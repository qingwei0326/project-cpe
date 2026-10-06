/*
 * @Author: 1orz cloudorzi@gmail.com
 * @Date: 2025-12-11 17:44:29
 * @LastEditors: 1orz cloudorzi@gmail.com
 * @LastEditTime: 2025-12-13 12:46:21
 * @FilePath: /udx710-backend/backend/src/utils.rs
 * @Description:
 *
 * Copyright (c) 2025 by 1orz, All Rights Reserved.
 */
//! 工具函数模块
//!
//! 包含 AT 指令解析、数据处理等工具函数

use crate::models::{CaStatus, CellInfo, IpAddress, NetworkInterfaceInfo};
use crate::sync::MutexExt;

use std::collections::HashMap;

use std::net::IpAddr;

mod bands;
mod cellular;
mod interfaces;
mod system;

pub use self::bands::*;
pub use self::cellular::*;
pub use self::interfaces::*;
pub use self::system::*;
