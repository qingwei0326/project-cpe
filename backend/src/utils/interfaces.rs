//! 自 utils.rs 拆出（纯移动，逻辑未改）。

use super::*;

/// 判断IP地址范围（公网/内网/回环/链路本地）
fn get_ip_scope(ip: &IpAddr) -> String {
    match ip {
        IpAddr::V4(ipv4) => {
            let octets = ipv4.octets();
            if ipv4.is_loopback() {
                "loopback".to_string()
            } else if ipv4.is_private()
                || (octets[0] == 10)
                || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                || (octets[0] == 192 && octets[1] == 168)
            {
                "private".to_string()
            } else if ipv4.is_link_local() || (octets[0] == 169 && octets[1] == 254) {
                "link-local".to_string()
            } else {
                "public".to_string()
            }
        }
        IpAddr::V6(ipv6) => {
            if ipv6.is_loopback() {
                "loopback".to_string()
            } else if ipv6.is_unicast_link_local() {
                "link-local".to_string()
            } else if ipv6.segments()[0] & 0xfe00 == 0xfc00 {
                // fc00::/7 - Unique Local Address (ULA)
                "private".to_string()
            } else if ipv6.segments()[0] & 0xff00 == 0xfe00 {
                // fe80::/10 - Link-Local
                "link-local".to_string()
            } else {
                "public".to_string()
            }
        }
    }
}

/// 读取网络接口的IP地址信息
fn read_interface_ip_addresses(interface: &str) -> Result<Vec<IpAddress>, String> {
    use std::process::Command;

    let mut addresses = Vec::new();

    // 使用 ip addr show 命令获取接口的IP地址
    let output = Command::new("ip")
        .args(["addr", "show", "dev", interface])
        .output()
        .map_err(|e| format!("Failed to execute ip command: {}", e))?;

    if !output.status.success() {
        return Ok(addresses); // 接口可能不存在或无IP，返回空列表
    }

    let output_str = String::from_utf8_lossy(&output.stdout);

    for line in output_str.lines() {
        let line = line.trim();

        // 匹配 "inet 192.168.1.1/24" 或 "inet6 fe80::1/64"
        if line.starts_with("inet ") || line.starts_with("inet6 ") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 2 {
                continue;
            }

            let ip_type = if parts[0] == "inet" { "ipv4" } else { "ipv6" };
            let addr_with_prefix = parts[1];

            // 分离IP地址和前缀长度
            if let Some((addr_str, prefix_str)) = addr_with_prefix.split_once('/') {
                if let Ok(ip) = addr_str.parse::<IpAddr>() {
                    let prefix_len = prefix_str.parse::<u8>().unwrap_or(0);
                    let scope = get_ip_scope(&ip);

                    addresses.push(IpAddress {
                        address: addr_str.to_string(),
                        prefix_len,
                        ip_type: ip_type.to_string(),
                        scope,
                    });
                }
            }
        }
    }

    Ok(addresses)
}

/// 读取所有网络接口信息
pub fn read_network_interfaces() -> Result<Vec<NetworkInterfaceInfo>, String> {
    use std::fs;
    use std::path::Path;

    let sys_class_net = Path::new("/sys/class/net");

    if !sys_class_net.exists() {
        return Err("Network interface directory not found".to_string());
    }

    let mut interfaces = Vec::new();

    // 遍历所有网络接口
    let entries = fs::read_dir(sys_class_net)
        .map_err(|e| format!("Failed to read network interfaces: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let interface_name = entry.file_name().to_string_lossy().to_string();
        let interface_path = entry.path();

        // 读取接口状态
        let status = fs::read_to_string(interface_path.join("operstate"))
            .unwrap_or_else(|_| "unknown".to_string())
            .trim()
            .to_lowercase();

        // 读取MAC地址
        let mac_address = fs::read_to_string(interface_path.join("address"))
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s != "00:00:00:00:00:00");

        // 读取MTU
        let mtu = fs::read_to_string(interface_path.join("mtu"))
            .ok()
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0);

        // 读取统计信息
        let stats_path = interface_path.join("statistics");
        let rx_bytes = fs::read_to_string(stats_path.join("rx_bytes"))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0);
        let tx_bytes = fs::read_to_string(stats_path.join("tx_bytes"))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0);
        let rx_packets = fs::read_to_string(stats_path.join("rx_packets"))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0);
        let tx_packets = fs::read_to_string(stats_path.join("tx_packets"))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0);
        let rx_errors = fs::read_to_string(stats_path.join("rx_errors"))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0);
        let tx_errors = fs::read_to_string(stats_path.join("tx_errors"))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0);

        // 读取IP地址信息
        let ip_addresses = read_interface_ip_addresses(&interface_name).unwrap_or_default();

        interfaces.push(NetworkInterfaceInfo {
            name: interface_name,
            status,
            mac_address,
            mtu,
            ip_addresses,
            rx_bytes,
            tx_bytes,
            rx_packets,
            tx_packets,
            rx_errors,
            tx_errors,
        });
    }

    // 按接口名称排序
    interfaces.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(interfaces)
}
