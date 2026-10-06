//! Persistent WAN traffic accounting.
//!
//! Linux interface counters are cumulative since boot and are therefore useful
//! for a low-overhead usage counter.  The collector stores only deltas once per
//! minute, so the database contains one row per interface and local calendar
//! day instead of one row per telemetry tick.

use std::fs;
use std::sync::Arc;

use tokio::time::{sleep, Duration};
use tracing::{debug, warn};

use crate::db::Database;
use crate::utils::read_interface_stats;

/// The modem-facing interface carries subscriber traffic.  `usb0` is the
/// management/tethering side and must not be counted a second time.
const INTERFACE_CANDIDATES: &[&str] = &[
    "sipa_eth0",
    "sipa_eth1",
    "wwan0",
    "rmnet_data0",
    "rmnet0",
    "eth1",
];

/// Select the first usable modem/WAN interface.
pub fn read_data_interface_stats() -> Result<(String, u64, u64), String> {
    for interface in INTERFACE_CANDIDATES {
        let operstate = fs::read_to_string(format!("/sys/class/net/{interface}/operstate"))
            .map(|value| value.trim().to_ascii_lowercase())
            .unwrap_or_default();
        if operstate != "up" && operstate != "unknown" {
            continue;
        }
        if let Ok((rx_bytes, tx_bytes)) = read_interface_stats(interface) {
            return Ok(((*interface).to_string(), rx_bytes, tx_bytes));
        }
    }

    Err("No active modem data interface found".to_string())
}

/// Run the low-frequency traffic recorder.
pub async fn run_collector(database: Arc<Database>, interval_secs: u64) {
    let interval_secs = interval_secs.max(30);

    loop {
        let sample = tokio::task::spawn_blocking(read_data_interface_stats).await;
        match sample {
            Ok(Ok((interface, rx_bytes, tx_bytes))) => {
                match database.record_traffic_sample(&interface, rx_bytes, tx_bytes) {
                    Ok(result) => {
                        if result.counter_reset {
                            debug!(
                                interface = %interface,
                                "Traffic counter reset detected; starting a new baseline"
                            );
                        }
                    }
                    Err(error) => {
                        warn!(%error, interface = %interface, "Traffic usage sample failed")
                    }
                }
            }
            Ok(Err(error)) => debug!(%error, "Traffic interface sample unavailable"),
            Err(error) => warn!(%error, "Traffic interface sampling task failed"),
        }

        sleep(Duration::from_secs(interval_secs)).await;
    }
}
