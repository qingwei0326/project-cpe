/*
 * @Author: 1orz cloudorzi@gmail.com
 * @Date: 2025-12-11 17:44:29
 * @LastEditors: 1orz cloudorzi@gmail.com
 * @LastEditTime: 2025-12-13 12:46:04
 * @FilePath: /udx710-backend/backend/src/handlers.rs
 * @Description:
 *
 * Copyright (c) 2025 by 1orz, All Rights Reserved.
 */
//! API 处理器模块
//!
//! 包含所有 HTTP API 的处理函数

use axum::{
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use serde_json::json;
use std::sync::Arc;
use zbus::Connection;

use crate::{
    dbus::{
        get_airplane_mode, get_all_apn_contexts, get_data_connection_status, get_device_info_data,
        get_network_info_data, get_qos_info_data, get_radio_mode, get_roaming_status,
        get_serving_cell_info, get_sim_info_data, send_at_command, set_airplane_mode,
        set_apn_properties, set_data_connection, set_radio_mode, set_roaming_allowed,
    },
    diagnostics,
    iptables::flush_iptables,
    models::*,
    usb_switch,
    utils::{
        bands_to_bitmask, bitmask_to_bands, build_splband_lte_command, build_splband_nr_command,
        format_uptime, get_cell_command_config, parse_at_response_to_2d_vec, parse_neighbor_cells,
        parse_primary_cell, parse_splband_lte_response, parse_splband_nr_response, read_cpu_info,
        read_disk_info, read_memory_info, read_network_interfaces, read_system_info,
        read_system_telemetry, read_uptime,
    },
};
use tokio::process::Command;

// ============ 小区锁定 API ============
// 使用 AT+SPFORCEFRQ 指令实现小区锁定
// 发现来源：通过 dbus-monitor 监听实际锁频操作

use crate::models::{CellLockRatStatus, CellLockStatusResponse};

// ============ 电话相关 API ============

use crate::db::Database;

// ============ 通话记录 API ============

use crate::config::ConfigManager;

use crate::webhook::WebhookSender;

/// 读取温度传感器数据（内部工具函数）
fn read_temperature_sensors() -> Vec<ThermalZone> {
    use std::fs;
    use std::path::Path;

    let thermal_path = Path::new("/sys/class/thermal");
    let mut sensors = Vec::new();

    if let Ok(entries) = fs::read_dir(thermal_path) {
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();

            if name.starts_with("thermal_zone") {
                let zone_path = entry.path();

                let sensor_type = fs::read_to_string(zone_path.join("type"))
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default();

                let temperature = fs::read_to_string(zone_path.join("temp"))
                    .ok()
                    .and_then(|s| s.trim().parse::<i32>().ok())
                    .map(|t| t as f64 / 1000.0)
                    .unwrap_or(0.0);

                sensors.push(ThermalZone {
                    zone: name.to_string(),
                    sensor_type,
                    temperature,
                });
            }
        }
    }

    sensors.sort_by(|a, b| a.zone.cmp(&b.zone));
    sensors
}

/// 获取USB模式名称
fn get_mode_name(mode: Option<u8>) -> String {
    match mode {
        Some(1) => "CDC-NCM".to_string(),
        Some(2) => "CDC-ECM".to_string(),
        Some(3) => "RNDIS".to_string(),
        _ => "Unknown".to_string(),
    }
}

mod calls;
mod cells;
mod common;
mod integrations;
mod network;
mod radio;
mod sms;
mod system;
mod usb;

pub use self::calls::*;
pub use self::cells::*;
pub use self::common::*;
pub use self::integrations::*;
pub use self::network::*;
pub use self::radio::*;
pub use self::sms::*;
pub use self::system::*;
pub use self::usb::*;
