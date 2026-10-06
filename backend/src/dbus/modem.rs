//! 自 dbus.rs 拆出（纯移动，逻辑未改）。

use super::*;

/// 通过 D-Bus 发送 AT 指令
///
/// # Arguments
/// * `conn` - D-Bus 连接
/// * `cmd` - AT 指令字符串
///
/// # Returns
/// AT 指令的响应结果
pub async fn send_at_command(conn: &Connection, cmd: &str) -> zbus::Result<String> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.Modem").await?;
        let result: String = tokio::time::timeout(
            tokio::time::Duration::from_secs(10),
            proxy.call("SendAtcmd", &(cmd)),
        )
        .await
        .map_err(|_| zbus::Error::Failure(format!("AT command timed out: {}", cmd)))??;
        Ok(result)
    })
    .await
}

/// 获取服务小区信息
///
/// # Arguments
/// * `conn` - D-Bus 连接
///
/// # Returns
/// 服务小区信息结构
pub async fn get_serving_cell_info(conn: &Connection) -> zbus::Result<ServingCell> {
    with_serial(async {
        let proxy = NetworkMonitorProxy::new(conn).await?;
        let cell_info: HashMap<String, OwnedValue> = proxy.get_serving_cell_information().await?;

        let tech = cell_info
            .get("Technology")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_else(|| "unknown".to_string());

        let cell_id = parse_u32_from_keys(&cell_info, &["NCellId", "CellId", "NRCellID"]);
        let tac = parse_u32_from_keys(&cell_info, &["TrackingAreaCode"]);

        Ok(ServingCell { tech, cell_id, tac })
    })
    .await
}

/// 查找第一个有效的 internet 类型 context 路径
///
/// 遍历所有 context，返回第一个类型为 internet 且配置了 APN 的 context 路径。
/// 如果没有配置 APN 的 context，则返回第一个 internet 类型的 context。
///
/// # Arguments
/// * `conn` - D-Bus 连接
///
/// # Returns
/// context 路径字符串
pub async fn find_internet_context(conn: &Connection) -> zbus::Result<String> {
    let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.ConnectionManager").await?;
    let contexts: Vec<(zbus::zvariant::OwnedObjectPath, HashMap<String, OwnedValue>)> =
        proxy.call("GetContexts", &()).await?;

    let mut first_internet_context: Option<String> = None;

    for (path, props) in contexts {
        let context_type = props
            .get("Type")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        if context_type == "internet" {
            let apn = props
                .get("AccessPointName")
                .and_then(|v| String::try_from(v.clone()).ok())
                .unwrap_or_default();

            // 如果配置了 APN，优先返回这个 context
            if !apn.is_empty() {
                return Ok(path.to_string());
            }

            // 记录第一个 internet 类型的 context
            if first_internet_context.is_none() {
                first_internet_context = Some(path.to_string());
            }
        }
    }

    // 返回第一个 internet context，如果没有则返回默认值
    Ok(first_internet_context.unwrap_or_else(|| "/ril_0/context2".to_string()))
}

/// 获取所有 APN Context 列表
///
/// # Arguments
/// * `conn` - D-Bus 连接
///
/// # Returns
/// APN Context 列表
pub async fn get_all_apn_contexts(conn: &Connection) -> zbus::Result<Vec<ApnContext>> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.ConnectionManager").await?;
        let contexts: Vec<(zbus::zvariant::OwnedObjectPath, HashMap<String, OwnedValue>)> =
            proxy.call("GetContexts", &()).await?;

        let mut result = Vec::new();

        for (path, props) in contexts {
            let context_type = props
                .get("Type")
                .and_then(|v| String::try_from(v.clone()).ok())
                .unwrap_or_default();

            // 只返回 internet 类型的 context
            if context_type == "internet" {
                let apn_context = ApnContext {
                    path: path.to_string(),
                    name: props
                        .get("Name")
                        .and_then(|v| String::try_from(v.clone()).ok())
                        .unwrap_or_else(|| "Internet".to_string()),
                    active: props
                        .get("Active")
                        .and_then(|v| bool::try_from(v.clone()).ok())
                        .unwrap_or(false),
                    apn: props
                        .get("AccessPointName")
                        .and_then(|v| String::try_from(v.clone()).ok())
                        .unwrap_or_default(),
                    protocol: props
                        .get("Protocol")
                        .and_then(|v| String::try_from(v.clone()).ok())
                        .unwrap_or_else(|| "ip".to_string()),
                    username: props
                        .get("Username")
                        .and_then(|v| String::try_from(v.clone()).ok())
                        .unwrap_or_default(),
                    password: props
                        .get("Password")
                        .and_then(|v| String::try_from(v.clone()).ok())
                        .unwrap_or_default(),
                    auth_method: props
                        .get("AuthenticationMethod")
                        .and_then(|v| String::try_from(v.clone()).ok())
                        .unwrap_or_else(|| "chap".to_string()),
                    context_type,
                };
                result.push(apn_context);
            }
        }

        Ok(result)
    })
    .await
}

/// 设置 APN 属性
///
/// # Arguments
/// * `conn` - D-Bus 连接
/// * `context_path` - context 的 D-Bus 路径
/// * `property` - 属性名
/// * `value` - 属性值
///
/// # Returns
/// 操作结果
pub async fn set_apn_property(
    conn: &Connection,
    context_path: &str,
    property: &str,
    value: &str,
) -> zbus::Result<()> {
    with_serial(async {
        let proxy = ConnectionContextProxy::builder(conn)
            .path(context_path)?
            .build()
            .await?;

        proxy
            .set_property(property, zbus::zvariant::Value::Str(value.into()))
            .await?;
        Ok(())
    })
    .await
}

/// 批量设置 APN 属性
///
/// # Arguments
/// * `conn` - D-Bus 连接
/// * `context_path` - context 的 D-Bus 路径
/// * `apn` - APN 名称（可选）
/// * `protocol` - 协议（可选）
/// * `username` - 用户名（可选）
/// * `password` - 密码（可选）
/// * `auth_method` - 认证方式（可选）
///
/// # Returns
/// 操作结果
pub async fn set_apn_properties(
    conn: &Connection,
    context_path: &str,
    apn: Option<&str>,
    protocol: Option<&str>,
    username: Option<&str>,
    password: Option<&str>,
    auth_method: Option<&str>,
) -> zbus::Result<()> {
    // 先检查 context 是否激活，如果激活需要先关闭
    let proxy = ConnectionContextProxy::builder(conn)
        .path(context_path)?
        .build()
        .await?;

    let props = proxy.get_properties().await?;
    let was_active = props
        .get("Active")
        .and_then(|v| bool::try_from(v.clone()).ok())
        .unwrap_or(false);

    // 如果 context 是激活状态，先关闭它
    if was_active {
        with_serial(async {
            let proxy = ConnectionContextProxy::builder(conn)
                .path(context_path)?
                .build()
                .await?;
            proxy
                .set_property("Active", zbus::zvariant::Value::Bool(false))
                .await?;
            Ok::<(), zbus::Error>(())
        })
        .await?;

        // 等待一下让状态稳定
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }

    // 设置各个属性
    if let Some(apn_val) = apn {
        set_apn_property(conn, context_path, "AccessPointName", apn_val).await?;
    }

    if let Some(protocol_val) = protocol {
        set_apn_property(conn, context_path, "Protocol", protocol_val).await?;
    }

    if let Some(username_val) = username {
        set_apn_property(conn, context_path, "Username", username_val).await?;
    }

    if let Some(password_val) = password {
        set_apn_property(conn, context_path, "Password", password_val).await?;
    }

    if let Some(auth_method_val) = auth_method {
        set_apn_property(conn, context_path, "AuthenticationMethod", auth_method_val).await?;
    }

    // 如果之前是激活状态，重新激活
    if was_active {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        with_serial(async {
            let proxy = ConnectionContextProxy::builder(conn)
                .path(context_path)?
                .build()
                .await?;
            proxy
                .set_property("Active", zbus::zvariant::Value::Bool(true))
                .await?;
            Ok::<(), zbus::Error>(())
        })
        .await?;
    }

    Ok(())
}

/// 设置数据连接状态
///
/// # Arguments
/// * `conn` - D-Bus 连接
/// * `active` - true 开启数据流量，false 关闭数据流量
///
/// # Returns
/// 操作结果
pub async fn set_data_connection(conn: &Connection, active: bool) -> zbus::Result<()> {
    with_serial(async {
        // 自动查找有效的 internet context
        let context_path = find_internet_context(conn).await?;

        let proxy = ConnectionContextProxy::builder(conn)
            .path(context_path)?
            .build()
            .await?;
        proxy
            .set_property("Active", zbus::zvariant::Value::Bool(active))
            .await?;
        Ok(())
    })
    .await
}

/// 获取数据连接状态
///
/// # Arguments
/// * `conn` - D-Bus 连接
///
/// # Returns
/// 数据连接是否激活
pub async fn get_data_connection_status(conn: &Connection) -> zbus::Result<bool> {
    with_serial(async {
        // 自动查找有效的 internet context
        let context_path = find_internet_context(conn).await?;

        let proxy = ConnectionContextProxy::builder(conn)
            .path(context_path)?
            .build()
            .await?;
        let properties = proxy.get_properties().await?;

        let active = properties
            .get("Active")
            .and_then(|v| bool::try_from(v.clone()).ok())
            .unwrap_or(false);

        Ok(active)
    })
    .await
}

/// 获取漫游状态
///
/// # Arguments
/// * `conn` - D-Bus 连接
///
/// # Returns
/// (roaming_allowed, is_roaming) 元组
pub async fn get_roaming_status(conn: &Connection) -> zbus::Result<(bool, bool)> {
    with_serial(async {
        // 获取 ConnectionManager 的 RoamingAllowed 属性
        let cm_proxy =
            Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.ConnectionManager").await?;
        let cm_props: std::collections::HashMap<String, OwnedValue> =
            cm_proxy.call("GetProperties", &()).await?;

        let roaming_allowed = cm_props
            .get("RoamingAllowed")
            .and_then(|v| bool::try_from(v.clone()).ok())
            .unwrap_or(false);

        // 获取 NetworkRegistration 的 Status 属性判断是否漫游
        let net_proxy = NetworkRegistrationProxy::new(conn).await?;
        let net_props = net_proxy.get_properties().await?;

        let status = net_props
            .get("Status")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_else(|| "unknown".to_string());

        let is_roaming = status == "roaming";

        Ok((roaming_allowed, is_roaming))
    })
    .await
}

/// 设置漫游开关
///
/// # Arguments
/// * `conn` - D-Bus 连接
/// * `allowed` - true 允许漫游数据，false 禁止漫游数据
///
/// # Returns
/// 操作结果
pub async fn set_roaming_allowed(conn: &Connection, allowed: bool) -> zbus::Result<()> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.ConnectionManager").await?;
        let value = zbus::zvariant::Value::Bool(allowed);
        proxy
            .call::<_, _, ()>("SetProperty", &("RoamingAllowed", value))
            .await?;
        Ok(())
    })
    .await
}

/// 初始化数据连接（程序启动时调用）
///
/// 检查当前数据连接状态，如果未激活则尝试自动激活。
/// 这个函数会在后台静默执行，不会阻塞服务启动。
///
/// # Arguments
/// * `conn` - D-Bus 连接
///
/// # Returns
/// 初始化结果消息
pub async fn init_data_connection(conn: &Connection) -> String {
    // 1. 先检查网络注册状态
    match NetworkRegistrationProxy::new(conn).await {
        Ok(net_proxy) => {
            if let Ok(props) = net_proxy.get_properties().await {
                let status = props
                    .get("Status")
                    .and_then(|v| String::try_from(v.clone()).ok())
                    .unwrap_or_else(|| "unknown".to_string());

                if status != "registered" && status != "roaming" {
                    return format!(
                        "Network not registered (status: {}), skipping data connection",
                        status
                    );
                }
            }
        }
        Err(e) => {
            return format!("Failed to check network status: {}", e);
        }
    }

    // 2. 自动查找有效的 internet context
    let context_path = match find_internet_context(conn).await {
        Ok(path) => path,
        Err(e) => {
            return format!("Failed to find internet context: {}", e);
        }
    };

    // 3. 获取 context 的属性
    let proxy = match ConnectionContextProxy::builder(conn).path(context_path.as_str()) {
        Ok(builder) => match builder.build().await {
            Ok(p) => p,
            Err(e) => return format!("Failed to create context proxy: {}", e),
        },
        Err(e) => return format!("Failed to build context path: {}", e),
    };

    let props = match proxy.get_properties().await {
        Ok(p) => p,
        Err(e) => return format!("Failed to get context properties: {}", e),
    };

    // 4. 检查是否已激活
    let active = props
        .get("Active")
        .and_then(|v| bool::try_from(v.clone()).ok())
        .unwrap_or(false);

    if active {
        return format!("Data connection already active ({})", context_path);
    }

    // 5. 检查 APN 是否配置
    let apn = props
        .get("AccessPointName")
        .and_then(|v| String::try_from(v.clone()).ok())
        .unwrap_or_default();

    if apn.is_empty() {
        return format!(
            "APN not configured on {}, skipping auto-connect",
            context_path
        );
    }

    // 6. 尝试激活数据连接
    match set_data_connection(conn, true).await {
        Ok(_) => format!(
            "Data connection activated on {} (APN: {})",
            context_path, apn
        ),
        Err(e) => format!("Failed to activate data connection: {}", e),
    }
}

/// 获取 SIM 卡信息（整合所有 SIM 相关信息）
///
/// # Arguments
/// * `conn` - D-Bus 连接
///
/// # Returns
/// SIM 卡信息结构（整合 SimManager + MessageManager）
pub async fn get_sim_info_data(conn: &Connection) -> zbus::Result<SimInfoResponse> {
    with_serial(async {
        let sim_proxy = SimManagerProxy::new(conn).await?;
        let msg_proxy = MessageManagerProxy::new(conn).await?;

        let sim_props = sim_proxy.get_properties().await?;
        let msg_props = msg_proxy.get_properties().await?;

        // 基本状态
        let present = sim_props
            .get("Present")
            .and_then(|v| bool::try_from(v.clone()).ok())
            .unwrap_or(false);

        // ICCID
        let iccid = sim_props
            .get("CardIdentifier")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        // IMSI
        let imsi = sim_props
            .get("SubscriberIdentity")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        // 手机号码列表
        let phone_numbers: Vec<String> = sim_props
            .get("SubscriberNumbers")
            .and_then(|v| <Vec<String>>::try_from(v.clone()).ok())
            .unwrap_or_default();

        // 短信中心
        let sms_center = msg_props
            .get("ServiceCenterAddress")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        // MCC/MNC
        let mcc = sim_props
            .get("MobileCountryCode")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        let mnc = sim_props
            .get("MobileNetworkCode")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        // PIN 状态
        let pin_required = sim_props
            .get("PinRequired")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_else(|| "none".to_string());

        // 首选语言
        let preferred_languages: Vec<String> = sim_props
            .get("PreferredLanguages")
            .and_then(|v| <Vec<String>>::try_from(v.clone()).ok())
            .unwrap_or_default();

        Ok(SimInfoResponse {
            present,
            iccid,
            imsi,
            phone_numbers,
            sms_center,
            mcc,
            mnc,
            pin_required,
            preferred_languages,
        })
    })
    .await
}

/// 获取网络信息
///
/// # Arguments
/// * `conn` - D-Bus 连接
///
/// # Returns
/// 网络信息结构
pub async fn get_network_info_data(conn: &Connection) -> zbus::Result<NetworkInfoResponse> {
    with_serial(async {
        let net_proxy = NetworkRegistrationProxy::new(conn).await?;
        let radio_proxy = RadioSettingsProxy::new(conn).await?;

        let net_props = net_proxy.get_properties().await?;
        let radio_props = radio_proxy.get_properties().await?;

        let operator_name = net_props
            .get("Name")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        let registration_status = net_props
            .get("Status")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_else(|| "unknown".to_string());

        let technology_preference = radio_props
            .get("TechnologyPreference")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        let signal_strength = net_props
            .get("Strength")
            .and_then(|v| u8::try_from(v.clone()).ok())
            .unwrap_or(0);

        let mcc = net_props
            .get("MobileCountryCode")
            .and_then(|v| String::try_from(v.clone()).ok());

        let mnc = net_props
            .get("MobileNetworkCode")
            .and_then(|v| String::try_from(v.clone()).ok());

        Ok(NetworkInfoResponse {
            operator_name,
            registration_status,
            technology_preference,
            signal_strength,
            mcc,
            mnc,
        })
    })
    .await
}

/// 获取设备信息（来自 D-Bus Modem 接口）
///
/// # Arguments
/// * `conn` - D-Bus 连接
///
/// # Returns
/// 设备信息结构
pub async fn get_device_info_data(conn: &Connection) -> zbus::Result<DeviceInfoResponse> {
    with_serial(async {
        let proxy = ModemProxy::new(conn).await?;
        let props = proxy.get_properties().await?;

        let imei = props
            .get("Serial")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        let manufacturer = props
            .get("Manufacturer")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        let model = props
            .get("Model")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_default();

        let revision = props
            .get("Revision")
            .and_then(|v| String::try_from(v.clone()).ok());

        let online = props
            .get("Online")
            .and_then(|v| bool::try_from(v.clone()).ok())
            .unwrap_or(false);

        let powered = props
            .get("Powered")
            .and_then(|v| bool::try_from(v.clone()).ok())
            .unwrap_or(false);

        Ok(DeviceInfoResponse {
            imei,
            manufacturer,
            model,
            revision,
            online,
            powered,
        })
    })
    .await
}

/// 从多个可能的键中解析 u32 值
///
/// 不同的 udx710 设备可能使用不同的键名和值类型
fn parse_u32_from_keys(cell_info: &HashMap<String, OwnedValue>, keys: &[&str]) -> u32 {
    for key in keys {
        if let Some(value) = cell_info.get(*key) {
            // 尝试直接转换为 u32
            if let Ok(num) = u32::try_from(value) {
                return num;
            }
            // 尝试转换为字符串后再解析
            if let Ok(s) = String::try_from(value.clone()) {
                // 尝试十进制解析
                if let Ok(num) = s.parse::<u32>() {
                    return num;
                }
                // 尝试十六进制解析
                if let Ok(num) = u32::from_str_radix(&s, 16) {
                    return num;
                }
            }
        }
    }
    0
}

/// 设置飞行模式
///
/// # Arguments
/// * `conn` - D-Bus 连接
/// * `enabled` - true 开启飞行模式（关闭射频），false 关闭飞行模式（开启射频）
///
/// # Returns
/// 操作结果
///
/// # 说明
/// 飞行模式通过设置 Modem 的 Online 属性实现：
/// - Online = false: 关闭射频，进入飞行模式（但 Modem 保持上电）
/// - Online = true: 开启射频，退出飞行模式
pub async fn set_airplane_mode(conn: &Connection, enabled: bool) -> zbus::Result<()> {
    with_serial(async {
        let proxy = ModemProxy::new(conn).await?;

        // 飞行模式：设置 Online 为相反值
        // enabled=true 表示开启飞行模式，即 Online=false
        proxy
            .set_property("Online", zbus::zvariant::Value::Bool(!enabled))
            .await?;

        Ok(())
    })
    .await
}

/// 获取飞行模式状态
///
/// # Arguments
/// * `conn` - D-Bus 连接
///
/// # Returns
/// 飞行模式响应结构，包含飞行模式状态、Powered 和 Online 属性
///
/// # 说明
/// 飞行模式状态判断：
/// - enabled = !Online (Online=false 表示飞行模式已启用)
pub async fn get_airplane_mode(conn: &Connection) -> zbus::Result<AirplaneModeResponse> {
    with_serial(async {
        let proxy = ModemProxy::new(conn).await?;
        let props = proxy.get_properties().await?;

        let powered = props
            .get("Powered")
            .and_then(|v| bool::try_from(v.clone()).ok())
            .unwrap_or(false);

        let online = props
            .get("Online")
            .and_then(|v| bool::try_from(v.clone()).ok())
            .unwrap_or(false);

        // 飞行模式状态：Online=false 表示飞行模式已启用
        let enabled = !online;

        Ok(AirplaneModeResponse {
            enabled,
            powered,
            online,
        })
    })
    .await
}

/// 获取射频模式
///
/// # Arguments
/// * `conn` - D-Bus 连接
///
/// # Returns
/// 射频模式响应结构
///
/// # 说明
/// 通过 RadioSettings.GetProperties 获取 TechnologyPreference 属性
pub async fn get_radio_mode(conn: &Connection) -> zbus::Result<RadioModeResponse> {
    with_serial(async {
        let proxy = RadioSettingsProxy::new(conn).await?;
        let props = proxy.get_properties().await?;

        let technology_preference = props
            .get("TechnologyPreference")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_else(|| "unknown".to_string());

        // 尝试映射为标准模式
        let mode = RadioMode::from_ofono_value(&technology_preference)
            .map(|m| match m {
                RadioMode::Auto => "auto",
                RadioMode::LteOnly => "lte",
                RadioMode::NrOnly => "nr",
            })
            .unwrap_or("unknown")
            .to_string();

        Ok(RadioModeResponse {
            mode,
            technology_preference,
        })
    })
    .await
}

/// 设置射频模式
///
/// # Arguments
/// * `conn` - D-Bus 连接
/// * `mode` - 目标射频模式
///
/// # Returns
/// 操作结果
///
/// # 说明
/// 通过 RadioSettings.SetProperty 设置 TechnologyPreference 属性
pub async fn set_radio_mode(conn: &Connection, mode: RadioMode) -> zbus::Result<()> {
    with_serial(async {
        let proxy = RadioSettingsProxy::new(conn).await?;
        let ofono_value = mode.to_ofono_value();

        proxy
            .set_property(
                "TechnologyPreference",
                zbus::zvariant::Value::Str(ofono_value.into()),
            )
            .await?;

        Ok(())
    })
    .await
}
