//! Lightweight persistent diagnostics for boot, shutdown and panic evidence.
//!
//! The device keeps `/home` small, so this intentionally uses one active log and
//! one rotated log.  The files are bounded and are written without going
//! through tracing, which keeps the panic path and early-startup path usable.

use chrono::Utc;
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

const MAX_LOG_BYTES: u64 = 512 * 1024;
const MAX_LOG_READ_BYTES: usize = 64 * 1024;
const LOG_FILE: &str = "udx710-diagnostics.log";
const ROTATED_LOG_FILE: &str = "udx710-diagnostics.log.1";
const BOOT_ID_PATH: &str = "/proc/sys/kernel/random/boot_id";
const UPTIME_PATH: &str = "/proc/uptime";
const PSTORE_PATH: &str = "/sys/fs/pstore";
const LAST_KMSG_PATH: &str = "/proc/last_kmsg";
const MAX_PSTORE_ENTRIES: usize = 8;

static LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static PROCESS_STARTED_AT: OnceLock<Instant> = OnceLock::new();
static SYSTEM_STARTUP: OnceLock<SystemStartupSnapshot> = OnceLock::new();
#[cfg(test)]
static TEST_ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Serialize, Clone)]
pub struct ResetEvidence {
    pub source: String,
    pub available: bool,
    pub readable: bool,
    pub bytes: Option<u64>,
    pub entries: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SystemStartupSnapshot {
    pub boot_id: Option<String>,
    pub system_uptime_seconds: Option<u64>,
    pub reset_evidence: Vec<ResetEvidence>,
}

#[derive(Debug, Serialize, Clone)]
pub struct DiagnosticsStatus {
    pub log_path: String,
    pub rotated_log_path: String,
    pub log_bytes: u64,
    pub rotated_log_bytes: u64,
    pub max_log_bytes: u64,
    pub pid: u32,
    pub uptime_seconds: Option<u64>,
    pub boot_id: Option<String>,
    pub boot_uptime_seconds: Option<u64>,
    pub system_uptime_seconds: Option<u64>,
    pub reset_evidence: Vec<ResetEvidence>,
}

fn state_dir() -> PathBuf {
    if let Ok(path) = std::env::var("UDX710_STATE_DIR") {
        if !path.trim().is_empty() {
            return PathBuf::from(path);
        }
    }

    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("/tmp"))
}

fn log_path() -> PathBuf {
    state_dir().join(LOG_FILE)
}

fn rotated_log_path() -> PathBuf {
    state_dir().join(ROTATED_LOG_FILE)
}

fn lock() -> &'static Mutex<()> {
    LOG_LOCK.get_or_init(|| Mutex::new(()))
}

fn append_line(line: &str) -> io::Result<()> {
    let _guard = lock()
        .lock()
        .map_err(|_| io::Error::other("diagnostics lock poisoned"))?;
    let path = log_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let incoming_bytes = line.len() as u64 + 1;
    if fs::metadata(&path)
        .map(|meta| meta.len().saturating_add(incoming_bytes) > MAX_LOG_BYTES)
        .unwrap_or(false)
    {
        let rotated = rotated_log_path();
        let _ = fs::remove_file(&rotated);
        let _ = fs::rename(&path, rotated);
    }

    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(line.as_bytes())?;
    file.write_all(b"\n")?;
    file.flush()
}

fn compact_event(event: &str) -> String {
    let mut value: String = event
        .chars()
        .map(|ch| if ch == '\n' || ch == '\r' { ' ' } else { ch })
        .collect();
    value.truncate(1024);
    value
}

fn compact_error(error: &io::Error) -> String {
    let mut value = error.to_string();
    value.truncate(160);
    value
}

fn read_trimmed(path: &str, max_bytes: usize) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(max_bytes as u64)
        .read_to_end(&mut bytes)
        .ok()?;
    let value = String::from_utf8_lossy(&bytes).trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn read_system_uptime_seconds() -> Option<u64> {
    read_trimmed(UPTIME_PATH, 128).and_then(|value| {
        value
            .split_whitespace()
            .next()?
            .split('.')
            .next()?
            .parse()
            .ok()
    })
}

fn pstore_evidence(path: &str) -> ResetEvidence {
    let path = PathBuf::from(path);
    let entries = match fs::read_dir(&path) {
        Ok(entries) => entries,
        Err(error) => {
            return ResetEvidence {
                source: path.display().to_string(),
                available: false,
                readable: false,
                bytes: None,
                entries: Vec::new(),
                error: Some(compact_error(&error)),
            };
        }
    };

    let mut names = Vec::new();
    let mut bytes = 0_u64;
    let mut error = None;
    for entry in entries.take(MAX_PSTORE_ENTRIES) {
        match entry {
            Ok(entry) => match entry.metadata() {
                Ok(metadata) if metadata.is_file() => {
                    let mut name = entry.file_name().to_string_lossy().into_owned();
                    name.truncate(96);
                    bytes = bytes.saturating_add(metadata.len());
                    names.push(name);
                }
                Ok(_) => {}
                Err(entry_error) => error = Some(compact_error(&entry_error)),
            },
            Err(entry_error) => error = Some(compact_error(&entry_error)),
        }
    }
    names.sort();
    ResetEvidence {
        source: path.display().to_string(),
        available: true,
        readable: true,
        bytes: Some(bytes),
        entries: names,
        error,
    }
}

fn last_kmsg_evidence(path: &str) -> ResetEvidence {
    let path = PathBuf::from(path);
    match fs::metadata(&path) {
        Ok(metadata) => match File::open(&path) {
            Ok(_) => ResetEvidence {
                source: path.display().to_string(),
                available: true,
                readable: true,
                bytes: Some(metadata.len()),
                entries: Vec::new(),
                error: None,
            },
            Err(error) => ResetEvidence {
                source: path.display().to_string(),
                available: true,
                readable: false,
                bytes: Some(metadata.len()),
                entries: Vec::new(),
                error: Some(compact_error(&error)),
            },
        },
        Err(error) => ResetEvidence {
            source: path.display().to_string(),
            available: false,
            readable: false,
            bytes: None,
            entries: Vec::new(),
            error: Some(compact_error(&error)),
        },
    }
}

fn capture_system_startup_with_paths(
    boot_id_path: &str,
    uptime_path: &str,
    pstore_path: &str,
    last_kmsg_path: &str,
) -> SystemStartupSnapshot {
    SystemStartupSnapshot {
        boot_id: read_trimmed(boot_id_path, 128),
        system_uptime_seconds: read_trimmed(uptime_path, 128).and_then(|value| {
            value
                .split_whitespace()
                .next()?
                .split('.')
                .next()?
                .parse()
                .ok()
        }),
        reset_evidence: vec![
            pstore_evidence(pstore_path),
            last_kmsg_evidence(last_kmsg_path),
        ],
    }
}

fn capture_system_startup() -> SystemStartupSnapshot {
    capture_system_startup_with_paths(BOOT_ID_PATH, UPTIME_PATH, PSTORE_PATH, LAST_KMSG_PATH)
}

fn system_startup() -> &'static SystemStartupSnapshot {
    SYSTEM_STARTUP.get_or_init(capture_system_startup)
}

pub fn record(event: impl AsRef<str>) {
    let line = format!(
        "{} {}",
        Utc::now().to_rfc3339(),
        compact_event(event.as_ref())
    );
    let _ = append_line(&line);
}

pub fn record_startup(bind_addr: &str) {
    PROCESS_STARTED_AT.get_or_init(Instant::now);
    let startup = system_startup();
    record(format!(
        "STARTUP pid={} version={} commit={} bind={}",
        std::process::id(),
        env!("APP_VERSION"),
        env!("GIT_COMMIT"),
        bind_addr
    ));
    let evidence = startup
        .reset_evidence
        .iter()
        .map(|item| {
            format!(
                "{}:available={} readable={} bytes={}",
                item.source,
                item.available,
                item.readable,
                item.bytes.unwrap_or(0)
            )
        })
        .collect::<Vec<_>>()
        .join(";");
    record(format!(
        "BOOT boot_id={} boot_uptime_seconds={} reset_evidence={}",
        startup.boot_id.as_deref().unwrap_or("unavailable"),
        startup.system_uptime_seconds.unwrap_or(0),
        evidence
    ));
}

pub fn record_shutdown(reason: &str) {
    record(format!("SHUTDOWN reason={reason}"));
}

pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        record(format!("PANIC {info}"));
        previous(info);
    }));
}

pub fn status() -> DiagnosticsStatus {
    let path = log_path();
    let rotated = rotated_log_path();
    DiagnosticsStatus {
        log_path: path.display().to_string(),
        rotated_log_path: rotated.display().to_string(),
        log_bytes: fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0),
        rotated_log_bytes: fs::metadata(&rotated).map(|meta| meta.len()).unwrap_or(0),
        max_log_bytes: MAX_LOG_BYTES,
        pid: std::process::id(),
        uptime_seconds: PROCESS_STARTED_AT
            .get()
            .map(|started_at| started_at.elapsed().as_secs()),
        boot_id: system_startup().boot_id.clone(),
        boot_uptime_seconds: system_startup().system_uptime_seconds,
        system_uptime_seconds: read_system_uptime_seconds(),
        reset_evidence: system_startup().reset_evidence.clone(),
    }
}

pub fn recent_log(rotated: bool, max_bytes: usize) -> io::Result<String> {
    let mut file = File::open(if rotated {
        rotated_log_path()
    } else {
        log_path()
    })?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let start = bytes
        .len()
        .saturating_sub(max_bytes.min(MAX_LOG_READ_BYTES));
    Ok(String::from_utf8_lossy(&bytes[start..]).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn records_events_and_rotates_bounded_log() {
        let _test_guard = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let test_dir = std::env::temp_dir().join(format!(
            "udx710-diagnostics-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after unix epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&test_dir).expect("create diagnostics test directory");
        let previous_dir = std::env::var_os("UDX710_STATE_DIR");
        std::env::set_var("UDX710_STATE_DIR", &test_dir);

        fs::write(log_path(), vec![b'x'; MAX_LOG_BYTES as usize])
            .expect("seed an active log at the rotation threshold");
        record_startup("127.0.0.1:3000");

        let snapshot = status();
        assert!(snapshot.log_bytes > 0);
        assert_eq!(snapshot.rotated_log_bytes, MAX_LOG_BYTES);
        assert!(recent_log(false, 64 * 1024)
            .expect("read active diagnostics log")
            .contains("BOOT"));
        assert_eq!(snapshot.pid, std::process::id());

        match previous_dir {
            Some(path) => std::env::set_var("UDX710_STATE_DIR", path),
            None => std::env::remove_var("UDX710_STATE_DIR"),
        }
        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn startup_snapshot_handles_missing_reset_evidence() {
        let missing = std::env::temp_dir().join(format!(
            "udx710-diagnostics-missing-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after unix epoch")
                .as_nanos()
        ));
        let missing = missing.to_string_lossy();
        let snapshot = capture_system_startup_with_paths(&missing, &missing, &missing, &missing);
        assert_eq!(snapshot.reset_evidence.len(), 2);
        assert!(snapshot
            .reset_evidence
            .iter()
            .all(|evidence| !evidence.available));
        assert!(snapshot.boot_id.is_none());
        assert!(snapshot.system_uptime_seconds.is_none());
    }

    #[test]
    fn rotated_log_is_read_with_the_same_limit() {
        let _test_guard = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let test_dir = std::env::temp_dir().join(format!(
            "udx710-diagnostics-rotated-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after unix epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&test_dir).expect("create diagnostics test directory");
        let previous_dir = std::env::var_os("UDX710_STATE_DIR");
        std::env::set_var("UDX710_STATE_DIR", &test_dir);
        fs::write(rotated_log_path(), "old diagnostic record")
            .expect("write rotated diagnostics log");

        assert_eq!(
            recent_log(true, MAX_LOG_READ_BYTES + 1).expect("read rotated log"),
            "old diagnostic record"
        );

        match previous_dir {
            Some(path) => std::env::set_var("UDX710_STATE_DIR", path),
            None => std::env::remove_var("UDX710_STATE_DIR"),
        }
        let _ = fs::remove_dir_all(&test_dir);
    }
}
