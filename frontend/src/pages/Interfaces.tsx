import { useState } from 'react'
import {
  Box,
  Chip,
  Collapse,
  IconButton,
  Stack,
  Typography,
  useTheme,
} from '@mui/material'
import {
  CheckCircle,
  ErrorOutline,
  ExpandMore,
  Hub,
  Lan,
  Public,
  Speed,
  Usb,
} from '@mui/icons-material'
import { usePolling } from '../hooks/usePolling'
import { useRefreshInterval } from '@/contexts/RefreshContext'
import { api } from '../api'
import type {
  ConnectivityCheckResponse,
  NetworkInterfaceInfo,
  TrafficUsageResponse,
} from '../api/types'
import PageHeader from '../components/Layout/PageHeader'
import { PageSkeleton } from '@/components/Layout/States'
import { SectionHeader, Surface } from '@/components/Layout/DesignSystem'
import { RADIUS } from '../theme'

const formatBytes = (n?: number): string => {
  if (!n || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / Math.pow(1024, i)
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

// 回环与容器/网桥类接口视为「虚拟接口」，默认折叠，避免淹没真实物理口。
const isVirtual = (name: string) =>
  name === 'lo' || /^(docker|veth|br-|virbr|tun|sit|ip6tnl|flannel|cali|kube|tailscale|ts-)/.test(name)

const ifaceIcon = (name: string) => {
  if (name.startsWith('usb')) return <Usb fontSize="small" />
  if (/^(eth|en|sipa|wlan)/.test(name)) return <Lan fontSize="small" />
  return <Hub fontSize="small" />
}

export default function Interfaces() {
  const theme = useTheme()
  const { resourceRefreshInterval, refreshKey } = useRefreshInterval()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([])
  const [connectivity, setConnectivity] = useState<ConnectivityCheckResponse | null>(null)
  const [traffic, setTraffic] = useState<TrafficUsageResponse | null>(null)
  const [showVirtual, setShowVirtual] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  usePolling(async () => {
    try {
      const [ifaces, conn, tr] = await Promise.all([
        api.getNetworkInterfaces(),
        api.getConnectivity(),
        api.getTrafficUsage(7, 6),
      ])
      if (ifaces.data) setInterfaces(ifaces.data.interfaces)
      if (conn.data) setConnectivity(conn.data)
      if (tr.data) setTraffic(tr.data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, resourceRefreshInterval === 0 ? 0 : Math.max(resourceRefreshInterval, 5000), refreshKey)

  if (loading) return <PageSkeleton tiles={3} blocks={2} blockHeight={148} />

  const real = interfaces.filter(i => !isVirtual(i.name) && i.status === 'up')
  const inactive = interfaces.filter(i => !isVirtual(i.name) && i.status !== 'up')
  const virtual = interfaces.filter(i => isVirtual(i.name))

  const renderIface = (iface: NetworkInterfaceInfo) => {
    const up = iface.status === 'up'
    return (
      <Box
        key={iface.name}
        sx={{
          p: 1.25, borderRadius: RADIUS.md, border: '1px solid', borderColor: 'divider',
          bgcolor: up ? 'background.default' : 'action.hover',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.75 }}>
          <Box sx={{ color: up ? 'primary.main' : 'text.disabled' }}>{ifaceIcon(iface.name)}</Box>
          <Typography fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>{iface.name}</Typography>
          <Chip size="small" color={up ? 'success' : 'default'} label={up ? '已连接' : '未连接'} />
          {iface.mac_address && (
            <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              MAC {iface.mac_address}
            </Typography>
          )}
        </Box>

        {iface.ip_addresses.length > 0 ? (
          <Stack spacing={0.25} sx={{ mb: 0.75 }}>
            {iface.ip_addresses.map((ip, idx) => (
              <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                <Chip size="small" variant="outlined" label={ip.ip_type.toUpperCase()} />
                <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }} noWrap>
                  {ip.address}/{ip.prefix_len}
                </Typography>
                {ip.scope && ip.scope !== 'global' && (
                  <Typography variant="caption" color="text.secondary">· {ip.scope}</Typography>
                )}
              </Box>
            ))}
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary">无 IP 地址</Typography>
        )}

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            收 <Box component="span" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{formatBytes(iface.rx_bytes)}</Box>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            发 <Box component="span" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{formatBytes(iface.tx_bytes)}</Box>
          </Typography>
          <Typography variant="caption" color="text.secondary">MTU {iface.mtu}</Typography>
          {(iface.rx_errors > 0 || iface.tx_errors > 0) && (
            <Typography variant="caption" color="error.main">
              错误 {iface.rx_errors + iface.tx_errors}
            </Typography>
          )}
        </Box>
      </Box>
    )
  }

  return (
    <Box>
      <PageHeader
        eyebrow="设备与网络 / 接口与流量"
        title="接口与流量"
        description={`${real.length} 个已连接 · ${inactive.length} 个未连接 · ${virtual.length} 个虚拟`}
      />

      {error && <Box sx={{ color: 'error.main', fontSize: 13, mb: 2 }}>{error}</Box>}

      {/* 联网检测 */}
      <Surface sx={{ mb: 1.5 }}>
        <SectionHeader title="联网检测" description="IPv4 / IPv6 连通性探测" />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1 }}>
          {(['ipv4', 'ipv6'] as const).map(k => {
            const r = connectivity?.[k]
            const ok = r?.success
            const notProvided = k === 'ipv6' && connectivity?.ipv6_available === false
            const borderColor = notProvided ? 'divider' : ok ? 'success.main' : 'error.main'
            const bgcolor = notProvided
              ? 'rgba(100,116,139,0.06)'
              : ok ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)'
            return (
              <Box key={k} sx={{
                p: 1.25, borderRadius: RADIUS.md, border: '1px solid',
                borderColor,
                bgcolor,
                display: 'flex', alignItems: 'center', gap: 1,
              }}>
                {notProvided
                  ? <Public fontSize="small" color="disabled" />
                  : ok ? <CheckCircle fontSize="small" color="success" /> : <ErrorOutline fontSize="small" color="error" />}
                <Box sx={{ minWidth: 0 }}>
                  <Typography fontWeight={700}>{k.toUpperCase()}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {notProvided
                      ? '运营商未提供'
                      : ok ? (r?.latency_ms !== null ? `延迟 ${r.latency_ms} ms` : '连通') : '不可达'}
                  </Typography>
                </Box>
              </Box>
            )
          })}
        </Box>
      </Surface>

      {/* 网络接口 */}
      <Surface sx={{ mb: 1.5 }}>
        <SectionHeader title="网络接口" description="设备对外连接的物理与虚拟接口" />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1 }}>
          {real.length ? real.map(renderIface) : (
            <Typography variant="body2" color="text.secondary">未检测到物理接口。</Typography>
          )}
        </Box>

        {inactive.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <IconButton size="small" onClick={() => setShowInactive(v => !v)} sx={{ p: 0.25 }}>
                <ExpandMore sx={{ transform: showInactive ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }} />
              </IconButton>
              <Typography variant="caption" color="text.secondary" sx={{ cursor: 'pointer' }} onClick={() => setShowInactive(v => !v)}>
                未连接接口（{inactive.length}）
              </Typography>
            </Box>
            <Collapse in={showInactive}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1, mt: 0.5 }}>
                {inactive.map(renderIface)}
              </Box>
            </Collapse>
          </Box>
        )}

        {virtual.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <IconButton size="small" onClick={() => setShowVirtual(v => !v)} sx={{ p: 0.25 }}>
                <ExpandMore sx={{ transform: showVirtual ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }} />
              </IconButton>
              <Typography variant="caption" color="text.secondary" sx={{ cursor: 'pointer' }} onClick={() => setShowVirtual(v => !v)}>
                虚拟接口（{virtual.length}）
              </Typography>
            </Box>
            <Collapse in={showVirtual}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1, mt: 0.5 }}>
                {virtual.map(renderIface)}
              </Box>
            </Collapse>
          </Box>
        )}
      </Surface>

      {/* 流量统计 */}
      <Surface>
        <SectionHeader title="流量统计" description="本月与今日累计用量" />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1, mb: 1 }}>
          <Box sx={{ p: 1.25, borderRadius: RADIUS.md, border: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Box sx={{ width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: RADIUS.full, bgcolor: theme.palette.primary.main + '14', color: 'primary.main' }}><Speed fontSize="small" /></Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">本月累计</Typography>
                <Typography variant="body2" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {traffic ? formatBytes(traffic.current_month.total_bytes) : '—'}
                </Typography>
              </Box>
            </Stack>
          </Box>
          <Box sx={{ p: 1.25, borderRadius: RADIUS.md, border: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Box sx={{ width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: RADIUS.full, bgcolor: theme.palette.primary.main + '14', color: 'primary.main' }}><Public fontSize="small" /></Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">今日累计</Typography>
                <Typography variant="body2" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {traffic ? formatBytes(traffic.today?.total_bytes ?? 0) : '—'}
                </Typography>
              </Box>
            </Stack>
          </Box>
        </Box>

        {traffic?.daily?.length ? (
          <Box sx={{ display: 'grid', gap: 0.5 }}>
            {traffic.daily.slice().reverse().map(d => (
              <Box key={d.period} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.25 }}>
                <Typography variant="caption" color="text.secondary">{d.period}</Typography>
                <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  收 {formatBytes(d.rx_bytes)} · 发 {formatBytes(d.tx_bytes)}
                </Typography>
              </Box>
            ))}
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary">暂无流量采样。</Typography>
        )}
      </Surface>
    </Box>
  )
}
