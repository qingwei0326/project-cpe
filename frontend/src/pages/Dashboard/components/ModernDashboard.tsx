import { alpha } from '@mui/material/styles'
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, LinearProgress, Stack, Typography, useTheme, type Theme } from '@mui/material'
import { ExpandMore, PhoneAndroid, PowerSettingsNew, Router, SignalCellularAlt, SimCard } from '@mui/icons-material'
import { Link as RouterLink } from 'react-router-dom'
import type { DashboardData, InterfaceSpeedHistory } from '../hooks/useDashboardData'
import { formatBearerRate, formatBytes, formatSignalValue, formatSpeed, getTempColor } from '../utils'
import { localizeOperator } from '../../../utils/carriers'
import { SectionHeader, Surface } from '../../../components/Layout/DesignSystem'
import { RADIUS, SURFACE_BY_MODE } from '../../../theme'
import { AnimatedNumber } from '../../../components/Layout/States'
import { useAnimatedValue } from '../../../hooks/useAnimatedValue'

/** 温度条以 120°C 为满格，抽成具名函数避免 1.2 这个魔法数散落在 JSX 里。 */
const TEMPERATURE_FULL_SCALE_C = 120
const temperatureToPercent = (celsius: number) =>
  Math.min(100, Math.max(0, (celsius / TEMPERATURE_FULL_SCALE_C) * 100))

interface Props { data: DashboardData; lastUpdatedAt: number | null; onToggleData: () => void; onToggleAirplaneMode: () => void; onToggleRoaming: () => void }

// 次级容器用比主卡暗一档的表面，层次靠明度而不是统一描边（设计稿图 1）。
function modeMuted(theme: Theme) {
  const m = theme.palette.mode === 'dark' ? 'dark' : 'light'
  return SURFACE_BY_MODE[m].muted
}

function Panel({ children, sx }: { children: React.ReactNode; sx?: Record<string, unknown> }) {
  return <Surface sx={{ height: '100%', p: { xs: 1.25, md: 1.5 }, bgcolor: modeMuted, ...sx }}>{children}</Surface>
}

function Heading({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) {
  return <SectionHeader title={title} description={detail} action={action} />
}

function ControlToggle({ icon, label, on, active, color, onClick }: {
  icon: React.ReactNode
  label: string
  on: boolean
  active: boolean
  color: 'primary' | 'secondary' | 'warning'
  onClick: () => void
}) {
  return (
    <Button
      variant={active ? 'contained' : 'outlined'}
      color={color}
      onClick={onClick}
      sx={{ minWidth: 0, flexDirection: 'column', gap: .25, py: .85 }}
    >
      {icon}
      <Box>
        <Typography variant="caption" fontWeight={800} display="block" lineHeight={1.2}>{label}</Typography>
        <Typography variant="caption" display="block" lineHeight={1.2} sx={{ fontSize: '0.6875rem', opacity: .85 }}>
          {on ? '开' : '关'}
        </Typography>
      </Box>
    </Button>
  )
}

function Ring({ label, value, detail, color }: { label: string; value: number | null; detail: string; color: string }) {
  const theme = useTheme<Theme>()
  const animated = useAnimatedValue(value ?? 0)
  const percent = Math.max(0, Math.min(100, animated))
  return <Box textAlign="center" minWidth={0}><Box sx={{ width: 72, height: 72, mx: 'auto', borderRadius: RADIUS.full, display: 'grid', placeItems: 'center', position: 'relative', background: `conic-gradient(${color} ${percent * 3.6}deg, ${alpha(theme.palette.text.primary, .14)} 0deg)`, '&::after': { content: '""', position: 'absolute', inset: 6, borderRadius: RADIUS.full, bgcolor: 'background.paper' } }}><Box sx={{ position: 'relative', zIndex: 1 }}><Typography variant="h6" fontWeight={850} lineHeight={1} sx={{ fontVariantNumeric: 'tabular-nums' }}>{value === null ? '—' : `${Math.round(animated)}%`}</Typography><Typography variant="caption" color="text.secondary">{label}</Typography></Box></Box><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: .35, whiteSpace: 'nowrap' }}>{detail}</Typography></Box>
}

function LineChart({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null
  const peak = Math.max(...values, 1)
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${94 - (value / peak) * 78}`).join(' ')
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

function SpeedPanel({ data }: { data: DashboardData }) {
  const theme = useTheme<Theme>()
  const ns = data.systemStats?.network_speed
  const iface = ns?.interfaces.find(item => item.interface === 'sipa_eth0') ?? ns?.interfaces[0]
  const history: InterfaceSpeedHistory | undefined = iface ? data.speedHistory?.[iface.interface] : undefined
  const interfaces = ns?.interfaces ?? []
  const sampling = !history?.rx?.length
  return <Panel sx={{ minHeight: 220, display: 'flex', flexDirection: 'column' }}><Heading title="实时网速趋势" detail={iface ? `读取 ${iface.interface} 实际收发速率` : '等待接口采样'} action={<Chip size="small" label="实时" color="success" variant="outlined" />} /><Box sx={{ flex: 1, minHeight: 132, position: 'relative', backgroundImage: `linear-gradient(${alpha(theme.palette.text.primary, .08)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(theme.palette.text.primary, .08)} 1px, transparent 1px)`, backgroundSize: '20% 25%' }}>{sampling && <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 1 }}>正在累积采样点…</Typography>}<LineChart values={history?.rx ?? []} color={theme.palette.info.main} /><LineChart values={history?.tx ?? []} color={theme.palette.secondary.main} /></Box><Stack direction="row" spacing={1.5} mt={.75}><Typography variant="caption" color="info.main">● 下载 <AnimatedNumber value={iface?.rx_bytes_per_sec ?? 0} format={formatSpeed} /></Typography><Typography variant="caption" color="secondary.main">● 上传 <AnimatedNumber value={iface?.tx_bytes_per_sec ?? 0} format={formatSpeed} /></Typography><Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>{iface?.interface ?? '—'}</Typography></Stack><Box sx={{ mt: .75, pt: .75, borderTop: '1px solid', borderColor: 'divider', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: .5 }}>{interfaces.slice(0, 2).map(item => <Box key={item.interface} display="flex" justifyContent="space-between" alignItems="center"><Typography variant="caption" fontFamily="monospace">{item.interface}</Typography><Typography variant="caption" color="text.secondary">↓ {formatSpeed(item.rx_bytes_per_sec)} · ↑ {formatSpeed(item.tx_bytes_per_sec)}</Typography></Box>)}</Box></Panel>
}

function QualityPanel({ data }: { data: DashboardData }) {
  const theme = useTheme<Theme>()
  const cells = data.cellsInfo?.cells?.slice(0, 4) ?? []
  const neighbors = cells.filter(cell => !cell.is_serving)
  return <Panel sx={{ minHeight: 160 }}><Heading title="小区信号" detail="服务小区与邻区无线指标" action={<Button component={RouterLink} to="/advanced-network" size="small">网络详情</Button>} /><Box sx={{ overflowX: 'auto' }}><Box sx={{ minWidth: 520, display: 'grid', gridTemplateColumns: 'minmax(180px, 1.6fr) repeat(3, minmax(75px, .7fr))', border: '1px solid', borderColor: 'divider', borderRadius: RADIUS.md, overflow: 'hidden' }}>{['小区', 'RSRP', 'RSRQ', 'SINR'].map(item => <Typography key={item} variant="caption" color="text.secondary" sx={{ p: .55, bgcolor: alpha(theme.palette.primary.main, .08) }}>{item}</Typography>)}{cells.length > 0 ? cells.map((cell, index) => <Box key={`${cell.pci}-${cell.arfcn}-${index}`} sx={{ display: 'contents' }}><Box sx={{ p: .55, borderTop: '1px solid', borderColor: 'divider', minWidth: 0 }}><Typography variant="body2" noWrap>{cell.is_serving ? '服务小区' : `邻区 ${neighbors.indexOf(cell) + 1}`}{cell.band ? ` · ${cell.band}` : ''}</Typography><Typography variant="caption" color="text.secondary" noWrap display="block">PCI {cell.pci || '—'} · 频点 {cell.arfcn || cell.earfcn || '—'}</Typography></Box><Typography variant="body2" sx={{ p: .55, borderTop: '1px solid', borderColor: 'divider' }}>{formatSignalValue(cell.rsrp)} dBm</Typography><Typography variant="body2" sx={{ p: .55, borderTop: '1px solid', borderColor: 'divider' }}>{formatSignalValue(cell.rsrq)} dB</Typography><Typography variant="body2" sx={{ p: .55, borderTop: '1px solid', borderColor: 'divider' }}>{formatSignalValue(cell.sinr)} dB</Typography></Box>) : <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / -1', p: .75 }}>等待小区采样</Typography>}</Box></Box></Panel>
}

function DetailPanel({ data }: { data: DashboardData }) {
  const cell = data.cellsInfo?.cells?.find(item => item.is_serving) ?? data.cellsInfo?.cells?.[0]
  const operator = localizeOperator(data.networkInfo?.operator_name, data.networkInfo?.mcc ?? data.simInfo?.mcc, data.networkInfo?.mnc ?? data.simInfo?.mnc)
  return <Panel><Accordion disableGutters><AccordionSummary expandIcon={<ExpandMore />}><Typography fontWeight={800}>设备、SIM 与小区详情</Typography></AccordionSummary><AccordionDetails><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}><Box><Stack direction="row" spacing={1} alignItems="center" mb={.75}><PhoneAndroid fontSize="small" color="primary" /><Typography variant="subtitle2">设备</Typography></Stack><Typography variant="caption" display="block" color="text.secondary">型号</Typography><Typography variant="body2">{data.deviceInfo?.model ?? '—'}</Typography><Typography variant="caption" display="block" color="text.secondary" mt={.6}>厂商 / 固件</Typography><Typography variant="body2">{data.deviceInfo?.manufacturer ?? '—'} · {data.deviceInfo?.revision ?? '—'}</Typography></Box><Box><Stack direction="row" spacing={1} alignItems="center" mb={.75}><SimCard fontSize="small" color="primary" /><Typography variant="subtitle2">SIM</Typography></Stack><Typography variant="caption" display="block" color="text.secondary">运营商</Typography><Typography variant="body2">{operator.display}</Typography>{operator.rawName && operator.rawName !== operator.display && <Typography variant="caption" display="block" color="text.disabled">{operator.rawName}</Typography>}<Typography variant="caption" display="block" color="text.secondary" mt={.6}>IMSI</Typography><Typography variant="body2" fontFamily="monospace">{data.simInfo?.imsi ?? '—'}</Typography></Box><Box><Stack direction="row" spacing={1} alignItems="center" mb={.75}><SignalCellularAlt fontSize="small" color="primary" /><Typography variant="subtitle2">服务小区</Typography></Stack><Typography variant="caption" display="block" color="text.secondary">制式 / 频段</Typography><Typography variant="body2">{cell?.tech ?? data.cellsInfo?.serving_cell.tech ?? '—'} · {cell?.band ?? '—'}</Typography><Typography variant="caption" display="block" color="text.secondary" mt={.6}>PCI / 频点</Typography><Typography variant="body2" fontFamily="monospace">PCI {cell?.pci ?? '—'} · {cell?.arfcn ?? cell?.earfcn ?? '—'}</Typography></Box></Box></AccordionDetails></Accordion></Panel>
}

// ===================== 图 1 视觉重做：4 张关键指标卡 =====================

function HeroCard({ accent, children, sx }: { accent?: string; children: React.ReactNode; sx?: Record<string, unknown> }) {
  return (
    <Surface sx={{ height: '100%', p: { xs: 1.25, md: 1.6 }, ...(accent ? { borderTop: `3px solid ${accent}` } : {}), ...sx }}>
      {children}
    </Surface>
  )
}

function MiniMetric({ label, value, unit }: { label: string; value?: string; unit?: string }) {
  return (
    <Box minWidth={0}>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value ?? '—'}<Typography component="span" variant="caption" color="text.secondary" sx={{ ml: .25 }}>{unit}</Typography>
      </Typography>
    </Box>
  )
}

function SignalBars({ pct }: { pct: number }) {
  const theme = useTheme<Theme>()
  const fill = Math.max(0, Math.min(7, Math.round((pct || 0) / 100 * 7)))
  const heights = [42, 54, 66, 76, 86, 94, 100]
  return (
    <Box display="flex" gap={.4} height={28} alignItems="flex-end">
      {heights.map((h, i) => (
        <Box key={i} flex={1} height={`${h}%`} borderRadius={RADIUS.xs} bgcolor={i < fill ? theme.palette.primary.main : alpha(theme.palette.text.primary, .1)} />
      ))}
    </Box>
  )
}

function HeroOperator({ data, theme }: { data: DashboardData; theme: Theme }) {
  const operator = localizeOperator(data.networkInfo?.operator_name, data.networkInfo?.mcc ?? data.simInfo?.mcc, data.networkInfo?.mnc ?? data.simInfo?.mnc)
  const network = data.networkInfo?.technology_preference || data.cellsInfo?.serving_cell.tech?.toUpperCase() || '未知'
  const primary = data.cellsInfo?.cells?.find(item => item.is_serving) ?? data.cellsInfo?.cells?.[0]
  const serving = data.cellsInfo?.serving_cell
  const pct = data.networkInfo?.signal_strength ?? 0
  return (
    <HeroCard accent={theme.palette.primary.main}>
      <Typography variant="caption" color="text.secondary">当前运营商</Typography>
      <Box display="flex" alignItems="baseline" gap={1} flexWrap="wrap" mt={.5}>
        <Typography fontSize="clamp(1.4rem, 2vw, 1.75rem)" fontWeight={600} lineHeight={1}>{operator.display}</Typography>
        {operator.rawName && <Typography variant="caption" color="text.disabled">{operator.rawName} · {data.networkInfo?.mcc ?? data.simInfo?.mcc ?? '—'}-{data.networkInfo?.mnc ?? data.simInfo?.mnc ?? '—'}</Typography>}
        <Chip size="small" label={network} sx={{ bgcolor: alpha(theme.palette.primary.main, .14), color: theme.palette.primary.main, fontWeight: 700 }} />
        {primary?.band && <Chip size="small" label={primary.band} variant="outlined" />}
        <Chip size="small" label={data.networkInfo?.registration_status ?? '—'} variant="outlined" />
      </Box>
      <Box display="flex" alignItems="center" gap={2} mt={1.5} pt={1.25} borderTop="1px solid" borderColor="divider">
        <Box minWidth={92}>
          <Typography variant="caption" color="text.secondary">信号强度</Typography>
          <Typography fontSize="clamp(1.5rem, 2.2vw, 1.9rem)" fontWeight={600} lineHeight={1} sx={{ fontVariantNumeric: 'tabular-nums', color: theme.palette.primary.main }}>{pct}<Box component="span" fontSize=".9rem">%</Box></Typography>
        </Box>
        <Box flex={1} minWidth={0}>
          <SignalBars pct={pct} />
          <Typography variant="caption" color="text.secondary" mt={.5} display="block">PCI {primary?.pci ?? '—'} · 频点 {primary?.arfcn ?? primary?.earfcn ?? '—'} · TAC {serving?.tac ?? '—'}</Typography>
        </Box>
      </Box>
      <Box display="grid" gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap={1} mt={1.25}>
        <MiniMetric label="RSRP" value={formatSignalValue(primary?.rsrp)} unit="dBm" />
        <MiniMetric label="RSRQ" value={formatSignalValue(primary?.rsrq)} unit="dB" />
        <MiniMetric label="SINR" value={formatSignalValue(primary?.sinr)} unit="dB" />
      </Box>
    </HeroCard>
  )
}

function HeroSpeed({ data, theme }: { data: DashboardData; theme: Theme }) {
  const ns = data.systemStats?.network_speed
  const iface = ns?.interfaces.find(item => item.interface === 'sipa_eth0') ?? ns?.interfaces[0]
  const ipv4 = data.connectivity?.ipv4?.latency_ms
  const ipv6 = data.connectivity?.ipv6?.latency_ms
  const ipv6Available = data.connectivity?.ipv6_available
  return (
    <HeroCard accent={theme.palette.info.main}>
      <Typography variant="caption" color="text.secondary">实时速率</Typography>
      <Box mt={.5}>
        <Box display="flex" alignItems="baseline" gap={.5}>
          <Typography variant="caption" color="text.secondary">下行</Typography>
          <Typography fontSize="clamp(1.5rem, 2.4vw, 2rem)" fontWeight={600} lineHeight={1} sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatSpeed(iface?.rx_bytes_per_sec ?? 0)}</Typography>
        </Box>
        <Box display="flex" alignItems="baseline" gap={.5} mt={.5}>
          <Typography variant="caption" color="text.secondary">上行</Typography>
          <Typography fontSize="clamp(1.1rem, 1.6vw, 1.4rem)" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }} color="text.secondary">{formatSpeed(iface?.tx_bytes_per_sec ?? 0)}</Typography>
        </Box>
        <Typography variant="caption" color="text.disabled" mt={.25} display="block">{iface?.interface ?? '—'}</Typography>
      </Box>
      <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1} mt={1.25} pt={1.25} borderTop="1px solid" borderColor="divider">
        <MiniMetric label="IPv4 延迟" value={typeof ipv4 === 'number' ? `${ipv4.toFixed(0)}` : undefined} unit="ms" />
        <MiniMetric
          label="IPv6 延迟"
          value={ipv6Available === false ? '未提供' : typeof ipv6 === 'number' ? `${ipv6.toFixed(0)}` : undefined}
          unit={ipv6Available === false ? undefined : 'ms'}
        />
      </Box>
    </HeroCard>
  )
}

function HeroContract({ data, theme }: { data: DashboardData; theme: Theme }) {
  const qos = data.qosInfo
  const qci = qos?.qci
  // 兼容旧服务：缺少 confirmed 时只信任 QCI 6..=9；显式 false 始终优先。
  const confirmed = typeof qci === 'number' && qci >= 6 && qci <= 9 && qos?.confirmed !== false
  return (
    <HeroCard accent={theme.palette.warning.main}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Typography variant="caption" color="text.secondary">承载 QoS 参数</Typography>
        <Chip size="small" label={confirmed ? `承载 QCI ${qci}` : '等待数据承载'} variant="outlined" />
      </Box>
      <Box mt={1}>
        <Typography variant="caption" color="text.secondary" display="block">承载下行速率</Typography>
        <Typography fontSize="clamp(1.2rem, 1.8vw, 1.5rem)" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>{confirmed ? formatBearerRate(qos?.dl_speed) : '—'}</Typography>
      </Box>
      <Box mt={1}>
        <Typography variant="caption" color="text.secondary" display="block">承载上行速率</Typography>
        <Typography fontSize="clamp(1.2rem, 1.8vw, 1.5rem)" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>{confirmed ? formatBearerRate(qos?.ul_speed) : '—'}</Typography>
      </Box>
      <Typography variant="caption" color="text.disabled" mt={1} display="block">模组上报，非套餐承诺</Typography>
    </HeroCard>
  )
}

function HeroTraffic({ data, theme }: { data: DashboardData; theme: Theme }) {
  const usage = data.trafficUsage
  const today = usage?.today
  const month = usage?.current_month
  const recent = (usage?.daily ?? []).slice(-14)
  const maxT = Math.max(...recent.map(r => r.total_bytes), 1)
  return (
    <HeroCard accent={theme.palette.primary.main}>
      <Box display="flex" justifyContent="space-between" alignItems="baseline" flexWrap="wrap" gap={1}>
        <Box display="flex" alignItems="baseline" gap={2} flexWrap="wrap">
          <Box>
            <Typography variant="caption" color="text.secondary" display="block">今日用量</Typography>
            <Typography fontSize="clamp(1.4rem, 2vw, 1.75rem)" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatBytes(today?.total_bytes ?? 0)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" display="block">本月累计</Typography>
            <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatBytes(month?.total_bytes ?? 0)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" display="block">下载 / 上传</Typography>
            <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatBytes(today?.rx_bytes ?? 0)} / {formatBytes(today?.tx_bytes ?? 0)}</Typography>
          </Box>
        </Box>
        <Typography variant="caption" color="text.disabled">近 14 天</Typography>
      </Box>
      <Box display="flex" gap={.4} height={56} alignItems="flex-end" mt={1.25}>
        {recent.length === 0
          ? <Typography variant="caption" color="text.secondary">等待流量统计</Typography>
          : recent.map((r, i) => (
            <Box
              key={r.period}
              flex={1}
              height={`${Math.max(3, (r.total_bytes / maxT) * 100)}%`}
              borderRadius={`${RADIUS.xs} ${RADIUS.xs} 0 0`}
              bgcolor={alpha(theme.palette.primary.main, 0.4 + 0.5 * (i / Math.max(1, recent.length - 1)))}
              title={`${r.period} · ${formatBytes(r.total_bytes)}`}
            />
          ))}
      </Box>
    </HeroCard>
  )
}

export default function ModernDashboard({ data, lastUpdatedAt, onToggleData, onToggleAirplaneMode, onToggleRoaming }: Props) {
  const theme = useTheme<Theme>()
  const stats = data.systemStats
  const home = stats?.disk?.find(item => item.mount_point === '/home')
  const temperatures = stats?.temperature?.slice(0, 4) ?? []
  const operator = localizeOperator(data.networkInfo?.operator_name, data.networkInfo?.mcc ?? data.simInfo?.mcc, data.networkInfo?.mnc ?? data.simInfo?.mnc)
  const online = Boolean(data.deviceInfo?.online)
  const lastSync = lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : '等待同步'
  const degradedSections = Object.entries(data.freshness).filter(([, value]) => value.state !== 'fresh')

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {/* 顶部关键指标卡：运营商/信号 · 实时速率 · 承载 QoS 参数 · 流量 */}
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', lg: 'minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, 0.85fr)' }, alignItems: 'stretch' }}>
        <HeroOperator data={data} theme={theme} />
        <HeroSpeed data={data} theme={theme} />
        <HeroContract data={data} theme={theme} />
      </Box>
      <HeroTraffic data={data} theme={theme} />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.55fr) minmax(340px, .75fr)' }, gap: 1.5, alignItems: 'start' }}>
        <SpeedPanel data={data} />
        <Box sx={{ display: 'grid', gap: 1.25 }}>
          <Panel><Heading title="系统资源" detail={`更新于 ${lastSync}`} /><Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: .75 }}>
            <Ring label="CPU" value={stats?.cpu_load?.load_percent ?? null} detail={stats?.cpu_load ? `负载 ${(stats.cpu_load.load_1min ?? 0).toFixed(2)}` : '—'} color={theme.palette.info.main} />
            <Ring label="内存" value={stats?.memory?.used_percent ?? null} detail={stats?.memory ? `${formatBytes(stats.memory.used_bytes)} / ${formatBytes(stats.memory.total_bytes)}` : '—'} color={theme.palette.secondary.main} />
            <Ring label="存储" value={home?.used_percent ?? null} detail={home ? `${formatBytes(home.used_bytes)} / ${formatBytes(home.total_bytes)}` : '—'} color={theme.palette.primary.light} />
          </Box></Panel>
          <Panel><Heading title="快捷控制" detail="只改变连接状态，不触发系统重启" /><Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: .65 }}>
            <ControlToggle icon={<SignalCellularAlt fontSize="small" />} label="数据" on={Boolean(data.dataStatus)} onClick={onToggleData} active={data.dataStatus} color="primary" />
            <ControlToggle icon={<Router fontSize="small" />} label="漫游" on={Boolean(data.roaming?.roaming_allowed)} onClick={onToggleRoaming} active={Boolean(data.roaming?.roaming_allowed)} color="secondary" />
            <ControlToggle icon={<PowerSettingsNew fontSize="small" />} label="飞行" on={Boolean(data.airplaneMode?.enabled)} onClick={onToggleAirplaneMode} active={Boolean(data.airplaneMode?.enabled)} color="warning" />
          </Box></Panel>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.55fr) minmax(340px, .75fr)' }, gap: 1.5, alignItems: 'start' }}>
        <QualityPanel data={data} />
        <Panel><Heading title="温度监控" detail="主要温区" /><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: .65 }}>
          {temperatures.map(sensor => (
            <Box key={sensor.zone} sx={{ px: .8, py: .65, border: '1px solid', borderColor: 'divider', borderRadius: RADIUS.md }}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Typography variant="caption" noWrap>{sensor.type}</Typography>
                <Typography variant="caption" fontWeight={800} color={`${getTempColor(sensor.temperature)}.main`}>{(sensor.temperature ?? 0).toFixed(1)}°C</Typography>
              </Box>
              <LinearProgress variant="determinate" value={temperatureToPercent(sensor.temperature ?? 0)} color={getTempColor(sensor.temperature)} sx={{ mt: .45, height: 4 }} />
            </Box>
          ))}
        </Box></Panel>
      </Box>

      <DetailPanel data={data} />

      <Box display="flex" justifyContent="flex-end" gap={1} flexWrap="wrap" alignItems="center">
        <Typography variant="caption" color="text.secondary">最后同步 {lastSync} · {operator.display} {online ? '在线' : '离线'}</Typography>
        {degradedSections.map(([section, value]) => (
          <Chip key={section} size="small" variant="outlined" color={value.state === 'unavailable' ? 'error' : 'warning'} label={`${section} ${value.state === 'stale' ? '延迟' : '不可用'}`} title={data.snapshotErrors[section]} />
        ))}
      </Box>
    </Box>
  )
}
