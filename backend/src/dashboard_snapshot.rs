//! Independently cached dashboard sampling.
//!
//! The dashboard combines slow modem properties and local telemetry.  Keeping
//! a cache per section means a transient D-Bus or probe failure does not erase
//! the last useful value, while the mutex around each entry coalesces matching
//! requests into one modem/AT sample.

use std::{collections::BTreeMap, sync::Arc, time::Duration};

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use zbus::Connection;

use crate::{
    connectivity,
    db::Database,
    dbus::{
        get_airplane_mode, get_data_connection_status, get_device_info_data, get_ims_status,
        get_network_info_data, get_qos_info_data, get_roaming_status, get_sim_info_data,
    },
    handlers::{get_cells_snapshot, get_system_stats_data},
    models::{
        ApiResponse, DashboardSectionFreshness, DashboardSnapshotData, DashboardSnapshotError,
        DashboardSnapshotSections,
    },
    traffic,
};

#[derive(Debug, Clone)]
struct CachedSection {
    value: Value,
    sampled_at: String,
    updated: std::time::Instant,
}

#[derive(Debug, Default)]
pub struct DashboardSnapshotCache {
    entries: Mutex<BTreeMap<&'static str, Arc<Mutex<Option<CachedSection>>>>>,
}

#[derive(Debug)]
struct SectionResult {
    value: Option<Value>,
    freshness: DashboardSectionFreshness,
    error: Option<String>,
}

impl DashboardSnapshotCache {
    async fn fetch<F, Fut>(&self, section: &'static str, ttl: Duration, fetcher: F) -> SectionResult
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Value, String>>,
    {
        let entry = {
            let mut entries = self.entries.lock().await;
            entries
                .entry(section)
                .or_insert_with(|| Arc::new(Mutex::new(None)))
                .clone()
        };

        // This lock intentionally spans the producer call. It is per section,
        // so unrelated sections still sample concurrently, while an identical
        // section never overlaps a D-Bus or AT operation.
        let mut cached_entry = entry.lock().await;
        if let Some(cached) = cached_entry.as_ref() {
            if cached.updated.elapsed() < ttl {
                return SectionResult {
                    value: Some(cached.value.clone()),
                    freshness: DashboardSectionFreshness {
                        state: "fresh".to_string(),
                        sampled_at: Some(cached.sampled_at.clone()),
                        age_seconds: Some(cached.updated.elapsed().as_secs()),
                    },
                    error: None,
                };
            }
        }

        match fetcher().await {
            Ok(value) => {
                let sampled_at = utc_timestamp();
                *cached_entry = Some(CachedSection {
                    value: value.clone(),
                    sampled_at: sampled_at.clone(),
                    updated: std::time::Instant::now(),
                });
                SectionResult {
                    value: Some(value),
                    freshness: DashboardSectionFreshness {
                        state: "fresh".to_string(),
                        sampled_at: Some(sampled_at),
                        age_seconds: Some(0),
                    },
                    error: None,
                }
            }
            Err(error) => match cached_entry.as_ref() {
                Some(cached) => SectionResult {
                    value: Some(cached.value.clone()),
                    freshness: DashboardSectionFreshness {
                        state: "stale".to_string(),
                        sampled_at: Some(cached.sampled_at.clone()),
                        age_seconds: Some(cached.updated.elapsed().as_secs()),
                    },
                    error: Some(error),
                },
                None => SectionResult {
                    value: None,
                    freshness: DashboardSectionFreshness {
                        state: "unavailable".to_string(),
                        sampled_at: None,
                        age_seconds: None,
                    },
                    error: Some(error),
                },
            },
        }
    }
}

fn utc_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn value<T: serde::Serialize>(data: T) -> Result<Value, String> {
    serde_json::to_value(data)
        .map_err(|error| format!("Failed to serialize dashboard section: {error}"))
}

/// GET /api/dashboard/snapshot
pub async fn get_dashboard_snapshot(
    State(conn): State<Arc<Connection>>,
    State(db): State<Arc<Database>>,
    State(cache): State<Arc<DashboardSnapshotCache>>,
) -> impl IntoResponse {
    let device_conn = Arc::clone(&conn);
    let sim_conn = Arc::clone(&conn);
    let network_conn = Arc::clone(&conn);
    let cells_conn = Arc::clone(&conn);
    let qos_conn = Arc::clone(&conn);
    let data_conn = Arc::clone(&conn);
    let roaming_conn = Arc::clone(&conn);
    let airplane_conn = Arc::clone(&conn);
    let ims_conn = Arc::clone(&conn);

    let (device, sim, network, cells, qos, data, roaming, airplane_mode, ims, connectivity, stats, traffic) = tokio::join!(
        cache.fetch("device", Duration::from_secs(300), move || async move { value(get_device_info_data(&device_conn).await.map_err(|e| e.to_string())?) }),
        cache.fetch("sim", Duration::from_secs(300), move || async move { value(get_sim_info_data(&sim_conn).await.map_err(|e| e.to_string())?) }),
        cache.fetch("network", Duration::from_secs(30), move || async move { value(get_network_info_data(&network_conn).await.map_err(|e| e.to_string())?) }),
        cache.fetch("cells", Duration::from_secs(60), move || async move { value(get_cells_snapshot(&cells_conn, false).await?) }),
        cache.fetch("qos", Duration::from_secs(30), move || async move { value(get_qos_info_data(&qos_conn).await.map_err(|e| e.to_string())?) }),
        cache.fetch("data", Duration::from_secs(30), move || async move { value(json!({ "active": get_data_connection_status(&data_conn).await.map_err(|e| e.to_string())? })) }),
        cache.fetch("roaming", Duration::from_secs(30), move || async move { let (roaming_allowed, is_roaming) = get_roaming_status(&roaming_conn).await.map_err(|e| e.to_string())?; value(json!({ "roaming_allowed": roaming_allowed, "is_roaming": is_roaming })) }),
        cache.fetch("airplane_mode", Duration::from_secs(30), move || async move { value(get_airplane_mode(&airplane_conn).await.map_err(|e| e.to_string())?) }),
        cache.fetch("ims", Duration::from_secs(30), move || async move { value(get_ims_status(&ims_conn).await.map_err(|e| e.to_string())?) }),
        cache.fetch("connectivity", Duration::from_secs(60), move || async move { value(connectivity::check_connectivity().await) }),
        cache.fetch("stats", Duration::from_secs(10), move || async move { value(get_system_stats_data().await?) }),
        cache.fetch("traffic", Duration::from_secs(60), move || async move {
            let interface = traffic::read_data_interface_stats().map(|(interface, _, _)| interface).unwrap_or_else(|_| "sipa_eth0".to_string());
            value(db.get_traffic_usage(&interface, 31, 12).map_err(|error| error.to_string())?)
        }),
    );

    let results = [
        ("device", &device),
        ("sim", &sim),
        ("network", &network),
        ("cells", &cells),
        ("qos", &qos),
        ("data", &data),
        ("roaming", &roaming),
        ("airplane_mode", &airplane_mode),
        ("ims", &ims),
        ("connectivity", &connectivity),
        ("stats", &stats),
        ("traffic", &traffic),
    ];
    let mut freshness = BTreeMap::new();
    let mut errors = Vec::new();
    for (name, result) in results {
        freshness.insert(name.to_string(), result.freshness.clone());
        if let Some(error) = &result.error {
            errors.push(DashboardSnapshotError {
                section: name.to_string(),
                message: error.clone(),
            });
        }
    }

    let snapshot = DashboardSnapshotData {
        generated_at: utc_timestamp(),
        sections: DashboardSnapshotSections {
            device: device.value,
            sim: sim.value,
            network: network.value,
            cells: cells.value,
            qos: qos.value,
            data: data.value,
            roaming: roaming.value,
            airplane_mode: airplane_mode.value,
            ims: ims.value,
            connectivity: connectivity.value,
            stats: stats.value,
            traffic: traffic.value,
        },
        freshness,
        errors,
    };
    (
        StatusCode::OK,
        Json(ApiResponse::success_with_message("Success", snapshot)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn stale_cache_retains_last_good_value_after_failure() {
        let cache = DashboardSnapshotCache::default();
        let first = cache
            .fetch("device", Duration::ZERO, || async {
                Ok(json!({"imei":"1"}))
            })
            .await;
        assert_eq!(first.freshness.state, "fresh");
        let stale = cache
            .fetch("device", Duration::ZERO, || async {
                Err("dbus down".to_string())
            })
            .await;
        assert_eq!(stale.freshness.state, "stale");
        assert_eq!(stale.value, Some(json!({"imei":"1"})));
        assert_eq!(stale.error.as_deref(), Some("dbus down"));
    }

    #[tokio::test]
    async fn unavailable_section_has_no_value() {
        let cache = DashboardSnapshotCache::default();
        let result = cache
            .fetch("sim", Duration::from_secs(1), || async {
                Err("missing".to_string())
            })
            .await;
        assert_eq!(result.freshness.state, "unavailable");
        assert!(result.value.is_none());
    }

    #[tokio::test]
    async fn concurrent_section_requests_share_one_sample() {
        let cache = Arc::new(DashboardSnapshotCache::default());
        let samples = Arc::new(AtomicUsize::new(0));
        let first_cache = Arc::clone(&cache);
        let first_samples = Arc::clone(&samples);
        let first = tokio::spawn(async move {
            first_cache
                .fetch("network", Duration::from_secs(30), move || async move {
                    first_samples.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    Ok(json!({ "operator_name": "test" }))
                })
                .await
        });
        tokio::time::sleep(Duration::from_millis(2)).await;
        let second_cache = Arc::clone(&cache);
        let second_samples = Arc::clone(&samples);
        let second = tokio::spawn(async move {
            second_cache
                .fetch("network", Duration::from_secs(30), move || async move {
                    second_samples.fetch_add(1, Ordering::SeqCst);
                    Ok(json!({ "operator_name": "second" }))
                })
                .await
        });
        assert_eq!(first.await.unwrap().freshness.state, "fresh");
        assert_eq!(second.await.unwrap().freshness.state, "fresh");
        assert_eq!(samples.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn snapshot_serializes_required_envelope_fields() {
        let mut freshness = BTreeMap::new();
        freshness.insert(
            "device".to_string(),
            DashboardSectionFreshness {
                state: "fresh".to_string(),
                sampled_at: Some("2026-09-17T00:00:00Z".to_string()),
                age_seconds: Some(0),
            },
        );
        let snapshot = DashboardSnapshotData {
            generated_at: "2026-09-17T00:00:00Z".to_string(),
            sections: DashboardSnapshotSections::default(),
            freshness,
            errors: Vec::new(),
        };
        let body =
            serde_json::to_value(ApiResponse::success_with_message("Success", snapshot)).unwrap();
        assert_eq!(body["status"], "ok");
        assert!(body["data"]["generated_at"].is_string());
        assert!(body["data"]["sections"]["airplane_mode"].is_null());
        assert!(body["data"]["errors"].is_array());
        assert_eq!(
            body["data"]["freshness"]["device"]["sampled_at"],
            "2026-09-17T00:00:00Z"
        );
        assert_eq!(body["data"]["freshness"]["device"]["age_seconds"], 0);
    }

    #[test]
    fn legacy_api_envelope_shape_is_unchanged() {
        let body = serde_json::to_value(ApiResponse::success_with_message(
            "Success",
            json!({ "active": true }),
        ))
        .unwrap();
        assert_eq!(
            body,
            json!({ "status": "ok", "message": "Success", "data": { "active": true } })
        );
    }
}
