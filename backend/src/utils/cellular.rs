//! 自 utils.rs 拆出（纯移动，逻辑未改）。

use super::*;

/// 解析 `AT+QCAINFO` 输出，提取载波聚合（CA）状态。
///
/// Quectel/SIMCom 模组在激活 CA 时会在响应中包含 `SCC1`、`SCC2` 等辅载波行；
/// 仅统计辅载波数量并据此判断是否激活。命令不支持或返回 `ERROR` 时返回 `None`，
/// 让前端据此不展示 CA 卡片，避免误报。频段名因命令格式型号相关、不可靠，留空。
#[allow(dead_code)]
pub fn parse_ca_info(response: &str) -> Option<CaStatus> {
    let upper = response.to_uppercase();
    if upper.contains("ERROR") || upper.contains("COMMAND NOT SUPPORT") || upper.is_empty() {
        return None;
    }
    let scc_count = upper.matches("SCC").count() as u8;
    Some(CaStatus {
        active: scc_count > 0,
        scc_count,
        bands: Vec::new(),
    })
}

/// 小区信息查询指令配置
#[derive(Debug, Clone)]
pub struct CellCommandConfig {
    /// 主小区查询指令
    pub primary: &'static str,
    /// 邻区查询指令
    pub neighbor: &'static str,
}

/// 获取指定网络制式的小区查询指令
///
/// # Arguments
/// * `tech` - 网络制式 ("nr" 或 "lte")
///
/// # Returns
/// 对应的指令配置，如果制式不支持则返回 None
pub fn get_cell_command_config(tech: &str) -> Option<CellCommandConfig> {
    let mut cmd_map = HashMap::new();

    // NR 5G 指令配置
    cmd_map.insert(
        "nr",
        CellCommandConfig {
            primary: "AT+SPENGMD=0,14,1",
            neighbor: "AT+SPENGMD=0,14,2",
        },
    );

    // LTE 4G 指令配置
    cmd_map.insert(
        "lte",
        CellCommandConfig {
            primary: "AT+SPENGMD=0,6,0",
            neighbor: "AT+SPENGMD=0,6,6",
        },
    );

    cmd_map.get(tech).cloned()
}

/// 根据 NR ARFCN 推算频段（返回完整格式如 n41）
/// 参考 3GPP TS 38.104
fn arfcn_to_nr_band(arfcn: u32) -> String {
    match arfcn {
        // N1 (2100 MHz FDD)
        422000..=434000 => "n1".to_string(),
        // N3 (1800 MHz FDD)
        361000..=376000 => "n3".to_string(),
        // N8 (900 MHz FDD)
        185000..=192000 => "n8".to_string(),
        // N28 (700 MHz FDD)
        151600..=160600 => "n28".to_string(),
        // N41 (2600 MHz TDD)
        499200..=537999 => "n41".to_string(),
        // N77 (3700 MHz TDD) - 与 N78 重叠，优先判断为 N78
        620000..=680000 => "n78".to_string(),
        // N79 (4700 MHz TDD)
        693334..=733333 => "n79".to_string(),
        _ => "".to_string(),
    }
}

/// 根据 LTE EARFCN 推算频段（返回完整格式如 B3）
/// 参考 3GPP TS 36.101
fn earfcn_to_lte_band(earfcn: u32) -> String {
    match earfcn {
        // B1 (2100 MHz FDD)
        0..=599 => "B1".to_string(),
        // B3 (1800 MHz FDD)
        1200..=1949 => "B3".to_string(),
        // B5 (850 MHz FDD)
        2400..=2649 => "B5".to_string(),
        // B7 (2600 MHz FDD)
        2750..=3449 => "B7".to_string(),
        // B8 (900 MHz FDD)
        3450..=3799 => "B8".to_string(),
        // B20 (800 MHz FDD)
        6150..=6449 => "B20".to_string(),
        // B28 (700 MHz FDD)
        9210..=9659 => "B28".to_string(),
        // B38 (2600 MHz TDD)
        37750..=38249 => "B38".to_string(),
        // B39 (1900 MHz TDD)
        38250..=38649 => "B39".to_string(),
        // B40 (2300 MHz TDD)
        38650..=39649 => "B40".to_string(),
        // B41 (2500 MHz TDD)
        39650..=41589 => "B41".to_string(),
        _ => "".to_string(),
    }
}

/// 将 AT 指令返回的字符串解析为二维数组
///
/// # Arguments
/// * `input` - AT 指令返回的原始字符串
///
/// # Returns
/// 解析后的二维字符串数组
pub fn parse_at_response_to_2d_vec(input: &str) -> Vec<Vec<String>> {
    let cleaned_str: String = input
        .trim()
        .trim_end_matches("OK")
        .replace(['\r', '\n'], "");

    let mut result: Vec<Vec<String>> = Vec::new();
    let mut current_part = String::new();
    let mut chars = cleaned_str.chars().peekable();
    let mut prev_char: Option<char> = None;

    while let Some(c) = chars.next() {
        match c {
            '-' => match prev_char {
                Some(',') => current_part.push(c),
                _ => {
                    if !current_part.is_empty() {
                        result.push(
                            current_part
                                .trim()
                                .split(',')
                                .map(|s| s.to_string())
                                .collect(),
                        );
                        current_part.clear();
                    }
                    if let Some('-') = chars.peek() {
                        current_part.push('-');
                        chars.next();
                    }
                }
            },
            _ => current_part.push(c),
        }
        prev_char = Some(c);
    }

    if !current_part.is_empty() {
        result.push(current_part.split(',').map(|s| s.to_string()).collect());
    }

    result
}

/// 解析主小区信息
///
/// # Arguments
/// * `tech` - 网络制式 (nr/lte)
/// * `parsed_data` - 解析后的二维数组
///
/// # Returns
/// 主小区信息结构
///
/// # AT+SPENGMD 数据格式说明
///
/// **NR (5G) 主小区 (AT+SPENGMD=0,14,1):**
/// - `[0]`: Band (频段)
/// - `[1]`: ARFCN (绝对频点号)
/// - `[2]`: PCI (物理小区标识)
/// - `[3]`: RSRP (参考信号接收功率，原始值 ×100)
/// - `[4]`: RSRQ (参考信号接收质量，原始值 ×100)
/// - `[15]`: SINR (信号与干扰加噪声比，原始值 ×100)
///
/// **LTE (4G) 主小区 (AT+SPENGMD=0,6,0):**
/// - `[0]`: Band (频段)
/// - `[1]`: ARFCN (绝对频点号)
/// - `[2]`: PCI (物理小区标识)
/// - `[3]`: RSRP (参考信号接收功率，原始值 ×100)
/// - `[4]`: RSRQ (参考信号接收质量，原始值 ×100)
/// - `[33]`: SINR (信号与干扰加噪声比，原始值 ×100)
pub fn parse_primary_cell(tech: &str, parsed_data: &[Vec<String>]) -> CellInfo {
    let mut cell_info = CellInfo {
        is_serving: true, // 主小区标记
        ..Default::default()
    };

    match tech {
        "nr" if parsed_data.len() >= 16 => {
            cell_info.tech = tech.to_string();
            // 给 NR 频段加 n 前缀
            let raw_band = parsed_data[0].join(",");
            cell_info.band = if !raw_band.is_empty() && raw_band != "0" {
                format!("n{}", raw_band)
            } else {
                raw_band
            };
            cell_info.arfcn = parsed_data[1].join(",");
            cell_info.pci = parsed_data[2].first().cloned().unwrap_or_default();
            // 返回原始值×100，不做除法，让前端处理单位转换
            cell_info.rsrp = parsed_data[3].first().cloned().unwrap_or_default();
            cell_info.rsrq = parsed_data[4].first().cloned().unwrap_or_default();
            cell_info.sinr = parsed_data[15].first().cloned().unwrap_or_default();
        }
        "lte" if parsed_data.len() >= 34 => {
            cell_info.tech = tech.to_string();
            // 给 LTE 频段加 B 前缀
            let raw_band = parsed_data[0].join(",");
            cell_info.band = if !raw_band.is_empty() && raw_band != "0" {
                format!("B{}", raw_band)
            } else {
                raw_band
            };
            cell_info.arfcn = parsed_data[1].join(",");
            cell_info.pci = parsed_data[2].join(",");
            // 返回原始值×100，不做除法，让前端处理单位转换
            cell_info.rsrp = parsed_data[3].first().cloned().unwrap_or_default();
            cell_info.rsrq = parsed_data[4].first().cloned().unwrap_or_default();
            cell_info.sinr = parsed_data[33].first().cloned().unwrap_or_default();
        }
        _ => {}
    }

    cell_info
}

/// 解析邻区信息列表
///
/// # Arguments
/// * `tech` - 网络制式 (nr/lte)
/// * `parsed_data` - 解析后的二维数组
///
/// # Returns
/// 邻区信息列表
///
/// # AT+SPENGMD 邻区数据格式说明
///
/// **NR (5G) 邻区 (AT+SPENGMD=0,14,2):**
/// - `[0][i]`: Band (频段，第i个邻区)
/// - `[1][i]`: ARFCN (绝对频点号)
/// - `[2][i]`: PCI (物理小区标识)
/// - `[3][i]`: RSRP (参考信号接收功率，原始值 ×100)
/// - `[4][i]`: RSRQ (参考信号接收质量，原始值 ×100)
/// - `[5][i]`: SINR (信号与干扰加噪声比，原始值 ×100)
///
/// **LTE (4G) 邻区 (AT+SPENGMD=0,6,6):**
/// - `row[0]`: ARFCN (绝对频点号)
/// - `row[1]`: PCI (物理小区标识)
/// - `row[2]`: RSRP (参考信号接收功率，原始值 ×100)
/// - `row[3]`: RSRQ (参考信号接收质量，原始值 ×100)
/// - `row[12]`: Band (频段，如果存在)
pub fn parse_neighbor_cells(tech: &str, parsed_data: &[Vec<String>]) -> Vec<CellInfo> {
    let mut result = Vec::new();

    match tech {
        "nr" => {
            if parsed_data.is_empty() {
                return result;
            }

            let count = parsed_data[0].len();
            for i in 0..count {
                if parsed_data.len() < 6 {
                    break;
                }

                let arfcn = parsed_data[1].get(i).map(|s| s.as_str()).unwrap_or("0");
                let pci = parsed_data[2].get(i).map(|s| s.as_str()).unwrap_or("0");

                // 如果 arfcn 和 pci 都是 0，说明后续没有有效数据
                if arfcn == "0" && pci == "0" {
                    break;
                }

                // 尝试从数据中获取频段，如果为空或"0"则通过 ARFCN 推算
                let raw_band = parsed_data[0].get(i).cloned().unwrap_or_default();
                let band = if raw_band.is_empty() || raw_band == "0" {
                    // 通过 ARFCN 推算频段
                    arfcn
                        .parse::<u32>()
                        .map(arfcn_to_nr_band)
                        .unwrap_or_default()
                } else {
                    raw_band
                };

                let cell = CellInfo {
                    is_serving: false, // 邻区标记
                    tech: tech.to_string(),
                    band,
                    arfcn: arfcn.to_string(),
                    pci: pci.to_string(),
                    // 返回原始值×100，不做除法，让前端处理单位转换
                    rsrp: parsed_data[3].get(i).cloned().unwrap_or_default(),
                    rsrq: parsed_data[4].get(i).cloned().unwrap_or_default(),
                    sinr: parsed_data[5].get(i).cloned().unwrap_or_default(),
                };

                result.push(cell);
            }
        }
        "lte" => {
            for row in parsed_data {
                if row.len() < 4 {
                    continue;
                }

                // 如果 arfcn 和 pci 都是 0，说明空行
                if row[0] == "0" && row[1] == "0" {
                    break;
                }

                // 尝试从数据中获取频段，如果不存在或为"0"则通过 EARFCN 推算
                let raw_band = if row.len() > 12 {
                    row[12].clone()
                } else {
                    String::new()
                };
                let band = if raw_band.is_empty() || raw_band == "0" {
                    // 通过 EARFCN 推算频段
                    row[0]
                        .parse::<u32>()
                        .map(earfcn_to_lte_band)
                        .unwrap_or_default()
                } else {
                    raw_band
                };

                let cell = CellInfo {
                    is_serving: false, // 邻区标记
                    tech: tech.to_string(),
                    band,
                    arfcn: row[0].clone(),
                    pci: row[1].clone(),
                    // 返回原始值×100，不做除法，让前端处理单位转换
                    rsrp: row[2].clone(),
                    rsrq: row[3].clone(),
                    sinr: "-".to_string(), // LTE邻区不提供SINR
                };

                result.push(cell);
            }
        }
        _ => {
            // 不支持的网络类型，返回空列表
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    // 设备 AT+SPENGMD=0,14,1 / 0,14,2 的真实响应（联通 n78，PCI 60 / 邻区 PCI 61）。
    const NR_PRIMARY: &str = "78-627264-60,0--7937--3506--128-0,0-100-6224649-4021325831,5-0,0-0-0-0-0-1131-25-7-3-5-1800-1000-3-1-10-2-17--74-5-2-2-10-2-5-0,2,32,460,1--2537,0-0-34500-34500-630000-100-630000-8-4-1-0,-7343,-3506,299-1,1-0\r\nOK\r\n";
    const NR_NEIGHBOR: &str = "0-627264-61--8206--3800-412-32-1--2537-0\r\nOK\r\n";

    fn groups(row: &[&str]) -> Vec<String> {
        row.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn splits_the_real_nr_response_on_dashes_but_keeps_negative_numbers() {
        let parsed = parse_at_response_to_2d_vec(NR_PRIMARY);
        assert_eq!(parsed[0], groups(&["78"]));
        assert_eq!(parsed[1], groups(&["627264"]));
        assert_eq!(parsed[2], groups(&["60", "0"]));
        assert_eq!(parsed[3], groups(&["-7937"]), "RSRP keeps its sign");
        assert_eq!(parsed[4], groups(&["-3506"]), "RSRQ keeps its sign");
        assert_eq!(parsed[15], groups(&["1131"]), "SINR is group 15");
        assert!(parsed.len() >= 16);
    }

    #[test]
    fn a_dash_right_after_a_comma_is_a_sign_not_a_separator() {
        assert_eq!(
            parse_at_response_to_2d_vec("1,-5-2"),
            vec![groups(&["1", "-5"]), groups(&["2"])]
        );
        assert_eq!(parse_at_response_to_2d_vec(""), Vec::<Vec<String>>::new());
    }

    #[test]
    fn primary_cell_matches_what_the_api_reports_for_the_same_device() {
        let cell = parse_primary_cell("nr", &parse_at_response_to_2d_vec(NR_PRIMARY));
        assert!(cell.is_serving);
        assert_eq!(cell.tech, "nr");
        assert_eq!(cell.band, "n78", "bare band number gets the n prefix");
        assert_eq!(cell.arfcn, "627264");
        assert_eq!(cell.pci, "60");
        // Raw values are x100; the frontend converts the unit.
        assert_eq!(cell.rsrp, "-7937");
        assert_eq!(cell.rsrq, "-3506");
        assert_eq!(cell.sinr, "1131");
    }

    #[test]
    fn a_short_or_unsupported_response_yields_an_empty_cell() {
        let short = parse_at_response_to_2d_vec("78-627264-60,0--7937");
        assert_eq!(parse_primary_cell("nr", &short).band, "");
        let nr = parse_at_response_to_2d_vec(NR_PRIMARY);
        assert_eq!(parse_primary_cell("gsm", &nr).band, "");
        // LTE needs 34 groups; a truncated response is not enough.
        assert_eq!(parse_primary_cell("lte", &short).band, "");
    }

    #[test]
    fn neighbour_band_is_derived_from_the_arfcn_when_the_modem_reports_zero() {
        let cells = parse_neighbor_cells("nr", &parse_at_response_to_2d_vec(NR_NEIGHBOR));
        assert_eq!(cells.len(), 1);
        let cell = &cells[0];
        assert!(!cell.is_serving);
        assert_eq!(cell.band, "n78");
        assert_eq!(cell.arfcn, "627264");
        assert_eq!(cell.pci, "61");
        assert_eq!(
            (cell.rsrp.as_str(), cell.rsrq.as_str(), cell.sinr.as_str()),
            ("-8206", "-3800", "412")
        );
    }

    #[test]
    fn neighbour_list_stops_at_the_empty_placeholder_row() {
        let parsed = vec![
            groups(&["0", "0"]),
            groups(&["627264", "0"]),
            groups(&["61", "0"]),
            groups(&["-8206", "0"]),
            groups(&["-3800", "0"]),
            groups(&["412", "0"]),
        ];
        assert_eq!(parse_neighbor_cells("nr", &parsed).len(), 1);
        assert!(parse_neighbor_cells("nr", &[]).is_empty());
        assert!(parse_neighbor_cells("gsm", &parsed).is_empty());
    }

    #[test]
    fn lte_neighbours_take_the_band_from_the_earfcn_and_have_no_sinr() {
        let rows = [
            groups(&["1850", "123", "-9500", "-1100"]),
            groups(&["0", "0", "0", "0"]),
            groups(&["1", "2", "3", "4"]),
        ];
        let cells = parse_neighbor_cells("lte", &rows);
        assert_eq!(cells.len(), 1, "an all-zero row ends the list");
        assert_eq!(cells[0].band, "B3");
        assert_eq!(cells[0].sinr, "-");
    }

    #[test]
    fn arfcn_ranges_map_to_the_expected_bands() {
        for (arfcn, band) in [
            (633984, "n78"),
            (627264, "n78"),
            (428910, "n1"),
            (368500, "n3"),
            (520000, "n41"),
            (700000, "n79"),
            (1, ""),
        ] {
            assert_eq!(arfcn_to_nr_band(arfcn), band, "NR ARFCN {arfcn}");
        }
        for (earfcn, band) in [
            (100, "B1"),
            (1850, "B3"),
            (2500, "B5"),
            (3500, "B8"),
            (38400, "B39"),
            (39000, "B40"),
            (40000, "B41"),
            (50000, ""),
        ] {
            assert_eq!(earfcn_to_lte_band(earfcn), band, "LTE EARFCN {earfcn}");
        }
    }

    #[test]
    fn query_commands_target_the_documented_engineering_mode_ids() {
        let nr = get_cell_command_config("nr").expect("nr config");
        assert_eq!(
            (nr.primary, nr.neighbor),
            ("AT+SPENGMD=0,14,1", "AT+SPENGMD=0,14,2")
        );
        let lte = get_cell_command_config("lte").expect("lte config");
        assert_eq!(
            (lte.primary, lte.neighbor),
            ("AT+SPENGMD=0,6,0", "AT+SPENGMD=0,6,6")
        );
        assert!(get_cell_command_config("gsm").is_none());
    }

    #[test]
    fn carrier_aggregation_is_only_reported_when_secondary_carriers_exist() {
        assert!(parse_ca_info("").is_none());
        assert!(parse_ca_info("ERROR").is_none());
        assert!(parse_ca_info("COMMAND NOT SUPPORT").is_none());

        let idle =
            parse_ca_info("+QCAINFO: \"PCC\",627264,100,\"NR5G BAND 78\"\r\nOK").expect("status");
        assert!(!idle.active);
        assert_eq!(idle.scc_count, 0);

        let active =
            parse_ca_info("+QCAINFO: \"PCC\",1\r\n+QCAINFO: \"SCC\",2\r\n+QCAINFO: \"SCC\",3")
                .expect("status");
        assert!(active.active);
        assert_eq!(active.scc_count, 2);
    }
}
