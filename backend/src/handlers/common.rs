//! 自 handlers.rs 拆出（纯移动，逻辑未改）。

use super::*;

/// 处理 OPTIONS 请求（CORS 预检）
pub async fn options_handler() -> impl IntoResponse {
    StatusCode::NO_CONTENT
}

/// POST /api/at - 发送 AT 指令
///
/// # 请求体
/// ```json
/// {
///   "cmd": "AT+CGSN"
/// }
/// ```
pub async fn post_at_command(
    State(conn): State<Arc<Connection>>,
    Json(payload): Json<AtCommandRequest>,
) -> impl IntoResponse {
    let (status, body_text) = match send_at_command(&conn, &payload.cmd).await {
        Ok(result) => (StatusCode::OK, result),
        Err(e) => (StatusCode::OK, format!("Error: {}", e)),
    };

    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );

    (status, headers, body_text)
}

/// GET /api/health - Health check endpoint
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Service is running"
/// }
/// ```
pub async fn health_check() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(json!({
            "status": "ok",
            "message": "Service is running",
            "version": env!("CARGO_PKG_VERSION"),
        })),
    )
}

/// GET /api/diagnostics - 获取有限大小的持久化诊断日志状态
pub async fn get_diagnostics() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(ApiResponse::success_with_message(
            "Success",
            diagnostics::status(),
        )),
    )
}

#[derive(Debug, Default, serde::Deserialize)]
pub(crate) struct DiagnosticsLogQuery {
    rotated: Option<bool>,
}

/// GET /api/diagnostics/log - 读取最近的诊断日志，`rotated=true` 读取上一轮日志
pub async fn get_diagnostics_log(Query(query): Query<DiagnosticsLogQuery>) -> impl IntoResponse {
    match diagnostics::recent_log(query.rotated.unwrap_or(false), 64 * 1024) {
        Ok(log) => (
            StatusCode::OK,
            [(
                axum::http::header::CONTENT_TYPE,
                "text/plain; charset=utf-8",
            )],
            log,
        )
            .into_response(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (
            StatusCode::NOT_FOUND,
            [(
                axum::http::header::CONTENT_TYPE,
                "text/plain; charset=utf-8",
            )],
            "diagnostics log is not available yet".to_string(),
        )
            .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(
                axum::http::header::CONTENT_TYPE,
                "text/plain; charset=utf-8",
            )],
            format!("failed to read diagnostics log: {error}"),
        )
            .into_response(),
    }
}
