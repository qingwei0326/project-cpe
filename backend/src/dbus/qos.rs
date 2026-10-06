//! 自 dbus.rs 拆出（纯移动，逻辑未改）。

use super::*;

lazy_static::lazy_static! {
    /// 承载 QoS 缓存状态。
    ///
    /// `AT+CGEQOSRDP` 与其他 AT 操作共用同一个串口，因此**取到数据承载后**
    /// 即长期缓存，后续调用不再占用串口。
    ///
    /// 但模组在数据承载尚未建立时可能只上报 IMS 信令承载（QCI 5）。若此时就把结果
    /// 固化，IMS 的 30/30 Mbps 会被当成用户数据承载速率显示到进程重启。因此只有选中
    /// **数据承载**（QCI 6..=9）时才写 `confirmed`；否则仅暂存最近一次结果并节流
    /// 重试，待数据承载建立后自动纠正。
    static ref QOS_CACHE: tokio::sync::Mutex<QosCacheState> =
        tokio::sync::Mutex::new(QosCacheState::default());
}

/// 尚未取到数据承载时，两次 AT 读取之间的最小间隔（秒）。
/// 前端 `/api/qos` 每 15s 轮询一次，节流可避免每次请求都占用 AT 串口。
const QOS_RETRY_THROTTLE_SECS: u64 = 5;

#[derive(Default)]
struct QosCacheState {
    /// 已确认取自数据承载（QCI 6..=9）的最终值。
    confirmed: Option<QosInfoResponse>,
    /// 最近一次读取结果（可能只是 IMS 承载），仅在节流窗口内返回。
    last: Option<QosInfoResponse>,
    /// 最近一次真正发起 AT 读取的时间。
    last_attempt: Option<std::time::Instant>,
}

impl QosCacheState {
    fn store_reading(&mut self, parsed: QosInfoResponse) {
        if parsed.confirmed {
            if self.confirmed.is_none() {
                diagnostics::record(format!(
                    "QOS_BEARER_CONFIRMED qci={} dl_kbps={} ul_kbps={}",
                    parsed.qci, parsed.dl_speed, parsed.ul_speed
                ));
            }
            self.confirmed = Some(parsed.clone());
        } else {
            let changed = self
                .last
                .as_ref()
                .map(|last| (last.qci, last.dl_speed, last.ul_speed))
                != Some((parsed.qci, parsed.dl_speed, parsed.ul_speed));
            if changed {
                diagnostics::record(format!(
                    "QOS_BEARER_DEFERRED qci={} dl_kbps={} ul_kbps={}",
                    parsed.qci, parsed.dl_speed, parsed.ul_speed
                ));
            }
        }
        self.last = Some(parsed);
    }
}

/// 是否为用户数据（上网）承载：非 GBR 的互联网承载，标准 QCI 6..=9。
fn is_data_bearer(qci: u8) -> bool {
    (6..=9).contains(&qci)
}

/// 获取QoS信息
///
/// 取到数据承载后不再重复发送 `AT+CGEQOSRDP`。
/// 若模组当前只上报 IMS 承载（QCI 5），本次结果不作为最终值，按
/// `QOS_RETRY_THROTTLE_SECS` 节流后重试，直到取到数据承载。
///
/// # Arguments
/// * `conn` - D-Bus 连接
///
/// # Returns
/// QoS信息结构
pub async fn get_qos_info_data(conn: &Connection) -> zbus::Result<QosInfoResponse> {
    let mut state = QOS_CACHE.lock().await;

    if let Some(confirmed) = state.confirmed.as_ref() {
        return Ok(confirmed.clone());
    }

    // 未取到数据承载：节流窗口内直接返回上一次结果，不再发 AT 命令。
    if let Some(last_attempt) = state.last_attempt {
        if last_attempt.elapsed() < std::time::Duration::from_secs(QOS_RETRY_THROTTLE_SECS) {
            if let Some(last) = state.last.as_ref() {
                return Ok(last.clone());
            }
        }
    }
    state.last_attempt = Some(std::time::Instant::now());

    let response = send_at_command(conn, "AT+CGEQOSRDP").await?;

    // 解析 +CGEQOSRDP: <cid>,<QCI>,[<DL_GBR>,<UL_GBR>],[<DL_MBR>,<UL_MBR>],[<DL_AMBR>,<UL_AMBR>]
    let parsed = parse_qos_response(&response);

    state.store_reading(parsed.clone());

    Ok(parsed)
}

/// 解析QoS响应
///
/// 真实模组在 `AT+CGEQOSRDP`（不带 CID）时会为每个活跃承载各回一行
/// `+CGEQOSRDP: <cid>,<QCI>,...`。旧实现只取**第一行**，而第一行往往是默认 /
/// 控制 / IMS 承载，并非用户数据承载，因此承载参数会被误读为 QCI 100 之类的值。
/// 现在解析全部承载，并选出真正承载用户数据的那个。
///
/// 格式: +CGEQOSRDP: <cid>,<QCI>,[<DL_GBR>,<UL_GBR>],[<DL_MBR>,<UL_MBR>],[<DL_AMBR>,<UL_AMBR>]
#[derive(Debug, Clone, Copy)]
struct QosBearer {
    cid: u32,
    qci: u8,
    dl_speed: u32,
    ul_speed: u32,
}

fn parse_qos_response(response: &str) -> QosInfoResponse {
    let mut bearers: Vec<QosBearer> = Vec::new();

    for line in response.lines() {
        let line = line.trim();
        if !line.starts_with("+CGEQOSRDP:") {
            continue;
        }
        let Some(data) = line.strip_prefix("+CGEQOSRDP:") else {
            continue;
        };
        let parts: Vec<&str> = data.trim().split(',').collect();
        // 至少需要 <cid> 与 <QCI> 两列，避免回显 / 异常行造成误判。
        if parts.len() < 2 {
            continue;
        }

        let cid = parts
            .first()
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0);
        let qci = parts
            .get(1)
            .and_then(|s| s.trim().parse::<u8>().ok())
            .unwrap_or(0);
        let dl_gbr = parts
            .get(2)
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0);
        let ul_gbr = parts
            .get(3)
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0);
        let dl_mbr = parts
            .get(4)
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0);
        let ul_mbr = parts
            .get(5)
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0);
        let dl_ambr = parts
            .get(6)
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0);
        let ul_ambr = parts
            .get(7)
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0);

        // 优先使用 GBR，如果为0则使用 MBR，如果还是0则使用 AMBR。
        let dl_speed = if dl_gbr > 0 {
            dl_gbr
        } else if dl_mbr > 0 {
            dl_mbr
        } else {
            dl_ambr
        };
        let ul_speed = if ul_gbr > 0 {
            ul_gbr
        } else if ul_mbr > 0 {
            ul_mbr
        } else {
            ul_ambr
        };

        bearers.push(QosBearer {
            cid,
            qci,
            dl_speed,
            ul_speed,
        });
    }

    if bearers.is_empty() {
        return QosInfoResponse {
            qci: 0,
            confirmed: false,
            dl_speed: 0,
            ul_speed: 0,
            raw_response: Some(response.to_string()),
        };
    }

    let chosen = select_data_bearer(&bearers);

    // 选中的 QCI 落在标准 QCI/5QI 区间(1..=86)之外时保留原始响应，便于上机排障。
    let raw_response = if (1..=86).contains(&chosen.qci) {
        None
    } else {
        Some(response.trim().to_string())
    };

    QosInfoResponse {
        qci: chosen.qci,
        confirmed: is_data_bearer(chosen.qci),
        dl_speed: chosen.dl_speed,
        ul_speed: chosen.ul_speed,
        raw_response,
    }
}

/// 从全部承载中选出用户数据（上网）承载。
///
/// 优先级：①非 GBR 互联网承载 QCI∈{6,7,8,9} > ②其它标准 QCI(1..=86，排除 5) >
/// ③IMS 信令承载(QCI 5) > ④无效 / 未指定(QCI 0 或 >86)。
/// 同档内取上报速率更大者，再取 CID 更大者（专用承载通常晚于默认承载建立）。
fn select_data_bearer(bearers: &[QosBearer]) -> QosBearer {
    fn class(qci: u8) -> u8 {
        if (6..=9).contains(&qci) {
            3
        } else if qci == 5 {
            1
        } else if (1..=86).contains(&qci) {
            2
        } else {
            0
        }
    }

    bearers
        .iter()
        .copied()
        .max_by(|a, b| {
            class(a.qci)
                .cmp(&class(b.qci))
                .then((a.dl_speed + a.ul_speed).cmp(&(b.dl_speed + b.ul_speed)))
                .then(a.cid.cmp(&b.cid))
        })
        .unwrap_or(bearers[0])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_internet_bearer_over_first_control_bearer() {
        // 真实模组常把默认 / 控制承载放在第一行（此处误报 QCI 100），
        // 真正上网承载在第二行（QCI 6）。
        let resp = "OK\n+CGEQOSRDP: 1,100,0,0,0,0,0,0\n+CGEQOSRDP: 2,6,0,0,0,0,30000,30000";
        let parsed = parse_qos_response(resp);
        assert_eq!(
            parsed.qci, 6,
            "应选中用户数据承载 QCI 6，而非首行控制承载 100"
        );
        assert_eq!(parsed.dl_speed, 30000);
        assert!(parsed.confirmed);
        assert!(parsed.raw_response.is_none());
    }

    #[test]
    fn single_bearer_returns_as_is() {
        let resp = "+CGEQOSRDP: 11,9,0,0,0,0,100000,50000";
        let parsed = parse_qos_response(resp);
        assert_eq!(parsed.qci, 9);
        assert_eq!(parsed.dl_speed, 100000);
        assert!(parsed.confirmed);
    }

    #[test]
    fn prefers_internet_qci_over_ims_qci() {
        // IMS 信令(QCI 5) 与 互联网默认承载(QCI 9) 同时存在，应选 9。
        let resp = "+CGEQOSRDP: 1,5,0,0,0,0,1000,1000\n+CGEQOSRDP: 2,9,0,0,0,0,30000,30000";
        let parsed = parse_qos_response(resp);
        assert_eq!(parsed.qci, 9);
        assert!(parsed.confirmed);
    }

    #[test]
    fn invalid_qci_keeps_raw_response() {
        // 全部承载 QCI 均非法时回退到首行，并保留原始响应用于排障。
        let resp = "+CGEQOSRDP: 1,200,0,0,0,0,0,0";
        let parsed = parse_qos_response(resp);
        assert_eq!(parsed.qci, 200);
        assert!(parsed.raw_response.is_some());
        assert!(!parsed.confirmed);
    }

    #[test]
    fn qos_ims_is_provisional_until_data_bearer_arrives() {
        let mut state = QosCacheState::default();
        let provisional = parse_qos_response("+CGEQOSRDP: 1,5,0,0,0,0,30000,30000");
        assert_eq!(provisional.qci, 5);
        assert_eq!(provisional.dl_speed, 30000);
        assert!(!provisional.confirmed);
        state.store_reading(provisional);
        assert!(state.confirmed.is_none());
        assert_eq!(state.last.as_ref().map(|qos| qos.qci), Some(5));

        let confirmed = parse_qos_response(
            "+CGEQOSRDP: 1,5,0,0,0,0,30000,30000\n+CGEQOSRDP: 2,6,0,0,0,0,50000,25000",
        );
        assert_eq!(confirmed.qci, 6);
        assert_eq!(confirmed.dl_speed, 50000);
        assert!(confirmed.confirmed);
        state.store_reading(confirmed);
        assert_eq!(state.confirmed.as_ref().map(|qos| qos.qci), Some(6));
        assert_eq!(state.last.as_ref().map(|qos| qos.qci), Some(6));
    }

    #[test]
    fn qos_ims_is_lower_priority_than_other_standard_bearers() {
        let parsed = parse_qos_response(
            "+CGEQOSRDP: 1,5,0,0,0,0,30000,30000\n+CGEQOSRDP: 2,1,0,0,0,0,1000,1000",
        );
        assert_eq!(parsed.qci, 1);
        assert!(!parsed.confirmed);
    }
}
