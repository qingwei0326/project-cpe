//! 自 handlers.rs 拆出（纯移动，逻辑未改）。

use super::*;

// ============ 短信相关 API ============

/// POST /api/sms/send - 发送短信
pub async fn send_sms_handler(
    State((conn, db)): State<(Arc<Connection>, Arc<Database>)>,
    Json(req): Json<SendSmsRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    // 发送短信
    match crate::dbus::send_sms(&conn, &req.phone_number, &req.content).await {
        Ok(message_path) => {
            // 存储到数据库
            match db.insert_sms("outgoing", &req.phone_number, &req.content, "sent", None) {
                Ok(id) => (
                    StatusCode::OK,
                    Json(ApiResponse::success_with_message(
                        "SMS sent successfully",
                        json!({
                            "message_path": message_path,
                            "db_id": id,
                        }),
                    )),
                ),
                Err(_e) => (
                    StatusCode::OK,
                    Json(ApiResponse::success_with_message(
                        "SMS sent but failed to save to database",
                        json!({ "message_path": message_path }),
                    )),
                ),
            }
        }
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!("Failed to send SMS: {}", e))),
        ),
    }
}

/// GET /api/sms/list - 获取短信列表
pub async fn get_sms_list_handler(
    State(db): State<Arc<Database>>,
    axum::extract::Query(req): axum::extract::Query<SmsListRequest>,
) -> (StatusCode, Json<ApiResponse<Vec<crate::db::SmsMessage>>>) {
    match db.get_sms_messages(req.limit, req.offset) {
        Ok(messages) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                format!("Retrieved {} messages", messages.len()),
                messages,
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!("Failed to get messages: {}", e))),
        ),
    }
}

/// GET /api/sms/conversation - 获取与特定号码的对话历史
pub async fn get_sms_conversation_handler(
    State(db): State<Arc<Database>>,
    axum::extract::Query(req): axum::extract::Query<SmsConversationRequest>,
) -> (StatusCode, Json<ApiResponse<Vec<crate::db::SmsMessage>>>) {
    match db.get_sms_conversation(&req.phone_number, req.limit) {
        Ok(messages) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                format!("Retrieved {} messages", messages.len()),
                messages,
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to get conversation: {}",
                e
            ))),
        ),
    }
}

/// GET /api/sms/stats - 获取短信统计
pub async fn get_sms_stats_handler(
    State(db): State<Arc<Database>>,
) -> (StatusCode, Json<ApiResponse<crate::db::SmsStats>>) {
    match db.get_sms_stats() {
        Ok(stats) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", stats)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!("Failed to get stats: {}", e))),
        ),
    }
}

/// DELETE /api/sms/clear - 清空所有短信
pub async fn clear_sms_handler(
    State(db): State<Arc<Database>>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    match db.clear_all_sms() {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "All messages cleared",
                json!({}),
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to clear messages: {}",
                e
            ))),
        ),
    }
}
