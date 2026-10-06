/*
 * @Author: 1orz cloudorzi@gmail.com
 * @Date: 2025-12-08 13:03:48
 * @LastEditors: 1orz cloudorzi@gmail.com
 * @LastEditTime: 2025-12-13 12:46:00
 * @FilePath: /udx710-backend/backend/src/db.rs
 * @Description:
 *
 * Copyright (c) 2025 by 1orz, All Rights Reserved.
 */
//! 数据库模块
//!
//! 使用 SQLite 存储短信历史记录和通话记录

use chrono::{Datelike, Duration as ChronoDuration, Local, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// 短信记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmsMessage {
    pub id: i64,
    pub direction: String,    // "incoming" 或 "outgoing"
    pub phone_number: String, // 发件人或收件人
    pub content: String,      // 短信内容
    pub timestamp: String,    // ISO 8601 格式时间
    pub status: String,       // "pending", "sent", "failed", "received"
    pub pdu: Option<String>,  // 原始 PDU（如果有）
}

/// 通话记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallRecord {
    pub id: i64,
    pub direction: String,        // "incoming" / "outgoing" / "missed"
    pub phone_number: String,     // 电话号码
    pub duration: i64,            // 通话时长（秒）
    pub start_time: String,       // 开始时间 ISO 8601
    pub end_time: Option<String>, // 结束时间 ISO 8601
    pub answered: bool,           // 是否接通
}

/// 短信统计
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct SmsStats {
    pub total: i64,
    pub incoming: i64,
    pub outgoing: i64,
}

/// 通话统计
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct CallStats {
    pub total: i64,
    pub incoming: i64,
    pub outgoing: i64,
    pub missed: i64,
    pub total_duration: i64, // 总通话时长（秒）
}

/// Traffic accumulated for one local calendar period.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrafficUsagePeriod {
    /// Date (`YYYY-MM-DD`) or month (`YYYY-MM`).
    pub period: String,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub total_bytes: u64,
    pub samples: u64,
}

/// Daily and monthly traffic usage response.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrafficUsageResponse {
    /// WAN interface used as the accounting source.
    pub interface: String,
    pub generated_at: String,
    pub current_rx_bytes: u64,
    pub current_tx_bytes: u64,
    pub last_sample_at: Option<String>,
    /// Earliest sample retained for this interface.
    pub coverage_start: Option<String>,
    pub today: TrafficUsagePeriod,
    pub current_month: TrafficUsagePeriod,
    /// Chronological daily series, including zero-traffic days.
    pub daily: Vec<TrafficUsagePeriod>,
    /// Chronological monthly series, including zero-traffic months.
    pub monthly: Vec<TrafficUsagePeriod>,
}

/// Result of comparing a new kernel counter sample with the previous sample.
#[derive(Debug, Clone, Copy, Default)]
pub struct TrafficSampleResult {
    pub rx_delta: u64,
    pub tx_delta: u64,
    pub counter_reset: bool,
}

/// 数据库管理器
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// 创建或打开数据库
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(db_path)?;

        // 创建短信表（如果不存在）
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sms_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                direction TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                status TEXT NOT NULL,
                pdu TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // 创建短信索引
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sms_timestamp ON sms_messages(timestamp DESC)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sms_phone ON sms_messages(phone_number)",
            [],
        )?;

        // 创建通话记录表（如果不存在）
        conn.execute(
            "CREATE TABLE IF NOT EXISTS call_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                direction TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                duration INTEGER DEFAULT 0,
                start_time TEXT NOT NULL,
                end_time TEXT,
                answered INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // 创建通话记录索引
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_call_start_time ON call_history(start_time DESC)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_call_phone ON call_history(phone_number)",
            [],
        )?;

        // Traffic is sampled at a low frequency and aggregated by local day.
        // The separate counter table lets us calculate deltas safely across
        // service restarts and kernel counter resets.
        conn.execute(
            "CREATE TABLE IF NOT EXISTS traffic_usage_daily (
                interface TEXT NOT NULL,
                period_date TEXT NOT NULL,
                rx_bytes INTEGER NOT NULL DEFAULT 0,
                tx_bytes INTEGER NOT NULL DEFAULT 0,
                samples INTEGER NOT NULL DEFAULT 0,
                first_sample_at TEXT,
                last_sample_at TEXT NOT NULL,
                PRIMARY KEY (interface, period_date)
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_traffic_usage_date
             ON traffic_usage_daily(interface, period_date DESC)",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS traffic_counter_state (
                interface TEXT PRIMARY KEY,
                rx_bytes INTEGER NOT NULL,
                tx_bytes INTEGER NOT NULL,
                sampled_at TEXT NOT NULL
            )",
            [],
        )?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    // ==================== 短信相关方法 ====================

    /// 插入新短信
    pub fn insert_sms(
        &self,
        direction: &str,
        phone_number: &str,
        content: &str,
        status: &str,
        pdu: Option<&str>,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let timestamp = Local::now().to_rfc3339();

        conn.execute(
            "INSERT INTO sms_messages (direction, phone_number, content, timestamp, status, pdu)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![direction, phone_number, content, timestamp, status, pdu],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// 判断短时间内是否已收到同一条短信，用于过滤 D-Bus 重复通知
    pub fn has_recent_sms_duplicate(
        &self,
        direction: &str,
        phone_number: &str,
        content: &str,
        status: &str,
        window_seconds: i64,
    ) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let window = format!("-{} seconds", window_seconds.max(1));

        let count: i64 = conn.query_row(
            "SELECT COUNT(1)
             FROM sms_messages
             WHERE direction = ?1
               AND phone_number = ?2
               AND content = ?3
               AND status = ?4
               AND created_at >= datetime('now', ?5)
             LIMIT 1",
            params![direction, phone_number, content, status, window],
            |row| row.get(0),
        )?;

        Ok(count > 0)
    }

    /// 更新短信状态
    #[allow(dead_code)]
    pub fn update_sms_status(&self, id: i64, status: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sms_messages SET status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        Ok(())
    }

    /// 获取所有短信（分页）
    pub fn get_sms_messages(&self, limit: i64, offset: i64) -> Result<Vec<SmsMessage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, direction, phone_number, content, timestamp, status, pdu
             FROM sms_messages
             ORDER BY timestamp DESC
             LIMIT ?1 OFFSET ?2",
        )?;

        let messages = stmt.query_map(params![limit, offset], |row| {
            Ok(SmsMessage {
                id: row.get(0)?,
                direction: row.get(1)?,
                phone_number: row.get(2)?,
                content: row.get(3)?,
                timestamp: row.get(4)?,
                status: row.get(5)?,
                pdu: row.get(6)?,
            })
        })?;

        let mut result = Vec::new();
        for message in messages {
            result.push(message?);
        }

        Ok(result)
    }

    /// 获取与特定号码的对话历史
    pub fn get_sms_conversation(&self, phone_number: &str, limit: i64) -> Result<Vec<SmsMessage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, direction, phone_number, content, timestamp, status, pdu
             FROM sms_messages
             WHERE phone_number = ?1
             ORDER BY timestamp DESC
             LIMIT ?2",
        )?;

        let messages = stmt.query_map(params![phone_number, limit], |row| {
            Ok(SmsMessage {
                id: row.get(0)?,
                direction: row.get(1)?,
                phone_number: row.get(2)?,
                content: row.get(3)?,
                timestamp: row.get(4)?,
                status: row.get(5)?,
                pdu: row.get(6)?,
            })
        })?;

        let mut result = Vec::new();
        for message in messages {
            result.push(message?);
        }

        Ok(result)
    }

    /// 获取短信统计
    pub fn get_sms_stats(&self) -> Result<SmsStats> {
        let conn = self.conn.lock().unwrap();

        let total: i64 =
            conn.query_row("SELECT COUNT(*) FROM sms_messages", [], |row| row.get(0))?;

        let incoming: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sms_messages WHERE direction = 'incoming'",
            [],
            |row| row.get(0),
        )?;

        let outgoing: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sms_messages WHERE direction = 'outgoing'",
            [],
            |row| row.get(0),
        )?;

        Ok(SmsStats {
            total,
            incoming,
            outgoing,
        })
    }

    /// 删除旧短信（保留最近 N 条）
    #[allow(dead_code)]
    pub fn cleanup_old_sms(&self, keep_count: i64) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let deleted = conn.execute(
            "DELETE FROM sms_messages WHERE id NOT IN (
                SELECT id FROM sms_messages ORDER BY timestamp DESC LIMIT ?1
            )",
            params![keep_count],
        )?;
        Ok(deleted)
    }

    /// 删除所有短信
    pub fn clear_all_sms(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM sms_messages", [])?;
        Ok(())
    }

    // ==================== 通话记录相关方法 ====================

    /// 插入新通话记录
    pub fn insert_call(&self, direction: &str, phone_number: &str, answered: bool) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let start_time = Local::now().to_rfc3339();

        conn.execute(
            "INSERT INTO call_history (direction, phone_number, duration, start_time, answered)
             VALUES (?1, ?2, 0, ?3, ?4)",
            params![direction, phone_number, start_time, answered as i32],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// 更新通话记录（通话结束时调用）
    pub fn update_call_end(&self, id: i64, duration: i64, answered: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let end_time = Local::now().to_rfc3339();

        conn.execute(
            "UPDATE call_history SET duration = ?1, end_time = ?2, answered = ?3 WHERE id = ?4",
            params![duration, end_time, answered as i32, id],
        )?;
        Ok(())
    }

    /// 标记通话为未接来电
    pub fn mark_call_missed(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let end_time = Local::now().to_rfc3339();

        conn.execute(
            "UPDATE call_history SET direction = 'missed', end_time = ?1, answered = 0 WHERE id = ?2",
            params![end_time, id],
        )?;
        Ok(())
    }

    /// 获取通话记录（分页）
    pub fn get_call_history(&self, limit: i64, offset: i64) -> Result<Vec<CallRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, direction, phone_number, duration, start_time, end_time, answered
             FROM call_history
             ORDER BY start_time DESC
             LIMIT ?1 OFFSET ?2",
        )?;

        let records = stmt.query_map(params![limit, offset], |row| {
            Ok(CallRecord {
                id: row.get(0)?,
                direction: row.get(1)?,
                phone_number: row.get(2)?,
                duration: row.get(3)?,
                start_time: row.get(4)?,
                end_time: row.get(5)?,
                answered: row.get::<_, i32>(6)? != 0,
            })
        })?;

        let mut result = Vec::new();
        for record in records {
            result.push(record?);
        }

        Ok(result)
    }

    /// 获取与特定号码的通话记录
    #[allow(dead_code)]
    pub fn get_call_history_by_number(
        &self,
        phone_number: &str,
        limit: i64,
    ) -> Result<Vec<CallRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, direction, phone_number, duration, start_time, end_time, answered
             FROM call_history
             WHERE phone_number = ?1
             ORDER BY start_time DESC
             LIMIT ?2",
        )?;

        let records = stmt.query_map(params![phone_number, limit], |row| {
            Ok(CallRecord {
                id: row.get(0)?,
                direction: row.get(1)?,
                phone_number: row.get(2)?,
                duration: row.get(3)?,
                start_time: row.get(4)?,
                end_time: row.get(5)?,
                answered: row.get::<_, i32>(6)? != 0,
            })
        })?;

        let mut result = Vec::new();
        for record in records {
            result.push(record?);
        }

        Ok(result)
    }

    /// 获取通话统计
    pub fn get_call_stats(&self) -> Result<CallStats> {
        let conn = self.conn.lock().unwrap();

        let total: i64 =
            conn.query_row("SELECT COUNT(*) FROM call_history", [], |row| row.get(0))?;

        let incoming: i64 = conn.query_row(
            "SELECT COUNT(*) FROM call_history WHERE direction = 'incoming'",
            [],
            |row| row.get(0),
        )?;

        let outgoing: i64 = conn.query_row(
            "SELECT COUNT(*) FROM call_history WHERE direction = 'outgoing'",
            [],
            |row| row.get(0),
        )?;

        let missed: i64 = conn.query_row(
            "SELECT COUNT(*) FROM call_history WHERE direction = 'missed'",
            [],
            |row| row.get(0),
        )?;

        let total_duration: i64 = conn.query_row(
            "SELECT COALESCE(SUM(duration), 0) FROM call_history WHERE answered = 1",
            [],
            |row| row.get(0),
        )?;

        Ok(CallStats {
            total,
            incoming,
            outgoing,
            missed,
            total_duration,
        })
    }

    /// 删除单条通话记录
    pub fn delete_call(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM call_history WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// 删除所有通话记录
    pub fn clear_all_calls(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM call_history", [])?;
        Ok(())
    }

    // ==================== 流量统计相关方法 ====================

    /// Record one cumulative kernel counter sample.
    ///
    /// Only the delta from the previous sample is added to the daily bucket.
    /// A decreasing counter is treated as a reboot/driver reset and starts a
    /// new baseline instead of creating a huge false usage spike.
    pub fn record_traffic_sample(
        &self,
        interface: &str,
        rx_bytes: u64,
        tx_bytes: u64,
    ) -> Result<TrafficSampleResult> {
        let now = Local::now();
        let sampled_at = now.to_rfc3339();
        let period_date = now.date_naive().format("%Y-%m-%d").to_string();
        let rx_value = i64::try_from(rx_bytes).unwrap_or(i64::MAX);
        let tx_value = i64::try_from(tx_bytes).unwrap_or(i64::MAX);

        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let previous: Option<(i64, i64)> = tx
            .query_row(
                "SELECT rx_bytes, tx_bytes
                 FROM traffic_counter_state
                 WHERE interface = ?1",
                params![interface],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;

        let (rx_delta, tx_delta, counter_reset) = match previous {
            Some((previous_rx, previous_tx))
                if rx_value >= previous_rx && tx_value >= previous_tx =>
            {
                (
                    (rx_value - previous_rx) as u64,
                    (tx_value - previous_tx) as u64,
                    false,
                )
            }
            Some(_) => (0, 0, true),
            None => (0, 0, false),
        };

        tx.execute(
            "INSERT INTO traffic_usage_daily
                (interface, period_date, rx_bytes, tx_bytes, samples, first_sample_at, last_sample_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
             ON CONFLICT(interface, period_date) DO UPDATE SET
                rx_bytes = traffic_usage_daily.rx_bytes + excluded.rx_bytes,
                tx_bytes = traffic_usage_daily.tx_bytes + excluded.tx_bytes,
                samples = traffic_usage_daily.samples + 1,
                first_sample_at = COALESCE(traffic_usage_daily.first_sample_at, excluded.first_sample_at),
                last_sample_at = excluded.last_sample_at",
            params![
                interface,
                period_date,
                i64::try_from(rx_delta).unwrap_or(i64::MAX),
                i64::try_from(tx_delta).unwrap_or(i64::MAX),
                sampled_at,
            ],
        )?;

        tx.execute(
            "INSERT INTO traffic_counter_state(interface, rx_bytes, tx_bytes, sampled_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(interface) DO UPDATE SET
                rx_bytes = excluded.rx_bytes,
                tx_bytes = excluded.tx_bytes,
                sampled_at = excluded.sampled_at",
            params![interface, rx_value, tx_value, sampled_at],
        )?;

        // Keep the database bounded while retaining more than a year of daily
        // history for the UI.  A row is only a few dozen bytes.
        let cutoff = (now.date_naive() - ChronoDuration::days(400))
            .format("%Y-%m-%d")
            .to_string();
        tx.execute(
            "DELETE FROM traffic_usage_daily WHERE period_date < ?1",
            params![cutoff],
        )?;
        tx.commit()?;

        Ok(TrafficSampleResult {
            rx_delta,
            tx_delta,
            counter_reset,
        })
    }

    /// Read daily and monthly usage for one modem-facing interface.
    pub fn get_traffic_usage(
        &self,
        interface: &str,
        days: u32,
        months: u32,
    ) -> Result<TrafficUsageResponse> {
        let day_count = days.clamp(1, 366);
        let month_count = months.clamp(1, 24);
        let now = Local::now();
        let today_date = now.date_naive();
        let day_start = today_date - ChronoDuration::days((day_count - 1) as i64);
        let month_start = shift_month(today_date, (month_count - 1) as i32);
        let day_start_text = day_start.format("%Y-%m-%d").to_string();
        let month_start_text = month_start.format("%Y-%m-%d").to_string();

        let conn = self.conn.lock().unwrap();
        let current_counter: Option<(i64, i64, String)> = conn
            .query_row(
                "SELECT rx_bytes, tx_bytes, sampled_at
                 FROM traffic_counter_state
                 WHERE interface = ?1",
                params![interface],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;

        let coverage_start: Option<String> = conn.query_row(
            "SELECT MIN(first_sample_at)
             FROM traffic_usage_daily
             WHERE interface = ?1",
            params![interface],
            |row| row.get(0),
        )?;

        let mut daily_by_period = HashMap::new();
        let mut daily_stmt = conn.prepare(
            "SELECT period_date, rx_bytes, tx_bytes, samples
             FROM traffic_usage_daily
             WHERE interface = ?1 AND period_date >= ?2
             ORDER BY period_date ASC",
        )?;
        let daily_rows = daily_stmt.query_map(params![interface, day_start_text], |row| {
            let period: String = row.get(0)?;
            let rx_bytes: i64 = row.get(1)?;
            let tx_bytes: i64 = row.get(2)?;
            let samples: i64 = row.get(3)?;
            Ok(TrafficUsagePeriod {
                period,
                rx_bytes: non_negative_u64(rx_bytes),
                tx_bytes: non_negative_u64(tx_bytes),
                total_bytes: non_negative_u64(rx_bytes.saturating_add(tx_bytes)),
                samples: non_negative_u64(samples),
            })
        })?;
        for row in daily_rows {
            let period = row?;
            daily_by_period.insert(period.period.clone(), period);
        }

        let mut monthly_by_period = HashMap::new();
        let mut monthly_stmt = conn.prepare(
            "SELECT substr(period_date, 1, 7),
                    COALESCE(SUM(rx_bytes), 0),
                    COALESCE(SUM(tx_bytes), 0),
                    COALESCE(SUM(samples), 0)
             FROM traffic_usage_daily
             WHERE interface = ?1 AND period_date >= ?2
             GROUP BY substr(period_date, 1, 7)
             ORDER BY substr(period_date, 1, 7) ASC",
        )?;
        let monthly_rows = monthly_stmt.query_map(params![interface, month_start_text], |row| {
            let period: String = row.get(0)?;
            let rx_bytes: i64 = row.get(1)?;
            let tx_bytes: i64 = row.get(2)?;
            let samples: i64 = row.get(3)?;
            Ok(TrafficUsagePeriod {
                period,
                rx_bytes: non_negative_u64(rx_bytes),
                tx_bytes: non_negative_u64(tx_bytes),
                total_bytes: non_negative_u64(rx_bytes.saturating_add(tx_bytes)),
                samples: non_negative_u64(samples),
            })
        })?;
        for row in monthly_rows {
            let period = row?;
            monthly_by_period.insert(period.period.clone(), period);
        }

        let mut daily = Vec::with_capacity(day_count as usize);
        for offset in (0..day_count).rev() {
            let date = today_date - ChronoDuration::days(offset as i64);
            let period = date.format("%Y-%m-%d").to_string();
            daily.push(
                daily_by_period
                    .remove(&period)
                    .unwrap_or_else(|| empty_usage_period(period)),
            );
        }

        let mut monthly = Vec::with_capacity(month_count as usize);
        for offset in (0..month_count).rev() {
            let date = shift_month(today_date, offset as i32);
            let period = date.format("%Y-%m").to_string();
            monthly.push(
                monthly_by_period
                    .remove(&period)
                    .unwrap_or_else(|| empty_usage_period(period)),
            );
        }

        let today_period = daily
            .last()
            .cloned()
            .unwrap_or_else(|| empty_usage_period(today_date.format("%Y-%m-%d").to_string()));
        let current_month_period = monthly
            .last()
            .cloned()
            .unwrap_or_else(|| empty_usage_period(today_date.format("%Y-%m").to_string()));
        let (current_rx_bytes, current_tx_bytes, last_sample_at) = current_counter
            .map(|(rx, tx, sampled_at)| {
                (non_negative_u64(rx), non_negative_u64(tx), Some(sampled_at))
            })
            .unwrap_or((0, 0, None));

        Ok(TrafficUsageResponse {
            interface: interface.to_string(),
            generated_at: now.to_rfc3339(),
            current_rx_bytes,
            current_tx_bytes,
            last_sample_at,
            coverage_start,
            today: today_period,
            current_month: current_month_period,
            daily,
            monthly,
        })
    }
}

fn non_negative_u64(value: i64) -> u64 {
    value.max(0) as u64
}

fn empty_usage_period(period: String) -> TrafficUsagePeriod {
    TrafficUsagePeriod {
        period,
        ..TrafficUsagePeriod::default()
    }
}

/// Return the first day of the month `months_back` before `date`.
fn shift_month(date: NaiveDate, months_back: i32) -> NaiveDate {
    let month_index = date.year() * 12 + date.month0() as i32 - months_back;
    let year = month_index.div_euclid(12);
    let month0 = month_index.rem_euclid(12) as u32;
    NaiveDate::from_ymd_opt(year, month0 + 1, 1).expect("valid month offset")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn traffic_samples_accumulate_and_handle_counter_reset() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock is after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("udx710-traffic-{suffix}.db"));
        let database = Database::new(path.clone()).expect("create test database");

        let first = database
            .record_traffic_sample("sipa_eth0", 100, 50)
            .expect("record first sample");
        assert_eq!(first.rx_delta, 0);
        assert_eq!(first.tx_delta, 0);

        let second = database
            .record_traffic_sample("sipa_eth0", 250, 90)
            .expect("record second sample");
        assert_eq!(second.rx_delta, 150);
        assert_eq!(second.tx_delta, 40);

        let usage = database
            .get_traffic_usage("sipa_eth0", 7, 2)
            .expect("read traffic usage");
        assert_eq!(usage.today.rx_bytes, 150);
        assert_eq!(usage.today.tx_bytes, 40);
        assert_eq!(usage.today.total_bytes, 190);
        assert_eq!(usage.current_month.total_bytes, 190);
        assert_eq!(usage.daily.len(), 7);
        assert_eq!(usage.monthly.len(), 2);

        let reset = database
            .record_traffic_sample("sipa_eth0", 10, 10)
            .expect("record reset sample");
        assert!(reset.counter_reset);
        assert_eq!(reset.rx_delta, 0);
        assert_eq!(reset.tx_delta, 0);

        drop(database);
        let _ = std::fs::remove_file(path);
    }
}
