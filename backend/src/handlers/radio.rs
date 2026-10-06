//! 自 handlers.rs 拆出（纯移动，逻辑未改）。

use super::*;

/// GET /api/radio-mode - 获取当前射频模式
///
/// # 返回
/// ```json
/// {
///   "status": "ok",
///   "message": "Success",
///   "data": {
///     "mode": "auto",
///     "technology_preference": "NR 5G/LTE auto"
///   }
/// }
/// ```
pub async fn get_radio_mode_handler(State(conn): State<Arc<Connection>>) -> impl IntoResponse {
    match get_radio_mode(&conn).await {
        Ok(data) => (
            StatusCode::OK,
            Json(ApiResponse::success_with_message("Success", data)),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<RadioModeResponse>::error(format!(
                "Failed to get radio mode: {}",
                e
            ))),
        ),
    }
}

/// POST /api/radio-mode - 设置射频模式
///
/// # 请求体
/// ```json
/// {
///   "mode": "auto"  // auto | lte | nr
/// }
/// ```
///
/// # 说明
/// - auto: 4G/5G 自动切换
/// - lte: 仅 4G LTE
/// - nr: 仅 5G NR
pub async fn set_radio_mode_handler(
    State(conn): State<Arc<Connection>>,
    Json(payload): Json<RadioModeRequest>,
) -> impl IntoResponse {
    match set_radio_mode(&conn, payload.mode.clone()).await {
        Ok(_) => {
            let mode_str = match payload.mode {
                RadioMode::Auto => "4G/5G Auto",
                RadioMode::LteOnly => "4G LTE Only",
                RadioMode::NrOnly => "5G NR Only",
            };
            (
                StatusCode::OK,
                Json(ApiResponse::success_with_message(
                    format!("Radio mode set to {}", mode_str),
                    json!({}),
                )),
            )
        }
        Err(e) => (
            StatusCode::OK,
            Json(ApiResponse::<serde_json::Value>::error(format!(
                "Failed to set radio mode: {}",
                e
            ))),
        ),
    }
}

/// GET /api/band-lock - 获取当前频段锁定状态
///
/// # 返回
/// ```json
/// {
///   "status": "ok",
///   "message": "Success",
///   "data": {
///     "locked": true,
///     "lte_fdd_bands": [1, 3, 8],
///     "lte_tdd_bands": [38, 40, 41],
///     "nr_fdd_bands": [1, 28],
///     "nr_tdd_bands": [41, 77, 78, 79]
///   }
/// }
/// ```
pub async fn get_band_lock_handler(State(conn): State<Arc<Connection>>) -> impl IntoResponse {
    // 读取 LTE 频段锁定状态
    let lte_result = send_at_command(&conn, "AT+SPLBAND=0").await;
    let (lte_fdd_mask, lte_tdd_mask, lte_raw) = match lte_result {
        Ok(response) => {
            let (fdd, tdd) = parse_splband_lte_response(&response);
            (fdd, tdd, Some(response))
        }
        Err(e) => (0, 0, Some(format!("Error: {}", e))),
    };

    // 读取 NR 频段锁定状态
    let nr_result = send_at_command(&conn, "AT+SPLBAND=3").await;
    let (nr_fdd_mask, nr_tdd_mask, nr_raw) = match nr_result {
        Ok(response) => {
            let (fdd, tdd) = parse_splband_nr_response(&response);
            (fdd, tdd, Some(response))
        }
        Err(e) => (0, 0, Some(format!("Error: {}", e))),
    };

    // UDX710 设备支持的全部频段掩码
    // LTE: FDD=149 (B1+B3+B5+B8), TDD=320 (B39+B41)
    // NR: FDD=517 (N1+N3+N28), TDD=912 (N41+N77+N78+N79)
    const LTE_FDD_ALL: u16 = 149;
    const LTE_TDD_ALL: u16 = 320;
    const NR_FDD_ALL: u16 = 517;
    const NR_TDD_ALL: u16 = 912;

    // 判断是否有频段锁定
    // 如果返回的频段等于设备支持的全部频段，则认为"未锁定"（全部可用）
    // 如果返回 0 或小于全部，则认为"已锁定"（限制了可用频段）
    let lte_is_all_or_zero = (lte_fdd_mask == LTE_FDD_ALL && lte_tdd_mask == LTE_TDD_ALL)
        || (lte_fdd_mask == 0 && lte_tdd_mask == 0);
    let nr_is_all_or_zero = (nr_fdd_mask == NR_FDD_ALL && nr_tdd_mask == NR_TDD_ALL)
        || (nr_fdd_mask == 0 && nr_tdd_mask == 0);
    let locked = !(lte_is_all_or_zero && nr_is_all_or_zero);

    // 将位掩码转换为频段号列表
    // 未锁定时返回空数组（前端显示为"未锁定模式"）
    // 已锁定时返回具体频段列表（前端显示为"自定义锁定模式"）
    let (lte_fdd_bands, lte_tdd_bands, nr_fdd_bands, nr_tdd_bands) = if !locked {
        // 未锁定：返回空数组
        (vec![], vec![], vec![], vec![])
    } else {
        // 已锁定：返回具体频段
        (
            bitmask_to_bands(lte_fdd_mask, 1),  // LTE FDD: B1-B16
            bitmask_to_bands(lte_tdd_mask, 33), // LTE TDD: B33-B48
            bitmask_to_bands(nr_fdd_mask, 100), // NR FDD: 展锐特殊映射
            bitmask_to_bands(nr_tdd_mask, 41),  // NR TDD: 展锐特殊映射
        )
    };

    // 构建调试信息
    let raw_response = Some(format!(
        "LTE(fdd={},tdd={}): {}\nNR(fdd={},tdd={}): {}",
        lte_fdd_mask,
        lte_tdd_mask,
        lte_raw.unwrap_or_default().trim(),
        nr_fdd_mask,
        nr_tdd_mask,
        nr_raw.unwrap_or_default().trim()
    ));

    let status = BandLockStatus {
        locked,
        lte_fdd_bands,
        lte_tdd_bands,
        nr_fdd_bands,
        nr_tdd_bands,
        raw_response,
    };

    (
        StatusCode::OK,
        Json(ApiResponse::success_with_message("Success", status)),
    )
}

/// POST /api/band-lock - 设置频段锁定
///
/// # 请求体
/// ```json
/// {
///   "lte_fdd_bands": [1, 3, 8],
///   "lte_tdd_bands": [38, 40, 41],
///   "nr_fdd_bands": [1, 28],
///   "nr_tdd_bands": [41, 77, 78, 79]
/// }
/// ```
///
/// # 说明
/// - 传入空数组表示不锁定对应类型的频段
/// - 所有数组都为空时，表示解除所有频段锁定
/// - LTE FDD: B1-B16, TDD: B33-B48
/// - NR FDD: N1-N16, TDD: N41-N56 (实际支持 N41-N79)
pub async fn set_band_lock_handler(
    State(conn): State<Arc<Connection>>,
    Json(payload): Json<BandLockRequest>,
) -> impl IntoResponse {
    // LTE 频段锁定
    let lte_fdd_mask = bands_to_bitmask(&payload.lte_fdd_bands, 1);
    let lte_tdd_mask = bands_to_bitmask(&payload.lte_tdd_bands, 33);

    if lte_fdd_mask != 0 || lte_tdd_mask != 0 {
        let lte_cmd = build_splband_lte_command(lte_fdd_mask, lte_tdd_mask);
        if let Err(e) = send_at_command(&conn, &lte_cmd).await {
            return (
                StatusCode::OK,
                Json(ApiResponse::<serde_json::Value>::error(format!(
                    "Failed to set LTE band lock: {}",
                    e
                ))),
            );
        }
    }

    // NR 频段锁定
    let nr_fdd_mask = bands_to_bitmask(&payload.nr_fdd_bands, 100); // NR FDD: 展锐特殊映射
    let nr_tdd_mask = bands_to_bitmask(&payload.nr_tdd_bands, 41); // NR TDD: 展锐特殊映射

    if nr_fdd_mask != 0 || nr_tdd_mask != 0 {
        let nr_cmd = build_splband_nr_command(nr_fdd_mask, nr_tdd_mask);
        if let Err(e) = send_at_command(&conn, &nr_cmd).await {
            return (
                StatusCode::OK,
                Json(ApiResponse::<serde_json::Value>::error(format!(
                    "Failed to set NR band lock: {}",
                    e
                ))),
            );
        }
    }

    // 如果所有频段都为空，则解除锁定
    if payload.lte_fdd_bands.is_empty()
        && payload.lte_tdd_bands.is_empty()
        && payload.nr_fdd_bands.is_empty()
        && payload.nr_tdd_bands.is_empty()
    {
        let mut lte_unlocked = false;
        let mut nr_unlocked = false;

        // 先读取当前 LTE 锁定状态
        let lte_result = send_at_command(&conn, "AT+SPLBAND=0").await;
        if let Ok(lte_response) = lte_result {
            let (lte_fdd_mask, lte_tdd_mask) = parse_splband_lte_response(&lte_response);

            // 只有当前有 LTE 锁定时才执行解锁
            if lte_fdd_mask != 0 || lte_tdd_mask != 0 {
                // 格式: AT+SPLBAND=1,0,<TDD>,0,<FDD>,0 (6 参数)
                if let Err(e) = send_at_command(&conn, "AT+SPLBAND=1,0,0,0,0,0").await {
                    return (
                        StatusCode::OK,
                        Json(ApiResponse::<serde_json::Value>::error(format!(
                            "Failed to unlock LTE bands: {}",
                            e
                        ))),
                    );
                }
                lte_unlocked = true;
            }
        }

        // 先读取当前 NR 锁定状态
        let nr_result = send_at_command(&conn, "AT+SPLBAND=3").await;
        if let Ok(nr_response) = nr_result {
            let (nr_fdd_mask, nr_tdd_mask) = parse_splband_nr_response(&nr_response);

            // 只有当前有 NR 锁定时才执行解锁
            if nr_fdd_mask != 0 || nr_tdd_mask != 0 {
                if let Err(e) = send_at_command(&conn, "AT+SPLBAND=2,0,0,0,0").await {
                    return (
                        StatusCode::OK,
                        Json(ApiResponse::<serde_json::Value>::error(format!(
                            "Failed to unlock NR bands: {}",
                            e
                        ))),
                    );
                }
                nr_unlocked = true;
            }
        }

        // 根据实际执行的解锁操作返回友好的提示信息
        let message = if lte_unlocked || nr_unlocked {
            if lte_unlocked && nr_unlocked {
                "已解除所有频段锁定（LTE + NR）"
            } else if lte_unlocked {
                "已解除 LTE 频段锁定（NR 未锁定）"
            } else {
                "已解除 NR 频段锁定（LTE 未锁定）"
            }
        } else {
            "当前没有锁定的频段，无需解锁"
        };

        return (
            StatusCode::OK,
            Json(ApiResponse::success_with_message(message, json!({}))),
        );
    }

    // 生成友好的提示信息
    let has_lte = lte_fdd_mask != 0 || lte_tdd_mask != 0;
    let has_nr = nr_fdd_mask != 0 || nr_tdd_mask != 0;
    let message = if has_lte && has_nr {
        "已同时锁定 LTE 和 NR 频段"
    } else if has_lte {
        "LTE 频段锁定已应用"
    } else {
        "NR 频段锁定已应用"
    };

    (
        StatusCode::OK,
        Json(ApiResponse::success_with_message(message, json!({}))),
    )
}
