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
import type { NetworkInterfaceInfo, TrafficUsageResponse } from '../api/types'
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
  const [traffic, setTraffic] = useState<TrafficUsageResponse | null>(null)
  const [showVirtual, setShowVirtual] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  usePolling(async () => {
    try {
      const [ifaces, tr] = await Promise.all([
        api.getNetworkInterfaces(),
        api.getTrafficUsage(7, 6),
      ])
      if (ifaces.data) setInterfaces(ifaces.data.interfaces)
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

  // 设备常常是刚开始统计，近 7 天大多是 0 B，列出来只是噪音。
  const activeDays = (traffic?.daily ?? []).filter(d => d.total_bytes > 0).slice().reverse()
  const previousMonth = traffic?.monthly.filter(m => m.period < traffic.current_month.period).at(-1)
  const usageTiles = [
    { label: '本月累计', bytes: traffic?.current_month.total_bytes ?? 0, icon: <Speed fontSize="small" /> },
    { label: '上月累计', bytes: previousMonth?.total_bytes ?? 0, icon: <Hub fontSize="small" /> },
    { label: '今日累计', bytes: traffic?.today?.total_bytes ?? 0, icon: <Public fontSize="small" /> },
  ]

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
        <SectionHeader title="流量统计" description="本月、上月与今日累计用量；下方只列出有流量的日期" />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1, mb: 1 }}>
          {usageTiles.map(tile => (
            <Box key={tile.label} sx={{ p: 1.25, borderRadius: RADIUS.md, border: '1px solid', borderColor: 'divider' }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: RADIUS.full, bgcolor: theme.palette.primary.main + '14', color: 'primary.main' }}>{tile.icon}</Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">{tile.label}</Typography>
                  <Typography variant="body2" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {traffic ? formatBytes(tile.bytes) : '—'}
                  </Typography>
                </Box>
              </Stack>
            </Box>
          ))}
        </Box>

        {activeDays.length > 0 ? (
          <Box sx={{ display: 'grid', gap: 0.5 }}>
            {activeDays.map(d => (
              <Box key={d.period} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.25 }}>
                <Typography variant="caption" color="text.secondary">{d.period}</Typography>
                <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  收 {formatBytes(d.rx_bytes)} · 发 {formatBytes(d.tx_bytes)}
                </Typography>
              </Box>
            ))}
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary">近 7 天没有流量记录。</Typography>
        )}
      </Surface>
    </Box>
  )
}
