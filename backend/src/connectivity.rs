//! Lightweight real IPv4/IPv6 connectivity probes shared by the API and
//! the data-connection watchdog.

use crate::models::{ConnectivityCheckResponse, PingResult};

const PROBE_INTERFACE: &str = "sipa_eth0";
const PING_SAMPLES: u32 = 3;
const PING_SAMPLE_COUNT: &str = "3";
const PING_TIMEOUT_SECONDS: &str = "2";
/// A single mobile RTT above this value is noisy; the watchdog uses this only
/// together with a failed transport probe, so it does not reset a healthy link
/// because of one radio scheduling delay.
pub const DEGRADED_P95_LATENCY_MS: f64 = 150.0;
/// A successful TCP connect that takes this long is not useful enough to
/// treat the bearer as healthy.  This catches the user-plane stalls where
/// ICMP times out but the socket eventually completes after several hundred
/// milliseconds.
pub const DEGRADED_TRANSPORT_LATENCY_MS: f64 = 250.0;

/// A small snapshot of the host-facing link.  Cellular probes run through
/// `sipa_eth0`, so this is intentionally recorded separately for `usb0`.
#[derive(Debug, Clone, Default)]
pub struct InterfacePathSnapshot {
    pub operstate: String,
    pub carrier: String,
    pub rx_bytes: String,
    pub tx_bytes: String,
}

#[derive(Debug, Clone, Default)]
pub struct TransportProbe {
    pub dns: bool,
    pub dns_latency_ms: Option<f64>,
    pub tcp4: bool,
    pub tcp4_latency_ms: Option<f64>,
    pub tcp6: bool,
    pub tcp6_latency_ms: Option<f64>,
    pub https: Option<bool>,
    pub https_status: Option<u16>,
    pub https_latency_ms: Option<f64>,
}

/// Probe one IPv4 and one IPv6 destination in parallel.
pub async fn check_connectivity() -> ConnectivityCheckResponse {
    let (ipv4, ipv6, ipv6_available) = tokio::join!(
        ping_host("223.5.5.5", false),
        ping_host("2400:3200::1", true),
        ipv6_wan_available(),
    );
    ConnectivityCheckResponse {
        ipv4,
        ipv6,
        ipv6_available,
    }
}

/// 接口是否实际持有可用的 IPv6 全球单播地址。只有出现非链路本地、非 ULA 的全球
/// 地址（运营商 / APN 通过 SLAAC 或 DHCPv6-PD 下发）才返回 `true`；`fe80::/10`
/// 链路本地地址、`::1` 回环与 `fc00::/7` ULA 都不足以代表 WAN 侧 IPv6 已就绪。
/// 该判定与 30s 连通性缓存同周期，仅多一次极轻量的 `ip -6 addr show`。
async fn ipv6_wan_available() -> bool {
    let output = run_ip_command(&["-6", "addr", "show", "dev", PROBE_INTERFACE]).await;
    if output.is_empty() || output.starts_with("error:") {
        return false;
    }
    for line in output.lines() {
        let line = line.trim();
        if let Some(pos) = line.find("inet6 ") {
            let addr = line[pos + 6..]
                .split_whitespace()
                .next()
                .unwrap_or("")
                .split('/')
                .next()
                .unwrap_or("");
            if addr.is_empty()
                || addr.starts_with("fe80:")
                || addr == "::1"
                || addr.starts_with("fc")
                || addr.starts_with("fd")
            {
                continue;
            }
            return true;
        }
    }
    false
}

/// `ip` 命令的轻量封装：超时 2s，失败或非成功状态返回空串。
async fn run_ip_command(args: &[&str]) -> String {
    match tokio::time::timeout(
        std::time::Duration::from_secs(2),
        tokio::process::Command::new("ip").args(args).output(),
    )
    .await
    {
        Ok(Ok(output)) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
        _ => String::new(),
    }
}

/// Read link state and counters without invoking a shell. Missing interfaces
/// are represented as `-`, which keeps diagnostics useful during USB mode
/// transitions and early boot.
pub async fn interface_path_snapshot(interface: &str) -> InterfacePathSnapshot {
    let base = format!("/sys/class/net/{interface}");
    let (operstate, carrier, rx_bytes, tx_bytes) = tokio::join!(
        read_sysfs_value(format!("{base}/operstate")),
        read_sysfs_value(format!("{base}/carrier")),
        read_sysfs_value(format!("{base}/statistics/rx_bytes")),
        read_sysfs_value(format!("{base}/statistics/tx_bytes")),
    );
    InterfacePathSnapshot {
        operstate,
        carrier,
        rx_bytes,
        tx_bytes,
    }
}

/// Probe transport layers that ICMP alone cannot distinguish. DNS and TCP are
/// always checked; HTTPS is enabled only when an actual service URL is
/// configured with `UDX710_CONNECTIVITY_URL`.
pub async fn check_transport() -> TransportProbe {
    let (dns, tcp4, tcp6) = tokio::join!(
        dns_probe(),
        tcp_probe("223.5.5.5:53"),
        tcp_probe("[2400:3200::1]:443"),
    );
    let (https, https_status, https_latency_ms) = https_probe().await;
    TransportProbe {
        dns: dns.0,
        dns_latency_ms: dns.1,
        tcp4: tcp4.0,
        tcp4_latency_ms: tcp4.1,
        tcp6: tcp6.0,
        tcp6_latency_ms: tcp6.1,
        https,
        https_status,
        https_latency_ms,
    }
}

async fn read_sysfs_value(path: String) -> String {
    tokio::fs::read_to_string(path)
        .await
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "-".to_string())
}

async fn dns_probe() -> (bool, Option<f64>) {
    let started_at = std::time::Instant::now();
    let result = match tokio::time::timeout(
        std::time::Duration::from_secs(2),
        tokio::net::lookup_host("example.com:443"),
    )
    .await
    {
        Ok(Ok(mut addresses)) => addresses.next().is_some(),
        _ => false,
    };
    (
        result,
        result.then_some(started_at.elapsed().as_secs_f64() * 1000.0),
    )
}

async fn tcp_probe(target: &str) -> (bool, Option<f64>) {
    let started_at = std::time::Instant::now();
    let result = matches!(
        tokio::time::timeout(
            std::time::Duration::from_secs(2),
            tokio::net::TcpStream::connect(target)
        )
        .await,
        Ok(Ok(_))
    );
    (
        result,
        result.then_some(started_at.elapsed().as_secs_f64() * 1000.0),
    )
}

async fn https_probe() -> (Option<bool>, Option<u16>, Option<f64>) {
    let Ok(url) = std::env::var("UDX710_CONNECTIVITY_URL") else {
        return (None, None, None);
    };
    if url.trim().is_empty() {
        return (None, None, None);
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        Ok(client) => client,
        Err(_) => return (Some(false), None, None),
    };
    let started_at = std::time::Instant::now();
    match client.get(url).send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            (
                Some(response.status().is_success()),
                Some(status),
                Some(started_at.elapsed().as_secs_f64() * 1000.0),
            )
        }
        Err(_) => (Some(false), None, None),
    }
}

async fn ping_host(target: &str, is_ipv6: bool) -> PingResult {
    let command = if is_ipv6 { "ping6" } else { "ping" };
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        tokio::process::Command::new(command)
            .args([
                "-I",
                PROBE_INTERFACE,
                "-c",
                PING_SAMPLE_COUNT,
                "-W",
                PING_TIMEOUT_SECONDS,
                target,
            ])
            .output(),
    )
    .await;

    match output {
        Ok(Ok(result)) => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            let stderr = String::from_utf8_lossy(&result.stderr);
            let latencies = parse_ping_latencies(&stdout);
            let (sent, received) =
                parse_packet_counts(&stdout).unwrap_or((PING_SAMPLES, latencies.len() as u32));
            let received = received.min(sent);
            let success = received > 0 || !latencies.is_empty();
            let error = if success {
                None
            } else {
                Some(if stderr.trim().is_empty() {
                    format!("{command} failed with status {}", result.status)
                } else {
                    stderr.trim().to_string()
                })
            };
            ping_result_from_samples(target, success, sent, received, latencies, error)
        }
        Ok(Err(error)) => ping_result_from_samples(
            target,
            false,
            PING_SAMPLES,
            0,
            Vec::new(),
            Some(format!("Failed to execute {command}: {error}")),
        ),
        Err(_) => ping_result_from_samples(
            target,
            false,
            PING_SAMPLES,
            0,
            Vec::new(),
            Some("Ping timed out".to_string()),
        ),
    }
}

fn parse_ping_latencies(output: &str) -> Vec<f64> {
    output
        .lines()
        .filter_map(|line| {
            let time_pos = line.find("time=")?;
            let after_time = &line[time_pos + 5..];
            let number: String = after_time
                .chars()
                .take_while(|character| character.is_ascii_digit() || *character == '.')
                .collect();
            number.parse::<f64>().ok()
        })
        .collect()
}

fn parse_packet_counts(output: &str) -> Option<(u32, u32)> {
    output.lines().find_map(|line| {
        if !line.contains("packets transmitted") {
            return None;
        }
        let numbers: Vec<u32> = line
            .split(|character: char| !character.is_ascii_digit())
            .filter(|part| !part.is_empty())
            .filter_map(|part| part.parse::<u32>().ok())
            .collect();
        (numbers.len() >= 2).then_some((numbers[0], numbers[1]))
    })
}

fn ping_result_from_samples(
    target: &str,
    success: bool,
    sent: u32,
    received: u32,
    mut latencies: Vec<f64>,
    error: Option<String>,
) -> PingResult {
    latencies.sort_by(f64::total_cmp);
    let latency_ms =
        (!latencies.is_empty()).then(|| latencies.iter().sum::<f64>() / latencies.len() as f64);
    let min_latency_ms = latencies.first().copied();
    let max_latency_ms = latencies.last().copied();
    let p95_latency_ms = (!latencies.is_empty()).then(|| {
        let index = ((latencies.len() as f64 * 0.95).ceil() as usize)
            .saturating_sub(1)
            .min(latencies.len() - 1);
        latencies[index]
    });
    let packet_loss_percent = if sent == 0 {
        100.0
    } else {
        ((sent.saturating_sub(received)) as f64 / sent as f64) * 100.0
    };
    PingResult {
        success,
        latency_ms,
        samples: received,
        packet_loss_percent,
        min_latency_ms,
        max_latency_ms,
        p95_latency_ms,
        target: target.to_string(),
        error,
    }
}

/// A high RTT is only considered a degraded path when the tail is high or
/// there is loss. Callers should combine this with a TCP/HTTPS failure before
/// resetting a data context.
pub fn ping_is_degraded(result: &PingResult) -> bool {
    result.packet_loss_percent >= 20.0
        || result
            .p95_latency_ms
            .is_some_and(|latency| latency >= DEGRADED_P95_LATENCY_MS)
}

fn transport_is_usable(success: bool, latency_ms: Option<f64>) -> bool {
    success && latency_ms.is_none_or(|latency| latency < DEGRADED_TRANSPORT_LATENCY_MS)
}

/// Effective IPv4 status. A successful TCP connect is not enough by itself:
/// when both the ping tail and TCP latency are degraded, the bearer is
/// treated as unhealthy even if the socket eventually completes.
pub fn effective_ipv4_ok(probe: &ConnectivityCheckResponse, transport: &TransportProbe) -> bool {
    if probe.ipv4.success && !ping_is_degraded(&probe.ipv4) {
        return true;
    }
    transport_is_usable(transport.tcp4, transport.tcp4_latency_ms)
}

/// Effective IPv6 status. The caller must decide whether IPv6 is required;
/// this function reports the actual IPv6 path only. A slow successful TCP
/// connect still counts as degraded when the ICMP path is degraded.
pub fn effective_ipv6_ok(probe: &ConnectivityCheckResponse, transport: &TransportProbe) -> bool {
    if probe.ipv6.success && !ping_is_degraded(&probe.ipv6) {
        return true;
    }
    transport_is_usable(transport.tcp6, transport.tcp6_latency_ms)
}

pub fn both_paths_failed(probe: &ConnectivityCheckResponse, transport: &TransportProbe) -> bool {
    !effective_ipv4_ok(probe, transport)
        && (!probe.ipv6_available || !effective_ipv6_ok(probe, transport))
}

#[cfg(test)]
mod tests {
    use super::{
        effective_ipv4_ok, effective_ipv6_ok, parse_packet_counts, parse_ping_latencies,
        ping_is_degraded, ping_result_from_samples, TransportProbe,
    };
    use crate::models::{ConnectivityCheckResponse, PingResult};

    #[test]
    fn parses_integer_and_fractional_ping_times() {
        assert_eq!(
            parse_ping_latencies("64 bytes from x: time=12.34 ms"),
            vec![12.34]
        );
        assert_eq!(
            parse_ping_latencies("64 bytes from x: time=8 ms"),
            vec![8.0]
        );
        assert!(parse_ping_latencies("timeout").is_empty());
    }

    #[test]
    fn parses_ping_samples_and_loss() {
        let output = "3 packets transmitted, 2 packets received, 33% packet loss\n64 bytes from x: time=120.00 ms\n64 bytes from x: time=180.00 ms";
        assert_eq!(parse_packet_counts(output), Some((3, 2)));
        let result = ping_result_from_samples("x", true, 3, 2, parse_ping_latencies(output), None);
        assert_eq!(result.samples, 2);
        assert!((result.packet_loss_percent - 33.3333).abs() < 0.01);
        assert_eq!(result.min_latency_ms, Some(120.0));
        assert_eq!(result.max_latency_ms, Some(180.0));
        assert!(ping_is_degraded(&result));
    }

    #[test]
    fn slow_transport_does_not_mask_a_timed_out_ping() {
        let probe = ConnectivityCheckResponse {
            ipv4: PingResult {
                success: false,
                packet_loss_percent: 100.0,
                error: Some("Ping timed out".to_string()),
                ..Default::default()
            },
            ipv6: PingResult {
                success: false,
                packet_loss_percent: 100.0,
                error: Some("Ping timed out".to_string()),
                ..Default::default()
            },
            ipv6_available: true,
        };
        let transport = TransportProbe {
            tcp4: true,
            tcp4_latency_ms: Some(1218.8),
            tcp6: true,
            tcp6_latency_ms: Some(1213.7),
            ..Default::default()
        };

        assert!(!effective_ipv4_ok(&probe, &transport));
        assert!(!effective_ipv6_ok(&probe, &transport));
    }

    #[test]
    fn healthy_transport_can_override_icmp_loss_when_fast() {
        let probe = ConnectivityCheckResponse {
            ipv4: PingResult {
                success: false,
                packet_loss_percent: 100.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let transport = TransportProbe {
            tcp4: true,
            tcp4_latency_ms: Some(42.0),
            ..Default::default()
        };

        assert!(effective_ipv4_ok(&probe, &transport));
    }
}
