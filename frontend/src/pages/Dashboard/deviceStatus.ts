// 仪表盘「设备前面板」的纯逻辑：把后端数据映射为指示灯、告警与各类读数。
// 不依赖 React / 路径别名，便于直接用 node:test 覆盖。
import type { DashboardData, PingSummary } from './hooks/useDashboardData.ts'
import type { QosInfo, ThermalZone, TrafficUsagePeriod } from '../../api/types.ts'
import { formatBytes, formatSpeed } from './utils.ts'

export type Tone = 'good' | 'info' | 'warn' | 'bad'

/** RSRP 标尺范围，与前面板上的刻度（-140 ~ -40 dBm）保持一致。 */
export const RSRP_MIN = -140
export const RSRP_MAX = -40
/** 温度条以 120°C 为满格。 */
export const TEMPERATURE_FULL_SCALE_C = 120

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** 把数值线性映射到 0..segments 的亮灯数。 */
export function litSegments(value: number | null | undefined, min: number, max: number, segments: number): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0
  return Math.round(clamp((value - min) / (max - min), 0, 1) * segments)
}

/** 5 格信号灯：按百分比四舍五入。 */
export function signalBars(percent: number | null | undefined): number {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return 0
  return clamp(Math.round(percent / 20), 0, 5)
}

/** RSRP 在标尺上的位置（0~100），无数据返回 null。 */
export function rsrpPosition(rsrp: number | null): number | null {
  if (rsrp === null || !Number.isFinite(rsrp)) return null
  return clamp(((rsrp - RSRP_MIN) / (RSRP_MAX - RSRP_MIN)) * 100, 0, 100)
}

/** 用量类指标：越高越危险。 */
export function loadTone(percent: number | null | undefined, warnAt: number, badAt: number): Tone {
  if (percent === null || percent === undefined) return 'good'
  if (percent >= badAt) return 'bad'
  if (percent >= warnAt) return 'warn'
  return 'good'
}

export function temperatureTone(celsius: number): Tone {
  return loadTone(celsius, 60, 70)
}

/** 信号质量类指标：越高越好。 */
export function qualityTone(value: number | null, warnBelow: number, badBelow: number): Tone {
  if (value === null) return 'info'
  if (value < badBelow) return 'bad'
  if (value < warnBelow) return 'warn'
  return 'good'
}

export interface QciState {
  confirmed: boolean
  /** 数据承载未确认或 QCI 不在常见数据承载范围时给出警示。 */
  tone: Tone
  label: string
}

/** 兼容旧服务：缺少 confirmed 时只信任 QCI 6..=9；显式 false 始终优先。 */
export function qciState(qos: QosInfo | null | undefined): QciState {
  const qci = qos?.qci
  const confirmed = typeof qci === 'number' && qci >= 6 && qci <= 9 && qos?.confirmed !== false
  if (confirmed) return { confirmed, tone: 'good', label: `承载 QCI ${qci}` }
  if (typeof qci === 'number' && qos?.confirmed !== false) {
    return { confirmed, tone: 'warn', label: `QCI ${qci}（非数据承载）` }
  }
  return { confirmed, tone: 'warn', label: '等待数据承载' }
}

export interface OdometerCell {
  char: string
  isDot: boolean
}

/** 拆出「3.6 GB」这样的数值与单位。 */
export function splitBytes(bytes: number): { value: string; unit: string } {
  const [value = '0', unit = 'B'] = formatBytes(bytes).split(' ')
  return { value, unit }
}

/** 里程表格子：整数部分至少两位，小数点单独成格。 */
export function odometerCells(value: string): OdometerCell[] {
  const [int = '0', frac] = value.split('.')
  const padded = int.padStart(2, '0')
  const cells: OdometerCell[] = [...padded].map((char) => ({ char, isDot: false }))
  if (frac !== undefined) {
    cells.push({ char: '.', isDot: true })
    for (const char of frac) cells.push({ char, isDot: false })
  }
  return cells
}

const MEGABYTE = 1024 * 1024

/**
 * 最近 N 天用量的相对高度（0~100），最大值为 100。
 *
 * 按对数刻度：真机上某一天高达 693 GB，线性比例会把今天的 46 MB 压成看不见的一格，
 * 对数刻度能同时看清大流量日和小流量日；零流量日始终为 0。
 */
export function dailyLevels(daily: TrafficUsagePeriod[] | undefined, count = 14): number[] {
  const recent = (daily ?? []).slice(-count)
  const scale = (bytes: number) => (bytes > 0 ? Math.log1p(bytes / MEGABYTE) : 0)
  const peak = Math.max(...recent.map((item) => scale(item.total_bytes)), 0)
  if (peak === 0) return recent.map(() => 0)
  return recent.map((item) => Math.round((scale(item.total_bytes) / peak) * 100))
}

/** 电平柱亮几格：没有流量的日子一格不亮，有流量至少亮 1 格。 */
export function vuLit(level: number, segments: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0
  return clamp(Math.round((level / 100) * segments), 1, segments)
}

export interface LedSpec {
  key: string
  label: string
  /** 灯上方的图标：glyph 为文字，其余用 icon 名称。 */
  glyph?: string
  icon?: 'power' | 'data' | 'temperature' | 'signal'
  tone: Tone
  on: boolean
  small: string
  /** 仅信号灯使用：点亮的格数（0~5）。 */
  bars?: number
  /** 悬停提示等补充信息。 */
  detail?: string
}

export interface PanelAlert {
  key: string
  label: string
  /** 可在数据网络页处理的告警给出跳转目标。 */
  to?: string
  /** 悬停提示（例如后端返回的错误原因）。 */
  title?: string
  tone: Tone
}

const SECTION_LABELS: Record<string, string> = {
  device: '设备信息',
  sim: 'SIM 卡',
  network: '网络信息',
  cells: '小区信息',
  qos: 'QoS',
  data: '移动数据',
  roaming: '漫游状态',
  airplane_mode: '飞行模式',
  ims: 'IMS',
  connectivity: '联网检测',
  stats: '系统状态',
  traffic: '流量统计',
}

export function primaryCell(data: DashboardData) {
  return data.cellsInfo?.cells?.find((cell) => cell.is_serving) ?? data.cellsInfo?.cells?.[0]
}

const TEMPERATURE_LABELS: { pattern: RegExp; label: string }[] = [
  { pattern: /soc/i, label: 'SoC' },
  { pattern: /nrcp|modem|baseband/i, label: '5G 基带' },
  { pattern: /cpu/i, label: 'CPU' },
]

/** 把 `soc-thmzone` 这类原始名字换成人能看懂的名称。 */
export function temperatureLabel(type: string): string {
  for (const { pattern, label } of TEMPERATURE_LABELS) if (pattern.test(type)) return label
  return type.replace(/-?thmzone$/i, '') || type
}

export interface TemperatureReading {
  key: string
  label: string
  type: string
  celsius: number
}

/**
 * 只展示最有代表性的传感器：优先 SoC 与 5G 基带；缺哪个就用剩余里最热的补上。
 * 真机上四个传感器读数都在 33~34°C，全部列出来只是噪音。
 */
export function selectTemperatures(sensors: ThermalZone[] | undefined, count = 2): TemperatureReading[] {
  const readings: TemperatureReading[] = (sensors ?? [])
    .filter((sensor) => Number.isFinite(sensor.temperature))
    .map((sensor) => ({ key: sensor.zone, label: temperatureLabel(sensor.type), type: sensor.type, celsius: sensor.temperature }))
  const picked: TemperatureReading[] = []
  for (const wanted of ['SoC', '5G 基带']) {
    const found = readings.find((reading) => reading.label === wanted)
    if (found) picked.push(found)
  }
  const rest = readings.filter((reading) => !picked.includes(reading)).sort((a, b) => b.celsius - a.celsius)
  return [...picked, ...rest].slice(0, count)
}

export function hottestTemperature(data: DashboardData): number | null {
  const values = (data.systemStats?.temperature ?? [])
    .map((sensor) => sensor.temperature)
    .filter((value) => Number.isFinite(value))
  return values.length > 0 ? Math.max(...values) : null
}

/** 载波聚合的载波数（含主载波）。 */
export function carrierCount(data: DashboardData): number | null {
  const ca = data.cellsInfo?.ca
  if (!ca?.active) return null
  return ca.bands.length > 0 ? ca.bands.length : ca.scc_count + 1
}

function radioGeneration(data: DashboardData): '5G' | '4G' | null {
  const tech = (primaryCell(data)?.tech ?? data.cellsInfo?.serving_cell.tech ?? data.networkInfo?.technology_preference ?? '').toLowerCase()
  if (tech.includes('nr') || tech.includes('5g')) return '5G'
  if (tech.includes('lte') || tech.includes('4g')) return '4G'
  return null
}

/** 移动网络往返延迟的分档：与后端「劣化」线（150 ms）对齐。 */
export const LATENCY_WARN_MS = 80
export const LATENCY_BAD_MS = 150

export function latencyTone(milliseconds: number | undefined): Tone {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) return 'good'
  if (milliseconds >= LATENCY_BAD_MS) return 'bad'
  if (milliseconds >= LATENCY_WARN_MS) return 'warn'
  return 'good'
}

/**
 * 延迟明细：最低 / 最高 / 丢包。
 * 平均值会被「空闲后第一个包要先唤醒无线连接」拉高，
 * 最低值才接近链路真实水平，所以把它们一起展示。
 */
export function latencyDetail(result: PingSummary | undefined): string {
  if (!result?.success) return ''
  const parts: string[] = []
  if (typeof result.min_latency_ms === 'number') parts.push(`最低 ${Math.round(result.min_latency_ms)}`)
  if (typeof result.max_latency_ms === 'number') parts.push(`最高 ${Math.round(result.max_latency_ms)}`)
  if (typeof result.packet_loss_percent === 'number') parts.push(`丢包 ${Number(result.packet_loss_percent.toFixed(0))}%`)
  return parts.join(' · ')
}

/** 延迟的灯：成功按延迟分档，失败为红灯。 */
function latencyLed(key: string, glyph: string, result: PingSummary | undefined, unavailable = false): LedSpec {
  if (unavailable) return { key, label: '延迟', glyph, tone: 'warn', on: false, small: '未提供' }
  const ok = Boolean(result?.success)
  return {
    key, label: '延迟', glyph,
    tone: ok ? latencyTone(result?.latency_ms) : 'bad', on: ok,
    small: ok && typeof result?.latency_ms === 'number' ? `${Math.round(result.latency_ms)} ms` : result ? '不通' : '—',
    detail: latencyDetail(result),
  }
}

/**
 * 前面板指示灯。顺序即链路自下而上：
 * 电源 → 无线制式 → 信号 → 数据 → IPv4 → IPv6 → 温度。
 * 漫游 / 飞行不占灯位：它们开启时会在异常提示区亮标签。
 * 载波聚合不占灯位（不是所有设备都支持），详情见「连接质量」。
 */
export function buildLeds(data: DashboardData): LedSpec[] {
  const generation = radioGeneration(data)
  const band = primaryCell(data)?.band
  const percent = data.networkInfo?.signal_strength ?? null
  const rx = data.systemStats?.network_speed.interfaces.find((item) => item.interface === 'sipa_eth0')
    ?? data.systemStats?.network_speed.interfaces[0]
  const hottest = hottestTemperature(data)
  const registered = data.networkInfo?.registration_status === 'registered'

  return [
    {
      key: 'power', label: '电源', icon: 'power',
      tone: data.deviceInfo?.powered ? 'good' : 'bad', on: Boolean(data.deviceInfo?.powered),
      small: data.deviceInfo ? (data.deviceInfo.online ? '在线' : '离线') : '—',
    },
    {
      key: 'radio', label: generation === '4G' ? 'LTE' : 'NR', glyph: generation ?? '--',
      tone: generation === '5G' ? 'info' : generation === '4G' ? 'warn' : 'bad',
      on: generation !== null && registered, small: band ?? '—',
    },
    {
      key: 'signal', label: '信号', icon: 'signal', bars: signalBars(percent),
      tone: qualityTone(percent, 50, 25), on: percent !== null && percent > 0,
      small: percent === null ? '—' : `${percent}%`,
    },
    {
      key: 'data', label: '数据', icon: 'data',
      tone: data.dataStatus ? 'good' : 'bad', on: data.dataStatus,
      small: data.dataStatus ? formatSpeed(rx?.rx_bytes_per_sec ?? 0) : '已断开',
    },
    latencyLed('ipv4', 'IPv4', data.connectivity?.ipv4),
    latencyLed('ipv6', 'IPv6', data.connectivity?.ipv6, data.connectivity?.ipv6_available === false),
    {
      key: 'temp', label: '温度', icon: 'temperature',
      tone: hottest === null ? 'good' : temperatureTone(hottest), on: hottest !== null,
      small: hottest === null ? '—' : `${Math.round(hottest)}°C`,
    },
  ]
}

/** 异常提示：全部正常时返回空数组，前面板不显示任何提示。 */
export function collectAlerts(data: DashboardData): PanelAlert[] {
  const alerts: PanelAlert[] = []
  const dataFresh = data.freshness.data?.state !== 'unavailable'
  if (data.deviceInfo && !data.deviceInfo.online) alerts.push({ key: 'offline', label: '设备离线', tone: 'bad' })
  if (data.simInfo && !data.simInfo.present) alerts.push({ key: 'sim', label: '未检测到 SIM 卡', tone: 'bad' })
  if (data.airplaneMode?.enabled) alerts.push({ key: 'airplane', label: '飞行模式已开启', to: '/data-network', tone: 'warn' })
  else if (data.deviceInfo && dataFresh && !data.dataStatus) alerts.push({ key: 'data', label: '移动数据已断开', to: '/data-network', tone: 'warn' })
  if (data.roaming?.is_roaming) alerts.push({ key: 'roaming', label: '正在漫游', to: '/data-network', tone: 'warn' })
  if (data.connectivity && !data.connectivity.ipv4.success) alerts.push({ key: 'ipv4', label: 'IPv4 联网失败', tone: 'bad' })
  const hottest = hottestTemperature(data)
  if (hottest !== null && temperatureTone(hottest) === 'bad') alerts.push({ key: 'temp', label: `温度过高 ${Math.round(hottest)}°C`, tone: 'bad' })
  for (const [section, freshness] of Object.entries(data.freshness)) {
    if (freshness.state === 'fresh') continue
    const name = SECTION_LABELS[section] ?? section
    alerts.push({
      key: `section-${section}`,
      label: freshness.state === 'unavailable' ? `${name}不可用` : `${name}数据延迟`,
      title: data.snapshotErrors[section],
      tone: freshness.state === 'unavailable' ? 'bad' : 'warn',
    })
  }
  return alerts
}
