/*
 * @Author: 1orz cloudorzi@gmail.com
 * @Date: 2025-12-10 09:19:05
 * @LastEditors: 1orz cloudorzi@gmail.com
 * @LastEditTime: 2025-12-13 12:46:12
 * @FilePath: /udx710-backend/backend/src/ota.rs
 * @Description:
 *
 * Copyright (c) 2025 by 1orz, All Rights Reserved.
 */
//! OTA 更新模块
//!
//! 处理 OTA 更新包的上传、验证和应用

use crate::diagnostics;
use crate::models::{OtaMeta, OtaStatusResponse, OtaUploadResponse, OtaValidation};
use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// OTA 相关路径
const OTA_STAGING_DIR: &str = "/tmp/ota_staging";
const OTA_BINARY_PATH: &str = "/home/root/udx710";
const OTA_WWW_PATH: &str = "/home/root/www";
const OTA_LOG_PATH: &str = "/home/root/udx710-ota.log";
const OTA_STATE_PATH: &str = "/home/root/udx710-ota.state";
const OTA_LOG_MAX_BYTES: u64 = 128 * 1024;
static OTA_OPERATION: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 当前版本信息（编译时注入）
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 获取当前 commit（从环境变量或默认值）
pub fn get_current_commit() -> String {
    option_env!("GIT_COMMIT").unwrap_or("unknown").to_string()
}

/// 获取 OTA 更新状态
pub fn get_ota_status() -> OtaStatusResponse {
    let pending_meta = read_pending_meta();

    OtaStatusResponse {
        current_version: CURRENT_VERSION.to_string(),
        current_commit: get_current_commit(),
        pending_update: pending_meta.is_some(),
        pending_meta,
        ota_state: read_ota_state(),
    }
}

/// 读取 OTA 脚本持久化的阶段，便于断电后判断上一次更新停在哪一步。
fn read_ota_state() -> Option<String> {
    fs::read_to_string(OTA_STATE_PATH)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn write_ota_state(state: &str) {
    let temp_path = format!("{OTA_STATE_PATH}.tmp");
    if fs::write(&temp_path, format!("{state}\n")).is_ok() {
        let _ = fs::rename(temp_path, OTA_STATE_PATH);
    }
}

/// 保留最新的一套回滚文件，启动时再次执行以覆盖 OTA 脚本被断电打断的情况。
pub fn cleanup_old_backups() -> Result<usize, String> {
    let parent = Path::new(OTA_BINARY_PATH)
        .parent()
        .ok_or_else(|| "Invalid OTA binary path".to_string())?;
    let mut binary_backups = Vec::new();
    let mut frontend_backups = Vec::new();

    let entries = fs::read_dir(parent).map_err(|e| format!("Failed to read OTA directory: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read OTA entry: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("udx710.bak.") && entry.path().is_file() {
            binary_backups.push(entry.path());
        } else if name.starts_with("www.bak.") && entry.path().is_dir() {
            frontend_backups.push(entry.path());
        }
    }

    binary_backups.sort();
    frontend_backups.sort();
    let mut removed = 0;
    let binary_keep_count = binary_backups.len().saturating_sub(1);
    for path in binary_backups.into_iter().take(binary_keep_count) {
        if fs::remove_file(path).is_ok() {
            removed += 1;
        }
    }
    let frontend_keep_count = frontend_backups.len().saturating_sub(1);
    for path in frontend_backups.into_iter().take(frontend_keep_count) {
        if fs::remove_dir_all(path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// 读取待安装的更新元数据
fn read_pending_meta() -> Option<OtaMeta> {
    let meta_path = format!("{}/meta.json", OTA_STAGING_DIR);
    if let Ok(content) = fs::read_to_string(&meta_path) {
        serde_json::from_str(&content).ok()
    } else {
        None
    }
}

/// 处理上传的 OTA 包（支持 tar.gz 和 zip 格式）
pub fn handle_ota_upload(data: &[u8]) -> Result<OtaUploadResponse, String> {
    let _operation = OTA_OPERATION
        .try_lock()
        .map_err(|_| "Another OTA operation is in progress".to_string())?;
    // 清理并创建临时目录
    let _ = fs::remove_dir_all(OTA_STAGING_DIR);
    fs::create_dir_all(OTA_STAGING_DIR)
        .map_err(|e| format!("Failed to create staging dir: {}", e))?;

    // 自动检测文件格式
    let is_zip = detect_zip_format(data);

    let extract_result = if is_zip {
        extract_zip_safely(data)
    } else {
        extract_tar_gz_safely(data)
    };

    if let Err(e) = extract_result {
        let _ = fs::remove_dir_all(OTA_STAGING_DIR);
        return Err(e);
    }

    if is_zip {
        // ZIP 格式不保留 Unix 权限，需要手动设置
        if let Err(e) = fix_file_permissions() {
            let _ = fs::remove_dir_all(OTA_STAGING_DIR);
            return Err(e);
        }
    }

    // 读取 meta.json
    let meta_path = format!("{}/meta.json", OTA_STAGING_DIR);
    let meta_content = match fs::read_to_string(&meta_path) {
        Ok(content) => content,
        Err(_) => {
            let _ = fs::remove_dir_all(OTA_STAGING_DIR);
            return Err("meta.json not found in OTA package".to_string());
        }
    };

    let meta: OtaMeta = match serde_json::from_str(&meta_content) {
        Ok(meta) => meta,
        Err(e) => {
            let _ = fs::remove_dir_all(OTA_STAGING_DIR);
            return Err(format!("Invalid meta.json: {}", e));
        }
    };

    // 验证
    let validation = validate_ota_package(&meta)?;
    if !validation.valid {
        let _ = fs::remove_dir_all(OTA_STAGING_DIR);
    }

    diagnostics::record(format!(
        "OTA upload version={} valid={} newer={}",
        meta.version, validation.valid, validation.is_newer
    ));
    Ok(OtaUploadResponse { meta, validation })
}

/// 安全解压 tar.gz，拒绝绝对路径、父目录跳转和符号链接
fn extract_tar_gz_safely(data: &[u8]) -> Result<(), String> {
    let decoder = GzDecoder::new(Cursor::new(data));
    let mut archive = tar::Archive::new(decoder);
    let entries = archive
        .entries()
        .map_err(|e| format!("Failed to read tar archive: {}", e))?;

    for entry in entries {
        let mut entry = entry.map_err(|e| format!("Failed to read tar entry: {}", e))?;
        let entry_path = entry
            .path()
            .map_err(|e| format!("Failed to read tar entry path: {}", e))?;
        let entry_path = entry_path.into_owned();
        let dest_path = safe_staging_path(&entry_path)?;
        let entry_type = entry.header().entry_type();

        if entry_type.is_dir() {
            fs::create_dir_all(&dest_path)
                .map_err(|e| format!("Failed to create directory {:?}: {}", dest_path, e))?;
        } else if entry_type.is_file() {
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory {:?}: {}", parent, e))?;
            }
            entry
                .unpack(&dest_path)
                .map_err(|e| format!("Failed to extract {:?}: {}", dest_path, e))?;
        } else {
            return Err(format!(
                "Refusing unsafe tar entry type {:?} for {:?}",
                entry_type, entry_path
            ));
        }
    }

    Ok(())
}

/// 安全解压 ZIP，拒绝绝对路径和父目录跳转
fn extract_zip_safely(data: &[u8]) -> Result<(), String> {
    let reader = Cursor::new(data);
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|e| format!("Failed to read zip archive: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;
        let enclosed_path = file
            .enclosed_name()
            .ok_or_else(|| format!("Unsafe zip entry path: {}", file.name()))?
            .to_path_buf();
        let dest_path = safe_staging_path(&enclosed_path)?;

        if file.is_dir() {
            fs::create_dir_all(&dest_path)
                .map_err(|e| format!("Failed to create directory {:?}: {}", dest_path, e))?;
            continue;
        }

        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory {:?}: {}", parent, e))?;
        }

        let mut out_file = fs::File::create(&dest_path)
            .map_err(|e| format!("Failed to create {:?}: {}", dest_path, e))?;
        io::copy(&mut file, &mut out_file)
            .map_err(|e| format!("Failed to extract {:?}: {}", dest_path, e))?;

        #[cfg(unix)]
        if let Some(mode) = file.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dest_path, fs::Permissions::from_mode(mode))
                .map_err(|e| format!("Failed to set permissions for {:?}: {}", dest_path, e))?;
        }
    }

    Ok(())
}

fn safe_staging_path(path: &Path) -> Result<PathBuf, String> {
    let mut dest = PathBuf::from(OTA_STAGING_DIR);
    let mut has_component = false;

    for component in path.components() {
        match component {
            Component::Normal(part) => {
                dest.push(part);
                has_component = true;
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Unsafe OTA archive path: {:?}", path));
            }
        }
    }

    if !has_component {
        return Err(format!("Empty OTA archive path: {:?}", path));
    }

    Ok(dest)
}

/// 验证 OTA 包
fn validate_ota_package(meta: &OtaMeta) -> Result<OtaValidation, String> {
    let binary_path = format!("{}/udx710", OTA_STAGING_DIR);
    let www_path = format!("{}/www", OTA_STAGING_DIR);

    // 检查文件存在
    if !Path::new(&binary_path).exists() {
        return Ok(OtaValidation {
            valid: false,
            is_newer: false,
            binary_md5_match: false,
            frontend_md5_match: false,
            binary_sha256_match: None,
            frontend_sha256_match: None,
            arch_match: false,
            error: Some("Binary file not found in package".to_string()),
        });
    }

    if !Path::new(&www_path).exists() {
        return Ok(OtaValidation {
            valid: false,
            is_newer: false,
            binary_md5_match: false,
            frontend_md5_match: false,
            binary_sha256_match: None,
            frontend_sha256_match: None,
            arch_match: false,
            error: Some("Frontend directory not found in package".to_string()),
        });
    }

    // 计算二进制 MD5（严格验证）
    let binary_md5 = calculate_file_md5(&binary_path)?;
    let binary_md5_match = binary_md5 == meta.binary_md5;

    let binary_sha256_match = match meta.binary_sha256.as_deref() {
        Some(expected) => {
            let actual = calculate_file_sha256(&binary_path)?;
            Some(actual.eq_ignore_ascii_case(expected))
        }
        None => None,
    };

    let frontend_sha256_match = match meta.frontend_sha256.as_deref() {
        Some(expected) => {
            let actual = calculate_dir_sha256(&www_path)?;
            Some(actual.eq_ignore_ascii_case(expected))
        }
        None => None,
    };

    // 旧包没有 SHA-256 时，前端目录存在即可（历史 MD5 算法跨平台不稳定）
    let frontend_md5_match = true;

    // 检查架构（只接受 musl）
    let arch_match = meta.arch == "aarch64-unknown-linux-musl";

    // 比较版本
    let is_newer = compare_versions(&meta.version, CURRENT_VERSION);

    let binary_hash_match = binary_sha256_match.unwrap_or(binary_md5_match);
    let frontend_hash_match = frontend_sha256_match.unwrap_or(frontend_md5_match);
    let valid = binary_hash_match && frontend_hash_match && arch_match;

    // 生成详细的错误信息
    let error = if !valid {
        let mut errors = Vec::new();
        if !binary_hash_match {
            errors.push(format!(
                "Binary MD5 mismatch: expected={}, actual={}",
                meta.binary_md5, binary_md5
            ));
        }
        if binary_sha256_match == Some(false) {
            errors.push("Binary SHA-256 mismatch".to_string());
        }
        if frontend_sha256_match == Some(false) {
            errors.push("Frontend SHA-256 mismatch".to_string());
        }
        if !arch_match {
            errors.push(format!(
                "Arch mismatch: expected=aarch64-unknown-linux-musl, actual={}",
                meta.arch
            ));
        }
        Some(errors.join("; "))
    } else {
        None
    };

    Ok(OtaValidation {
        valid,
        is_newer,
        binary_md5_match,
        frontend_md5_match,
        binary_sha256_match,
        frontend_sha256_match,
        arch_match,
        error,
    })
}

/// 计算文件 MD5
fn calculate_file_md5(path: &str) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;

    let mut context = md5::Context::new();
    let mut buffer = [0u8; 8192];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read file: {}", e))?;
        if read == 0 {
            break;
        }
        context.consume(&buffer[..read]);
    }

    Ok(format!("{:x}", context.compute()))
}

/// 计算文件 SHA-256
fn calculate_file_sha256(path: &str) -> Result<String, String> {
    calculate_file_sha256_path(Path::new(path))
}

fn calculate_file_sha256_path(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read file: {}", e))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

/// 计算目录 SHA-256：按相对路径排序，hash(相对路径 + NUL + 文件 SHA-256 + 换行)
fn calculate_dir_sha256(path: &str) -> Result<String, String> {
    let base = Path::new(path);
    let mut files = Vec::new();
    collect_regular_files(base, &mut files)?;

    files.sort_by_key(|a| relative_path_key(base, a));

    let mut hasher = Sha256::new();
    for file in files {
        let rel = relative_path_key(base, &file);
        let file_hash = calculate_file_sha256_path(&file)?;
        hasher.update(rel.as_bytes());
        hasher.update([0]);
        hasher.update(file_hash.as_bytes());
        hasher.update(b"\n");
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn collect_regular_files(path: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries =
        fs::read_dir(path).map_err(|e| format!("Failed to read directory {:?}: {}", path, e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to read file type {:?}: {}", entry.path(), e))?;
        let path = entry.path();

        if file_type.is_dir() {
            collect_regular_files(&path, files)?;
        } else if file_type.is_file() {
            files.push(path);
        } else {
            return Err(format!(
                "Refusing non-regular file in OTA package: {:?}",
                path
            ));
        }
    }

    Ok(())
}

fn relative_path_key(base: &Path, path: &Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// 比较版本号（返回 v1 > v2）
fn compare_versions(v1: &str, v2: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> { v.split('.').filter_map(|s| s.parse().ok()).collect() };

    let v1_parts = parse(v1);
    let v2_parts = parse(v2);

    for i in 0..std::cmp::max(v1_parts.len(), v2_parts.len()) {
        let p1 = v1_parts.get(i).unwrap_or(&0);
        let p2 = v2_parts.get(i).unwrap_or(&0);
        if p1 > p2 {
            return true;
        } else if p1 < p2 {
            return false;
        }
    }
    false
}

/// 获取当前进程实际监听的端口，保证 OTA 重启后不会回到默认端口。
fn current_listen_port() -> String {
    let args: Vec<String> = std::env::args().collect();
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == "-p" || arg == "--port" {
            if let Some(port) = args
                .get(index + 1)
                .and_then(|value| value.parse::<u16>().ok())
            {
                return port.to_string();
            }
        } else if let Some(port) = arg.strip_prefix("--port=") {
            if let Ok(port) = port.parse::<u16>() {
                return port.to_string();
            }
        } else if let Some(port) = arg.strip_prefix("-p") {
            if let Ok(port) = port.parse::<u16>() {
                return port.to_string();
            }
        }
        index += 1;
    }

    std::env::var("PORT")
        .ok()
        .and_then(|port| port.parse::<u16>().ok())
        .map(|port| port.to_string())
        .unwrap_or_else(|| "3000".to_string())
}

fn ota_backup_suffix() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{timestamp}-{}", std::process::id())
}

/// 在不重启当前进程时切换磁盘上的版本。
///
/// Linux 允许重命名正在执行的文件；当前进程继续使用旧 inode，下一次
/// 服务启动会从正式路径加载新文件。先保留旧文件，再分别切换二进制和
/// 前端目录，任一步失败都恢复旧版本，避免留下半套更新。
fn install_prepared_update_without_restart(
    prepared_binary: &str,
    prepared_www: &str,
) -> Result<(), String> {
    let old_binary = Path::new(OTA_BINARY_PATH);
    let old_www = Path::new(OTA_WWW_PATH);
    let suffix = ota_backup_suffix();
    let binary_backup = format!("{OTA_BINARY_PATH}.bak.{suffix}");
    let www_backup = format!("{OTA_WWW_PATH}.bak.{suffix}");
    let had_binary = old_binary.exists();
    let had_www = old_www.exists();

    if had_binary {
        fs::rename(old_binary, &binary_backup)
            .map_err(|error| format!("Failed to preserve current binary: {error}"))?;
    }
    if had_www {
        if let Err(error) = fs::rename(old_www, &www_backup) {
            if had_binary {
                let _ = fs::rename(&binary_backup, old_binary);
            }
            return Err(format!("Failed to preserve current frontend: {error}"));
        }
    }

    let mut binary_installed = false;
    let mut frontend_installed = false;
    let result = (|| {
        fs::rename(prepared_binary, old_binary)
            .map_err(|error| format!("Failed to install prepared binary: {error}"))?;
        binary_installed = true;
        fs::rename(prepared_www, old_www)
            .map_err(|error| format!("Failed to install prepared frontend: {error}"))?;
        frontend_installed = true;

        let chmod = Command::new("chmod")
            .args(["755", OTA_BINARY_PATH])
            .output()
            .map_err(|error| format!("Failed to chmod installed binary: {error}"))?;
        if !chmod.status.success() {
            return Err(format!(
                "Failed to chmod installed binary: {}",
                String::from_utf8_lossy(&chmod.stderr).trim()
            ));
        }
        Ok(())
    })();

    if let Err(error) = result {
        if frontend_installed {
            let _ = fs::remove_dir_all(old_www);
        }
        if binary_installed {
            let _ = fs::remove_file(old_binary);
        }
        let _ = fs::remove_file(prepared_binary);
        let _ = fs::remove_dir_all(prepared_www);
        if had_binary {
            let _ = fs::rename(&binary_backup, old_binary);
        }
        if had_www {
            let _ = fs::rename(&www_backup, old_www);
        }
        return Err(error);
    }

    Ok(())
}

/// 服务重启后收敛“仅应用”留下的 prepared 状态。
pub fn finalize_previous_update() {
    if read_ota_state().as_deref() != Some("prepared") {
        return;
    }

    let prepared_binary = format!("{OTA_BINARY_PATH}.new");
    let prepared_www = format!("{OTA_WWW_PATH}.new");
    if Path::new(&prepared_binary).exists()
        || Path::new(&prepared_www).exists()
        || !Path::new(OTA_BINARY_PATH).is_file()
        || !Path::new(OTA_WWW_PATH).is_dir()
    {
        return;
    }

    write_ota_state("completed");
    diagnostics::record("OTA prepared update is active after service restart");
}

/// 应用 OTA 更新
pub fn apply_ota_update(restart_now: bool) -> Result<String, String> {
    let _operation = OTA_OPERATION
        .try_lock()
        .map_err(|_| "Another OTA operation is in progress".to_string())?;
    let meta = read_pending_meta().ok_or_else(|| "No pending update".to_string())?;

    let validation = validate_ota_package(&meta)?;
    if !validation.valid {
        diagnostics::record(format!(
            "OTA apply rejected version={} reason={}",
            meta.version,
            validation.error.as_deref().unwrap_or("unknown")
        ));
        return Err(format!(
            "Pending OTA package failed validation: {}",
            validation
                .error
                .unwrap_or_else(|| "unknown validation error".to_string())
        ));
    }

    let staging_binary = format!("{}/udx710", OTA_STAGING_DIR);
    let staging_www = format!("{}/www", OTA_STAGING_DIR);
    let prepared_binary = format!("{}.new", OTA_BINARY_PATH);
    let prepared_www = format!("{}.new", OTA_WWW_PATH);

    // 不能直接写入正在运行的 /home/root/udx710；Linux 会返回 Text file busy。
    // 先把新文件准备到 .new 路径，重启模式交给独立脚本切换，非重启模式
    // 通过重命名切换正式路径并等待下一次服务启动加载。
    let _ = fs::remove_file(&prepared_binary);
    fs::copy(&staging_binary, &prepared_binary)
        .map_err(|e| format!("Failed to prepare binary: {}", e))?;

    Command::new("chmod")
        .args(["755", &prepared_binary])
        .output()
        .map_err(|e| format!("Failed to chmod prepared binary: {}", e))?;

    let _ = fs::remove_dir_all(&prepared_www);
    copy_dir_recursive(&staging_www, &prepared_www)?;

    // 暂存目录已经复制到 .new，可以清理，避免 pending_update 残留。
    let _ = fs::remove_dir_all(OTA_STAGING_DIR);
    diagnostics::record(format!(
        "OTA apply prepared version={} restart_now={restart_now}",
        meta.version
    ));

    if restart_now {
        write_ota_state("prepared");
        let current_pid = std::process::id();
        let port = current_listen_port();
        let script_path = "/tmp/udx710_apply_ota.sh";
        let script = format!(
            r#"#!/bin/sh
set -u
LOG="{ota_log}"
STATE="{ota_state}"
OLD_BIN="{old_bin}"
NEW_BIN="{new_bin}"
OLD_WWW="{old_www}"
NEW_WWW="{new_www}"
PORT="{port}"
TS=$(date +%Y%m%d%H%M%S 2>/dev/null || echo now)
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -ge {ota_log_max} ]; then
  mv "$LOG" "$LOG.1" 2>/dev/null || true
fi
echo "[$TS] applying OTA" > "$LOG"
write_state() {{
  printf '%s\n' "$1" > "$STATE"
  sync
}}
write_state "applying"

rollback() {{
  echo "[$TS] new service failed health check, rolling back" >> "$LOG"
  write_state "rolling_back"
  if [ -n "${{NEW_PID:-}}" ]; then
    kill "$NEW_PID" 2>/dev/null || true
  fi
  if [ -f "$OLD_BIN.bak.$TS" ]; then
    rm -f "$OLD_BIN"
    mv "$OLD_BIN.bak.$TS" "$OLD_BIN"
  fi
  if [ -d "$OLD_WWW.bak.$TS" ]; then
    rm -rf "$OLD_WWW"
    mv "$OLD_WWW.bak.$TS" "$OLD_WWW"
  fi
  chmod 755 "$OLD_BIN" 2>/dev/null || true
  "$OLD_BIN" -p "$PORT" >> "$LOG" 2>&1 &
  echo "[$TS] previous service restarted" >> "$LOG"
  write_state "rolled_back"
  exit 1
}}

sleep 1
kill {pid} 2>/dev/null || killall udx710 2>/dev/null || true
sleep 1
if [ ! -f "$NEW_BIN" ]; then
  echo "missing prepared binary: $NEW_BIN" >> "$LOG"
  exit 1
fi
if [ ! -d "$NEW_WWW" ]; then
  echo "missing prepared frontend: $NEW_WWW" >> "$LOG"
  exit 1
fi
if [ -f "$OLD_BIN" ]; then
  mv "$OLD_BIN" "$OLD_BIN.bak.$TS"
fi
if [ -d "$OLD_WWW" ]; then
  mv "$OLD_WWW" "$OLD_WWW.bak.$TS"
fi
mv "$NEW_BIN" "$OLD_BIN"
mv "$NEW_WWW" "$OLD_WWW"
chmod 755 "$OLD_BIN"
write_state "health_check"
"$OLD_BIN" -p "$PORT" >> "$LOG" 2>&1 &
NEW_PID=$!
HEALTHY=0
for attempt in 1 2 3 4 5; do
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --connect-timeout 1 --max-time 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && HEALTHY=1
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 3 -O /dev/null "http://127.0.0.1:$PORT/api/health" && HEALTHY=1
  else
    kill -0 "$NEW_PID" 2>/dev/null && HEALTHY=1
  fi
  [ "$HEALTHY" -eq 1 ] && break
  sleep 1
done
if [ "$HEALTHY" -ne 1 ]; then
  rollback
fi
write_state "healthy"
# 只保留本次回滚副本，避免多次 OTA 逐渐占满设备存储。
for backup in "$OLD_BIN".bak.*; do
  [ -f "$backup" ] || continue
  [ "$backup" = "$OLD_BIN.bak.$TS" ] || rm -f "$backup"
done
for backup in "$OLD_WWW".bak.*; do
  [ -d "$backup" ] || continue
  [ "$backup" = "$OLD_WWW.bak.$TS" ] || rm -rf "$backup"
done
echo "[$TS] OTA applied and service restarted" >> "$LOG"
write_state "completed"
"#,
            old_bin = OTA_BINARY_PATH,
            new_bin = prepared_binary,
            old_www = OTA_WWW_PATH,
            new_www = prepared_www,
            pid = current_pid,
            port = port,
            ota_log = OTA_LOG_PATH,
            ota_state = OTA_STATE_PATH,
            ota_log_max = OTA_LOG_MAX_BYTES,
        );
        fs::write(script_path, script)
            .map_err(|e| format!("Failed to write OTA apply script: {}", e))?;
        Command::new("chmod")
            .args(["755", script_path])
            .output()
            .map_err(|e| format!("Failed to chmod OTA apply script: {}", e))?;
        Command::new("/bin/sh")
            .arg(script_path)
            .spawn()
            .map_err(|e| format!("Failed to spawn OTA apply script: {}", e))?;

        Ok(format!(
            "Update to version {} prepared successfully",
            meta.version
        ))
    } else {
        install_prepared_update_without_restart(&prepared_binary, &prepared_www)?;
        write_ota_state("prepared");
        diagnostics::record(format!(
            "OTA update switched on disk version={} awaiting service restart",
            meta.version
        ));
        Ok(format!(
            "Update to version {} applied; restart service to activate",
            meta.version
        ))
    }
}

/// 递归复制目录
fn copy_dir_recursive(src: &str, dst: &str) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Failed to create dir: {}", e))?;

    let entries = fs::read_dir(src).map_err(|e| format!("Failed to read src dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = Path::new(dst).join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to read file type: {}", e))?;

        if file_type.is_dir() {
            copy_dir_recursive(
                src_path.to_str().unwrap_or(""),
                dst_path.to_str().unwrap_or(""),
            )?;
        } else if file_type.is_file() {
            fs::copy(&src_path, &dst_path).map_err(|e| format!("Failed to copy file: {}", e))?;
        } else {
            return Err(format!("Refusing to copy non-regular file: {:?}", src_path));
        }
    }

    Ok(())
}

/// 取消待安装的更新
pub fn cancel_pending_update() -> Result<(), String> {
    let _operation = OTA_OPERATION
        .try_lock()
        .map_err(|_| "Another OTA operation is in progress".to_string())?;
    if Path::new(OTA_STAGING_DIR).exists() {
        fs::remove_dir_all(OTA_STAGING_DIR)
            .map_err(|e| format!("Failed to remove staging dir: {}", e))?;
    }
    Ok(())
}

/// 检测文件是否为 ZIP 格式（通过魔术字节）
fn detect_zip_format(data: &[u8]) -> bool {
    // ZIP 文件魔术字节: PK\x03\x04 (0x504B0304)
    // TAR.GZ 文件魔术字节: \x1f\x8b (gzip header)
    if data.len() < 4 {
        return false;
    }

    // 检查是否是 ZIP 格式
    data[0] == 0x50 && data[1] == 0x4B && data[2] == 0x03 && data[3] == 0x04
}

/// 修复文件权限（用于 ZIP 解压后）
fn fix_file_permissions() -> Result<(), String> {
    let binary_path = format!("{}/udx710", OTA_STAGING_DIR);
    let www_path = format!("{}/www", OTA_STAGING_DIR);

    // 设置二进制文件权限为 755（可执行）
    if Path::new(&binary_path).exists() {
        Command::new("chmod")
            .args(["755", &binary_path])
            .output()
            .map_err(|e| format!("Failed to chmod binary: {}", e))?;
    }

    // 设置前端文件权限：目录 755，文件 644
    if Path::new(&www_path).exists() {
        // 所有目录设置为 755
        let _ = Command::new("find")
            .args([&www_path, "-type", "d", "-exec", "chmod", "755", "{}", "+"])
            .output();

        // 所有文件设置为 644
        let _ = Command::new("find")
            .args([&www_path, "-type", "f", "-exec", "chmod", "644", "{}", "+"])
            .output();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A private directory per test, removed on drop even if the test panics.
    struct TestDir(PathBuf);

    impl TestDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "udx710-ota-{label}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("clock should be after unix epoch")
                    .as_nanos()
            ));
            fs::create_dir_all(&dir).expect("create ota test directory");
            Self(dir)
        }

        fn write(&self, rel: &str, contents: &[u8]) {
            let path = self.0.join(rel);
            fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
            fs::write(path, contents).expect("write fixture file");
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn versions_compare_numerically_not_lexicographically() {
        assert!(compare_versions("3.3.12", "3.3.11"));
        assert!(compare_versions("10.0.0", "9.9.9"));
        assert!(compare_versions("3.4", "3.3.9"));
        assert!(!compare_versions("3.3.11", "3.3.11"));
        assert!(!compare_versions("3.3.10", "3.3.11"));
        assert!(
            !compare_versions("3.3", "3.3.0"),
            "missing parts count as zero"
        );
        assert!(!compare_versions("3.3.0", "3.3"));
    }

    #[test]
    fn archive_paths_stay_inside_the_staging_directory() {
        let staging = PathBuf::from(OTA_STAGING_DIR);
        assert_eq!(
            safe_staging_path(Path::new("udx710")).unwrap(),
            staging.join("udx710")
        );
        assert_eq!(
            safe_staging_path(Path::new("./www/assets/app.js")).unwrap(),
            staging.join("www").join("assets").join("app.js")
        );
        assert_eq!(
            safe_staging_path(Path::new("www/")).unwrap(),
            staging.join("www")
        );
    }

    #[test]
    fn archive_paths_that_escape_or_are_empty_are_refused() {
        for bad in [
            "../etc/passwd",
            "www/../../etc/passwd",
            "/etc/passwd",
            "",
            ".",
            "./",
        ] {
            assert!(
                safe_staging_path(Path::new(bad)).is_err(),
                "{bad:?} must be refused"
            );
        }
    }

    #[test]
    fn file_hash_matches_the_known_sha256() {
        let dir = TestDir::new("file");
        dir.write("hello.txt", b"hello");
        let hash = calculate_file_sha256_path(&dir.0.join("hello.txt")).expect("hash");
        assert_eq!(
            hash,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert!(calculate_file_sha256_path(&dir.0.join("missing")).is_err());
    }

    /// The expected value was computed independently (Python, the same algorithm
    /// `scripts/pack-ota.sh` uses): sha256 over `rel \0 file_sha256 \n` for every
    /// file, ordered by the relative path string.  `a.txt` sorts before `a/b`
    /// because '.' < '/', which a per-component path sort would get wrong.
    #[test]
    fn directory_hash_matches_the_independent_implementation() {
        let dir = TestDir::new("dir");
        dir.write("sub/b.js", b"world");
        dir.write("a/b", b"nested");
        dir.write("a.txt", b"hello");

        assert_eq!(
            calculate_dir_sha256(dir.0.to_str().expect("utf-8 path")).expect("hash"),
            "69de3f26b0c4f642fcb6f778c326bbdc061005618819a52538f9e36b8e821f63"
        );
    }

    #[test]
    fn directory_hash_changes_with_content_and_with_names() {
        let a = TestDir::new("hash-a");
        a.write("x.js", b"one");
        let b = TestDir::new("hash-b");
        b.write("x.js", b"two");
        let c = TestDir::new("hash-c");
        c.write("y.js", b"one");

        let hash =
            |d: &TestDir| calculate_dir_sha256(d.0.to_str().expect("utf-8 path")).expect("hash");
        assert_ne!(hash(&a), hash(&b), "content change");
        assert_ne!(hash(&a), hash(&c), "rename");
    }

    #[test]
    fn collecting_files_walks_subdirectories_and_uses_forward_slash_keys() {
        let dir = TestDir::new("walk");
        dir.write("index.html", b"<html>");
        dir.write("assets/js/app.js", b"x");

        let mut files = Vec::new();
        collect_regular_files(&dir.0, &mut files).expect("walk");
        let mut keys: Vec<String> = files.iter().map(|f| relative_path_key(&dir.0, f)).collect();
        keys.sort();
        assert_eq!(keys, vec!["assets/js/app.js", "index.html"]);
    }

    #[test]
    fn zip_and_gzip_payloads_are_told_apart() {
        assert!(detect_zip_format(b"PK\x03\x04rest"));
        assert!(!detect_zip_format(&[0x1f, 0x8b, 0x08, 0x00]));
        assert!(!detect_zip_format(b""));
    }
}
