//! 自 dbus.rs 拆出（纯移动，逻辑未改）。

use super::*;

/// 根据 MCC/MNC 获取推荐的 APN 配置
///
/// # Arguments
/// * `mcc` - 移动国家代码
/// * `mnc` - 移动网络代码
///
/// # Returns
/// (apn, protocol) 元组，如果未找到则返回 None
fn get_recommended_apn(mcc: &str, mnc: &str) -> Option<(&'static str, &'static str)> {
    match (mcc, mnc) {
        // 中国移动 (46000, 46002, 46007, 46008)
        ("460", "00") | ("460", "02") | ("460", "07") | ("460", "08") => Some(("cmnet", "dual")),
        // 中国联通 (46001, 46006, 46009)
        ("460", "01") | ("460", "06") | ("460", "09") => Some(("3gnet", "dual")),
        // 中国电信 (46003, 46005, 46011)
        ("460", "03") | ("460", "05") | ("460", "11") => Some(("ctnet", "dual")),
        // 中国广电 (46015)
        ("460", "15") => Some(("cbnet", "dual")),
        _ => None,
    }
}

/// 自动配置 APN（根据 SIM 卡运营商）
///
/// 根据 SIM 卡的 MCC/MNC 自动查找并设置推荐的 APN 配置
///
/// # Arguments
/// * `conn` - D-Bus 连接
/// * `context_path` - 要配置的 context 路径
///
/// # Returns
/// 配置结果消息
async fn auto_configure_apn(conn: &Connection, context_path: &str) -> Result<String, String> {
    // 1. 获取网络注册信息中的 MCC/MNC
    let net_proxy = NetworkRegistrationProxy::new(conn)
        .await
        .map_err(|e| format!("Failed to create network proxy: {}", e))?;

    let props = net_proxy
        .get_properties()
        .await
        .map_err(|e| format!("Failed to get network properties: {}", e))?;

    let mcc = props
        .get("MobileCountryCode")
        .and_then(|v| String::try_from(v.clone()).ok())
        .unwrap_or_default();

    let mnc = props
        .get("MobileNetworkCode")
        .and_then(|v| String::try_from(v.clone()).ok())
        .unwrap_or_default();

    if mcc.is_empty() || mnc.is_empty() {
        return Err("MCC/MNC not available".to_string());
    }

    // 2. 查找推荐 APN
    let (apn, protocol) = get_recommended_apn(&mcc, &mnc)
        .ok_or_else(|| format!("No recommended APN for MCC={} MNC={}", mcc, mnc))?;

    // 3. 设置 APN 和协议
    set_apn_property(conn, context_path, "AccessPointName", apn)
        .await
        .map_err(|e| format!("Failed to set APN: {}", e))?;

    set_apn_property(conn, context_path, "Protocol", protocol)
        .await
        .map_err(|e| format!("Failed to set protocol: {}", e))?;

    Ok(format!("Auto-configured APN: {} ({})", apn, protocol))
}

/// 检查并恢复数据连接
///
/// 这个函数被 watchdog 调用，检查数据连接状态并在需要时恢复
///
/// # Arguments
/// * `conn` - D-Bus 连接
///
/// # Returns
/// 当前状态描述字符串
async fn check_and_restore_data_connection(conn: &Connection) -> String {
    // 1. 检查网络注册状态
    let net_status = match NetworkRegistrationProxy::new(conn).await {
        Ok(net_proxy) => match net_proxy.get_properties().await {
            Ok(props) => props
                .get("Status")
                .and_then(|v| String::try_from(v.clone()).ok())
                .unwrap_or_else(|| "unknown".to_string()),
            Err(_) => "unknown".to_string(),
        },
        Err(_) => return "Network proxy unavailable".to_string(),
    };

    // 网络未注册时不尝试恢复
    if net_status != "registered" && net_status != "roaming" {
        return format!("Waiting for network (status: {})", net_status);
    }

    // 2. 查找 internet context
    let context_path = match find_internet_context(conn).await {
        Ok(path) => path,
        Err(e) => return format!("No internet context: {}", e),
    };

    // 3. 获取 context 属性
    let proxy = match ConnectionContextProxy::builder(conn).path(context_path.as_str()) {
        Ok(builder) => match builder.build().await {
            Ok(p) => p,
            Err(e) => return format!("Context proxy error: {}", e),
        },
        Err(e) => return format!("Context path error: {}", e),
    };

    let props = match proxy.get_properties().await {
        Ok(p) => p,
        Err(e) => return format!("Get properties error: {}", e),
    };

    let apn = props
        .get("AccessPointName")
        .and_then(|v| String::try_from(v.clone()).ok())
        .unwrap_or_default();

    let active = props
        .get("Active")
        .and_then(|v| bool::try_from(v.clone()).ok())
        .unwrap_or(false);

    // 4. 如果 APN 为空，尝试自动配置
    if apn.is_empty() {
        match auto_configure_apn(conn, &context_path).await {
            Ok(msg) => {
                // APN 配置成功后，继续尝试激活
                match set_data_connection(conn, true).await {
                    Ok(_) => return format!("{}, connection activated", msg),
                    Err(e) => return format!("{}, but activation failed: {}", msg, e),
                }
            }
            Err(e) => return format!("APN not configured: {}", e),
        }
    }

    // 5. 如果连接未激活，尝试激活
    if !active {
        match set_data_connection(conn, true).await {
            Ok(_) => return format!("Connection restored (APN: {})", apn),
            Err(e) => return format!("Activation failed: {}", e),
        }
    }

    // 6. 连接正常
    format!("Connected (APN: {})", apn)
}

/// 数据连接 Watchdog - 后台轮询监控并自动恢复
///
/// 持续监控数据连接状态，在断开时自动尝试恢复。
/// 支持自动识别运营商并配置 APN。
///
/// # Arguments
/// * `conn` - D-Bus 连接
/// * `interval_secs` - 检查间隔（秒）
/// * `iptables_flush_enabled` - 是否允许清空 iptables filter 表。默认关闭
///   （由 `UDX710_WATCHDOG_IPTABLES_FLUSH` 控制），因为 filter 表规则由设备
///   原厂固件维护，清空后不会自动重建，反而打断转发路径。
pub async fn data_connection_watchdog(
    conn: std::sync::Arc<Connection>,
    interval_secs: u64,
    iptables_flush_enabled: bool,
) {
    use crate::iptables::{flush_iptables, get_iptables_rule_count};

    const PROBE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);
    const MIN_RECOVERY_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(300);
    const MAX_RECOVERY_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(1800);
    const USB_STALL_PROBE_THRESHOLD: u8 = 3;
    const USB_RECOVERY_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(300);
    /// 路由类失败在触发下电重拨之前的复测延迟。
    ///
    /// 实测：模组重附着时默认路由会被摘掉几秒，而此时的「首轮即重拨」会撞上
    /// `GPRS is not attached`，既无效又给模组添一次状态抖动。因此先等这么久再复测。
    const ROUTE_CONFIRM_DELAY: std::time::Duration = std::time::Duration::from_secs(5);
    /// usb0（主机侧管理链路）需连续多少次采样保持 down 才认定为「链路卡死」。
    const USB_LINK_DOWN_PROBES: u8 = 6;
    /// 两次 USB 链路重建之间的最小间隔。
    const USB_LINK_RECOVERY_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(1800);
    /// 连续重建的最大尝试次数（链路恢复 up 后复位）。
    const USB_LINK_MAX_ATTEMPTS: u8 = 2;

    let mut last_data_log = String::new();
    let mut last_iptables_action = false; // 上次是否清空了 iptables
    let mut last_connectivity_probe = std::time::Instant::now()
        .checked_sub(PROBE_INTERVAL)
        .unwrap_or_else(std::time::Instant::now);
    let mut consecutive_dual_failures = 0u8;
    let mut consecutive_partial_failures = 0u8;
    let mut last_ipv6_route_fix: Option<std::time::Instant> = None; // IPv6 默认路由修复节流
    let mut last_recovery = std::time::Instant::now()
        .checked_sub(MIN_RECOVERY_COOLDOWN)
        .unwrap_or_else(std::time::Instant::now);
    let mut recovery_cooldown = MIN_RECOVERY_COOLDOWN;
    let mut recovery_attempts = 0u32;
    let mut awaiting_recovery_confirmation = false;
    let mut last_usb_path: Option<InterfacePathSnapshot> = None;
    let mut usb_path_had_activity = false;
    let mut usb_activity_before_bearer_fault = false;
    let mut usb_recovery_eligible = false;
    let mut usb_stalled_probes = 0u8;
    let mut last_usb_recovery = std::time::Instant::now()
        .checked_sub(USB_RECOVERY_COOLDOWN)
        .unwrap_or_else(std::time::Instant::now);
    // The watchdog loop is serial, but keep this explicit guard so a future
    // refactor cannot start overlapping gadget rebuilds.
    let usb_recovery_in_flight = std::sync::atomic::AtomicBool::new(false);
    // usb0 管理链路状态机：用于观测 up/down 跃迁，并在链路长时间卡死时做一次
    // 受守卫的重建（帮助主机重新枚举），避免只能靠重启设备恢复。
    let mut usb_link_down_probes = 0u8;
    let mut usb_link_was_down = false;
    let mut usb_link_down_since: Option<std::time::Instant> = None;
    let mut last_usb_link_recovery = std::time::Instant::now()
        .checked_sub(USB_LINK_RECOVERY_COOLDOWN)
        .unwrap_or_else(std::time::Instant::now);
    let mut usb_link_recovery_attempts = 0u8;

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(interval_secs)).await;

        // 1. iptables 守卫（默认关闭）
        //
        // 本服务不管理防火墙：filter 表里的规则全部由设备原厂固件维护（转发、
        // zone、fast path/offload 等）。无条件 `iptables -F` 会把这些规则抹掉，
        // 而固件不会自动重建，结果是转发路径被反复打断、快转失效，表现为上网
        // 延迟升高与周期性抖动。因此默认不动 iptables，只有显式打开开关才执行。
        if iptables_flush_enabled {
            match get_iptables_rule_count().await {
                Ok(count) => {
                    if count.has_rules() {
                        match flush_iptables().await {
                            Ok(()) => {
                                if !last_iptables_action {
                                    info!(
                                        total = count.total(),
                                        ipv4 = count.ipv4_rules,
                                        ipv6 = count.ipv6_rules,
                                        "Watchdog: iptables flushed"
                                    );
                                    diagnostics::record(format!(
                                        "IPTABLES_FLUSH ipv4={} ipv6={}",
                                        count.ipv4_rules, count.ipv6_rules
                                    ));
                                }
                                last_iptables_action = true;
                            }
                            Err(e) => {
                                warn!(error = %e, "Watchdog: iptables flush failed");
                            }
                        }
                    } else {
                        // 无规则，重置标志
                        last_iptables_action = false;
                    }
                }
                Err(e) => {
                    warn!(error = %e, "Watchdog: iptables check failed");
                }
            }
        }

        // 2. 检查并恢复数据连接
        let result = check_and_restore_data_connection(&conn).await;

        // 只在状态变化时打印日志，避免刷屏
        if result != last_data_log {
            info!(status = %result, "Watchdog: data connection");
            last_data_log = result;
        }

        // `Active=true` only means that ofono believes the PDP context is
        // enabled.  Probe the real path as well, otherwise a blackholed
        // context (as seen during the N1 transition) looks healthy forever.
        if last_connectivity_probe.elapsed() >= PROBE_INTERVAL {
            last_connectivity_probe = std::time::Instant::now();

            let context_active = get_data_connection_status(&conn).await.unwrap_or(false);
            let (usb_path, sipa_path) = tokio::join!(
                interface_path_snapshot("usb0"),
                interface_path_snapshot("sipa_eth0"),
            );
            diagnostics::record(format!(
                "DATA_HOST_PATH usb0_operstate={} usb0_carrier={} usb0_rx_bytes={} usb0_tx_bytes={} sipa_operstate={} sipa_carrier={} sipa_rx_bytes={} sipa_tx_bytes={}",
                usb_path.operstate,
                usb_path.carrier,
                usb_path.rx_bytes,
                usb_path.tx_bytes,
                sipa_path.operstate,
                sipa_path.carrier,
                sipa_path.rx_bytes,
                sipa_path.tx_bytes,
            ));
            let usb_counters_changed = last_usb_path
                .as_ref()
                .and_then(|previous| usb_path_counters_changed(previous, &usb_path));
            if usb_counters_changed == Some(true) {
                usb_path_had_activity = true;
            }
            last_usb_path = Some(usb_path.clone());

            // ---- usb0 管理链路：状态跃迁观测 + 受守卫自愈 ----
            //
            // usb0 是主机侧链路，与 sipa_eth0（蜂窝数据）相互独立。主机睡眠/关机时
            // usb0 变 down 属正常，因此这里只做观测；只有长时间保持 down 且无载波
            // （链路本来就不可用）时才重建一次 gadget，帮助主机重新枚举。
            let usb_link_down = usb_path.operstate.eq_ignore_ascii_case("down");
            let usb_link_no_carrier = usb_path.carrier == "0";
            if usb_link_down {
                if !usb_link_was_down {
                    diagnostics::record(format!(
                        "USB_PATH_STATE_CHANGE from=up to=down operstate={} carrier={} rx_bytes={} tx_bytes={}",
                        usb_path.operstate,
                        usb_path.carrier,
                        usb_path.rx_bytes,
                        usb_path.tx_bytes
                    ));
                    usb_link_down_since = Some(std::time::Instant::now());
                }
                usb_link_was_down = true;
                usb_link_down_probes = usb_link_down_probes.saturating_add(1);
            } else {
                if usb_link_was_down {
                    diagnostics::record(format!(
                        "USB_PATH_RECOVERED duration_secs={} operstate={} carrier={}",
                        usb_link_down_since
                            .map(|since| since.elapsed().as_secs())
                            .unwrap_or(0),
                        usb_path.operstate,
                        usb_path.carrier
                    ));
                    if usb_path.carrier == "1" {
                        match tokio::task::spawn_blocking(crate::usb_switch::ensure_usb_forwarding)
                            .await
                        {
                            Ok(()) => diagnostics::record(
                                "USB_FORWARDING_RECHECK reason=usb-link-recovered",
                            ),
                            Err(error) => diagnostics::record(format!(
                                "USB_FORWARDING_TASK_FAILED reason=usb-link-recovered error={error}"
                            )),
                        }
                    }
                    // 链路恢复说明卡死已解除，允许将来开启新一轮重建。
                    usb_link_recovery_attempts = 0;
                }
                usb_link_was_down = false;
                usb_link_down_since = None;
                usb_link_down_probes = 0;
            }

            if usb_link_down && usb_link_down_probes == USB_LINK_DOWN_PROBES {
                diagnostics::record(format!(
                    "USB_PATH_DOWN duration_secs={} operstate={} carrier={} rx_bytes={} tx_bytes={}",
                    usb_link_down_since
                        .map(|since| since.elapsed().as_secs())
                        .unwrap_or(0),
                    usb_path.operstate,
                    usb_path.carrier,
                    usb_path.rx_bytes,
                    usb_path.tx_bytes
                ));
            }

            // 承载故障恢复进行中时不动 USB，避免两类恢复动作叠在一起。
            let usb_link_recovery_allowed = consecutive_dual_failures == 0;
            if should_recover_usb_link(
                usb_link_down,
                usb_link_no_carrier,
                usb_link_down_probes,
                USB_LINK_DOWN_PROBES,
                last_usb_link_recovery.elapsed() >= USB_LINK_RECOVERY_COOLDOWN,
                USB_LINK_MAX_ATTEMPTS.saturating_sub(usb_link_recovery_attempts),
                // watchdog 主循环是串行的，不存在并发重建。
                false,
            ) && usb_link_recovery_allowed
            {
                usb_link_recovery_attempts = usb_link_recovery_attempts.saturating_add(1);
                let started_at = std::time::Instant::now();
                diagnostics::record(format!(
                    "USB_LINK_RECOVERY_START down_probes={} attempt={} cooldown_secs={}",
                    usb_link_down_probes,
                    usb_link_recovery_attempts,
                    USB_LINK_RECOVERY_COOLDOWN.as_secs()
                ));
                let recovery = rebuild_usb_gadget().await;
                last_usb_link_recovery = std::time::Instant::now();
                usb_link_down_probes = 0;
                match recovery {
                    Ok(()) => diagnostics::record(format!(
                        "USB_LINK_RECOVERY_DONE success=true duration_ms={}",
                        started_at.elapsed().as_millis()
                    )),
                    Err(error) => diagnostics::record(format!(
                        "USB_LINK_RECOVERY_DONE success=false duration_ms={} error={}",
                        started_at.elapsed().as_millis(),
                        compact_log_value(&error, 160)
                    )),
                }
            }
            if !context_active {
                diagnostics::record("DATA_CONTEXT_INACTIVE watchdog probe skipped connectivity");
                consecutive_dual_failures = 0;
                consecutive_partial_failures = 0;
                usb_recovery_eligible = false;
                usb_stalled_probes = 0;
                continue;
            }

            let (probe, transport) = tokio::join!(check_connectivity(), check_transport());
            diagnostics::record(format!(
                "DATA_TRANSPORT_PROBE dns={} dns_ms={} tcp4={} tcp4_ms={} tcp6={} tcp6_ms={} https={} https_ms={} https_status={}",
                transport.dns,
                format_probe_ms(transport.dns_latency_ms),
                transport.tcp4,
                format_probe_ms(transport.tcp4_latency_ms),
                transport.tcp6,
                format_probe_ms(transport.tcp6_latency_ms),
                transport
                    .https
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "-".to_string()),
                format_probe_ms(transport.https_latency_ms),
                transport
                    .https_status
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "-".to_string()),
            ));

            // ICMP can be delayed or deprioritised while TCP still works.  A
            // ping is therefore considered usable unless its tail/loss is
            // degraded and the matching TCP probe also failed.  This keeps a
            // noisy ICMP target from causing a needless PDP reset, while still
            // catching the "RTT rises, then the user plane blackholes" case.
            let ipv4_ok = effective_ipv4_ok(&probe, &transport);
            let ipv6_transport_ok = effective_ipv6_ok(&probe, &transport);
            let both_failed = both_paths_failed(&probe, &transport);
            diagnostics::record(format!(
                "DATA_CONNECTIVITY_PROBE ipv4={} ipv4_ms={} ipv4_p95_ms={} ipv4_loss={:.1} ipv4_ok={} ipv4_err={} ipv6={} ipv6_ms={} ipv6_p95_ms={} ipv6_loss={:.1} ipv6_ok={} ipv6_err={}",
                probe.ipv4.success,
                format_probe_ms(probe.ipv4.latency_ms),
                format_probe_ms(probe.ipv4.p95_latency_ms),
                probe.ipv4.packet_loss_percent,
                ipv4_ok,
                probe
                    .ipv4
                    .error
                    .as_deref()
                    .map(|value| compact_log_value(value, 100))
                    .unwrap_or_else(|| "-".to_string()),
                probe.ipv6.success,
                format_probe_ms(probe.ipv6.latency_ms),
                format_probe_ms(probe.ipv6.p95_latency_ms),
                probe.ipv6.packet_loss_percent,
                ipv6_transport_ok,
                probe
                    .ipv6
                    .error
                    .as_deref()
                    .map(|value| compact_log_value(value, 100))
                    .unwrap_or_else(|| "-".to_string()),
            ));

            // IPv6 已持有全球单播地址但探测不可达：根因通常是 Linux 侧缺少
            // IPv6 默认路由（模组下发了地址却未写入 ::/0 路由）。尝试补默认路由。
            if probe.ipv6_available && !probe.ipv6.success {
                ensure_ipv6_default_route(&mut last_ipv6_route_fix).await;
            }

            if both_failed {
                consecutive_dual_failures = consecutive_dual_failures.saturating_add(1);
                consecutive_partial_failures = 0;
                let failure = capture_connectivity_failure(&conn, &probe).await;
                usb_recovery_eligible = true;
                usb_activity_before_bearer_fault = usb_path_had_activity;
                usb_stalled_probes = 0;

                // 路由类失败常只是几秒的瞬时窗口（模组重附着时默认路由被摘掉）。
                // 实测此时「首轮即重拨」会撞上 `GPRS is not attached`，既无效又给
                // 模组添一次抖动；因此先复测，恢复了就只记诊断、不重拨。
                let mut route_failure_confirmed = false;
                if is_route_failure(&failure.path_class) {
                    tokio::time::sleep(ROUTE_CONFIRM_DELAY).await;
                    let (recheck, recheck_transport) =
                        tokio::join!(check_connectivity(), check_transport());
                    let recheck_ipv4_ok = effective_ipv4_ok(&recheck, &recheck_transport);
                    let recheck_ipv6_ok = effective_ipv6_ok(&recheck, &recheck_transport);
                    if recheck_ipv4_ok || (recheck.ipv6_available && recheck_ipv6_ok) {
                        diagnostics::record(format!(
                            "DATA_CONNECTIVITY_ROUTE_RECOVERED path_class={} ipv4={} ipv6={}",
                            failure.path_class, recheck_ipv4_ok, recheck_ipv6_ok
                        ));
                        consecutive_dual_failures = 0;
                        // 瞬时窗口已自愈：撤销本次失败对 USB 兜底自愈的武装。
                        usb_recovery_eligible = false;
                        usb_activity_before_bearer_fault = false;
                    } else {
                        route_failure_confirmed = true;
                        diagnostics::record(format!(
                            "DATA_CONNECTIVITY_ROUTE_CONFIRMED path_class={}",
                            failure.path_class
                        ));
                    }
                }

                if should_reactivate_data_context(
                    consecutive_dual_failures,
                    &failure.path_class,
                    route_failure_confirmed,
                ) && last_recovery.elapsed() >= recovery_cooldown
                {
                    if awaiting_recovery_confirmation {
                        recovery_cooldown =
                            increase_recovery_cooldown(recovery_cooldown, MAX_RECOVERY_COOLDOWN);
                    }
                    recovery_attempts = recovery_attempts.saturating_add(1);
                    let started_at = std::time::Instant::now();
                    diagnostics::record(format!(
                        "DATA_CONTEXT_RECOVERY_START attempt={} path_class={} cooldown_secs={}",
                        recovery_attempts,
                        failure.path_class,
                        recovery_cooldown.as_secs()
                    ));

                    let (recovery_ok, recovery) = reactivate_data_context(&conn).await;
                    let recovery_duration_ms = started_at.elapsed().as_millis();
                    last_recovery = std::time::Instant::now();
                    awaiting_recovery_confirmation = recovery_ok;
                    if !recovery_ok {
                        recovery_cooldown =
                            increase_recovery_cooldown(recovery_cooldown, MAX_RECOVERY_COOLDOWN);
                    }
                    diagnostics::record(format!(
                        "DATA_CONTEXT_RECOVERY_DONE success={} duration_ms={} next_cooldown_secs={} result={}",
                        recovery_ok,
                        recovery_duration_ms,
                        recovery_cooldown.as_secs(),
                        compact_log_value(&recovery, 180)
                    ));
                    warn!(result = %recovery, path_class = %failure.path_class, "Watchdog: reactivated data context after connectivity failure");
                    consecutive_dual_failures = 0;
                }
            } else if ipv4_ok && (!probe.ipv6_available || ipv6_transport_ok) {
                consecutive_dual_failures = 0;
                consecutive_partial_failures = 0;
                if awaiting_recovery_confirmation {
                    awaiting_recovery_confirmation = false;
                    recovery_attempts = 0;
                    recovery_cooldown = MIN_RECOVERY_COOLDOWN;
                    diagnostics::record(
                        "DATA_CONTEXT_RECOVERY_CONFIRMED connectivity probe recovered",
                    );
                }

                // A host-side USB recovery is deliberately gated on a prior
                // carrier-path failure and observed USB activity before that
                // failure.  This avoids treating a newly booted or genuinely
                // idle USB peer as a stuck gadget merely because its counters
                // do not move for three probes.
                if usb_recovery_eligible && usb_activity_before_bearer_fault {
                    if usb_counters_changed == Some(true) {
                        // The host path recovered on its own after the
                        // bearer fault; stop carrying this recovery window
                        // into an unrelated idle period.
                        usb_recovery_eligible = false;
                        usb_activity_before_bearer_fault = false;
                        usb_stalled_probes = 0;
                    } else if usb_path_is_stalled(&usb_path, usb_counters_changed) {
                        usb_stalled_probes = usb_stalled_probes.saturating_add(1);
                    } else {
                        usb_stalled_probes = 0;
                    }

                    if usb_stalled_probes == USB_STALL_PROBE_THRESHOLD {
                        diagnostics::record(format!(
                            "USB_PATH_STALLED probes={} usb0_operstate={} usb0_carrier={} usb0_rx_bytes={} usb0_tx_bytes={}",
                            usb_stalled_probes,
                            usb_path.operstate,
                            usb_path.carrier,
                            usb_path.rx_bytes,
                            usb_path.tx_bytes,
                        ));
                    }

                    if should_recover_usb_path(
                        usb_recovery_eligible,
                        usb_activity_before_bearer_fault,
                        usb_stalled_probes,
                        USB_STALL_PROBE_THRESHOLD,
                        last_usb_recovery.elapsed() >= USB_RECOVERY_COOLDOWN,
                        usb_recovery_in_flight.load(std::sync::atomic::Ordering::Acquire),
                    ) && usb_recovery_in_flight
                        .compare_exchange(
                            false,
                            true,
                            std::sync::atomic::Ordering::AcqRel,
                            std::sync::atomic::Ordering::Acquire,
                        )
                        .is_ok()
                    {
                        let started_at = std::time::Instant::now();
                        diagnostics::record(format!(
                            "USB_PATH_RECOVERY_START stalled_probes={} cooldown_secs={}",
                            usb_stalled_probes,
                            USB_RECOVERY_COOLDOWN.as_secs()
                        ));
                        let recovery = rebuild_usb_gadget().await;
                        last_usb_recovery = std::time::Instant::now();
                        usb_recovery_in_flight.store(false, std::sync::atomic::Ordering::Release);
                        usb_stalled_probes = 0;
                        match recovery {
                            Ok(()) => {
                                diagnostics::record(format!(
                                    "USB_PATH_RECOVERY_DONE success=true duration_ms={}",
                                    started_at.elapsed().as_millis()
                                ));
                                usb_recovery_eligible = false;
                                usb_activity_before_bearer_fault = false;
                            }
                            Err(error) => {
                                diagnostics::record(format!(
                                    "USB_PATH_RECOVERY_DONE success=false duration_ms={} error={}",
                                    started_at.elapsed().as_millis(),
                                    compact_log_value(&error, 180)
                                ));
                                warn!(error = %error, "Watchdog: USB gadget recovery skipped or failed");
                            }
                        }
                    }
                } else {
                    usb_stalled_probes = 0;
                }
            } else {
                // 部分栈故障（恰有一个协议失败）。但多数运营商 / APN 根本不提供
                // IPv6：此时接口没有全球单播地址，单纯 IPv6 不通属正常状态，既不
                // 应计入 partial 计数，更不应触发重拨（此前每轮都记录一条无意义的
                // `DATA_CONNECTIVITY_PARTIAL` 即源于此）。只有接口确实持有全球
                // IPv6 地址、却仍探测失败时，才视为真实的部分栈故障。
                if !probe.ipv6_available {
                    // 接口没有 IPv6 全球地址：IPv6 不通属正常，不计入 partial；但必须
                    // 清除 dual 连续失败计数，否则残留值会让后续一次 both 失败提前达到
                    // 重拨阈值，造成过度重拨与周期性断网。
                    consecutive_dual_failures = 0;
                    diagnostics::record(format!(
                        "DATA_CONNECTIVITY_NO_IPV6_WAN ipv4={} ipv6={} ipv6_err={}",
                        probe.ipv4.success,
                        probe.ipv6.success,
                        probe
                            .ipv6
                            .error
                            .as_deref()
                            .map(|value| compact_log_value(value, 100))
                            .unwrap_or_else(|| "-".to_string()),
                    ));
                } else {
                    consecutive_dual_failures = 0;
                    consecutive_partial_failures = consecutive_partial_failures.saturating_add(1);
                    diagnostics::record(format!(
                    "DATA_CONNECTIVITY_PARTIAL failures={} ipv4={} ipv6={} ipv4_err={} ipv6_err={}",
                    consecutive_partial_failures,
                    probe.ipv4.success,
                    probe.ipv6.success,
                    probe
                        .ipv4
                        .error
                        .as_deref()
                        .map(|value| compact_log_value(value, 100))
                        .unwrap_or_else(|| "-".to_string()),
                    probe
                        .ipv6
                        .error
                        .as_deref()
                        .map(|value| compact_log_value(value, 100))
                        .unwrap_or_else(|| "-".to_string()),
                ));

                    // Query the serving technology only after the bounded
                    // threshold. This keeps the normal 30-second probe free of
                    // additional AT commands while still targeting the N1/NR
                    // blackhole seen with a live PDP context.
                    if consecutive_partial_failures >= 3 {
                        let tech = get_serving_cell_info(&conn)
                            .await
                            .map(|cell| cell.tech)
                            .unwrap_or_else(|_| "unknown".to_string());
                        const PARTIAL_STACK_PATH_CLASS: &str = "partial-stack";

                        if should_reactivate_partial_data_context(
                            consecutive_partial_failures,
                            &tech,
                            PARTIAL_STACK_PATH_CLASS,
                            ipv4_ok,
                        ) {
                            if last_recovery.elapsed() >= recovery_cooldown {
                                if awaiting_recovery_confirmation {
                                    recovery_cooldown = increase_recovery_cooldown(
                                        recovery_cooldown,
                                        MAX_RECOVERY_COOLDOWN,
                                    );
                                }
                                recovery_attempts = recovery_attempts.saturating_add(1);
                                let started_at = std::time::Instant::now();
                                diagnostics::record(format!(
                                "DATA_CONTEXT_RECOVERY_START attempt={} path_class={} tech={} cooldown_secs={}",
                                recovery_attempts,
                                PARTIAL_STACK_PATH_CLASS,
                                compact_log_value(&tech, 32),
                                recovery_cooldown.as_secs()
                            ));

                                let (recovery_ok, recovery) = reactivate_data_context(&conn).await;
                                let recovery_duration_ms = started_at.elapsed().as_millis();
                                last_recovery = std::time::Instant::now();
                                awaiting_recovery_confirmation = recovery_ok;
                                if !recovery_ok {
                                    recovery_cooldown = increase_recovery_cooldown(
                                        recovery_cooldown,
                                        MAX_RECOVERY_COOLDOWN,
                                    );
                                }
                                diagnostics::record(format!(
                                "DATA_CONTEXT_RECOVERY_DONE success={} duration_ms={} next_cooldown_secs={} result={}",
                                recovery_ok,
                                recovery_duration_ms,
                                recovery_cooldown.as_secs(),
                                compact_log_value(&recovery, 180)
                            ));
                                warn!(result = %recovery, path_class = PARTIAL_STACK_PATH_CLASS, tech = %tech, "Watchdog: reactivated data context after connectivity failure");
                                consecutive_partial_failures = 0;
                            }
                        } else {
                            // LTE and unknown technologies intentionally do not
                            // inherit an NR partial-stack recovery window.
                            consecutive_partial_failures = 0;
                        }
                    }
                }
            }
        }
    }
}

/// 路由类失败：内核明确没有到目标的路由（含「地址在、默认路由丢」）。
fn is_route_failure(path_class: &str) -> bool {
    matches!(
        path_class,
        "route-unreachable" | "route-absent-addr-present"
    )
}

fn format_probe_ms(value: Option<f64>) -> String {
    value
        .map(|latency| format!("{latency:.1}"))
        .unwrap_or_else(|| "-".to_string())
}

/// 主路由表里是否存在 IPv4 默认路由。
fn has_default_ipv4_route(routes: &str) -> bool {
    !routes.starts_with("error:")
        && routes
            .lines()
            .any(|line| line.trim_start().starts_with("default "))
}

/// `ip addr show dev sipa_eth0` 输出里是否仍有 IPv4 地址（/32 点对点链路）。
fn has_ipv4_addr(addr_output: &str) -> bool {
    addr_output
        .lines()
        .any(|line| line.trim_start().starts_with("inet "))
}

/// 失败路径分类。
///
/// 优先级：最具体的「地址在、默认路由丢」优先；其余保持既有语义，避免改变
/// `route-unreachable` / `interface-down` 的既有消费行为。
fn classify_path(
    v4_route_unreachable: bool,
    v6_route_unreachable: bool,
    v4_default_route_present: bool,
    sipa_v4_addr_present: bool,
    interface_down: bool,
    snapshot_error: bool,
) -> &'static str {
    if v4_route_unreachable && !v4_default_route_present && sipa_v4_addr_present {
        "route-absent-addr-present"
    } else if v4_route_unreachable || v6_route_unreachable {
        "route-unreachable"
    } else if interface_down {
        "interface-down"
    } else if snapshot_error {
        "route-snapshot-unavailable"
    } else {
        "route-present-pdp-path-suspect"
    }
}

/// 是否需要下电重拨。
///
/// 路由类失败不再「首轮即真」：必须先经 `ROUTE_CONFIRM_DELAY` 复测确认仍不可达
/// （`route_failure_confirmed`），否则只算瞬时窗口。非路由类保持「连续 2 次」。
fn should_reactivate_data_context(
    consecutive_dual_failures: u8,
    path_class: &str,
    route_failure_confirmed: bool,
) -> bool {
    (is_route_failure(path_class) && route_failure_confirmed) || consecutive_dual_failures >= 2
}

/// 是否需要重建 USB gadget 以恢复 usb0 管理链路。
///
/// 与 `should_recover_usb_path`（承载故障后的 USB 停滞兜底）相互独立：这里覆盖的是
/// 「主机睡眠/唤醒后 gadget 未重新枚举」——链路本来就 down 且无载波，重建正是把它
/// 拉回来的手段，不会让可用链路变差。
fn should_recover_usb_link(
    operstate_down: bool,
    carrier_absent: bool,
    down_probes: u8,
    threshold: u8,
    cooldown_elapsed: bool,
    attempts_left: u8,
    recovery_in_flight: bool,
) -> bool {
    operstate_down
        && carrier_absent
        && down_probes >= threshold
        && cooldown_elapsed
        && attempts_left > 0
        && !recovery_in_flight
}

/// 部分栈失败是否值得下电重拨。
///
/// IPv6 在多数运营商 / APN 下本就不通，IPv4 正常时下电重拨只会把好端端的数据
/// 连接打断（表现为周期性断网、ping 飙升）。因此除 NR + partial-stack + 达到
/// 阈值外，还要求 IPv4 探测同样失败，确认用户面确实不通时才恢复。
fn should_reactivate_partial_data_context(
    partial_failures: u8,
    tech: &str,
    path_class: &str,
    ipv4_ok: bool,
) -> bool {
    path_class == "partial-stack"
        && tech.eq_ignore_ascii_case("nr")
        && !ipv4_ok
        && partial_failures >= 3
}

fn usb_path_counters_changed(
    previous: &InterfacePathSnapshot,
    current: &InterfacePathSnapshot,
) -> Option<bool> {
    let previous_rx = previous.rx_bytes.parse::<u64>().ok()?;
    let previous_tx = previous.tx_bytes.parse::<u64>().ok()?;
    let current_rx = current.rx_bytes.parse::<u64>().ok()?;
    let current_tx = current.tx_bytes.parse::<u64>().ok()?;
    Some(previous_rx != current_rx || previous_tx != current_tx)
}

fn usb_path_is_stalled(path: &InterfacePathSnapshot, counters_changed: Option<bool>) -> bool {
    path.operstate == "up" && path.carrier == "1" && counters_changed == Some(false)
}

fn should_recover_usb_path(
    recovery_eligible: bool,
    activity_before_bearer_fault: bool,
    stalled_probes: u8,
    threshold: u8,
    cooldown_elapsed: bool,
    recovery_in_flight: bool,
) -> bool {
    recovery_eligible
        && activity_before_bearer_fault
        && stalled_probes >= threshold
        && cooldown_elapsed
        && !recovery_in_flight
}

#[cfg(unix)]
async fn rebuild_usb_gadget() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        let mode = crate::usb_switch::get_current_usb_mode()?.mode;
        crate::usb_switch::switch_usb_mode_advanced(mode)
    })
    .await
    .map_err(|error| format!("USB recovery worker join failed: {error}"))?
}

#[cfg(not(unix))]
async fn rebuild_usb_gadget() -> Result<(), String> {
    Err("USB gadget recovery is only available on Unix targets".to_string())
}

/// Recreate the internet context once.  The cooldown in the watchdog prevents
/// a repeated modem reset loop when the carrier or radio is genuinely offline.
async fn reactivate_data_context(conn: &Connection) -> (bool, String) {
    let disable_result = set_data_connection(conn, false).await;
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    let enable_result = set_data_connection(conn, true).await;

    match (disable_result, enable_result) {
        (Ok(()), Ok(())) => (true, "deactivated and activated".to_string()),
        (disable, enable) => (
            false,
            format!(
                "disable={}; enable={}",
                disable
                    .err()
                    .map(|error| error.to_string())
                    .unwrap_or_else(|| "ok".to_string()),
                enable
                    .err()
                    .map(|error| error.to_string())
                    .unwrap_or_else(|| "ok".to_string())
            ),
        ),
    }
}

fn increase_recovery_cooldown(
    current: std::time::Duration,
    maximum: std::time::Duration,
) -> std::time::Duration {
    let doubled = current.as_secs().saturating_mul(2).min(maximum.as_secs());
    std::time::Duration::from_secs(doubled.max(1))
}

#[derive(Debug, Default)]
struct ConnectivityFailureSnapshot {
    path_class: String,
    details: String,
}

/// Capture the small amount of modem context needed to correlate a failure
/// with a band/PDP transition.  Full system logs stay in the device's syslog;
/// this bounded record makes the event visible through `/api/diagnostics/log`.
async fn capture_connectivity_failure(
    conn: &Connection,
    probe: &ConnectivityCheckResponse,
) -> ConnectivityFailureSnapshot {
    let tech = get_serving_cell_info(conn)
        .await
        .map(|cell| cell.tech)
        .unwrap_or_else(|_| "unknown".to_string());
    // The serving-cell helper intentionally exposes a compact summary.  Keep
    // the modem's engineering response as well so a failure can be correlated
    // with an N1/N78 transition when the public summary only says "5G".
    let radio = send_at_command(conn, "AT+SPENGMD=0,14,1")
        .await
        .map(|value| compact_log_value(&value, 220))
        .unwrap_or_else(|error| format!("error:{error}"));
    let pdp = send_at_command(conn, "AT+CGPADDR")
        .await
        .map(|value| compact_log_value(&value, 220))
        .unwrap_or_else(|error| format!("error:{error}"));

    let path = collect_network_path_snapshot().await;
    diagnostics::record(format!(
        "DATA_CONNECTIVITY_FAIL tech={} radio={} ipv4={} ipv6={} pdp={} path_class={} path={}",
        compact_log_value(&tech, 32),
        radio,
        probe.ipv4.success,
        probe.ipv6.success,
        pdp,
        path.path_class,
        path.details
    ));
    path
}

/// Capture route selection and link state without invoking a shell.  The
/// watchdog uses this only after a confirmed dual-stack failure, so the extra
/// commands do not add steady-state modem traffic.  The output is deliberately
/// compact because the persistent diagnostics log is bounded to 512 KiB.
async fn collect_network_path_snapshot() -> ConnectivityFailureSnapshot {
    let (
        ipv4_routes,
        ipv6_routes,
        ipv4_route_get,
        ipv6_route_get,
        sipa_addresses,
        usb_addresses,
        sipa_state,
        usb_state,
    ) = tokio::join!(
        run_ip_command(&["-4", "route", "show", "table", "main"]),
        run_ip_command(&["-6", "route", "show", "table", "main"]),
        run_ip_command(&["-4", "route", "get", "223.5.5.5"]),
        run_ip_command(&["-6", "route", "get", "2400:3200::1"]),
        run_ip_command(&["addr", "show", "dev", "sipa_eth0"]),
        run_ip_command(&["addr", "show", "dev", "usb0"]),
        interface_state_snapshot("sipa_eth0"),
        interface_state_snapshot("usb0"),
    );

    let v4_route_unreachable =
        ipv4_route_get.contains("unreachable") || ipv4_route_get.contains("Network is unreachable");
    let v6_route_unreachable =
        ipv6_route_get.contains("unreachable") || ipv6_route_get.contains("Network is unreachable");
    let v4_default_route_present = has_default_ipv4_route(&ipv4_routes);
    let sipa_v4_addr_present = has_ipv4_addr(&sipa_addresses);
    // `sipa_eth0` is the modem-facing data path.  `usb0` is the host-facing
    // management link and may legitimately be down while cellular data is up,
    // so it must not decide the recovery class by itself.
    let interface_down = sipa_state.contains("operstate=down") || sipa_state.contains("carrier=0");
    let snapshot_error = ipv4_routes.starts_with("error:") || ipv6_routes.starts_with("error:");
    let path_class = classify_path(
        v4_route_unreachable,
        v6_route_unreachable,
        v4_default_route_present,
        sipa_v4_addr_present,
        interface_down,
        snapshot_error,
    );

    let details = format!(
        "v4_default_route={} sipa_v4_addr={} | v4_routes={} | v6_routes={} | v4_get={} | v6_get={} | sipa_addr={} | usb_addr={} | sipa_state={} | usb_state={}",
        v4_default_route_present,
        sipa_v4_addr_present,
        compact_log_value(&ipv4_routes, 180),
        compact_log_value(&ipv6_routes, 180),
        compact_log_value(&ipv4_route_get, 180),
        compact_log_value(&ipv6_route_get, 180),
        compact_log_value(&sipa_addresses, 180),
        compact_log_value(&usb_addresses, 180),
        sipa_state,
        usb_state,
    );

    ConnectivityFailureSnapshot {
        path_class: path_class.to_string(),
        details,
    }
}

async fn run_ip_command(args: &[&str]) -> String {
    let command = tokio::process::Command::new("ip").args(args).output();
    match tokio::time::timeout(std::time::Duration::from_secs(2), command).await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if output.status.success() {
                if stdout.is_empty() {
                    "(empty)".to_string()
                } else {
                    stdout
                }
            } else if stderr.is_empty() {
                format!("error:exit={}", output.status)
            } else {
                format!("error:{}", stderr)
            }
        }
        Ok(Err(error)) => format!("error:{error}"),
        Err(_) => "error:timeout".to_string(),
    }
}

/// 当接口已持有 IPv6 全球地址却探测不可达时，采集一次 IPv6 路由/邻居诊断信息。
///
/// 仅记录诊断，**绝不修改路由表**：历史实现曾删除并重建默认路由（假设网关为
/// `fe80::1`），一旦假设错误会让 IPv6 乃至整机网络异常，且会与 RA 下发的路由叠加
/// 产生重复默认路由、放大延迟抖动。节流 5 分钟，不改变重拨语义。
async fn ensure_ipv6_default_route(last_attempt: &mut Option<std::time::Instant>) {
    const THROTTLE: std::time::Duration = std::time::Duration::from_secs(300);
    if let Some(t) = last_attempt {
        if t.elapsed() < THROTTLE {
            return;
        }
    }
    *last_attempt = Some(std::time::Instant::now());

    let default = run_ip_command(&["-6", "route", "show", "default"]).await;
    diagnostics::record(format!(
        "IPV6_ROUTE_CHECK default={}",
        compact_log_value(&default, 200),
    ));
    if default.contains("via ") {
        return; // 已有带网关的默认路由，无需处理
    }
    // 诊断：内核如何解析到公网 IPv6 目标的路由 / 邻居，定位模组网关
    let get = run_ip_command(&["-6", "route", "get", "2400:3200::1"]).await;
    diagnostics::record(format!("IPV6_ROUTE_GET {}", compact_log_value(&get, 200),));
    let neigh = run_ip_command(&["-6", "neigh", "show", "dev", "sipa_eth0"]).await;
    diagnostics::record(format!("IPV6_NEIGH {}", compact_log_value(&neigh, 200),));
    if default.contains("dev ") {
        // 只记录诊断，绝不修改路由：删除/重建默认路由风险过高（网关假设可能
        // 错误），一旦误删会让 IPv6 乃至整个网络异常。保持既有路由不动。
        diagnostics::record(format!(
            "IPV6_DEFAULT_ROUTE_NO_GATEWAY default={}",
            compact_log_value(&default, 200),
        ));
    }
}

async fn interface_state_snapshot(interface: &str) -> String {
    let (operstate, carrier, rx_bytes, tx_bytes) = tokio::join!(
        read_interface_value(interface, "operstate"),
        read_interface_value(interface, "carrier"),
        read_interface_value(interface, "statistics/rx_bytes"),
        read_interface_value(interface, "statistics/tx_bytes"),
    );
    format!(
        "operstate={} carrier={} rx_bytes={} tx_bytes={}",
        operstate, carrier, rx_bytes, tx_bytes
    )
}

async fn read_interface_value(interface: &str, relative_path: &str) -> String {
    let path = format!("/sys/class/net/{interface}/{relative_path}");
    match tokio::fs::read_to_string(path).await {
        Ok(value) => value.trim().to_string(),
        Err(error) => format!("error:{error}"),
    }
}

#[cfg(test)]
mod watchdog_tests {
    use super::{
        classify_path, has_default_ipv4_route, has_ipv4_addr, increase_recovery_cooldown,
        is_route_failure, should_reactivate_data_context, should_reactivate_partial_data_context,
        should_recover_usb_link, should_recover_usb_path, usb_path_counters_changed,
        usb_path_is_stalled,
    };
    use crate::connectivity::InterfacePathSnapshot;
    use std::time::Duration;

    #[test]
    fn recovery_cooldown_doubles_and_stops_at_the_cap() {
        let cap = Duration::from_secs(1800);
        assert_eq!(
            increase_recovery_cooldown(Duration::from_secs(300), cap),
            Duration::from_secs(600)
        );
        assert_eq!(
            increase_recovery_cooldown(Duration::from_secs(1200), cap),
            cap
        );
        assert_eq!(increase_recovery_cooldown(cap, cap), cap);
    }

    #[test]
    fn route_failure_needs_recheck_before_reactivation() {
        // 未复测确认前不重拨，避免被模组重附着的瞬时窗口误触发。
        assert!(!should_reactivate_data_context(
            1,
            "route-unreachable",
            false
        ));
        assert!(!should_reactivate_data_context(
            1,
            "route-absent-addr-present",
            false
        ));
        // 复测确认仍不可达才重拨。
        assert!(should_reactivate_data_context(1, "route-unreachable", true));
        assert!(should_reactivate_data_context(
            1,
            "route-absent-addr-present",
            true
        ));
        // 非路由类保持「连续 2 次」语义。
        assert!(!should_reactivate_data_context(1, "interface-down", false));
        assert!(should_reactivate_data_context(2, "interface-down", false));
    }

    #[test]
    fn classifies_address_present_but_default_route_missing() {
        let routes_without_default = "192.168.66.0/24 dev usb0 scope link src 192.168.66.1";
        let addr_with_inet =
            "2: sipa_eth0: <UP,LOWER_UP> mtu 1500\n    inet 10.98.172.60/32 scope global sipa_eth0";
        assert!(!has_default_ipv4_route(routes_without_default));
        assert!(has_default_ipv4_route(
            "default via 10.98.172.60 dev sipa_eth0"
        ));
        assert!(!has_default_ipv4_route("error:ip: command not found"));
        assert!(has_ipv4_addr(addr_with_inet));
        assert!(!has_ipv4_addr("2: sipa_eth0: <UP,LOWER_UP> mtu 1500"));

        assert_eq!(
            classify_path(true, false, false, true, false, false),
            "route-absent-addr-present"
        );
        // 默认路由仍在时不落入新分类，保持既有语义。
        assert_eq!(
            classify_path(true, false, true, true, false, false),
            "route-unreachable"
        );
        assert_eq!(
            classify_path(false, true, true, true, false, false),
            "route-unreachable"
        );
        assert_eq!(
            classify_path(false, false, true, true, true, false),
            "interface-down"
        );
        assert_eq!(
            classify_path(false, false, true, true, false, true),
            "route-snapshot-unavailable"
        );
        assert_eq!(
            classify_path(false, false, true, true, false, false),
            "route-present-pdp-path-suspect"
        );

        assert!(is_route_failure("route-absent-addr-present"));
        assert!(is_route_failure("route-unreachable"));
        assert!(!is_route_failure("interface-down"));
    }

    #[test]
    fn usb_link_recovery_requires_down_link_threshold_cooldown_and_budget() {
        assert!(should_recover_usb_link(true, true, 6, 6, true, 2, false));
        // 载波仍在（主机在线）时不动 USB。
        assert!(!should_recover_usb_link(true, false, 6, 6, true, 2, false));
        // 未达阈值 / 冷却未到 / 次数用尽 / 已有重建在进行：都不动。
        assert!(!should_recover_usb_link(true, true, 5, 6, true, 2, false));
        assert!(!should_recover_usb_link(true, true, 6, 6, false, 2, false));
        assert!(!should_recover_usb_link(true, true, 6, 6, true, 0, false));
        assert!(!should_recover_usb_link(true, true, 6, 6, true, 2, true));
        // 链路本来就是 up 时不重建。
        assert!(!should_recover_usb_link(false, false, 9, 6, true, 2, false));
    }

    #[test]
    fn nr_partial_stack_recovery_requires_three_probes() {
        assert!(!should_reactivate_partial_data_context(
            1,
            "nr",
            "partial-stack",
            false
        ));
        assert!(!should_reactivate_partial_data_context(
            2,
            "nr",
            "partial-stack",
            false
        ));
        assert!(should_reactivate_partial_data_context(
            3,
            "nr",
            "partial-stack",
            false
        ));
        assert!(!should_reactivate_partial_data_context(
            3,
            "lte",
            "partial-stack",
            false
        ));
        assert!(!should_reactivate_partial_data_context(
            3,
            "nr",
            "interface-down",
            false
        ));
    }

    #[test]
    fn partial_stack_with_working_ipv4_keeps_the_context() {
        // 仅 IPv6 不通是运营商常态，此时不得下电重拨，否则会周期性断网。
        assert!(!should_reactivate_partial_data_context(
            3,
            "nr",
            "partial-stack",
            true
        ));
        assert!(!should_reactivate_partial_data_context(
            9,
            "nr",
            "partial-stack",
            true
        ));
    }

    #[test]
    fn usb_stall_requires_up_link_and_unchanged_valid_counters() {
        let previous = InterfacePathSnapshot {
            operstate: "up".to_string(),
            carrier: "1".to_string(),
            rx_bytes: "100".to_string(),
            tx_bytes: "200".to_string(),
        };
        let unchanged = previous.clone();
        let changed = InterfacePathSnapshot {
            rx_bytes: "101".to_string(),
            ..previous.clone()
        };
        let invalid = InterfacePathSnapshot {
            rx_bytes: "-".to_string(),
            ..previous.clone()
        };

        assert_eq!(
            usb_path_counters_changed(&previous, &unchanged),
            Some(false)
        );
        assert!(usb_path_is_stalled(&unchanged, Some(false)));
        assert_eq!(usb_path_counters_changed(&previous, &changed), Some(true));
        assert!(!usb_path_is_stalled(&changed, Some(true)));
        assert_eq!(usb_path_counters_changed(&previous, &invalid), None);
        assert!(!usb_path_is_stalled(&invalid, None));
    }

    #[test]
    fn usb_recovery_needs_fault_history_activity_threshold_and_cooldown() {
        assert!(!should_recover_usb_path(true, true, 2, 3, true, false));
        assert!(!should_recover_usb_path(true, false, 3, 3, true, false));
        assert!(!should_recover_usb_path(true, true, 3, 3, false, false));
        assert!(!should_recover_usb_path(true, true, 3, 3, true, true));
        assert!(should_recover_usb_path(true, true, 3, 3, true, false));
    }
}
