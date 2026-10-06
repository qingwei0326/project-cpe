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
                .sum()
        }
        33 => {
            // LTE TDD (B33-B48) - 展锐 UDX710 使用 16 位位掩码
            // 简单线性映射：B33 -> bit0, B34 -> bit1, ..., B48 -> bit15
            bands
                .iter()
                .filter(|&&b| (33..=48).contains(&b)) // 严格限制在 B33-B48
                .map(|&b| 1u16 << (b - 33))
                .sum()
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
                .sum()
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
                .sum()
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
