//! 自 handlers.rs 拆出（纯移动，逻辑未改）。

use super::*;

/// GET /api/usb-mode - 查询USB模式配置
///
/// 返回当前硬件实际运行的模式、永久配置和临时配置
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Success",
///   "data": {
///     "current_mode": 1,
///     "current_mode_name": "CDC-NCM",
///     "permanent_mode": 1,
///     "temporary_mode": null,
///     "needs_reboot": true,
///     "read_mode": "hardware"
///   }
/// }
/// ```
pub async fn get_usb_mode() -> impl IntoResponse {
    // 读取 USB 模式配置（包括硬件状态和配置文件）
    match usb_switch::get_usb_mode_config() {
        Ok(config) => {
            let response = UsbModeResponse {
                current_mode: config.current_mode,
                current_mode_name: get_mode_name(config.current_mode),
                permanent_mode: config.permanent_mode,
                temporary_mode: config.temporary_mode,
                needs_reboot: config.needs_reboot(),
                read_mode: "hardware".to_string(),
            };
            (
                StatusCode::OK,
                Json(ApiResponse::success_with_message("Success", response)),
            )
        }
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<UsbModeResponse>::error(format!(
                "Failed to get USB mode: {}",
                e
            ))),
        ),
    }
}

/// GET /api/usb-diagnostics - 查询 USB/configfs 诊断快照
pub async fn get_usb_diagnostics() -> impl IntoResponse {
    let diagnostics = usb_switch::get_usb_diagnostics();
    (
        StatusCode::OK,
        Json(ApiResponse::success_with_message("Success", diagnostics)),
    )
}

/// POST /api/usb-mode - 设置USB模式配置（写入配置文件，重启后生效）
///
/// # Request body
/// ```json
/// {
///   "mode": 1,
///   "permanent": true  // true=永久模式, false=临时模式
/// }
/// ```
///
/// # 支持的模式
/// - 1: CDC-NCM
/// - 2: CDC-ECM
/// - 3: RNDIS
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "USB mode configuration saved. Please reboot to apply changes."
/// }
/// ```
pub async fn set_usb_mode(Json(payload): Json<SetUsbModeRequest>) -> impl IntoResponse {
    // 验证模式值
    if !(1..=3).contains(&payload.mode) {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::<()>::error(
                "Invalid mode: must be 1 (CDC-NCM), 2 (CDC-ECM), or 3 (RNDIS)",
            )),
        );
    }

    // 写入配置文件
    match usb_switch::set_usb_mode_config(payload.mode, payload.permanent) {
        Ok(_) => {
            let mode_name = get_mode_name(Some(payload.mode));
            let mode_type = if payload.permanent {
                "永久"
            } else {
                "临时"
            };
            (
                StatusCode::OK,
                Json(ApiResponse::success_with_message(
                    format!(
                        "USB 模式已设置为 {} ({})，请重启设备后生效",
                        mode_name, mode_type
                    ),
                    (),
                )),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::<()>::error(format!(
                "Failed to set USB mode: {}",
                e
            ))),
        ),
    }
}

/// POST /api/usb-advance - 热切换USB模式（立即生效，无需重启）
///
/// 高级接口：直接操作 configfs 实现热切换
///
/// # Request body
/// ```json
/// {
///   "mode": 1
/// }
/// ```
///
/// # 支持的模式
/// - 1: CDC-NCM
/// - 2: CDC-ECM
/// - 3: RNDIS
///
/// # 注意事项
/// - 热切换会导致 USB 连接短暂断开（约 1-2 秒）
/// - macOS 可能需要更长时间识别新设备
/// - 模式 3 (RNDIS) 在 macOS/Linux 上可能需要额外驱动
/// - 建议使用模式 1 (NCM) 以获得最佳跨平台兼容性
pub async fn set_usb_mode_advanced(Json(payload): Json<SetUsbModeRequest>) -> impl IntoResponse {
    // 验证模式值
    if !(1..=3).contains(&payload.mode) {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::<()>::error(
                "Invalid mode: must be 1 (CDC-NCM), 2 (CDC-ECM), or 3 (RNDIS)",
            )),
        );
    }

    // 热切换里有外部命令和最长 1 秒的等待，放到阻塞线程池，避免占住异步工作线程
    let mode = payload.mode;
    let switched =
        match tokio::task::spawn_blocking(move || usb_switch::switch_usb_mode_advanced(mode)).await
        {
            Ok(result) => result,
            Err(error) => Err(format!("worker task failed: {error}")),
        };
    match switched {
        Ok(_) => {
            let mode_name = get_mode_name(Some(payload.mode));
            (
                StatusCode::OK,
                Json(ApiResponse::success_with_message(
                    format!("USB 模式已热切换为 {} (无需重启)", mode_name),
                    (),
                )),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::<()>::error(format!("USB 模式切换失败: {}", e))),
        ),
    }
}
