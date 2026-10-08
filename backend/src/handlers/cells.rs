//! 自 handlers.rs 拆出（纯移动，逻辑未改）。

use super::*;

/// 获取主小区信息
///
/// # Arguments
/// * `conn` - D-Bus 连接
/// * `cmd` - AT 指令
/// * `tech` - 网络制式
///
/// # Returns
/// 解析后的主小区信息
async fn fetch_primary_cell(conn: &Connection, cmd: &str, tech: &str) -> Result<CellInfo, String> {
    let response = send_at_command(conn, cmd)
        .await
        .map_err(|e| format!("Primary cell AT command failed: {}", e))?;

    let parsed = parse_at_response_to_2d_vec(&response);
    let cell = parse_primary_cell(tech, &parsed);

    Ok(cell)
}

/// 获取邻区信息列表
///
/// # Arguments
/// * `conn` - D-Bus 连接
/// * `cmd` - AT 指令
/// * `tech` - 网络制式
///
/// # Returns
/// 解析后的邻区信息列表
async fn fetch_neighbor_cells(
    conn: &Connection,
    cmd: &str,
    tech: &str,
) -> Result<Vec<CellInfo>, String> {
    let response = send_at_command(conn, cmd)
        .await
        .map_err(|e| format!("Neighbor cell AT command failed: {}", e))?;

    let parsed = parse_at_response_to_2d_vec(&response);
    let cells = parse_neighbor_cells(tech, &parsed);

    Ok(cells)
}

/// GET /api/cells - Get cell information
///
/// # Response example
/// ```json
/// {
///   "status": "ok",
///   "message": "Success",
///   "data": {
///     "serving_cell": {
///       "tech": "nr",
///       "cell_id": 12345,
///       "tac": 100
///     },
///     "cells": [...]
///   }
/// }
/// ```
#[derive(Debug, Default, serde::Deserialize)]
pub(crate) struct CellRefreshQuery {
    /// 手动刷新时跳过服务端缓存
    refresh: Option<String>,
}

impl CellRefreshQuery {
    fn force_refresh(&self) -> bool {
        self.refresh
            .as_deref()
            .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false)
    }
}

const CELL_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(30);

const CELL_FORCE_DEDUP_WINDOW: std::time::Duration = std::time::Duration::from_secs(1);

lazy_static::lazy_static! {
    /// 同时合并重复的小区请求，避免并发页面重复发送 AT 指令。
    static ref CELL_CACHE: tokio::sync::Mutex<Option<(std::time::Instant, CellsResponse)>> =
        tokio::sync::Mutex::new(None);
}

async fn fetch_cells_snapshot(conn: &Connection) -> Result<CellsResponse, String> {
    let serving_cell = get_serving_cell_info(conn)
        .await
        .map_err(|e| format!("Failed to get serving cell info: {}", e))?;
    let tech = serving_cell.tech.as_str();
    let Some(cmd_config) = get_cell_command_config(tech) else {
        return Ok(CellsResponse {
            serving_cell,
            cells: Vec::new(),
            ca: None,
        });
    };

    // ofono 不支持并发 AT 指令，主小区和邻区必须顺序读取。
    let primary_cell = fetch_primary_cell(conn, cmd_config.primary, tech).await?;
    let neighbor_cells = fetch_neighbor_cells(conn, cmd_config.neighbor, tech).await?;

    // 模组邻区查询 (AT+SPENGMD) 常把服务小区 (PCell) 也列在返回数组首位，
    // 按 PCI 剔除与服务小区相同的项，避免服务小区在「邻区」区被重复展示。
    let serving_pci = primary_cell.pci.clone();
    let neighbor_cells = neighbor_cells
        .into_iter()
        .filter(|c| c.pci != serving_pci)
        .collect::<Vec<_>>();

    let mut cells = Vec::with_capacity(1 + neighbor_cells.len());
    cells.push(primary_cell);
    cells.extend(neighbor_cells);

    // 注意：UDX710 (Unisoc) 不支持 AT+QCAINFO（Quectel 专有命令）。该命令在本模组
    // 上不返回，导致 send_at_command 占着串口锁空等满 10s 超时才释放；前端轮询
    // /api/cells 与 watchdog 叠加后会耗尽串口与后端线程，表现为管理接口整体超时、
    // 设备无法上网。因此这里不再查询 CA，恒为 None（前端据此隐藏 CA 卡片）。
    let ca = None;

    Ok(CellsResponse {
        serving_cell,
        cells,
        ca,
    })
}

pub(crate) async fn get_cells_snapshot(
    conn: &Connection,
    force_refresh: bool,
) -> Result<CellsResponse, String> {
    /// 真正发 AT 的小区读取超过该耗时即记录诊断（正常在百毫秒级）。
    const CELLS_SLOW_THRESHOLD_MS: u128 = 2000;

    // 锁覆盖查询过程：第一个请求负责读取 AT，其他同时到达的请求复用结果。
    let mut cache = CELL_CACHE.lock().await;
    if let Some((updated_at, snapshot)) = cache.as_ref() {
        let age = updated_at.elapsed();
        if age < CELL_CACHE_TTL && (!force_refresh || age < CELL_FORCE_DEDUP_WINDOW) {
            return Ok(snapshot.clone());
        }
    }

    let started_at = std::time::Instant::now();
    let snapshot = fetch_cells_snapshot(conn).await?;
    let elapsed_ms = started_at.elapsed().as_millis();
    if elapsed_ms >= CELLS_SLOW_THRESHOLD_MS {
        crate::diagnostics::record(format!(
            "CELLS_FETCH_SLOW elapsed_ms={} force={}",
            elapsed_ms, force_refresh
        ));
    }
    *cache = Some((std::time::Instant::now(), snapshot.clone()));
    Ok(snapshot)
}

pub async fn get_cells(
    State(conn): State<Arc<Connection>>,
    Query(query): Query<CellRefreshQuery>,
) -> impl IntoResponse {
    let result = get_cells_snapshot(&conn, query.force_refresh()).await;

    match result {
        Ok(data) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", data)),
        ),
        Err(msg) => (
            StatusCode::OK,
            Json(ApiResponse::<CellsResponse>::error(msg)),
        ),
    }
}

/// GET /api/location/cell-info - 获取基站定位参数
///
/// 返回格式化的基站定位参数，可用于调用第三方定位API（如Google Geolocation、OpenCellID等）
pub async fn get_cell_location_info(
    State(conn): State<Arc<Connection>>,
    Query(query): Query<CellRefreshQuery>,
) -> impl IntoResponse {
    // 获取网络信息（MCC、MNC）
    let network_info = match get_network_info_data(&conn).await {
        Ok(info) => info,
        Err(e) => {
            return (
                StatusCode::OK,
                Json(ApiResponse::<CellLocationResponse>::error(format!(
                    "Failed to get network info: {}",
                    e
                ))),
            );
        }
    };

    // 检查是否有 MCC 和 MNC
    let mcc = match network_info.mcc {
        Some(ref m) if !m.is_empty() => m.clone(),
        _ => {
            return (
                StatusCode::OK,
                Json(ApiResponse::success_with_message(
                    "Cell location unavailable: MCC not available",
                    CellLocationResponse {
                        available: false,
                        cell_info: None,
                        neighbor_cells: vec![],
                        usage_hint: "Network not registered or MCC/MNC not available. Please ensure device is connected to cellular network.".to_string(),
                    },
                )),
            );
        }
    };

    let mnc = match network_info.mnc {
        Some(ref m) if !m.is_empty() => m.clone(),
        _ => {
            return (
                StatusCode::OK,
                Json(ApiResponse::success_with_message(
                    "Cell location unavailable: MNC not available",
                    CellLocationResponse {
                        available: false,
                        cell_info: None,
                        neighbor_cells: vec![],
                        usage_hint: "Network not registered or MCC/MNC not available. Please ensure device is connected to cellular network.".to_string(),
                    },
                )),
            );
        }
    };

    // 与 /api/cells 复用同一份采样，避免再次发送主小区和邻区 AT 指令。
    let cells_snapshot = match get_cells_snapshot(&conn, query.force_refresh()).await {
        Ok(snapshot) => snapshot,
        Err(e) => {
            return (
                StatusCode::OK,
                Json(ApiResponse::<CellLocationResponse>::error(e)),
            );
        }
    };
    let serving_cell = cells_snapshot.serving_cell;
    let serving_cell_detail = cells_snapshot
        .cells
        .iter()
        .find(|cell| cell.is_serving)
        .cloned();
    let neighbor_cells: Vec<CellInfo> = cells_snapshot
        .cells
        .iter()
        .filter(|cell| !cell.is_serving)
        .cloned()
        .collect();

    // 获取详细的小区信息（信号强度等）
    let tech = serving_cell.tech.as_str();
    if get_cell_command_config(tech).is_none() {
        // 如果不支持当前网络制式，返回基本信息（不含信号强度）
        let cell_info = if serving_cell.cell_id > 0 {
            Some(CellLocationInfo {
                mcc: mcc.clone(),
                mnc: mnc.clone(),
                lac: serving_cell.tac,
                cid: serving_cell.cell_id,
                signal_strength: -100, // 默认信号强度
                radio_type: serving_cell.tech.clone(),
                arfcn: None,
                pci: None,
                rsrq: None,
                sinr: None,
            })
        } else {
            None
        };

        let usage_hint = format!(
            "Cell location data available (limited). Unsupported network type: {}.\n\
                Network: {} (MCC={}, MNC={}), Cell ID={}, TAC={}",
            tech, network_info.operator_name, mcc, mnc, serving_cell.cell_id, serving_cell.tac
        );

        return (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(
                "Success (limited info)",
                CellLocationResponse {
                    available: cell_info.is_some(),
                    cell_info,
                    neighbor_cells: vec![],
                    usage_hint,
                },
            )),
        );
    }

    // 构建主服务小区定位信息
    let cell_info = if serving_cell.cell_id > 0 {
        let signal_strength = if let Some(ref detail) = serving_cell_detail {
            // RSRP 是原始值×100，需要除以100
            detail.rsrp.parse::<i32>().unwrap_or(-140) / 100
        } else {
            -100 // 默认信号强度
        };

        let arfcn = serving_cell_detail
            .as_ref()
            .and_then(|d| d.arfcn.parse::<u32>().ok());
        let pci = serving_cell_detail
            .as_ref()
            .and_then(|d| d.pci.parse::<u32>().ok());
        let rsrq = serving_cell_detail
            .as_ref()
            .and_then(|d| d.rsrq.parse::<i32>().ok().map(|v| v / 100));
        let sinr = serving_cell_detail
            .as_ref()
            .and_then(|d| d.sinr.parse::<i32>().ok().map(|v| v / 100));

        Some(CellLocationInfo {
            mcc: mcc.clone(),
            mnc: mnc.clone(),
            lac: serving_cell.tac,
            cid: serving_cell.cell_id,
            signal_strength,
            radio_type: serving_cell.tech.clone(),
            arfcn,
            pci,
            rsrq,
            sinr,
        })
    } else {
        None
    };

    // 构建邻区定位信息列表
    let neighbor_location_cells: Vec<CellLocationInfo> = neighbor_cells
        .iter()
        .filter_map(|cell| {
            let signal_strength = cell.rsrp.parse::<i32>().unwrap_or(-140) / 100;
            let pci = cell.pci.parse::<u32>().ok()?;

            Some(CellLocationInfo {
                mcc: mcc.clone(),
                mnc: mnc.clone(),
                lac: serving_cell.tac, // 邻区通常与主小区在同一 TAC
                cid: 0,                // 邻区可能没有完整的 CID，只有 PCI
                signal_strength,
                radio_type: cell.tech.clone(),
                arfcn: cell.arfcn.parse::<u32>().ok(),
                pci: Some(pci),
                rsrq: cell.rsrq.parse::<i32>().ok().map(|v| v / 100),
                sinr: cell.sinr.parse::<i32>().ok().map(|v| v / 100),
            })
        })
        .collect();

    // 构建使用建议
    let usage_hint = if cell_info.is_some() {
        format!(
            "Cell location data available. You can use this data with geolocation APIs:\n\
            - Google Geolocation API: https://developers.google.com/maps/documentation/geolocation/overview\n\
            - OpenCellID: https://opencellid.org/\n\
            - Unwired Labs: https://unwiredlabs.com/\n\
            Network: {} (MCC={}, MNC={}), Cell ID={}, TAC={}, Signal={}dBm",
            network_info.operator_name,
            mcc,
            mnc,
            serving_cell.cell_id,
            serving_cell.tac,
            cell_info.as_ref().map(|c| c.signal_strength).unwrap_or(-100)
        )
    } else {
        "Cell location unavailable: No serving cell found.".to_string()
    };

    let response = CellLocationResponse {
        available: cell_info.is_some(),
        cell_info,
        neighbor_cells: neighbor_location_cells,
        usage_hint,
    };

    (
        StatusCode::OK,
        Json(ApiResponse::success_with_message("Success", response)),
    )
}

/// SPFORCEFRQ 网络类型常量
const FORCEFRQ_TYPE_LTE: u8 = 12;

const FORCEFRQ_TYPE_NR: u8 = 16;

/// 获取 RAT 类型名称
fn get_rat_name(rat: u8) -> String {
    match rat {
        12 => "LTE".to_string(),
        16 => "NR".to_string(),
        _ => format!("Unknown({})", rat),
    }
}

/// 解析 AT+SPFORCEFRQ 查询响应
///
/// 响应格式:
/// - 未锁定: +SPFORCEFRQ: 16,3
/// - 已锁定: +SPFORCEFRQ: 16,3,633984,597
fn parse_spforcefrq_query_response(response: &str, rat: u8) -> CellLockRatStatus {
    let prefix = format!("+SPFORCEFRQ: {},3", rat);

    if let Some(line) = response.lines().find(|l| l.starts_with(&prefix)) {
        let data = line
            .strip_prefix(&format!("+SPFORCEFRQ: {},3", rat))
            .unwrap_or("");
        let data = data.trim_start_matches(',');

        if data.is_empty() {
            // 未锁定
            CellLockRatStatus {
                rat,
                rat_name: get_rat_name(rat),
                enabled: false,
                lock_type: 0,
                pci: None,
                arfcn: None,
            }
        } else {
            // 已锁定，解析 arfcn,pci
            let parts: Vec<&str> = data.split(',').collect();
            let arfcn = parts.first().and_then(|s| s.trim().parse::<u32>().ok());
            let pci = parts.get(1).and_then(|s| s.trim().parse::<u16>().ok());

            CellLockRatStatus {
                rat,
                rat_name: get_rat_name(rat),
                enabled: arfcn.is_some() && pci.is_some(),
                lock_type: 3,
                pci,
                arfcn,
            }
        }
    } else {
        // 解析失败，返回未锁定状态
        CellLockRatStatus {
            rat,
            rat_name: get_rat_name(rat),
            enabled: false,
            lock_type: 0,
            pci: None,
            arfcn: None,
        }
    }
}

/// GET /api/cell-lock - 获取小区锁定状态
///
/// 使用 AT+SPFORCEFRQ=<type>,3 查询锁定状态
///
/// ## 响应示例
/// ```json
/// {
///   "status": "ok",
///   "message": "Success",
///   "data": {
///     "rat_status": [
///       { "rat": 16, "rat_name": "NR", "enabled": true, "lock_type": 3, "pci": 597, "arfcn": 633984 }
///     ],
///     "any_locked": true
///   }
/// }
/// ```
pub async fn get_cell_lock_handler(State(conn): State<Arc<Connection>>) -> impl IntoResponse {
    let mut rat_status = Vec::new();
    let mut any_locked = false;

    // 查询 NR 锁定状态
    let nr_cmd = format!("AT+SPFORCEFRQ={},3", FORCEFRQ_TYPE_NR);
    if let Ok(response) = send_at_command(&conn, &nr_cmd).await {
        let status = parse_spforcefrq_query_response(&response, FORCEFRQ_TYPE_NR);
        if status.enabled {
            any_locked = true;
        }
        rat_status.push(status);
    } else {
        rat_status.push(CellLockRatStatus {
            rat: FORCEFRQ_TYPE_NR,
            rat_name: "NR".to_string(),
            enabled: false,
            lock_type: 0,
            pci: None,
            arfcn: None,
        });
    }

    // 查询 LTE 锁定状态
    let lte_cmd = format!("AT+SPFORCEFRQ={},3", FORCEFRQ_TYPE_LTE);
    if let Ok(response) = send_at_command(&conn, &lte_cmd).await {
        let status = parse_spforcefrq_query_response(&response, FORCEFRQ_TYPE_LTE);
        if status.enabled {
            any_locked = true;
        }
        rat_status.push(status);
    } else {
        rat_status.push(CellLockRatStatus {
            rat: FORCEFRQ_TYPE_LTE,
            rat_name: "LTE".to_string(),
            enabled: false,
            lock_type: 0,
            pci: None,
            arfcn: None,
        });
    }

    let response = CellLockStatusResponse {
        rat_status,
        any_locked,
    };

    (
        StatusCode::OK,
        Json(ApiResponse::success_with_message("Success", response)),
    )
}

/// 启动自愈：清除历史遗留的小区锁定与工程模式残留。
///
/// 误锁单个小区会阻止切换与载波聚合，导致速率骤降；而 `AT+SFUN=5` 进入工程模式
/// 后若未配对 `AT+SFUN=4`（进程崩溃、升级重启等），状态会残留并限制射频性能。
/// 启动时无条件执行一次「进工程模式 → 清 NR/LTE 锁 → 退工程模式」。
pub(crate) async fn reset_cell_state_on_boot(conn: &Connection) -> Result<String, String> {
    let steps = [
        ("AT+SFUN=5", "进入工程模式"),
        ("AT+SPFORCEFRQ=16,0", "清空 NR 锁定"),
        ("AT+SPFORCEFRQ=12,0", "清空 LTE 锁定"),
        ("AT+SFUN=4", "恢复正常模式"),
    ];
    let mut done = Vec::new();
    for (cmd, desc) in steps {
        if let Err(e) = send_at_command(conn, cmd).await {
            // 即使中途失败也尽力退出工程模式，避免残留
            if cmd != "AT+SFUN=4" {
                let _ = send_at_command(conn, "AT+SFUN=4").await;
            }
            return Err(format!("{}失败: {}", desc, e));
        }
        done.push(desc);
    }
    Ok(done.join(" → "))
}

#[cfg(test)]
mod tests {
    use super::*;

    // 设备 AT+SPFORCEFRQ=16,3 / 12,3 在未锁定时的真实响应。
    const UNLOCKED_NR: &str = "+SPFORCEFRQ: 16,3\r\nOK\r\n";
    const UNLOCKED_LTE: &str = "+SPFORCEFRQ: 12,3\r\nOK\r\n";

    #[test]
    fn an_unlocked_modem_reports_no_lock() {
        let nr = parse_spforcefrq_query_response(UNLOCKED_NR, FORCEFRQ_TYPE_NR);
        assert!(!nr.enabled);
        assert_eq!(nr.lock_type, 0);
        assert_eq!((nr.pci, nr.arfcn), (None, None));
        assert_eq!(nr.rat_name, "NR");

        let lte = parse_spforcefrq_query_response(UNLOCKED_LTE, FORCEFRQ_TYPE_LTE);
        assert!(!lte.enabled);
        assert_eq!(lte.rat_name, "LTE");
    }

    #[test]
    fn a_locked_cell_reports_arfcn_then_pci() {
        let locked = parse_spforcefrq_query_response(
            "+SPFORCEFRQ: 16,3,633984,597\r\nOK\r\n",
            FORCEFRQ_TYPE_NR,
        );
        assert!(locked.enabled);
        assert_eq!(locked.lock_type, 3);
        assert_eq!(locked.arfcn, Some(633984));
        assert_eq!(locked.pci, Some(597));
    }

    #[test]
    fn only_the_line_for_the_requested_rat_counts() {
        // The NR answer must not be read as an LTE lock and vice versa.
        let status = parse_spforcefrq_query_response(
            "+SPFORCEFRQ: 16,3,633984,597\r\nOK\r\n",
            FORCEFRQ_TYPE_LTE,
        );
        assert!(!status.enabled);
        assert_eq!(status.pci, None);
    }

    #[test]
    fn errors_and_half_written_locks_are_not_reported_as_locked() {
        for response in [
            "",
            "ERROR",
            "+CME ERROR: 4",
            "+SPFORCEFRQ: 16,3,abc,def",
            "+SPFORCEFRQ: 16,3,633984",
        ] {
            let status = parse_spforcefrq_query_response(response, FORCEFRQ_TYPE_NR);
            assert!(!status.enabled, "{response:?}");
        }
    }

    #[test]
    fn rat_names_are_stable() {
        assert_eq!(get_rat_name(16), "NR");
        assert_eq!(get_rat_name(12), "LTE");
        assert_eq!(get_rat_name(3), "Unknown(3)");
    }
}
