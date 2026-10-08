//! 自 utils.rs 拆出（纯移动，逻辑未改）。

// ============================================================================
// 频段锁定 (AT+SPLBAND) 相关函数
// ============================================================================

/// 将频段号列表转换为位掩码
///
/// # 展锐 UDX710 频段映射规则
///
/// ## LTE FDD (base=1)
/// 线性映射，使用 16 位位掩码：
/// - B1 = bit0 = 1, B2 = bit1 = 2, B3 = bit2 = 4, ..., B16 = bit15 = 32768
/// - 公式：`1 << (band - 1)`
/// - 设备支持: B1, B3, B5, B8
///
/// ## LTE TDD (base=33)
/// 线性映射，使用 16 位位掩码：
/// - B33 = bit0 = 1, B34 = bit1 = 2, ..., B48 = bit15 = 32768
/// - 公式：`1 << (band - 33)`
/// - 设备支持: B39, B41
///
/// ## NR FDD (base=100, 特殊标记)
/// **非线性映射**，展锐特殊定义：
/// - N1=1, N3=4, N28=512
/// - 设备支持: N1, N3, N28
///
/// ## NR TDD (base=41)
/// **非线性映射**，展锐特殊定义：
/// - N34=1, N38=2, N39=4, N40=8, N41=16, N77=128, N78=256, N79=512
/// - 设备支持: N41, N77, N78, N79
///
/// # Arguments
/// * `bands` - 频段号列表（例如 [1, 3, 8]）
/// * `base` - 基准频段号（1=LTE FDD, 33=LTE TDD, 41=NR TDD, 100=NR FDD）
///
/// # Returns
/// 位掩码值
///
/// # Examples
/// ```
/// // LTE FDD B1+B3+B8
/// let mask = bands_to_bitmask(&[1, 3, 8], 1); // 1 + 4 + 128 = 133
/// // NR FDD N1+N3+N28 (展锐特殊映射)
/// let mask = bands_to_bitmask(&[1, 3, 28], 100); // 1 + 4 + 512 = 517
/// // NR TDD N77+N78 (展锐特殊映射)
/// let mask = bands_to_bitmask(&[77, 78], 41); // 128 + 256 = 384
/// // NR TDD N41+N78+N79
/// let mask = bands_to_bitmask(&[41, 78, 79], 41); // 16 + 256 + 512 = 784
/// ```
pub fn bands_to_bitmask(bands: &[u8], base: u8) -> u16 {
    match base {
        1 => {
            // LTE FDD (B1-B16) - 展锐 UDX710 使用 16 位位掩码
            // 简单线性映射：B1 -> bit0, B2 -> bit1, ..., B16 -> bit15
            bands
                .iter()
                .filter(|&&b| (1..=16).contains(&b)) // 严格限制在 B1-B16
                .map(|&b| 1u16 << (b - 1))
                .fold(0, |mask, bit| mask | bit)
        }
        33 => {
            // LTE TDD (B33-B48) - 展锐 UDX710 使用 16 位位掩码
            // 简单线性映射：B33 -> bit0, B34 -> bit1, ..., B48 -> bit15
            bands
                .iter()
                .filter(|&&b| (33..=48).contains(&b)) // 严格限制在 B33-B48
                .map(|&b| 1u16 << (b - 33))
                .fold(0, |mask, bit| mask | bit)
        }
        100 => {
            // NR FDD - 展锐模块使用特殊映射（非线性）
            // 根据 AT+SPLBAND=4 返回的 517 = N1(1) + N3(4) + N28(512)
            let nr_fdd_map: &[(u8, u16)] = &[
                (1, 1),    // N1 -> bit 0
                (2, 2),    // N2 -> bit 1
                (3, 4),    // N3 -> bit 2
                (5, 16),   // N5 -> bit 4
                (7, 64),   // N7 -> bit 6
                (8, 128),  // N8 -> bit 7
                (28, 512), // N28 -> bit 9
            ];

            bands
                .iter()
                .filter_map(|&b| {
                    nr_fdd_map
                        .iter()
                        .find(|(band, _)| *band == b)
                        .map(|(_, mask)| *mask)
                })
                .fold(0, |mask, bit| mask | bit)
        }
        41 => {
            // NR TDD - 展锐模块使用特殊映射（非线性）
            let nr_tdd_map: &[(u8, u16)] = &[
                (34, 1),   // N34 -> bit 0
                (38, 2),   // N38 -> bit 1
                (39, 4),   // N39 -> bit 2
                (40, 8),   // N40 -> bit 3
                (41, 16),  // N41 -> bit 4
                (77, 128), // N77 -> bit 7
                (78, 256), // N78 -> bit 8
                (79, 512), // N79 -> bit 9
            ];

            bands
                .iter()
                .filter_map(|&b| {
                    nr_tdd_map
                        .iter()
                        .find(|(band, _)| *band == b)
                        .map(|(_, mask)| *mask)
                })
                .fold(0, |mask, bit| mask | bit)
        }
        _ => 0,
    }
}

/// 将位掩码转换为频段号列表
///
/// # Arguments
/// * `mask` - 位掩码值
/// * `base` - 基准频段号（1=LTE FDD, 33=LTE TDD, 41=NR TDD, 100=NR FDD）
///
/// # Returns
/// 频段号列表
///
/// # Examples
/// ```
/// // 位掩码 133 -> B1+B3+B8
/// let bands = bitmask_to_bands(133, 1); // [1, 3, 8]
/// // NR FDD 位掩码 517 -> N1+N3+N28 (展锐特殊映射)
/// let bands = bitmask_to_bands(517, 100); // [1, 3, 28]
/// // NR TDD 位掩码 384 -> N77+N78 (展锐特殊映射)
/// let bands = bitmask_to_bands(384, 41); // [77, 78]
/// ```
pub fn bitmask_to_bands(mask: u16, base: u8) -> Vec<u8> {
    match base {
        1 => {
            // LTE FDD (B1-B16)
            (0..16)
                .filter(|i| (mask & (1 << i)) != 0)
                .map(|i| (i + 1) as u8)
                .collect()
        }
        33 => {
            // LTE TDD (B33-B48)
            (0..16)
                .filter(|i| (mask & (1 << i)) != 0)
                .map(|i| (33 + i) as u8)
                .collect()
        }
        100 => {
            // NR FDD - 展锐模块使用特殊映射（反向查找）
            let nr_fdd_map: &[(u16, u8)] = &[
                (1, 1),    // bit 0 -> N1
                (2, 2),    // bit 1 -> N2
                (4, 3),    // bit 2 -> N3
                (16, 5),   // bit 4 -> N5
                (64, 7),   // bit 6 -> N7
                (128, 8),  // bit 7 -> N8
                (512, 28), // bit 9 -> N28
            ];

            nr_fdd_map
                .iter()
                .filter(|(bit_mask, _)| (mask & bit_mask) != 0)
                .map(|(_, band)| *band)
                .collect()
        }
        41 => {
            // NR TDD - 展锐模块使用特殊映射（反向查找）
            let nr_tdd_map: &[(u16, u8)] = &[
                (1, 34),   // bit 0 -> N34
                (2, 38),   // bit 1 -> N38
                (4, 39),   // bit 2 -> N39
                (8, 40),   // bit 3 -> N40
                (16, 41),  // bit 4 -> N41
                (128, 77), // bit 7 -> N77
                (256, 78), // bit 8 -> N78
                (512, 79), // bit 9 -> N79
            ];

            nr_tdd_map
                .iter()
                .filter(|(bit_mask, _)| (mask & bit_mask) != 0)
                .map(|(_, band)| *band)
                .collect()
        }
        _ => Vec::new(),
    }
}

/// 解析 LTE SPLBAND 响应
///
/// # Arguments
/// * `response` - AT+SPLBAND=0 的响应，格式: `+SPLBAND: 0,<TDD>,0,<FDD>,0`
///
/// # Returns
/// (lte_fdd_mask, lte_tdd_mask)
///
/// # Examples
/// ```
/// let response = "+SPLBAND: 0,320,0,149,0\r\nOK";
/// let (fdd, tdd) = parse_splband_lte_response(response);
/// // fdd = 149 (B1+B3+B5+B8), tdd = 320 (B39+B41)
/// ```
pub fn parse_splband_lte_response(response: &str) -> (u16, u16) {
    for line in response.lines() {
        let line = line.trim();
        if line.starts_with("+SPLBAND:") {
            if let Some(data) = line.strip_prefix("+SPLBAND:") {
                let parts: Vec<&str> = data.trim().split(',').collect();
                if parts.len() >= 5 {
                    // +SPLBAND: 0,<TDD>,0,<FDD>,0
                    // parts[0] = "0", parts[1] = TDD, parts[2] = "0", parts[3] = FDD, parts[4] = "0"
                    let tdd = parts
                        .get(1)
                        .and_then(|s| s.trim().parse::<u16>().ok())
                        .unwrap_or(0);
                    let fdd = parts
                        .get(3)
                        .and_then(|s| s.trim().parse::<u16>().ok())
                        .unwrap_or(0);
                    return (fdd, tdd);
                }
            }
        }
    }
    (0, 0)
}

/// 解析 NR SPLBAND 响应
///
/// # Arguments
/// * `response` - AT+SPLBAND=3 的响应，格式: `+SPLBAND=<NR-FDD>,0,<NR-TDD>,0`
///
/// # Returns
/// (nr_fdd_mask, nr_tdd_mask)
///
/// # Examples
/// ```
/// let response = "+SPLBAND: 1,0,256,0\r\nOK";
/// let (fdd, tdd) = parse_splband_nr_response(response);
/// // fdd = 1 (N1), tdd = 256 (N78)
/// ```
pub fn parse_splband_nr_response(response: &str) -> (u16, u16) {
    for line in response.lines() {
        let line = line.trim();
        if line.starts_with("+SPLBAND:") {
            if let Some(data) = line.strip_prefix("+SPLBAND:") {
                let parts: Vec<&str> = data.trim().split(',').collect();
                if parts.len() >= 4 {
                    // +SPLBAND: <NR-FDD>,0,<NR-TDD>,0
                    let fdd = parts
                        .first()
                        .and_then(|s| s.trim().parse::<u16>().ok())
                        .unwrap_or(0);
                    let tdd = parts
                        .get(2)
                        .and_then(|s| s.trim().parse::<u16>().ok())
                        .unwrap_or(0);
                    return (fdd, tdd);
                }
            }
        }
    }
    (0, 0)
}

/// 构造 LTE SPLBAND 设置指令
///
/// # Arguments
/// * `fdd_mask` - LTE FDD 频段位掩码
/// * `tdd_mask` - LTE TDD 频段位掩码
///
/// # Returns
/// AT 指令字符串
///
/// # Examples
/// ```
/// // 锁定 LTE B1+B3+B39+B41
/// let cmd = build_splband_lte_command(5, 320);
/// // "AT+SPLBAND=1,0,320,0,5,0"
/// ```
pub fn build_splband_lte_command(fdd_mask: u16, tdd_mask: u16) -> String {
    // 格式: AT+SPLBAND=1,0,<TDD>,0,<FDD>,0 (6 参数)
    format!("AT+SPLBAND=1,0,{},0,{},0", tdd_mask, fdd_mask)
}

/// 构造 NR SPLBAND 设置指令
///
/// # Arguments
/// * `fdd_mask` - NR FDD 频段位掩码
/// * `tdd_mask` - NR TDD 频段位掩码
///
/// # Returns
/// AT 指令字符串
///
/// # Examples
/// ```
/// // 锁定 NR N1+N78
/// let cmd = build_splband_nr_command(1, 256);
/// // "AT+SPLBAND=2,1,0,256,0"
/// ```
pub fn build_splband_nr_command(fdd_mask: u16, tdd_mask: u16) -> String {
    format!("AT+SPLBAND=2,{},0,{},0", fdd_mask, tdd_mask)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 设备 AT+SPLBAND=4/5 返回的真实能力位掩码（见 band.md）。
    const LTE_CAPS: &str = "+SPLBAND: 0,320,0,149,0\r\nOK\r\n";
    const NR_CAPS: &str = "+SPLBAND: 517,0,912,0\r\nOK\r\n";
    const NR_UNLOCKED: &str = "+SPLBAND: 0,0,0,0\r\nOK\r\n";

    #[test]
    fn device_capability_masks_decode_to_the_documented_bands() {
        let (lte_fdd, lte_tdd) = parse_splband_lte_response(LTE_CAPS);
        assert_eq!(bitmask_to_bands(lte_fdd, 1), vec![1, 3, 5, 8]);
        assert_eq!(bitmask_to_bands(lte_tdd, 33), vec![39, 41]);

        let (nr_fdd, nr_tdd) = parse_splband_nr_response(NR_CAPS);
        assert_eq!(bitmask_to_bands(nr_fdd, 100), vec![1, 3, 28]);
        assert_eq!(bitmask_to_bands(nr_tdd, 41), vec![41, 77, 78, 79]);
    }

    #[test]
    fn bands_round_trip_through_the_bitmask() {
        for (bands, base) in [
            (vec![1u8, 3, 5, 8], 1u8),
            (vec![39, 41], 33),
            (vec![1, 3, 28], 100),
            (vec![41, 77, 78, 79], 41),
        ] {
            assert_eq!(
                bitmask_to_bands(bands_to_bitmask(&bands, base), base),
                bands
            );
        }
    }

    #[test]
    fn known_masks_match_the_documented_examples() {
        assert_eq!(bands_to_bitmask(&[1, 3, 8], 1), 133);
        assert_eq!(bands_to_bitmask(&[1, 3, 28], 100), 517);
        assert_eq!(bands_to_bitmask(&[77, 78], 41), 384);
        assert_eq!(bands_to_bitmask(&[41, 78, 79], 41), 784);
    }

    #[test]
    fn bands_the_modem_does_not_know_are_ignored() {
        assert_eq!(bands_to_bitmask(&[0, 17, 200], 1), 0);
        assert_eq!(bands_to_bitmask(&[1, 99], 33), 0);
        assert_eq!(bands_to_bitmask(&[4, 6], 100), 0);
        assert_eq!(bands_to_bitmask(&[1, 3], 7), 0, "unknown base");
        assert!(bitmask_to_bands(0xFFFF, 7).is_empty());
    }

    #[test]
    fn a_repeated_band_never_turns_into_another_band() {
        // Summing instead of OR-ing would make [1, 1] the mask for B2, and
        // [16, 16] overflow a u16.
        assert_eq!(bands_to_bitmask(&[1, 1], 1), 1);
        assert_eq!(bands_to_bitmask(&[16, 16], 1), 1 << 15);
        assert_eq!(bands_to_bitmask(&[78, 78], 41), 256);
        assert_eq!(bands_to_bitmask(&[28, 28, 1], 100), 513);
    }

    #[test]
    fn responses_are_parsed_from_real_device_output() {
        assert_eq!(parse_splband_lte_response(LTE_CAPS), (149, 320));
        assert_eq!(parse_splband_nr_response(NR_CAPS), (517, 912));
        assert_eq!(parse_splband_nr_response(NR_UNLOCKED), (0, 0));
        // Extra lines around the payload (echo, blank lines) are tolerated.
        assert_eq!(
            parse_splband_lte_response("AT+SPLBAND=5\r\n\r\n+SPLBAND: 0,320,0,149,0\r\nOK"),
            (149, 320)
        );
    }

    #[test]
    fn errors_and_garbage_parse_as_nothing_locked() {
        for response in [
            "",
            "ERROR",
            "+CME ERROR: 3",
            "+SPLBAND: 1,2",
            "+SPLBAND: a,b,c,d,e",
        ] {
            assert_eq!(parse_splband_lte_response(response), (0, 0), "{response:?}");
            assert_eq!(parse_splband_nr_response(response), (0, 0), "{response:?}");
        }
    }

    #[test]
    fn set_commands_use_the_documented_argument_order() {
        // LTE takes TDD before FDD, NR takes FDD before TDD.
        assert_eq!(
            build_splband_lte_command(5, 320),
            "AT+SPLBAND=1,0,320,0,5,0"
        );
        assert_eq!(build_splband_nr_command(1, 256), "AT+SPLBAND=2,1,0,256,0");
    }
}
