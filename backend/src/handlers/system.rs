//! 自 handlers.rs 拆出（纯移动，逻辑未改）。

use super::*;

/// GET /api/stats/cpu - 获取 CPU 信息
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Success",
///   "data": {
///     "core_count": 2,
///     "cores": [
///       {
///         "processor": 0,
///         "bogomips": "52.00",
///         "features": ["fp", "asimd", "evtstrm", "aes"],
///         "implementer": "0x41",
///         "architecture": "8",
///         "variant": "0x1",
///         "part": "0xd05",
///         "revision": "0"
///       }
///     ],
///     "hardware": "Unisoc UDX710",
///     "serial": "0000000000000000",
///     "model_name": "ARM Cortex-A55"
///   }
/// }
/// ```
pub async fn get_cpu_info() -> impl IntoResponse {
    match read_cpu_info() {
        Ok(data) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", data)),
        ),
        Err(msg) => (StatusCode::OK, Json(ApiResponse::<CpuInfo>::error(msg))),
    }
}

/// GET /api/stats/system - 获取综合系统状态（包括网速、内存、运行时间）
///
/// 一次性获取所有系统监控信息，适合仪表板使用
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Success",
///   "data": {
///     "network_speed": { ... },
///     "memory": { ... },
///     "uptime": { ... }
///   }
/// }
/// ```
pub(crate) async fn get_system_stats_data() -> Result<SystemStatsResponse, String> {
    tokio::task::spawn_blocking(|| -> Result<SystemStatsResponse, String> {
        // 网卡计数和 CPU 使用率由同一个后台快照提供，避免每个请求重复采样。
        let telemetry = read_system_telemetry()?;

        // 获取内存信息
        let (total, available, cached, buffers) = read_memory_info()?;
        let used = total.saturating_sub(available);
        let used_percent = if total > 0 {
            (used as f64 / total as f64) * 100.0
        } else {
            0.0
        };

        // 获取磁盘信息
        let disk = read_disk_info();

        // 获取运行时间
        let (uptime, idle) = read_uptime()?;
        let formatted = format_uptime(uptime);

        // 获取系统信息（uname）
        let system_info = read_system_info()?;

        // 获取温度
        let temperature = read_temperature_sensors();

        // 获取 USB 模式
        let usb_mode = match usb_switch::get_usb_mode_config() {
            Ok(config) => UsbModeResponse {
                current_mode: config.current_mode,
                current_mode_name: get_mode_name(config.current_mode),
                permanent_mode: config.permanent_mode,
                temporary_mode: config.temporary_mode,
                needs_reboot: config.needs_reboot(),
                read_mode: "hardware".to_string(),
            },
            Err(_) => UsbModeResponse::default(),
        };

        Ok(SystemStatsResponse {
            network_speed: NetworkSpeedResponse {
                interfaces: telemetry.network_speed,
                interval_seconds: telemetry.network_interval_seconds,
            },
            memory: MemoryInfo {
                total_bytes: total,
                available_bytes: available,
                used_bytes: used,
                used_percent,
                cached_bytes: cached,
                buffers_bytes: buffers,
            },
            disk,
            cpu_load: telemetry.cpu_load,
            uptime: UptimeInfo {
                uptime_seconds: uptime,
                idle_seconds: idle,
                uptime_formatted: formatted,
            },
            system_info,
            temperature,
            usb_mode,
        })
    })
    .await
    .map_err(|e| format!("Stats task failed: {}", e))
    .and_then(|result| result)
}

pub async fn get_system_stats() -> impl IntoResponse {
    let result = get_system_stats_data().await;

    match result {
        Ok(data) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", data)),
        ),
        Err(msg) => (
            StatusCode::OK,
            Json(ApiResponse::<SystemStatsResponse>::error(msg)),
        ),
    }
}

/// POST /api/system/reboot - 系统重启
///
/// # Request body（可选）
/// ```json
/// {
///   "delay_seconds": 3  // 延迟秒数，默认为3秒
/// }
/// ```
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "System will reboot in 3 seconds"
/// }
/// ```
pub async fn system_reboot(Json(payload): Json<Option<SystemRebootRequest>>) -> impl IntoResponse {
    let delay = payload.map(|p| p.delay_seconds).unwrap_or(3);

    // 使用 tokio 异步执行重启命令
    tokio::spawn(async move {
        // 等待指定的延迟时间
        tokio::time::sleep(tokio::time::Duration::from_secs(delay as u64)).await;

        // 执行重启命令
        let _ = Command::new("reboot").output().await;
    });

    (
        StatusCode::OK,
        Json(ApiResponse::success_with_message(
            format!("系统将在 {} 秒后重启", delay),
            json!({"delay_seconds": delay}),
        )),
    )
}
