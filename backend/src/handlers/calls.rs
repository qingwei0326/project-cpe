//! 自 handlers.rs 拆出（纯移动，逻辑未改）。

use super::*;

/// GET /api/calls - 获取当前通话列表
pub async fn get_calls_handler(
    State(conn): State<Arc<Connection>>,
) -> (StatusCode, Json<ApiResponse<CallListResponse>>) {
    // 获取 VoiceCallManager 接口下的所有通话
    match crate::dbus::get_active_calls(&conn).await {
        Ok(calls) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Success",
                CallListResponse { calls },
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!("Failed to get calls: {}", e))),
        ),
    }
}

/// POST /api/call/dial - 拨打电话
pub async fn dial_call_handler(
    State(conn): State<Arc<Connection>>,
    Json(req): Json<MakeCallRequest>,
) -> (StatusCode, Json<ApiResponse<CallInfo>>) {
    match crate::dbus::dial_call(&conn, &req.phone_number).await {
        Ok(call_info) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Call initiated",
                call_info,
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!("Failed to dial: {}", e))),
        ),
    }
}

/// POST /api/call/hangup - 挂断电话
pub async fn hangup_call_handler(
    State(conn): State<Arc<Connection>>,
    Json(req): Json<HangupCallRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    match crate::dbus::hangup_call(&conn, &req.path).await {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Call ended", json!({}))),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!("Failed to hangup: {}", e))),
        ),
    }
}

/// POST /api/call/hangup-all - 挂断所有电话
pub async fn hangup_all_calls_handler(
    State(conn): State<Arc<Connection>>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    match crate::dbus::hangup_all_calls(&conn).await {
        Ok(count) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                format!("Ended {} call(s)", count),
                json!({ "count": count }),
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!("Failed to hangup all: {}", e))),
        ),
    }
}

/// POST /api/call/answer - 接听来电
pub async fn answer_call_handler(
    State(conn): State<Arc<Connection>>,
    Json(req): Json<HangupCallRequest>, // 复用结构，只需要 path
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    match crate::dbus::answer_call(&conn, &req.path).await {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Call answered",
                json!({}),
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!("Failed to answer: {}", e))),
        ),
    }
}

/// GET /api/call/volume - 获取通话音量
pub async fn get_call_volume_handler(
    State(conn): State<Arc<Connection>>,
) -> (
    StatusCode,
    Json<ApiResponse<crate::models::CallVolumeResponse>>,
) {
    match crate::dbus::get_call_volume(&conn).await {
        Ok(volume) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", volume)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to get call volume: {}",
                e
            ))),
        ),
    }
}

/// POST /api/call/volume - 设置通话音量
pub async fn set_call_volume_handler(
    State(conn): State<Arc<Connection>>,
    Json(req): Json<crate::models::SetCallVolumeRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    match crate::dbus::set_call_volume(&conn, req.speaker_volume, req.microphone_volume, req.muted)
        .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Call volume updated",
                json!({}),
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to set call volume: {}",
                e
            ))),
        ),
    }
}

/// GET /api/voicemail/status - 获取语音留言状态
pub async fn get_voicemail_status_handler(
    State(conn): State<Arc<Connection>>,
) -> (
    StatusCode,
    Json<ApiResponse<crate::models::VoicemailStatusResponse>>,
) {
    match crate::dbus::get_voicemail_status(&conn).await {
        Ok(voicemail) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", voicemail)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to get voicemail status: {}",
                e
            ))),
        ),
    }
}

/// GET /api/call/forwarding - 获取呼叫转移设置
pub async fn get_call_forwarding_handler(
    State(conn): State<Arc<Connection>>,
) -> (
    StatusCode,
    Json<ApiResponse<crate::models::CallForwardingResponse>>,
) {
    match crate::dbus::get_call_forwarding(&conn).await {
        Ok(forwarding) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", forwarding)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to get call forwarding: {}",
                e
            ))),
        ),
    }
}

/// POST /api/call/forwarding - 设置呼叫转移
pub async fn set_call_forwarding_handler(
    State(conn): State<Arc<Connection>>,
    Json(req): Json<crate::models::SetCallForwardingRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    match crate::dbus::set_call_forwarding(&conn, &req.forward_type, &req.number, req.timeout).await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Call forwarding updated",
                json!({}),
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to set call forwarding: {}",
                e
            ))),
        ),
    }
}

/// GET /api/call/settings - 获取通话设置
pub async fn get_call_settings_handler(
    State(conn): State<Arc<Connection>>,
) -> (
    StatusCode,
    Json<ApiResponse<crate::models::CallSettingsResponse>>,
) {
    match crate::dbus::get_call_settings(&conn).await {
        Ok(settings) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", settings)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to get call settings: {}",
                e
            ))),
        ),
    }
}

/// POST /api/call/settings - 设置通话设置
pub async fn set_call_settings_handler(
    State(conn): State<Arc<Connection>>,
    Json(req): Json<crate::models::SetCallSettingRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    match crate::dbus::set_call_setting(&conn, &req.property, &req.value).await {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Call settings updated",
                json!({}),
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to set call settings: {}",
                e
            ))),
        ),
    }
}

/// GET /api/call/history - 获取通话记录
pub async fn get_call_history_handler(
    State(db): State<Arc<Database>>,
    Query(params): Query<crate::models::CallHistoryRequest>,
) -> (
    StatusCode,
    Json<ApiResponse<crate::models::CallHistoryResponse>>,
) {
    let limit = if params.limit > 0 { params.limit } else { 50 };
    let offset = if params.offset >= 0 { params.offset } else { 0 };

    match db.get_call_history(limit, offset) {
        Ok(records) => {
            let stats = db.get_call_stats().unwrap_or_default();
            (
                StatusCode::OK,
                Json(ApiResponse::success_with_message(
                    "Success",
                    crate::models::CallHistoryResponse { records, stats },
                )),
            )
        }
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to get call history: {}",
                e
            ))),
        ),
    }
}

/// DELETE /api/call/history/{id} - 删除单条通话记录
pub async fn delete_call_history_handler(
    State(db): State<Arc<Database>>,
    axum::extract::Path(id): axum::extract::Path<i64>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    match db.delete_call(id) {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Call record deleted",
                json!({}),
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to delete call record: {}",
                e
            ))),
        ),
    }
}

/// POST /api/call/history/clear - 清空所有通话记录
pub async fn clear_call_history_handler(
    State(db): State<Arc<Database>>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    match db.clear_all_calls() {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "All call records cleared",
                json!({}),
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to clear call history: {}",
                e
            ))),
        ),
    }
}
