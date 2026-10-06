//! 自 handlers.rs 拆出（纯移动，逻辑未改）。

use super::*;

// ============ Webhook 配置 API ============

/// GET /api/webhook/config - 获取 Webhook 配置
pub async fn get_webhook_config_handler(
    State(config_manager): State<Arc<ConfigManager>>,
) -> (StatusCode, Json<ApiResponse<crate::config::WebhookConfig>>) {
    let config = config_manager.get_webhook();
    (
        StatusCode::OK,
        Json(ApiResponse::success_with_message("Success", config)),
    )
}

/// POST /api/webhook/config - 设置 Webhook 配置
pub async fn set_webhook_config_handler(
    State(config_manager): State<Arc<ConfigManager>>,
    Json(webhook_config): Json<crate::config::WebhookConfig>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    match config_manager.set_webhook(webhook_config) {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Webhook config updated",
                json!({}),
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to update webhook config: {}",
                e
            ))),
        ),
    }
}

/// POST /api/webhook/test - 测试 Webhook 连接
pub async fn test_webhook_handler(
    State(webhook_sender): State<Arc<WebhookSender>>,
) -> (
    StatusCode,
    Json<ApiResponse<crate::models::WebhookTestResponse>>,
) {
    match webhook_sender.test_webhook().await {
        Ok(message) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Webhook test successful",
                crate::models::WebhookTestResponse {
                    success: true,
                    message,
                },
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Webhook test failed",
                crate::models::WebhookTestResponse {
                    success: false,
                    message: e,
                },
            )),
        ),
    }
}

// ============ OTA 更新功能 ============

/// GET /api/ota/status - 获取 OTA 更新状态
pub async fn get_ota_status_handler() -> impl IntoResponse {
    let status = crate::ota::get_ota_status();
    (
        StatusCode::OK,
        Json(ApiResponse::success_with_message("Success", status)),
    )
}

/// POST /api/ota/upload - 上传 OTA 更新包
pub async fn upload_ota_handler(body: axum::body::Bytes) -> impl IntoResponse {
    let result = tokio::task::spawn_blocking(move || crate::ota::handle_ota_upload(&body))
        .await
        .map_err(|e| format!("OTA upload task failed: {}", e))
        .and_then(|result| result);
    match result {
        Ok(response) => {
            let message = if response.validation.valid {
                "OTA package uploaded and validated"
            } else {
                "OTA package uploaded but validation failed"
            };
            (
                StatusCode::OK,
                Json(ApiResponse::success_with_message(message, response)),
            )
        }
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<crate::models::OtaUploadResponse>::error(
                format!("Failed to process OTA package: {}", e),
            )),
        ),
    }
}

/// POST /api/ota/apply - 应用 OTA 更新
pub async fn apply_ota_handler(
    Json(req): Json<crate::models::OtaApplyRequest>,
) -> impl IntoResponse {
    let result = tokio::task::spawn_blocking(move || crate::ota::apply_ota_update(req.restart_now))
        .await
        .map_err(|e| format!("OTA apply task failed: {}", e))
        .and_then(|result| result);
    match result {
        Ok(message) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                &message,
                json!({ "applied": true }),
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<serde_json::Value>::error(format!(
                "Failed to apply OTA update: {}",
                e
            ))),
        ),
    }
}

/// POST /api/ota/cancel - 取消待安装的更新
pub async fn cancel_ota_handler() -> impl IntoResponse {
    let result = tokio::task::spawn_blocking(crate::ota::cancel_pending_update)
        .await
        .map_err(|e| format!("OTA cancel task failed: {}", e))
        .and_then(|result| result);
    match result {
        Ok(()) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Pending update cancelled",
                json!({}),
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<serde_json::Value>::error(format!(
                "Failed to cancel update: {}",
                e
            ))),
        ),
    }
}
