//! 自 dbus.rs 拆出（纯移动，逻辑未改）。

use super::*;

/// 获取 IMEISV（软件版本号）
pub async fn get_imeisv(conn: &Connection) -> zbus::Result<ImeisvResponse> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.Modem").await?;
        let result: HashMap<String, OwnedValue> = proxy.call("GetImeisv", &()).await?;

        let svn = result
            .get("SoftwareVersionNumber")
            .and_then(|v| String::try_from(v.clone()).ok())
            .unwrap_or_else(|| "Unknown".to_string());

        Ok(ImeisvResponse {
            software_version_number: svn,
        })
    })
    .await
}

/// 获取信号强度详细信息
pub async fn get_signal_strength(conn: &Connection) -> zbus::Result<SignalStrengthResponse> {
    with_serial(async {
        let proxy =
            Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.NetworkRegistration").await?;
        let result: HashMap<String, OwnedValue> = proxy.call("GetSignalStrength", &()).await?;

        let strength = result
            .get("Strength")
            .and_then(|v| i32::try_from(v.clone()).ok())
            .unwrap_or(0);

        Ok(SignalStrengthResponse { strength })
    })
    .await
}

/// 获取 NITZ 网络时间
pub async fn get_nitz_time(conn: &Connection) -> zbus::Result<NitzTimeResponse> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.Modem").await?;

        match proxy.call("GetNITZ", &()).await {
            Ok(time_string) => Ok(NitzTimeResponse {
                time_string,
                available: true,
            }),
            Err(_) => Ok(NitzTimeResponse {
                time_string: String::new(),
                available: false,
            }),
        }
    })
    .await
}

/// 获取 IMS 状态
pub async fn get_ims_status(conn: &Connection) -> zbus::Result<ImsStatusResponse> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.IpMultimediaSystem").await?;
        let props: HashMap<String, OwnedValue> = proxy.call("GetProperties", &()).await?;

        let registered = props
            .get("Registered")
            .and_then(|v| bool::try_from(v.clone()).ok())
            .unwrap_or(false);

        let voice_capable = props
            .get("VoiceCapable")
            .and_then(|v| bool::try_from(v.clone()).ok())
            .unwrap_or(false);

        let sms_capable = props
            .get("SmsCapable")
            .and_then(|v| bool::try_from(v.clone()).ok())
            .unwrap_or(false);

        Ok(ImsStatusResponse {
            registered,
            voice_capable,
            sms_capable,
        })
    })
    .await
}

/// 获取运营商列表（快速，仅返回当前）
pub async fn get_operators(conn: &Connection) -> zbus::Result<OperatorListResponse> {
    with_serial(async {
        let proxy =
            Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.NetworkRegistration").await?;
        let result: Vec<(zbus::zvariant::OwnedObjectPath, HashMap<String, OwnedValue>)> =
            proxy.call("GetOperators", &()).await?;

        let mut operators = Vec::new();
        for (path, props) in result {
            operators.push(parse_operator_info(path.to_string(), props));
        }

        Ok(OperatorListResponse { operators })
    })
    .await
}

/// 运营商全频扫描的硬上限。
///
/// ofono 的 `NetworkRegistration.Scan()` 等同 `AT+COPS=?`，本身可能耗时数十秒到两
/// 分钟。该调用在 `with_serial` 内执行，会**独占全局串口锁**；此前没有超时，导致
/// 扫描期间所有 AT/D-Bus 操作（含 watchdog 的数据自愈）全部排队，表现为整个管理
/// 接口延迟飙升。这里给它加上硬上限，确保锁一定会被释放。
const OPERATOR_SCAN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(140);

/// 扫描运营商（慢，返回所有可用）
pub async fn scan_operators(conn: &Connection) -> zbus::Result<OperatorListResponse> {
    let started_at = std::time::Instant::now();
    diagnostics::record("OPERATOR_SCAN_START");

    let scan: zbus::Result<OperatorListResponse> = with_serial(async {
        let proxy =
            Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.NetworkRegistration").await?;
        let scanned: zbus::Result<
            Vec<(zbus::zvariant::OwnedObjectPath, HashMap<String, OwnedValue>)>,
        > = tokio::time::timeout(OPERATOR_SCAN_TIMEOUT, proxy.call("Scan", &()))
            .await
            .map_err(|_| {
                zbus::Error::Failure(format!(
                    "operator scan timed out after {}s",
                    OPERATOR_SCAN_TIMEOUT.as_secs()
                ))
            })?;
        let result = scanned?;

        let mut operators = Vec::new();
        for (path, props) in result {
            operators.push(parse_operator_info(path.to_string(), props));
        }

        Ok(OperatorListResponse { operators })
    })
    .await;

    match scan.as_ref() {
        Ok(response) => diagnostics::record(format!(
            "OPERATOR_SCAN_DONE success=true duration_ms={} operators={}",
            started_at.elapsed().as_millis(),
            response.operators.len()
        )),
        Err(error) => diagnostics::record(format!(
            "OPERATOR_SCAN_DONE success=false duration_ms={} error={}",
            started_at.elapsed().as_millis(),
            compact_log_value(&error.to_string(), 120)
        )),
    }

    scan
}

/// 解析运营商信息
fn parse_operator_info(path: String, props: HashMap<String, OwnedValue>) -> OperatorInfo {
    let name = props
        .get("Name")
        .and_then(|v| String::try_from(v.clone()).ok())
        .unwrap_or_else(|| "Unknown".to_string());

    let status = props
        .get("Status")
        .and_then(|v| String::try_from(v.clone()).ok())
        .unwrap_or_else(|| "unknown".to_string());

    let mcc = props
        .get("MobileCountryCode")
        .and_then(|v| String::try_from(v.clone()).ok())
        .unwrap_or_default();

    let mnc = props
        .get("MobileNetworkCode")
        .and_then(|v| String::try_from(v.clone()).ok())
        .unwrap_or_default();

    let technologies: Vec<String> = props
        .get("Technologies")
        .and_then(|v| {
            // 尝试将 Value 转换为数组
            <Vec<String>>::try_from(v.clone()).ok()
        })
        .unwrap_or_default();

    OperatorInfo {
        path,
        name,
        status,
        mcc,
        mnc,
        technologies,
    }
}

/// 手动注册到指定运营商
pub async fn register_operator_manual(conn: &Connection, mccmnc: &str) -> zbus::Result<()> {
    with_serial(async {
        let proxy =
            Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.NetworkRegistration").await?;
        proxy.call("RegisterManually", &(mccmnc, "")).await
    })
    .await
}

/// 自动注册运营商
pub async fn register_operator_auto(conn: &Connection) -> zbus::Result<()> {
    with_serial(async {
        let proxy =
            Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.NetworkRegistration").await?;
        proxy.call("Register", &()).await
    })
    .await
}

/// 获取 SIM 卡槽信息
pub async fn get_sim_slot(conn: &Connection) -> zbus::Result<SimSlotResponse> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.Modem").await?;
        let response: String = proxy.call("SendAtcmd", &("AT+SPCONFIGSIMSLOT?")).await?;

        // 解析响应：+SPCONFIGSIMSLOT: 66051
        let raw_value = response
            .lines()
            .find(|line| line.contains("+SPCONFIGSIMSLOT:"))
            .and_then(|line| line.split(':').nth(1))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(String::new);

        // 根据值判断卡槽（这个需要根据实际设备的规则来解析）
        // 66051 可能表示卡槽 1，66306 可能表示卡槽 2
        // 您需要提供切换命令来确认规则
        let active_slot = if raw_value.contains("66051") {
            1
        } else if raw_value.contains("66306") {
            2
        } else {
            0
        };

        Ok(SimSlotResponse {
            active_slot,
            raw_value,
        })
    })
    .await
}

/// 切换 SIM 卡槽
pub async fn switch_sim_slot(conn: &Connection, slot: u8) -> zbus::Result<String> {
    with_serial(async {
        let proxy = Proxy::new(conn, "org.ofono", "/ril_0", "org.ofono.Modem").await?;

        // 根据卡槽号生成 AT 命令
        // 注意：这个命令格式需要根据您的设备文档确认
        // 可能是 AT+SPCONFIGSIMSLOT=1 或 AT+SPCONFIGSIMSLOT=66051
        let value = match slot {
            1 => "66051", // 卡槽 1 的值
            2 => "66306", // 卡槽 2 的值（猜测，需要您确认）
            _ => {
                return Err(zbus::Error::Failure(
                    "Invalid slot number, must be 1 or 2".to_string(),
                ))
            }
        };

        let cmd = format!("AT+SPCONFIGSIMSLOT={}", value);
        let response: String = proxy.call("SendAtcmd", &(cmd.as_str())).await?;

        Ok(response)
    })
    .await
}
