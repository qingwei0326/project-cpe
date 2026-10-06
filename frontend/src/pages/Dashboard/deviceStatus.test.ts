import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLeds, carrierCount, collectAlerts, dailyLevels, latencyDetail, latencyTone, litSegments, odometerCells, qciState, rsrpPosition, selectTemperatures, signalBars, splitBytes, temperatureLabel, vuLit,
} from './deviceStatus.ts'
import type { DashboardData } from './hooks/useDashboardData.ts'

function makeData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    deviceInfo: { imei: '1', manufacturer: 'Unisoc', model: 'UDX710', online: true, powered: true },
    simInfo: null,
    systemStats: null,
    trafficUsage: null,
    networkInfo: { operator_name: 'x', registration_status: 'registered', technology_preference: 'nr', signal_strength: 78 },
    dataStatus: true,
    cellsInfo: {
      serving_cell: { tech: 'NR', cell_id: 1, tac: 1 },
      cells: [{ is_serving: true, tech: 'NR', band: 'n41' }],
      ca: { active: true, scc_count: 2, bands: ['n41', 'n79', 'n28'] },
    },
    qosInfo: { qci: 9, confirmed: true, dl_speed: 1000000, ul_speed: 200000 },
    airplaneMode: { enabled: false, powered: true, online: true },
    imsStatus: null,
    connectivity: { ipv4: { success: true, latency_ms: 28 }, ipv6: { success: true, latency_ms: 31 }, ipv6_available: true },
    speedHistory: {},
    roaming: { roaming_allowed: false, is_roaming: false },
    freshness: {},
    snapshotErrors: {},
    ...overrides,
  }
}

void test('signal bars round to five LEDs and tolerate missing data', () => {
  assert.equal(signalBars(78), 4)
  assert.equal(signalBars(100), 5)
  assert.equal(signalBars(4), 0)
  assert.equal(signalBars(null), 0)
  assert.equal(signalBars(Number.NaN), 0)
})

void test('RSRP marker maps -140..-40 dBm onto the ruler and clamps outliers', () => {
  assert.equal(rsrpPosition(-95), 45)
  assert.equal(rsrpPosition(-200), 0)
  assert.equal(rsrpPosition(0), 100)
  assert.equal(rsrpPosition(null), null)
})

void test('segment meters clamp to their range', () => {
  assert.equal(litSegments(-11, -20, -3, 10), 5)
  assert.equal(litSegments(100, 0, 100, 10), 10)
  assert.equal(litSegments(-50, 0, 100, 10), 0)
  assert.equal(litSegments(undefined, 0, 100, 10), 0)
})

void test('QCI plate only turns healthy for a confirmed data bearer', () => {
  assert.deepEqual(qciState({ qci: 9, confirmed: true, dl_speed: 1, ul_speed: 1 }), { confirmed: true, tone: 'good', label: '承载 QCI 9' })
  // 旧服务缺少 confirmed 字段：QCI 6..=9 仍视为已确认。
  assert.equal(qciState({ qci: 8, dl_speed: 1, ul_speed: 1 }).confirmed, true)
  // 显式 false 始终优先。
  assert.equal(qciState({ qci: 9, confirmed: false, dl_speed: 1, ul_speed: 1 }).confirmed, false)
  assert.equal(qciState({ qci: 5, dl_speed: 1, ul_speed: 1 }).tone, 'warn')
  assert.equal(qciState(null).label, '等待数据承载')
})

void test('odometer pads the integer part and keeps the decimal point as its own cell', () => {
  assert.deepEqual(odometerCells('3.6').map((cell) => cell.char), ['0', '3', '.', '6'])
  assert.deepEqual(odometerCells('128').map((cell) => cell.char), ['1', '2', '8'])
  assert.equal(odometerCells('3.6')[2]?.isDot, true)
  assert.deepEqual(splitBytes(3.6 * 1024 ** 3), { value: '3.6', unit: 'GB' })
})

void test('daily levels use a log scale so one huge day does not flatten the rest', () => {
  const MB = 1024 * 1024
  const day = (total: number) => ({ period: 'd', rx_bytes: total, tx_bytes: 0, total_bytes: total, samples: 1 })
  const levels = dailyLevels([day(1 * MB), day(10 * MB), day(100 * MB)])
  assert.equal(levels[2], 100)
  assert.ok((levels[0] ?? 0) < (levels[1] ?? 0) && (levels[1] ?? 0) < (levels[2] ?? 0))
  // 真机：某天 693 GB，今天 46 MB，其余为 0。
  const real = dailyLevels([day(0), day(693 * 1024 * MB), day(0), day(46 * MB)])
  assert.equal(real[0], 0)
  assert.equal(real[1], 100)
  assert.ok((real[3] ?? 0) >= 20, 'a small day must stay clearly visible next to the outlier')
  assert.deepEqual(dailyLevels(undefined), [])
  assert.deepEqual(dailyLevels([day(0), day(0)]), [0, 0])
  assert.equal(dailyLevels(Array.from({ length: 20 }, () => day(MB))).length, 14)
})

void test('carrier aggregation counts carriers including the primary one', () => {
  assert.equal(carrierCount(makeData()), 3)
  const noBands = makeData({ cellsInfo: { serving_cell: { tech: 'NR', cell_id: 1, tac: 1 }, cells: [], ca: { active: true, scc_count: 1, bands: [] } } })
  assert.equal(carrierCount(noBands), 2)
  const inactive = makeData({ cellsInfo: { serving_cell: { tech: 'NR', cell_id: 1, tac: 1 }, cells: [], ca: { active: false, scc_count: 0, bands: [] } } })
  assert.equal(carrierCount(inactive), null)
})

void test('healthy device lights the panel and raises no alerts', () => {
  const data = makeData()
  assert.deepEqual(collectAlerts(data), [])
  const leds = Object.fromEntries(buildLeds(data).map((led) => [led.key, led]))
  assert.equal(leds.radio?.glyph, '5G')
  assert.equal(leds.radio?.on, true)
  assert.equal(leds.signal?.bars, 4)
  assert.equal(leds.ipv4?.small, '28 ms')
  assert.equal(leds.ipv6?.small, '31 ms')
  // 漫游 / 飞行不占灯位。
  assert.equal(leds.roaming, undefined)
  assert.equal(leds.airplane, undefined)
})

void test('abnormal states surface as alerts and light the matching LEDs', () => {
  const data = makeData({
    dataStatus: false,
    roaming: { roaming_allowed: true, is_roaming: true },
    connectivity: { ipv4: { success: false }, ipv6: { success: false }, ipv6_available: false },
  })
  const labels = collectAlerts(data).map((alert) => alert.label)
  assert.deepEqual(labels, ['移动数据已断开', '正在漫游', 'IPv4 联网失败'])
  const leds = Object.fromEntries(buildLeds(data).map((led) => [led.key, led]))
  assert.equal(leds.data?.on, false)
  assert.equal(leds.data?.small, '已断开')
  assert.equal(leds.ipv4?.on, false)
  assert.equal(leds.ipv4?.tone, 'bad')
  assert.equal(leds.ipv4?.small, '不通')
})

void test('airplane mode replaces the generic data-off alert', () => {
  const data = makeData({ dataStatus: false, airplaneMode: { enabled: true, powered: false, online: false } })
  assert.deepEqual(collectAlerts(data).map((alert) => alert.key), ['airplane'])
})

void test('an unavailable data source does not fake a disconnected alert', () => {
  const data = makeData({ dataStatus: false, freshness: { data: { sampled_at: null, age_seconds: null, state: 'unavailable' } } })
  assert.equal(collectAlerts(data).some((alert) => alert.key === 'data'), false)
})

void test('days without traffic stay dark while tiny non-zero days still light one segment', () => {
  assert.equal(vuLit(0, 10), 0)
  assert.equal(vuLit(Number.NaN, 10), 0)
  // 真机上有一天高达 693 GB，今天只有 46 MB：占比不足 1 格也要亮 1 格，才能和零流量区分开。
  assert.equal(vuLit(0.01, 10), 1)
  assert.equal(vuLit(100, 10), 10)
})


void test('LEDs follow the link chain order and carrier aggregation never takes a lamp', () => {
  const keys = buildLeds(makeData()).map((led) => led.key)
  assert.deepEqual(keys, ['power', 'radio', 'signal', 'data', 'ipv4', 'ipv6', 'temp'])
  assert.equal(keys.includes('ca'), false)
})

void test('an operator without IPv6 shows the lamp as unavailable instead of failed', () => {
  const data = makeData({ connectivity: { ipv4: { success: true, latency_ms: 28 }, ipv6: { success: false }, ipv6_available: false } })
  const ipv6 = buildLeds(data).find((led) => led.key === 'ipv6')
  assert.equal(ipv6?.on, false)
  assert.equal(ipv6?.tone, 'warn')
  assert.equal(ipv6?.small, '未提供')
})

void test('latency is graded against the backend degraded threshold instead of always green', () => {
  assert.equal(latencyTone(28), 'good')
  assert.equal(latencyTone(79.9), 'good')
  // 真机上 IPv4 122 ms / IPv6 96 ms：都应该提醒，而不是绿灯。
  assert.equal(latencyTone(96), 'warn')
  assert.equal(latencyTone(122), 'warn')
  assert.equal(latencyTone(150), 'bad')
  assert.equal(latencyTone(undefined), 'good')
})

void test('slow but working paths light the lamp amber and carry min / max / loss details', () => {
  const data = makeData({
    connectivity: {
      ipv4: { success: true, latency_ms: 122, min_latency_ms: 41.2, max_latency_ms: 260, packet_loss_percent: 0 },
      ipv6: { success: true, latency_ms: 96 },
      ipv6_available: true,
    },
  })
  const leds = Object.fromEntries(buildLeds(data).map((led) => [led.key, led]))
  assert.equal(leds.ipv4?.tone, 'warn')
  assert.equal(leds.ipv4?.on, true)
  assert.equal(leds.ipv4?.detail, '最低 41 · 最高 260 · 丢包 0%')
  assert.equal(leds.ipv6?.tone, 'warn')
  assert.equal(leds.ipv6?.detail, '')
})

void test('latency details are empty for failed probes and tolerate missing fields', () => {
  assert.equal(latencyDetail({ success: false }), '')
  assert.equal(latencyDetail(undefined), '')
  assert.equal(latencyDetail({ success: true, packet_loss_percent: 33.3 }), '丢包 33%')
})

void test('only the representative temperature sensors are shown, with readable names', () => {
  const zone = (name: string, celsius: number) => ({ zone: name, type: name, temperature: celsius })
  // 真机上的四个传感器。
  const real = [zone('soc-thmzone', 34.4), zone('apcpu0-thmzone', 33.2), zone('nrcp-thmzone', 34.3), zone('apcpu1-thmzone', 34.1)]
  const picked = selectTemperatures(real)
  assert.deepEqual(picked.map((item) => item.label), ['SoC', '5G 基带'])
  assert.deepEqual(picked.map((item) => item.celsius), [34.4, 34.3])
  // 缺基带时用剩余里最热的补位。
  assert.deepEqual(selectTemperatures([zone('soc-thmzone', 40), zone('apcpu0-thmzone', 50), zone('apcpu1-thmzone', 45)]).map((item) => item.label), ['SoC', 'CPU'])
  assert.deepEqual(selectTemperatures(undefined), [])
  assert.equal(temperatureLabel('gpu-thmzone'), 'gpu')
})

void test('degraded data sources are reported in the alert strip instead of a hidden footer', () => {
  const data = makeData({
    freshness: {
      traffic: { sampled_at: null, age_seconds: null, state: 'unavailable' },
      cells: { sampled_at: 'x', age_seconds: 99, state: 'stale' },
      stats: { sampled_at: 'x', age_seconds: 1, state: 'fresh' },
    },
    snapshotErrors: { traffic: 'db locked' },
  })
  const alerts = collectAlerts(data).filter((alert) => alert.key.startsWith('section-'))
  assert.deepEqual(alerts.map((alert) => [alert.label, alert.tone]), [['流量统计不可用', 'bad'], ['小区信息数据延迟', 'warn']])
  assert.equal(alerts[0]?.title, 'db locked')
})
