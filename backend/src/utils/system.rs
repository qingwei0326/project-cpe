//! 自 utils.rs 拆出（纯移动，逻辑未改）。

use super::*;

/// 从 /proc/meminfo 读取内存信息
///
/// # Returns
/// (total, available, cached, buffers) in bytes
pub fn read_memory_info() -> Result<(u64, u64, u64, u64), String> {
    use std::fs;

    let content = fs::read_to_string("/proc/meminfo")
        .map_err(|e| format!("Failed to read /proc/meminfo: {}", e))?;

    let mut total = 0u64;
    let mut available = 0u64;
    let mut cached = 0u64;
    let mut buffers = 0u64;

    for line in content.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }

        let value = parts[1].parse::<u64>().unwrap_or(0) * 1024; // Convert KB to bytes

        match parts[0] {
            "MemTotal:" => total = value,
            "MemAvailable:" => available = value,
            "Cached:" => cached = value,
            "Buffers:" => buffers = value,
            _ => {}
        }
    }

    Ok((total, available, cached, buffers))
}

/// 读取磁盘/分区使用情况
///
/// 自适应检测分区，去重处理（相同设备的多个挂载点只保留一个）
///
/// # Returns
/// 包含各个分区信息的 Vec<DiskInfo>
#[cfg(target_os = "linux")]
pub fn read_disk_info() -> Vec<crate::models::DiskInfo> {
    use std::collections::HashMap;
    use std::ffi::CString;
    use std::fs;

    // 读取 /proc/mounts
    let mounts = match fs::read_to_string("/proc/mounts") {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };

    // 用于设备去重：设备名 -> (挂载点, 文件系统类型, 优先级)
    // 优先级越低越优先显示
    let mut device_map: HashMap<String, (String, String, u8)> = HashMap::new();

    // 挂载点优先级（数字越小优先级越高）
    let get_priority = |mount: &str| -> u8 {
        match mount {
            "/" => 0,
            "/home" => 1,
            "/mnt/userdata" => 2,
            "/var" => 3,
            "/run" => 4,
            "/tmp" => 5,
            _ if mount.starts_with("/mnt/") => 10,
            _ if mount.starts_with("/var/") => 15,
            _ => 20,
        }
    };

    // 跳过的虚拟文件系统和挂载点
    let skip_fs = [
        "proc",
        "sysfs",
        "devtmpfs",
        "devpts",
        "cgroup",
        "cgroup2",
        "pstore",
        "bpf",
        "tracefs",
        "debugfs",
        "securityfs",
        "configfs",
        "fusectl",
        "hugetlbfs",
        "mqueue",
        "rpc_pipefs",
        "autofs",
        "functionfs",
    ];

    let skip_mounts = [
        "/dev",
        "/dev/pts",
        "/sys",
        "/proc",
        "/sys/kernel/config",
        "/dev/usb-ffs/adb",
    ];

    for line in mounts.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }

        let device = parts[0];
        let mount_point = parts[1];
        let fs_type = parts[2];

        // 跳过虚拟文件系统
        if skip_fs.contains(&fs_type) {
            continue;
        }

        // 跳过特定挂载点
        if skip_mounts.contains(&mount_point) {
            continue;
        }

        let priority = get_priority(mount_point);

        // 设备去重：同一设备保留优先级最高的挂载点
        let key = device.to_string();
        if let Some((_, _, existing_priority)) = device_map.get(&key) {
            if priority >= *existing_priority {
                continue; // 已有更高优先级的挂载点
            }
        }

        device_map.insert(
            key,
            (mount_point.to_string(), fs_type.to_string(), priority),
        );
    }

    // 收集磁盘信息
    let mut disks = Vec::new();

    for (_, (mount_point, fs_type, _)) in device_map {
        let c_path = match CString::new(mount_point.as_str()) {
            Ok(p) => p,
            Err(_) => continue,
        };

        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        let result = unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) };

        if result != 0 {
            continue;
        }

        let block_size = stat.f_frsize as u64;
        let total = stat.f_blocks as u64 * block_size;
        let available = stat.f_bavail as u64 * block_size;
        let free = stat.f_bfree as u64 * block_size;
        let used = total.saturating_sub(free);

        // 跳过太小的分区（< 1MB）
        if total < 1024 * 1024 {
            continue;
        }

        let used_percent = (used as f64 / total as f64) * 100.0;

        disks.push(crate::models::DiskInfo {
            mount_point,
            fs_type,
            total_bytes: total,
            used_bytes: used,
            available_bytes: available,
            used_percent,
        });
    }

    // 按挂载点排序：根目录优先，然后按名称
    disks.sort_by(|a, b| {
        let pa = get_priority(&a.mount_point);
        let pb = get_priority(&b.mount_point);
        if pa != pb {
            pa.cmp(&pb)
        } else {
            a.mount_point.cmp(&b.mount_point)
        }
    });

    disks
}

/// 桌面端没有 Linux `/proc/mounts` 和 `statvfs`，返回空列表供联调使用。
#[cfg(not(target_os = "linux"))]
pub fn read_disk_info() -> Vec<crate::models::DiskInfo> {
    Vec::new()
}

/// 从 /proc/uptime 读取系统运行时间
///
/// # Returns
/// (uptime_seconds, idle_seconds)
pub fn read_uptime() -> Result<(u64, u64), String> {
    use std::fs;

    let content = fs::read_to_string("/proc/uptime")
        .map_err(|e| format!("Failed to read /proc/uptime: {}", e))?;

    let parts: Vec<&str> = content.split_whitespace().collect();
    if parts.len() < 2 {
        return Err("Invalid /proc/uptime format".to_string());
    }

    let uptime = parts[0]
        .parse::<f64>()
        .map_err(|e| format!("Failed to parse uptime: {}", e))? as u64;

    let idle = parts[1]
        .parse::<f64>()
        .map_err(|e| format!("Failed to parse idle time: {}", e))? as u64;

    Ok((uptime, idle))
}

/// 格式化运行时间为人类可读格式
///
/// # Arguments
/// * `seconds` - 总秒数
///
/// # Returns
/// 格式化的字符串，如 "2天 3小时 45分钟"
pub fn format_uptime(seconds: u64) -> String {
    let days = seconds / 86400;
    let hours = (seconds % 86400) / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;

    let mut parts = Vec::new();

    if days > 0 {
        parts.push(format!("{}天", days));
    }
    if hours > 0 {
        parts.push(format!("{}小时", hours));
    }
    if minutes > 0 {
        parts.push(format!("{}分钟", minutes));
    }
    if parts.is_empty() || secs > 0 {
        parts.push(format!("{}秒", secs));
    }

    parts.join(" ")
}

/// 读取网络接口的流量统计
///
/// # Arguments
/// * `interface` - 网络接口名称（如 usb0, eth0）
///
/// # Returns
/// (rx_bytes, tx_bytes)
pub fn read_interface_stats(interface: &str) -> Result<(u64, u64), String> {
    use std::fs;

    let rx_path = format!("/sys/class/net/{}/statistics/rx_bytes", interface);
    let tx_path = format!("/sys/class/net/{}/statistics/tx_bytes", interface);

    let rx_bytes = fs::read_to_string(&rx_path)
        .map_err(|e| format!("Failed to read {}: {}", rx_path, e))?
        .trim()
        .parse::<u64>()
        .map_err(|e| format!("Failed to parse rx_bytes: {}", e))?;

    let tx_bytes = fs::read_to_string(&tx_path)
        .map_err(|e| format!("Failed to read {}: {}", tx_path, e))?
        .trim()
        .parse::<u64>()
        .map_err(|e| format!("Failed to parse tx_bytes: {}", e))?;

    Ok((rx_bytes, tx_bytes))
}

/// 获取所有活跃的网络接口列表
///
/// # Returns
/// 网络接口名称列表（排除 lo）
pub fn get_active_interfaces() -> Result<Vec<String>, String> {
    use std::fs;

    let entries = fs::read_dir("/sys/class/net")
        .map_err(|e| format!("Failed to read /sys/class/net: {}", e))?;

    let mut interfaces = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        // 排除回环接口
        if name != "lo" {
            // 检查接口是否 up
            let operstate_path = format!("/sys/class/net/{}/operstate", name);
            if let Ok(state) = fs::read_to_string(&operstate_path) {
                let state = state.trim();
                // 包含 up 和 unknown 状态的接口（unknown 可能是某些虚拟接口）
                if state == "up" || state == "unknown" {
                    interfaces.push(name);
                }
            }
        }
    }

    Ok(interfaces)
}

/// 从 /proc/stat 解析 CPU 时间
/// 返回 (total, idle)
fn parse_cpu_stat() -> Result<(u64, u64), String> {
    use std::fs;

    let stat = fs::read_to_string("/proc/stat")
        .map_err(|e| format!("Failed to read /proc/stat: {}", e))?;

    for line in stat.lines() {
        if line.starts_with("cpu ") {
            let values: Vec<u64> = line
                .split_whitespace()
                .skip(1) // 跳过 "cpu"
                .filter_map(|s| s.parse::<u64>().ok())
                .collect();

            if values.len() >= 4 {
                // user + nice + system + idle + iowait + irq + softirq + steal
                let user = values.first().copied().unwrap_or(0);
                let nice = values.get(1).copied().unwrap_or(0);
                let system = values.get(2).copied().unwrap_or(0);
                let idle = values.get(3).copied().unwrap_or(0);
                let iowait = values.get(4).copied().unwrap_or(0);
                let irq = values.get(5).copied().unwrap_or(0);
                let softirq = values.get(6).copied().unwrap_or(0);
                let steal = values.get(7).copied().unwrap_or(0);

                let total = user + nice + system + idle + iowait + irq + softirq + steal;
                let idle_total = idle + iowait;

                return Ok((total, idle_total));
            }
        }
    }

    Err("Failed to parse /proc/stat".to_string())
}

/// 后台采样得到的 CPU 和网卡统计快照。
#[derive(Debug, Clone, Default)]
pub struct SystemTelemetrySnapshot {
    pub network_speed: Vec<crate::models::NetworkSpeed>,
    pub network_interval_seconds: f64,
    pub cpu_load: crate::models::CpuLoadInfo,
}

#[derive(Default)]
struct TelemetryState {
    updated_at: Option<std::time::Instant>,
    network_samples: Vec<(String, u64, u64)>,
    cpu_sample: Option<(u64, u64)>,
    snapshot: Option<SystemTelemetrySnapshot>,
}

lazy_static::lazy_static! {
    static ref TELEMETRY_STATE: std::sync::Mutex<TelemetryState> =
        std::sync::Mutex::new(TelemetryState::default());
}

fn read_load_average() -> Result<(f64, f64, f64, u32), String> {
    use std::fs;

    let loadavg = fs::read_to_string("/proc/loadavg")
        .map_err(|e| format!("Failed to read /proc/loadavg: {}", e))?;
    let parts: Vec<&str> = loadavg.split_whitespace().collect();
    let load_1min = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let load_5min = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let load_15min = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let core_count = std::thread::available_parallelism()
        .map(|p| p.get() as u32)
        .unwrap_or(1);

    Ok((load_1min, load_5min, load_15min, core_count))
}

/// 采集一份 CPU 和网卡快照。
///
/// 该函数只读取内核计数器，不等待固定采样时间。由后台任务每秒调用，
/// 请求处理器直接读取最近结果，避免多个页面各自触发采样。
pub fn sample_system_telemetry() -> Result<SystemTelemetrySnapshot, String> {
    let now = std::time::Instant::now();
    let interfaces = get_active_interfaces()?;
    let current_network: Vec<(String, u64, u64)> = interfaces
        .iter()
        .filter_map(|interface| {
            read_interface_stats(interface)
                .ok()
                .map(|(rx, tx)| (interface.clone(), rx, tx))
        })
        .collect();
    let cpu_stat = parse_cpu_stat().ok();
    let (load_1min, load_5min, load_15min, core_count) = read_load_average()?;

    let mut state = TELEMETRY_STATE.lock_recover();
    let elapsed = state
        .updated_at
        .map(|updated_at| now.duration_since(updated_at).as_secs_f64())
        .filter(|value| *value > 0.0)
        .unwrap_or(0.0);

    let network_speed = current_network
        .iter()
        .map(|(interface, rx2, tx2)| {
            let previous = state
                .network_samples
                .iter()
                .find(|(name, _, _)| name == interface)
                .map(|(_, rx1, tx1)| (*rx1, *tx1));
            let (rx_speed, tx_speed) = match (previous, elapsed > 0.0) {
                (Some((rx1, tx1)), true) => (
                    (rx2.saturating_sub(rx1) as f64 / elapsed) as u64,
                    (tx2.saturating_sub(tx1) as f64 / elapsed) as u64,
                ),
                _ => (0, 0),
            };
            crate::models::NetworkSpeed {
                interface: interface.clone(),
                rx_bytes_per_sec: rx_speed,
                tx_bytes_per_sec: tx_speed,
                total_rx_bytes: *rx2,
                total_tx_bytes: *tx2,
            }
        })
        .collect();

    let load_percent = match (cpu_stat, state.cpu_sample) {
        (Some((total, idle)), Some((previous_total, previous_idle))) => {
            let total_diff = total.saturating_sub(previous_total);
            let idle_diff = idle.saturating_sub(previous_idle);
            if total_diff == 0 {
                0.0
            } else {
                let busy_diff = total_diff.saturating_sub(idle_diff);
                (busy_diff as f64 / total_diff as f64 * 100.0).clamp(0.0, 100.0)
            }
        }
        _ => 0.0,
    };

    let snapshot = SystemTelemetrySnapshot {
        network_speed,
        network_interval_seconds: elapsed,
        cpu_load: crate::models::CpuLoadInfo {
            load_1min,
            load_5min,
            load_15min,
            core_count,
            load_percent,
        },
    };
    state.updated_at = Some(now);
    state.network_samples = current_network;
    state.cpu_sample = cpu_stat;
    state.snapshot = Some(snapshot.clone());
    Ok(snapshot)
}

/// 读取最近的遥测快照；没有新快照时才同步采样一次。
pub fn read_system_telemetry() -> Result<SystemTelemetrySnapshot, String> {
    {
        let state = TELEMETRY_STATE.lock_recover();
        if let (Some(updated_at), Some(snapshot)) = (state.updated_at, state.snapshot.clone()) {
            if updated_at.elapsed() <= std::time::Duration::from_secs(2) {
                return Ok(snapshot);
            }
        }
    }
    sample_system_telemetry()
}

/// 兼容旧调用方的 CPU 负载读取接口。
#[allow(dead_code)]
pub fn read_cpu_load_sync() -> Result<crate::models::CpuLoadInfo, String> {
    read_system_telemetry().map(|snapshot| snapshot.cpu_load)
}

/// 异步采样 CPU 使用率（需要两次采样计算差值）
///
/// # Returns
/// CPU 使用率百分比 (0.0 - 100.0)
#[allow(dead_code)]
pub async fn sample_cpu_usage() -> Result<f64, String> {
    use tokio::time::{sleep, Duration};

    // 第一次采样
    let (total1, idle1) = parse_cpu_stat()?;

    // 等待 200ms
    sleep(Duration::from_millis(200)).await;

    // 第二次采样
    let (total2, idle2) = parse_cpu_stat()?;

    // 计算差值
    let total_diff = total2.saturating_sub(total1);
    let idle_diff = idle2.saturating_sub(idle1);

    if total_diff == 0 {
        return Ok(0.0);
    }

    // 计算 CPU 使用率
    let usage = ((total_diff - idle_diff) as f64 / total_diff as f64) * 100.0;

    Ok(usage.clamp(0.0, 100.0))
}

/// 从 /proc/cpuinfo 读取 CPU 信息
///
/// # Returns
/// CpuInfo 结构
pub fn read_cpu_info() -> Result<crate::models::CpuInfo, String> {
    use crate::models::{CpuCore, CpuInfo};
    use std::fs;

    let content = fs::read_to_string("/proc/cpuinfo")
        .map_err(|e| format!("Failed to read /proc/cpuinfo: {}", e))?;

    let mut cores = Vec::new();
    let mut current_core = CpuCore::default();
    let mut hardware = String::new();
    let mut serial = String::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            // 空行表示一个 processor 块结束
            if current_core.processor > 0 || !current_core.bogomips.is_empty() {
                cores.push(current_core.clone());
                current_core = CpuCore::default();
            }
            continue;
        }

        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim();
            let value = value.trim();

            match key {
                "processor" => {
                    if let Ok(num) = value.parse::<u32>() {
                        current_core.processor = num;
                    }
                }
                "BogoMIPS" => {
                    current_core.bogomips = value.to_string();
                }
                "Features" => {
                    current_core.features =
                        value.split_whitespace().map(|s| s.to_string()).collect();
                }
                "CPU implementer" => {
                    current_core.implementer = value.to_string();
                }
                "CPU architecture" => {
                    current_core.architecture = value.to_string();
                }
                "CPU variant" => {
                    current_core.variant = value.to_string();
                }
                "CPU part" => {
                    current_core.part = value.to_string();
                }
                "CPU revision" => {
                    current_core.revision = value.to_string();
                }
                "Hardware" => {
                    hardware = value.to_string();
                }
                "Serial" => {
                    serial = value.to_string();
                }
                _ => {}
            }
        }
    }

    // 处理最后一个核心（如果文件不以空行结尾）
    if current_core.processor > 0 || !current_core.bogomips.is_empty() {
        cores.push(current_core);
    }

    // 识别 CPU 型号
    let model_name = if !cores.is_empty() {
        identify_cpu_model(&cores[0].implementer, &cores[0].part)
    } else {
        "Unknown".to_string()
    };

    Ok(CpuInfo {
        core_count: cores.len() as u32,
        cores,
        hardware,
        serial,
        model_name,
    })
}

/// 从 uname 系统调用读取系统信息
///
/// # Returns
/// SystemInfo 结构
#[cfg(target_os = "linux")]
pub fn read_system_info() -> Result<crate::models::SystemInfo, String> {
    use crate::models::SystemInfo;
    use std::ffi::CStr;

    unsafe {
        let mut utsname: libc::utsname = std::mem::zeroed();

        if libc::uname(&mut utsname) != 0 {
            return Err("Failed to call uname system call".to_string());
        }

        // 将 C 字符串转换为 Rust String
        let sysname = CStr::from_ptr(utsname.sysname.as_ptr())
            .to_string_lossy()
            .to_string();

        let nodename = CStr::from_ptr(utsname.nodename.as_ptr())
            .to_string_lossy()
            .to_string();

        let release = CStr::from_ptr(utsname.release.as_ptr())
            .to_string_lossy()
            .to_string();

        let version = CStr::from_ptr(utsname.version.as_ptr())
            .to_string_lossy()
            .to_string();

        let machine = CStr::from_ptr(utsname.machine.as_ptr())
            .to_string_lossy()
            .to_string();

        // 注意：domainname 字段在某些平台上不可用，这里留空
        let domainname = String::new();

        // 构造类似 uname -a 的完整输出
        let full_info = format!(
            "{} {} {} {} {}",
            sysname, nodename, release, version, machine
        );

        Ok(SystemInfo {
            sysname,
            nodename,
            release,
            version,
            machine,
            domainname,
            full_info,
        })
    }
}

/// 非 Linux 构建提供最小系统信息，设备构建仍使用上面的 uname 实现。
#[cfg(not(target_os = "linux"))]
pub fn read_system_info() -> Result<crate::models::SystemInfo, String> {
    use crate::models::SystemInfo;
    let sysname = std::env::consts::OS.to_string();
    let machine = std::env::consts::ARCH.to_string();
    let nodename = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string());
    let full_info = format!("{sysname} {nodename} {machine}");
    Ok(SystemInfo {
        sysname,
        nodename,
        release: String::new(),
        version: String::new(),
        machine,
        domainname: String::new(),
        full_info,
    })
}

/// 根据 implementer 和 part 识别 CPU 型号
///
/// # Arguments
/// * `implementer` - CPU 实现者 ID（如 0x41 表示 ARM）
/// * `part` - CPU 部件号（如 0xd05 表示 Cortex-A55）
///
/// # Returns
/// CPU 型号名称
fn identify_cpu_model(implementer: &str, part: &str) -> String {
    // ARM implementer (0x41)
    if implementer == "0x41" {
        return match part {
            "0xd05" => "ARM Cortex-A55".to_string(),
            "0xd0a" => "ARM Cortex-A75".to_string(),
            "0xd0b" => "ARM Cortex-A76".to_string(),
            "0xd0c" => "ARM Neoverse N1".to_string(),
            "0xd0d" => "ARM Cortex-A77".to_string(),
            "0xd0e" => "ARM Cortex-A76AE".to_string(),
            "0xd40" => "ARM Neoverse V1".to_string(),
            "0xd41" => "ARM Cortex-A78".to_string(),
            "0xd44" => "ARM Cortex-X1".to_string(),
            "0xd46" => "ARM Cortex-A510".to_string(),
            "0xd47" => "ARM Cortex-A710".to_string(),
            "0xd48" => "ARM Cortex-X2".to_string(),
            "0xd49" => "ARM Neoverse N2".to_string(),
            "0xd4a" => "ARM Neoverse E1".to_string(),
            "0xd4b" => "ARM Cortex-A78AE".to_string(),
            "0xd4c" => "ARM Cortex-X1C".to_string(),
            "0xd4d" => "ARM Cortex-A715".to_string(),
            "0xd4e" => "ARM Cortex-X3".to_string(),
            _ => format!("ARM CPU (part: {})", part),
        };
    }

    format!("CPU (implementer: {}, part: {})", implementer, part)
}
