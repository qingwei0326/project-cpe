/*
 * @Author: 1orz cloudorzi@gmail.com
 * @Date: 2025-12-10 09:19:05
 * @LastEditors: 1orz cloudorzi@gmail.com
 * @LastEditTime: 2025-12-13 12:46:02
 * @FilePath: /udx710-backend/backend/src/dbus.rs
 * @Description:
 *
 * Copyright (c) 2025 by 1orz, All Rights Reserved.
 */
//! D-Bus 通信模块
//!
//! 处理与 ofono D-Bus 服务的通信

use std::collections::HashMap;
use tracing::{info, warn};
use zbus::{proxy, zvariant::OwnedValue, Connection, Proxy};

use crate::connectivity::{
    both_paths_failed_at, check_connectivity, check_transport, downlink_mbps, effective_ipv4_ok_at,
    effective_ipv6_ok_at, interface_path_snapshot, link_is_busy, InterfacePathSnapshot,
};
use crate::diagnostics;
use crate::models::{
    AirplaneModeResponse, ApnContext, ConnectivityCheckResponse, DeviceInfoResponse,
    NetworkInfoResponse, QosInfoResponse, RadioMode, RadioModeResponse, ServingCell,
    SimInfoResponse,
};
use crate::serial::with_serial;

// ============ 电话相关 D-Bus 接口 ============

use crate::models::CallInfo;

// ============ 新增功能接口 ============

use crate::models::{
    CallForwardingResponse, CallSettingsResponse, CallVolumeResponse, ImeisvResponse,
    ImsStatusResponse, NitzTimeResponse, OperatorInfo, OperatorListResponse,
    SignalStrengthResponse, VoicemailStatusResponse,
};

// ============ SIM 卡槽功能 ============

use crate::models::SimSlotResponse;

/// ofono NetworkMonitor 代理接口
#[proxy(
    interface = "org.ofono.NetworkMonitor",
    default_service = "org.ofono",
    default_path = "/ril_0",
    assume_defaults = true
)]
pub trait NetworkMonitor {
    /// 获取服务小区信息
    fn get_serving_cell_information(
        &self,
    ) -> zbus::Result<HashMap<String, zbus::zvariant::OwnedValue>>;
}

/// ofono ConnectionContext 代理接口
#[proxy(
    interface = "org.ofono.ConnectionContext",
    default_service = "org.ofono",
    default_path = "/ril_0/context2",
    assume_defaults = true
)]
pub trait ConnectionContext {
    /// 获取连接上下文的所有属性
    fn get_properties(&self) -> zbus::Result<HashMap<String, zbus::zvariant::OwnedValue>>;

    /// 设置连接上下文的属性
    fn set_property(&self, name: &str, value: zbus::zvariant::Value<'_>) -> zbus::Result<()>;
}

/// ofono SimManager 代理接口
#[proxy(
    interface = "org.ofono.SimManager",
    default_service = "org.ofono",
    default_path = "/ril_0",
    assume_defaults = true
)]
pub trait SimManager {
    /// 获取SIM卡所有属性
    fn get_properties(&self) -> zbus::Result<HashMap<String, zbus::zvariant::OwnedValue>>;
}

/// ofono MessageManager 代理接口
#[proxy(
    interface = "org.ofono.MessageManager",
    default_service = "org.ofono",
    default_path = "/ril_0",
    assume_defaults = true
)]
pub trait MessageManager {
    /// 获取消息管理器所有属性
    fn get_properties(&self) -> zbus::Result<HashMap<String, zbus::zvariant::OwnedValue>>;
}

/// ofono NetworkRegistration 代理接口
#[proxy(
    interface = "org.ofono.NetworkRegistration",
    default_service = "org.ofono",
    default_path = "/ril_0",
    assume_defaults = true
)]
pub trait NetworkRegistration {
    /// 获取网络注册所有属性
    fn get_properties(&self) -> zbus::Result<HashMap<String, zbus::zvariant::OwnedValue>>;
}

/// ofono RadioSettings 代理接口
#[proxy(
    interface = "org.ofono.RadioSettings",
    default_service = "org.ofono",
    default_path = "/ril_0",
    assume_defaults = true
)]
pub trait RadioSettings {
    /// 获取无线设置所有属性
    fn get_properties(&self) -> zbus::Result<HashMap<String, zbus::zvariant::OwnedValue>>;

    /// 设置无线设置属性
    fn set_property(&self, name: &str, value: zbus::zvariant::Value<'_>) -> zbus::Result<()>;
}

/// ofono Modem 代理接口
#[proxy(
    interface = "org.ofono.Modem",
    default_service = "org.ofono",
    default_path = "/ril_0",
    assume_defaults = true
)]
pub trait Modem {
    /// 获取调制解调器所有属性
    fn get_properties(&self) -> zbus::Result<HashMap<String, zbus::zvariant::OwnedValue>>;

    /// 设置调制解调器属性
    fn set_property(&self, name: &str, value: zbus::zvariant::Value<'_>) -> zbus::Result<()>;
}

fn compact_log_value(value: &str, max_chars: usize) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

/// ofono VoiceCallManager 代理接口
#[proxy(
    interface = "org.ofono.VoiceCallManager",
    default_service = "org.ofono",
    default_path = "/ril_0",
    assume_defaults = true
)]
pub trait VoiceCallManager {
    /// 获取所有通话
    fn get_calls(
        &self,
    ) -> zbus::Result<Vec<(zbus::zvariant::OwnedObjectPath, HashMap<String, OwnedValue>)>>;

    /// 拨打电话
    fn dial(
        &self,
        number: &str,
        hide_callerid: &str,
    ) -> zbus::Result<zbus::zvariant::OwnedObjectPath>;

    /// 挂断所有通话
    fn hangup_all(&self) -> zbus::Result<()>;
}

/// ofono VoiceCall 代理接口（单个通话）
#[proxy(
    interface = "org.ofono.VoiceCall",
    default_service = "org.ofono",
    assume_defaults = true
)]
pub trait VoiceCall {
    /// 挂断此通话
    fn hangup(&self) -> zbus::Result<()>;

    /// 接听来电
    fn answer(&self) -> zbus::Result<()>;

    /// 获取通话属性
    fn get_properties(&self) -> zbus::Result<HashMap<String, OwnedValue>>;
}

mod modem;
mod network;
mod qos;
mod telephony;
mod watchdog;

pub use self::modem::*;
pub use self::network::*;
pub use self::qos::*;
pub use self::telephony::*;
pub use self::watchdog::*;
