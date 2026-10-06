//! 自 handlers.rs 拆出（纯移动，逻辑未改）。

use super::*;

/// GET /api/device - 获取设备信息（来自 D-Bus Modem 接口）
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Success",
///   "data": {
///     "imei": "123456789012345",
///     "manufacturer": "UNISOC",
///     "model": "UDX710",
///     "revision": "1.0.0",
///     "online": true,
///     "powered": true
///   }
/// }
/// ```
pub async fn get_device_info(State(conn): State<Arc<Connection>>) -> impl IntoResponse {
    match get_device_info_data(&conn).await {
        Ok(data) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", data)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<DeviceInfoResponse>::error(format!(
                "Failed to get device info: {}",
                e
            ))),
        ),
    }
}

/// POST /api/data - Set data connection status
///
/// # Request body
/// ```json
/// {
///   "active": true
/// }
/// ```
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Data connection updated successfully"
/// }
/// ```
///
/// # 说明
/// 每次切换数据连接状态时，会自动清空 iptables 规则（flush），
/// 以确保网络配置处于干净状态
pub async fn set_data_status(
    State(conn): State<Arc<Connection>>,
    Json(payload): Json<DataConnectionRequest>,
) -> impl IntoResponse {
    // 1. 仅在显式开启时才清空 iptables 规则。
    //    默认关闭：filter 表规则由设备原厂固件维护，清空后不会自动重建，
    //    反而会打断转发路径、抬高上网延迟（见 iptables::flush_enabled 说明）。
    if crate::iptables::flush_enabled() {
        if let Err(_e) = flush_iptables().await {
            // 清空规则失败不应阻止数据连接操作，静默处理
        }
    }

    // 2. 设置数据连接状态
    match set_data_connection(&conn, payload.active).await {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Data connection updated successfully",
                DataConnectionResponse {
                    active: payload.active,
                },
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<DataConnectionResponse>::error(format!(
                "Failed to set data connection: {}",
                e
            ))),
        ),
    }
}

/// GET /api/data - Get data connection status
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Success",
///   "data": {
///     "active": true
///   }
/// }
/// ```
pub async fn get_data_status(State(conn): State<Arc<Connection>>) -> impl IntoResponse {
    match get_data_connection_status(&conn).await {
        Ok(active) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Success",
                DataConnectionResponse { active },
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<DataConnectionResponse>::error(format!(
                "Failed to get data connection status: {}",
                e
            ))),
        ),
    }
}

/// GET /api/roaming - Get roaming status
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Success",
///   "data": {
///     "roaming_allowed": true,
///     "is_roaming": false
///   }
/// }
/// ```
pub async fn get_roaming_status_handler(State(conn): State<Arc<Connection>>) -> impl IntoResponse {
    match get_roaming_status(&conn).await {
        Ok((roaming_allowed, is_roaming)) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Success",
                RoamingResponse {
                    roaming_allowed,
                    is_roaming,
                },
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<RoamingResponse>::error(format!(
                "Failed to get roaming status: {}",
                e
            ))),
        ),
    }
}

/// POST /api/roaming - Set roaming allowed
///
/// # Request body
/// ```json
/// {
///   "allowed": true
/// }
/// ```
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Roaming enabled successfully",
///   "data": {
///     "roaming_allowed": true,
///     "is_roaming": false
///   }
/// }
/// ```
pub async fn set_roaming_status_handler(
    State(conn): State<Arc<Connection>>,
    Json(payload): Json<RoamingRequest>,
) -> impl IntoResponse {
    match set_roaming_allowed(&conn, payload.allowed).await {
        Ok(_) => {
            // Read back the status to confirm
            match get_roaming_status(&conn).await {
                Ok((roaming_allowed, is_roaming)) => {
                    let msg = if payload.allowed {
                        "Roaming enabled successfully"
                    } else {
                        "Roaming disabled successfully"
                    };
                    (
                        StatusCode::OK,
                        Json(ApiResponse::success_with_message(
                            msg,
                            RoamingResponse {
                                roaming_allowed,
                                is_roaming,
                            },
                        )),
                    )
                }
                Err(e) => (
                    StatusCode::OK,
                    Json(ApiResponse::<RoamingResponse>::error(format!(
                        "Roaming setting updated, but failed to read status: {}",
                        e
                    ))),
                ),
            }
        }
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<RoamingResponse>::error(format!(
                "Failed to set roaming: {}",
                e
            ))),
        ),
    }
}

/// POST /api/airplane-mode - Set airplane mode
///
/// # Request body
/// ```json
/// {
///   "enabled": true
/// }
/// ```
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Airplane mode enabled successfully",
///   "data": {
///     "enabled": true,
///     "powered": true,
///     "online": false
///   }
/// }
/// ```
pub async fn set_airplane_mode_handler(
    State(conn): State<Arc<Connection>>,
    Json(payload): Json<AirplaneModeRequest>,
) -> impl IntoResponse {
    match set_airplane_mode(&conn, payload.enabled).await {
        Ok(_) => {
            // 读取当前状态确认
            match get_airplane_mode(&conn).await {
                Ok(status) => {
                    let msg = if payload.enabled {
                        "Airplane mode enabled successfully"
                    } else {
                        "Airplane mode disabled successfully"
                    };
                    (
                        StatusCode::OK,
                        Json(ApiResponse::success_with_message(msg, status)),
                    )
                }
                Err(e) => (
                    StatusCode::OK,
                    Json(ApiResponse::<AirplaneModeResponse>::error(format!(
                        "Airplane mode set but failed to read status: {}",
                        e
                    ))),
                ),
            }
        }
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<AirplaneModeResponse>::error(format!(
                "Failed to set airplane mode: {}",
                e
            ))),
        ),
    }
}

/// GET /api/airplane-mode - Get airplane mode status
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Success",
///   "data": {
///     "enabled": false,
///     "powered": true,
///     "online": true
///   }
/// }
/// ```
pub async fn get_airplane_mode_handler(State(conn): State<Arc<Connection>>) -> impl IntoResponse {
    match get_airplane_mode(&conn).await {
        Ok(status) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", status)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<AirplaneModeResponse>::error(format!(
                "Failed to get airplane mode status: {}",
                e
            ))),
        ),
    }
}

/// GET /api/sim - Get SIM card information
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Success",
///   "data": {
///     "present": true,
///     "pin_required": "none",
///     "service_center_address": "+8613800200569",
///     "subscriber_identity": "460123456789012"
///   }
/// }
/// ```
pub async fn get_sim_info(State(conn): State<Arc<Connection>>) -> impl IntoResponse {
    match get_sim_info_data(&conn).await {
        Ok(data) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", data)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<SimInfoResponse>::error(format!(
                "Failed to get SIM info: {}",
                e
            ))),
        ),
    }
}

/// GET /api/network - Get network information
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Success",
///   "data": {
///     "operator_name": "CMCC",
///     "registration_status": "registered",
///     "technology_preference": "NR 5G/LTE auto",
///     "signal_strength": 85
///   }
/// }
/// ```
pub async fn get_network_info(State(conn): State<Arc<Connection>>) -> impl IntoResponse {
    match get_network_info_data(&conn).await {
        Ok(data) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", data)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<NetworkInfoResponse>::error(format!(
                "Failed to get network info: {}",
                e
            ))),
        ),
    }
}

/// GET /api/qos - Get QoS information
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Success",
///   "data": {}
/// }
/// ```
///
/// `data` 为 [`QosInfoResponse`]，字段随模组 `AT+CGEQOSRDP` 实际上报值而定。
pub async fn get_qos_info(State(conn): State<Arc<Connection>>) -> impl IntoResponse {
    match get_qos_info_data(&conn).await {
        Ok(data) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", data)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<QosInfoResponse>::error(format!(
                "Failed to get QoS info: {}",
                e
            ))),
        ),
    }
}

/// GET /api/network/interfaces - 获取所有网络接口详细信息
///
/// 返回所有网络接口的详细信息，包括：
/// - 接口名称、状态、MAC地址、MTU
/// - IPv4和IPv6地址列表
/// - 公网/内网地址分类
/// - 流量统计（接收/发送字节数、包数、错误数）
pub async fn get_network_interfaces_info() -> impl IntoResponse {
    let result = tokio::task::spawn_blocking(|| {
        let interfaces = read_network_interfaces()?;
        let total_count = interfaces.len();

        Ok::<_, String>(NetworkInterfacesResponse {
            interfaces,
            total_count,
        })
    })
    .await;

    match result {
        Ok(Ok(data)) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", data)),
        ),
        Ok(Err(msg)) => (
            StatusCode::OK,
            Json(ApiResponse::<NetworkInterfacesResponse>::error(msg)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<NetworkInterfacesResponse>::error(format!(
                "Task execution failed: {}",
                e
            ))),
        ),
    }
}

// ============ 新增功能 API ============

/// GET /api/device/imeisv - 获取 IMEISV（软件版本号）
pub async fn get_imeisv_handler(
    State(conn): State<Arc<Connection>>,
) -> (StatusCode, Json<ApiResponse<crate::models::ImeisvResponse>>) {
    match crate::dbus::get_imeisv(&conn).await {
        Ok(imeisv) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", imeisv)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!("Failed to get IMEISV: {}", e))),
        ),
    }
}

/// GET /api/network/signal-strength - 获取信号强度详细信息
pub async fn get_signal_strength_handler(
    State(conn): State<Arc<Connection>>,
) -> (
    StatusCode,
    Json<ApiResponse<crate::models::SignalStrengthResponse>>,
) {
    match crate::dbus::get_signal_strength(&conn).await {
        Ok(signal) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", signal)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to get signal strength: {}",
                e
            ))),
        ),
    }
}

/// GET /api/network/nitz - 获取 NITZ 网络时间
pub async fn get_nitz_handler(
    State(conn): State<Arc<Connection>>,
) -> (
    StatusCode,
    Json<ApiResponse<crate::models::NitzTimeResponse>>,
) {
    match crate::dbus::get_nitz_time(&conn).await {
        Ok(nitz) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", nitz)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to get NITZ time: {}",
                e
            ))),
        ),
    }
}

/// GET /api/ims/status - 获取 IMS 状态
pub async fn get_ims_status_handler(
    State(conn): State<Arc<Connection>>,
) -> (
    StatusCode,
    Json<ApiResponse<crate::models::ImsStatusResponse>>,
) {
    match crate::dbus::get_ims_status(&conn).await {
        Ok(ims) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", ims)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to get IMS status: {}",
                e
            ))),
        ),
    }
}

/// GET /api/network/operators - 获取运营商列表（快速）
pub async fn get_operators_handler(
    State(conn): State<Arc<Connection>>,
) -> (
    StatusCode,
    Json<ApiResponse<crate::models::OperatorListResponse>>,
) {
    match crate::dbus::get_operators(&conn).await {
        Ok(operators) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", operators)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to get operators: {}",
                e
            ))),
        ),
    }
}

/// GET /api/network/operators/scan - 扫描所有运营商（慢，120秒）
pub async fn scan_operators_handler(
    State(conn): State<Arc<Connection>>,
) -> (
    StatusCode,
    Json<ApiResponse<crate::models::OperatorListResponse>>,
) {
    match crate::dbus::scan_operators(&conn).await {
        Ok(operators) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Scan completed",
                operators,
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to scan operators: {}",
                e
            ))),
        ),
    }
}

/// POST /api/network/register-manual - 手动注册运营商
pub async fn register_operator_manual_handler(
    State(conn): State<Arc<Connection>>,
    Json(req): Json<crate::models::ManualRegisterRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    match crate::dbus::register_operator_manual(&conn, &req.mccmnc).await {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                format!("Registered to operator {}", req.mccmnc),
                json!({}),
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to register operator: {}",
                e
            ))),
        ),
    }
}

/// POST /api/network/register-auto - 自动注册运营商
pub async fn register_operator_auto_handler(
    State(conn): State<Arc<Connection>>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    match crate::dbus::register_operator_auto(&conn).await {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Automatic registration initiated",
                json!({}),
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to register automatically: {}",
                e
            ))),
        ),
    }
}

// ============ SIM 卡槽功能 ============

/// GET /api/sim/slot - 获取 SIM 卡槽信息
pub async fn get_sim_slot_handler(
    State(conn): State<Arc<Connection>>,
) -> (
    StatusCode,
    Json<ApiResponse<crate::models::SimSlotResponse>>,
) {
    match crate::dbus::get_sim_slot(&conn).await {
        Ok(slot_info) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", slot_info)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to get SIM slot info: {}",
                e
            ))),
        ),
    }
}

/// POST /api/sim/slot/switch - 切换 SIM 卡槽
pub async fn switch_sim_slot_handler(
    State(conn): State<Arc<Connection>>,
    Json(req): Json<crate::models::SwitchSimSlotRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    match crate::dbus::switch_sim_slot(&conn, req.slot).await {
        Ok(response) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                format!("Switched to SIM slot {}", req.slot),
                json!({"response": response}),
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!(
                "Failed to switch SIM slot: {}",
                e
            ))),
        ),
    }
}

// ============ APN 管理功能 ============

/// GET /api/apn - 获取 APN 列表
///
/// 返回所有 internet 类型的 APN context 配置
pub async fn get_apn_list_handler(
    State(conn): State<Arc<Connection>>,
) -> (StatusCode, Json<ApiResponse<ApnListResponse>>) {
    match get_all_apn_contexts(&conn).await {
        Ok(contexts) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Success",
                ApnListResponse { contexts },
            )),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!("Failed to get APN list: {}", e))),
        ),
    }
}

/// POST /api/apn - 设置 APN 配置
///
/// # 请求体
/// ```json
/// {
///   "context_path": "/ril_0/context2",
///   "apn": "cbnet",
///   "protocol": "dual",
///   "username": "",
///   "password": "",
///   "auth_method": "chap"
/// }
/// ```
pub async fn set_apn_handler(
    State(conn): State<Arc<Connection>>,
    Json(req): Json<SetApnRequest>,
) -> (StatusCode, Json<ApiResponse<serde_json::Value>>) {
    // 验证 context_path
    if req.context_path.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("context_path is required")),
        );
    }

    // 调用 D-Bus 设置 APN 属性
    match set_apn_properties(
        &conn,
        &req.context_path,
        req.apn.as_deref(),
        req.protocol.as_deref(),
        req.username.as_deref(),
        req.password.as_deref(),
        req.auth_method.as_deref(),
    )
    .await
    {
        Ok(_) => {
            // 获取更新后的 APN 配置
            match get_all_apn_contexts(&conn).await {
                Ok(contexts) => {
                    // 找到刚刚修改的 context
                    let updated_context = contexts
                        .iter()
                        .find(|c| c.path == req.context_path)
                        .cloned();

                    (
                        StatusCode::OK,
                        Json(ApiResponse::success_with_message(
                            "APN configuration updated successfully",
                            json!({
                                "updated_context": updated_context,
                            }),
                        )),
                    )
                }
                Err(_) => (
                    StatusCode::OK,
                    Json(ApiResponse::success_with_message(
                        "APN configuration updated successfully",
                        json!({}),
                    )),
                ),
            }
        }
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::error(format!("Failed to set APN: {}", e))),
        ),
    }
}

/// GET /api/traffic/usage - 获取 WAN 流量日/月累计
///
/// 统计来自调制解调器侧网卡内核计数器的增量，不重复计算 usb0 的主机侧流量。
pub async fn get_traffic_usage_handler(
    State(db): State<Arc<Database>>,
    Query(query): Query<TrafficUsageQuery>,
) -> impl IntoResponse {
    let interface = crate::traffic::read_data_interface_stats()
        .map(|(interface, _, _)| interface)
        .unwrap_or_else(|_| "sipa_eth0".to_string());
    let days = query.days.unwrap_or(31);
    let months = query.months.unwrap_or(12);

    match db.get_traffic_usage(&interface, days, months) {
        Ok(usage) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", usage)),
        ),
        Err(error) => (
            StatusCode::OK,
            Json(ApiResponse::<crate::db::TrafficUsageResponse>::error(
                format!("Failed to get traffic usage: {error}"),
            )),
        ),
    }
}

/// GET /api/connectivity - 联网检测
///
/// 通过 ping 检测 IPv4 和 IPv6 连通性
pub async fn get_connectivity_check() -> (StatusCode, Json<ApiResponse<ConnectivityCheckResponse>>)
{
    const CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(30);

    lazy_static::lazy_static! {
        static ref CONNECTIVITY_CACHE: tokio::sync::Mutex<Option<(std::time::Instant, ConnectivityCheckResponse)>> =
            tokio::sync::Mutex::new(None);
    }

    let mut cache = CONNECTIVITY_CACHE.lock().await;
    if let Some((checked_at, response)) = cache.as_ref() {
        if checked_at.elapsed() < CACHE_TTL {
            return (
                StatusCode::OK,
                Json(ApiResponse::success_with_message(
                    "Connectivity check cached",
                    response.clone(),
                )),
            );
        }
    }

    let response = crate::connectivity::check_connectivity().await;

    *cache = Some((std::time::Instant::now(), response.clone()));

    (
        StatusCode::OK,
        Json(ApiResponse::success_with_message(
            "Connectivity check completed",
            response,
        )),
    )
}
