# CPE 上网延迟升高：根因分析与排查手册

适用于「固件/后端改动后，走 CPE 数据通道转发的流量（上网 ping、游戏）延迟明显变高」的排查。

设备信息：UDX710 5G CPE，后端二进制部署在 `/home/root/udx710`，诊断日志为
`/home/root/udx710-diagnostics.log`。

---

## 结论速览

| 优先级 | 根因 | 表现 | 状态 |
|---|---|---|---|
| 1（主因） | watchdog 每 15 秒无条件 `iptables -F` | 持续高延迟 + 周期性抖动 | 已修复（默认关闭） |
| 2（次因） | IPv6 单独不通会触发 5G 上下文下电重拨 | 每隔一段时间断网、ping 飙升 | 已修复 |
| 3（低频） | USB gadget 重建 | 偶发断网数秒 | 保留（触发条件严格） |

---

## 根因 1（主因）：watchdog 每 15 秒清空 iptables filter 表

### 现象链路

`main.rs` 以 15 秒间隔启动 watchdog，`backend/src/dbus.rs` 的 `data_connection_watchdog`
每轮循环的第一件事就是调用 `get_iptables_rule_count()` 检查 filter 表。修复前的逻辑是
「只要检测到有规则就清空」，执行的是 `iptables -F` + `ip6tables -F`。

### 为什么这会抬高上网延迟

1. 全仓库搜索 `offload / masquerade / FORWARD / nft / firewall` **零命中**，说明本服务
   **完全不管理防火墙**。filter 表里的规则全部由设备原厂固件维护（转发链、zone、
   fast path / flow offload 等）。
2. 设备上的 `iptables` 通常是 iptables-nft 兼容层，`-F` 会直接抹掉 nftables 中 filter
   表的内容，而原厂固件**不会自动重建**这些规则（需 `service firewall restart` 之类才会重灌）。
3. 规则被抹掉后，转发路径退化、硬件快转/offload 失效，数据包改走慢路径甚至被丢弃，
   表现为上网延迟升高；每 15 秒一次的清表还会带来周期性抖动。
4. 每次检查还要 fork `iptables` / `ip6tables` 两个进程，制造额外的 nftables 表锁竞争。

### 附带影响

手动开关数据连接的 API（`POST /api/data`）此前也会先 flush 一次，同样属于误伤。

---

## 根因 2（次因）：IPv6 单独不通会触发 5G 上下文下电重拨

watchdog 每 30 秒探测一次连通性（ping `223.5.5.5` + `ping6 2400:3200::1`）。修复前的判定是：

> 只要 IPv4 与 IPv6 不是**同时**成功，就累计 `consecutive_partial_failures`；
> 达到 3 次且当前制式为 NR（5G）→ 执行下电 2 秒 + 重拨。

问题在于：**IPv6 在多数运营商 / APN 下本就不通**。于是只要 IPv6 不通，即使 IPv4 完全正常，
也会周期性把数据连接下电重拨一次，造成断网与 ping 飙升。

---

## 根因 3（低频）：USB gadget 重建

条件较严（需要先有 bearer fault、usb0 停滞达到阈值、且过了冷却期），一旦触发会断网数秒。
保留该能力作为兜底自愈，不做改动。

---

## 设备侧排查：不改代码即可验证

以下命令在 `adb shell` 里执行。

### 1. 判定是不是根因 1 —— 观察规则数是否被周期性清零

```sh
i=0; while [ $i -lt 20 ]; do \
  echo "$(date +%T) v4=$(iptables -S 2>/dev/null | grep -c '^-A') v6=$(ip6tables -S 2>/dev/null | grep -c '^-A')"; \
  i=$((i+1)); sleep 3; \
done
```

- 数字周期性掉到 `0` → **确认根因 1**（watchdog 正在清空 filter 表）。
- 数字长期稳定 → 根因 1 不成立，继续看第 3 步。

### 2. 看诊断日志里的关键事件

```sh
grep -E 'IPTABLES_FLUSH|DATA_CONNECTIVITY_PARTIAL|DATA_CONTEXT_RECOVERY_START|USB_PATH_RECOVERY_START' \
  /home/root/udx710-diagnostics.log | tail -50
```

判定：

- 出现 `IPTABLES_FLUSH` → 确实发生过 iptables 清空。
- `DATA_CONNECTIVITY_PARTIAL ... ipv4=false ipv6=false` 反复出现 → 双栈都不通，
  属于真实故障，需要查信号/APN。
- `DATA_CONNECTIVITY_PARTIAL ... ipv4=true ipv6=false` 且紧随其后出现
  `DATA_CONTEXT_RECOVERY_START` → **确认根因 2**（仅 IPv6 不通就重拨）。
- `DATA_CONTEXT_RECOVERY_START` 的时间间隔约等于 15～30 分钟 → 与冷却退避吻合。

### 3. 最直接的对照实验：停掉后端再 ping

```sh
killall udx710
ping -c 60 223.5.5.5        # 记录 avg / mdev —— 记为 A

cd /home/root && ./udx710 &
ping -c 60 223.5.5.5        # 记录 avg / mdev —— 记为 B
```

- A 明显优于 B → 延迟确实由后端行为引入，按根因 1、2 处理。
- A 与 B 差不多 → 延迟来自链路/信号/运营商侧，与本服务无关，转去查 RSRP/RSRQ/SINR 与 APN。

### 4. 确认 nftables 规则是否已被抹掉

```sh
nft list ruleset 2>/dev/null | head -40
iptables -S | head -20
```

若 forward 链几乎为空、只剩默认策略，而设备原本应有转发规则 → 规则确实被抹掉了。

---

## 本次已做的修复

### 修复 1：iptables 清空改为默认关闭

- `backend/src/iptables.rs` 新增 `flush_enabled()`，读取环境变量
  `UDX710_WATCHDOG_IPTABLES_FLUSH`（`1` / `true` / `yes` / `on` 为开），**默认关闭**。
- `backend/src/dbus.rs` watchdog 主循环的 flush 段包在 `if iptables_flush_enabled` 内，
  命中时写入诊断日志 `IPTABLES_FLUSH ipv4=… ipv6=…`（仅状态变化时记录，不刷屏）。
- `backend/src/main.rs` 读取开关并作为新参数传给
  `data_connection_watchdog(conn, interval_secs, iptables_flush_enabled)`，
  启动日志增加 `iptables_flush=…` 字段。
- `backend/src/handlers.rs` 手动开关数据连接前的 flush 也受同一开关控制。

默认不再 fork iptables 进程，稳态 CPU 与 nftables 锁竞争消除。

### 修复 2：收紧 partial 重拨判定

`should_reactivate_partial_data_context` 增加 `ipv4_ok` 参数：

```rust
path_class == "partial-stack" && tech.eq_ignore_ascii_case("nr") && !ipv4_ok && partial_failures >= 3
```

即 **IPv4 正常时绝不因 IPv6 不通而下电重拨**。单元测试同步更新，并新增用例
`partial_stack_with_working_ipv4_keeps_the_context`。

### 修复 3：QCI 只读取一次

签约档位是运营商下发的静态值，`get_qos_info_data` 现在只在进程内首次调用时发送一次
`AT+CGEQOSRDP`，结果永久缓存。此前 Dashboard 的 `qos` 段 TTL 为 30 秒，等于**每 30 秒往
AT 串口发一次命令**，与其他 AT 操作抢串口，本身也可能加重延迟。

配套清理：移除「蜂窝信号」页的签约档位区块，删除代码中 `qci5 / 30000` 的示例注释与文档。
Dashboard 首页的签约档位卡片保留。

---

## 修复后如何验证延迟恢复

1. 重新构建并部署：`./scripts/build.sh && ./scripts/deploy.sh`
2. 启动后确认 watchdog 启动日志带 `iptables_flush=false`：

   ```sh
   RUST_LOG=info ./udx710 2>&1 | grep 'Watchdog started'
   ```

3. 再跑一次第 1 步的规则数观察，**数字应长期稳定，不再周期性掉到 0**。
4. 观察 10～15 分钟诊断日志，确认：

   ```sh
   grep -c 'IPTABLES_FLUSH' /home/root/udx710-diagnostics.log        # 应为 0
   grep -c 'DATA_CONTEXT_RECOVERY_START' /home/root/udx710-diagnostics.log  # 应为 0 或极少
   ```

5. 延迟对照：`ping -c 100 223.5.5.5`，与修复前的 `avg` / `mdev` 对比。
   判定标准：**avg 回落且 mdev（抖动）显著变小**——抖动变小是转发路径恢复的主要标志。

### 若仍有周期性卡顿

按出现频率对齐：

- 约 30 秒 → 仍在跑连通性探测，看 `DATA_CONNECTIVITY_*` 记录。
- 约 5～30 分钟 → 恢复动作在触发，看 `DATA_CONTEXT_RECOVERY_START` / `USB_PATH_RECOVERY_START`。
- 无明显周期 → 转向无线侧：查服务小区 RSRP / RSRQ / SINR 与频段，排除弱覆盖。

---

## 需要 iptables 自动清空时怎么办

确有场景需要清空 filter 表时，显式打开开关（不建议长期开启）：

```sh
export UDX710_WATCHDOG_IPTABLES_FLUSH=1
cd /home/root && ./udx710
```

注意：清 nat 表的 `flush_all_iptables()` 保持未启用状态，它会直接丢掉 MASQUERADE
导致彻底断网，**不要启用**。

---

## 根因 4：模组重附着时默认路由被摘掉（地址在、路由丢）

### 现象

`ping` 直接报 `Network is unreachable`（不是超时、不是丢包），随后 watchdog 记录：

```
DATA_CONNECTIVITY_FAIL tech=unknown radio=0-0-0,... path_class=route-unreachable
  path=v4_routes=192.168.66.0/24 dev usb0 scope link src 192.168.66.1   <- sipa_eth0 默认路由整条消失
      | v4_get=error:ip: RTNETLINK answers: Network is unreachable
      | sipa_addr=... inet 10.98.172.60/32 scope global sipa_...        <- 但接口 IP 仍在
DATA_CONTEXT_RECOVERY_START attempt=1 path_class=route-unreachable
DATA_CONTEXT_RECOVERY_DONE success=false result=... GPRS is not attached
```

### 判定

- `Network is unreachable` = **内核没有到目标的路由**，与丢包无关。关键是「**接口 IP 还在、默认路由没了**」。
- 同刻 `tech=unknown`、`radio` 全为 0，说明模组正在断网/重附着；重附着完成后 PDP 地址会变（实测 `10.98.172.60` → `10.76.130.137`）。
- 本服务**不修改 sipa_eth0 的路由**（全仓无 `route del`），路由消失来自模组/ofono 侧。

### 修复

1. 新增分类 `route-absent-addr-present`，并在 `DATA_CONNECTIVITY_FAIL` 行首输出 `v4_default_route=` / `sipa_v4_addr=`，一眼可判。
2. **收敛首轮重拨**：路由类失败不再首轮即重拨，先等 5 秒复测；恢复则记
   `DATA_CONNECTIVITY_ROUTE_RECOVERED` 且不重拨，仍不可达记
   `DATA_CONNECTIVITY_ROUTE_CONFIRMED` 后走原重拨。真断网只多等 5 秒。

### 核对命令

```sh
grep -E 'route-absent-addr-present|ROUTE_RECOVERED|ROUTE_CONFIRMED' /home/root/udx710-diagnostics.log | tail -20
```

---

## 根因 5：usb0 管理链路卡死（只能靠重启设备恢复）

### 现象

`/api/diagnostics/log` 中大量 `DATA_HOST_PATH usb0_operstate=down usb0_carrier=0`，
rx/tx 计数冻结（链路已断），或清零后仍长时间 down：

```
23:10:08 ~ 23:53:12  usb0 down carrier=0 rx=678905497 tx=3705190808（计数冻结）
00:14:23 ~ 00:15:56  usb0 down carrier=0 rx=0 tx=0
00:16:58             usb0 up carrier=1（重启设备后恢复）
```

### 判定

- 全窗口**没有** `USB_PATH_RECOVERY_START`，说明不是后端关的；主机睡眠/关机时 usb0 down 属正常。
- 真正的问题：主机唤醒后 gadget **未重新枚举**，而既有自愈只覆盖「承载故障后的 USB 停滞」
  （需要 `usb_recovery_eligible` 且 `usb_activity_before_bearer_fault`），**覆盖不到这一场景**，
  因此只能重启设备。

### 修复

1. **观测**：新增 `USB_PATH_STATE_CHANGE`（up↔down 跃迁）、`USB_PATH_DOWN duration_secs=...`、
   `USB_PATH_RECOVERED duration_secs=...`。以后不需要靠零散采样反推。
2. **受守卫自愈**：`usb0` 持续 down 且无载波 ≥180 秒时重建一次 gadget（等于代替你"拔插重枚举"），
   **冷却 30 分钟、最多连试 2 次**，链路恢复 up 后复位计数。链路本来就是断的，重建不会让可用链路变差。
3. **拆雷**：删除 `configure_usb_network()` 里的 `ip route add default via 192.168.66.2`。
   它会在设备侧插入一条与 `default via <运营商网关> dev sipa_eth0` **并列的默认路由**（无 metric），
   可能让 CPE 自身流量被丢给主机形成黑洞，表现为「管理页能用但上不了网」。

### 核对命令

```sh
grep -E 'USB_PATH_|USB_LINK_RECOVERY|USB_NETWORK_CONFIGURED' /home/root/udx710-diagnostics.log | tail -30
```

---

## 根因 6：运营商扫描长时间独占串口锁导致「整体延迟高」

`GET /api/network/operators/scan` → `dbus::scan_operators`（`with_serial`）→ ofono
`NetworkRegistration.Scan()`（等同 `AT+COPS=?`，本身数十秒到两分钟）。该调用**此前没有超时**，
全程持有全局 `DBUS_LOCK`，期间 `/api/cells`、`/api/dashboard/snapshot`、watchdog 的数据自愈
**全部排队**，于是表现为「扫描半天、整个管理页延迟高」。

修复：给 `Scan()` 加 **140 秒硬超时**（贴着前端 150 秒的超时，保证后端先返回、前端能拿到有意义的错误），并记录 `OPERATOR_SCAN_START` / `OPERATOR_SCAN_DONE duration_ms=...`。
注意扫描本身就是慢操作（前端提示"约需 2 分钟"），慢是设计如此，但**不能再无限期占锁**。

### 核对命令

```sh
grep -E 'OPERATOR_SCAN_|CELLS_FETCH_SLOW' /home/root/udx710-diagnostics.log | tail -20
```
