import type { DashboardData } from '../hooks/useDashboardData'
import {
  TEMPERATURE_FULL_SCALE_C, carrierCount, dailyLevels, latencyDetail, latencyTone, litSegments, loadTone, odometerCells, primaryCell, qciState, qualityTone, rsrpPosition, selectTemperatures, splitBytes, vuLit,
  type Tone,
} from '../deviceStatus'
import { convertSignalValue, formatBearerRate, formatBytes, formatSignalValue, formatSpeed } from '../utils'
import FacePanel from './FacePanel'
import './device.css'

interface Props { data: DashboardData; lastUpdatedAt: number | null }

const WAVE_W = 300
const WAVE_H = 110

function Seg({ value, min, max, segments = 10, tone, tall }: { value: number | null; min: number; max: number; segments?: number; tone: Tone; tall?: boolean }) {
  const lit = litSegments(value, min, max, segments)
  return (
    <div className={`dv-seg dv-tone-${tone}${tall ? ' dv-seg-tall' : ''}`} aria-hidden="true">
      {Array.from({ length: segments }, (_, index) => <i key={index} className={index < lit ? 'is-on' : undefined} />)}
    </div>
  )
}

/** 少于该点数时折线没有意义，显示「正在累积采样点」。 */
const WAVE_MIN_POINTS = 4

function wavePoints(values: number[], peak: number): string {
  if (values.length < WAVE_MIN_POINTS) return ''
  return values.map((value, index) => `${((index / (values.length - 1)) * WAVE_W).toFixed(1)},${(WAVE_H - 6 - (value / peak) * (WAVE_H - 18)).toFixed(1)}`).join(' ')
}

function LinkPanel({ data }: { data: DashboardData }) {
  const cell = primaryCell(data)
  const cells = data.cellsInfo?.cells?.slice(0, 4) ?? []
  const rsrp = convertSignalValue(cell?.rsrp)
  const rsrq = convertSignalValue(cell?.rsrq)
  const sinr = convertSignalValue(cell?.sinr)
  const percent = data.networkInfo?.signal_strength ?? null
  const position = rsrpPosition(rsrp)
  const qci = qciState(data.qosInfo)
  const serving = data.cellsInfo?.serving_cell
  const bands = data.cellsInfo?.ca?.active ? data.cellsInfo.ca.bands : []
  const carriers = carrierCount(data)
  const neighbors = cells.filter((item) => !item.is_serving)
  const cellIdParts = [
    `PCI ${cell?.pci ?? '—'}`,
    `频点 ${cell?.arfcn ?? cell?.earfcn ?? '—'}`,
    ...(serving?.tac ? [`TAC ${serving.tac}`] : []),
    // 部分调制解调器不上报 CID，恒为 0，显示出来是误导，所以为 0 时隐藏。
    ...(serving?.cell_id ? [`CID ${serving.cell_id}`] : []),
  ]

  return (
    <section className="dv-panel dv-w7" aria-label="连接质量">
      <h2 className="dv-engr"><b>连接质量</b> · LINK</h2>
      <div className="dv-well">
        <div className="dv-ruler">
          <div className="dv-ruler-top">
            <span className="dv-ruler-nm">RSRP · 参考信号接收功率</span>
            <span className="dv-ruler-val">{rsrp === null ? '—' : rsrp.toFixed(1)}<small>dBm</small></span>
          </div>
          <div className="dv-track">{position !== null && <div className="dv-mark" style={{ left: `${position}%` }} />}</div>
          <div className="dv-ticks" aria-hidden="true">{[-140, -120, -100, -80, -60, -40].map((tick) => <span key={tick}>{tick}</span>)}</div>
        </div>
        <div className="dv-mrows">
          <div className="dv-mrow"><span className="dv-mrow-n">信号</span><Seg value={percent} min={0} max={100} tone={qualityTone(percent, 50, 25)} /><span className="dv-mrow-v">{percent ?? '—'}<small> %</small></span></div>
          <div className="dv-mrow"><span className="dv-mrow-n">RSRQ</span><Seg value={rsrq} min={-20} max={-3} tone={qualityTone(rsrq, -12, -16)} /><span className="dv-mrow-v">{rsrq === null ? '—' : rsrq.toFixed(1)}<small> dB</small></span></div>
          <div className={`dv-mrow${carriers === null ? ' dv-mrow-wide' : ''}`}><span className="dv-mrow-n">SINR</span><Seg value={sinr} min={-5} max={30} tone={qualityTone(sinr, 10, 0)} /><span className="dv-mrow-v">{sinr === null ? '—' : sinr.toFixed(1)}<small> dB</small></span></div>
          {carriers !== null && (
            <div className="dv-mrow">
              <span className="dv-mrow-n">载波聚合</span>
              <div className="dv-ca">{bands.length > 0 ? bands.map((band) => <span key={band} className="dv-chip">{band}</span>) : <span className="dv-chip dv-chip-off">{`${carriers}CC`}</span>}</div>
              <span className="dv-mrow-v">×{carriers}</span>
            </div>
          )}
          <div className="dv-cellid">{cellIdParts.join(' · ')}</div>
        </div>
      </div>

      <div className="dv-platerow">
        <div className={`dv-plate dv-tone-${qci.tone}`}>
          <div className="dv-plate-k"><small>QCI</small>{qci.label}</div>
          <div className="dv-plate-d">
            <div><small>承载下行</small><b>{qci.confirmed ? formatBearerRate(data.qosInfo?.dl_speed) : '—'}</b></div>
            <div><small>承载上行</small><b>{qci.confirmed ? formatBearerRate(data.qosInfo?.ul_speed) : '—'}</b></div>
          </div>
        </div>
      </div>

      <div className="dv-lcd">
        <div className="dv-tw">
          <table className="dv-cells">
            <thead><tr><th>小区</th><th>PCI · 频点</th><th>RSRP</th><th>RSRQ</th><th>SINR</th></tr></thead>
            <tbody>
              {cells.map((item, index) => {
                const weak = (convertSignalValue(item.rsrp) ?? 0) <= -105 && convertSignalValue(item.rsrp) !== null
                return (
                  <tr key={`${item.pci}-${item.arfcn}-${item.earfcn}-${index}`} className={item.is_serving ? 'is-serving' : undefined}>
                    <td>{item.is_serving ? '▶ 服务小区' : `邻区 ${neighbors.indexOf(item) + 1}`}{item.band ? ` · ${item.band}` : ''}</td>
                    <td>{item.pci ?? '—'} · {item.arfcn ?? item.earfcn ?? '—'}</td>
                    <td className={weak ? 'is-weak' : undefined}>{formatSignalValue(item.rsrp)} dBm</td>
                    <td>{formatSignalValue(item.rsrq)} dB</td>
                    <td>{formatSignalValue(item.sinr)} dB</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {cells.length === 0 && <div className="dv-empty">等待小区采样</div>}
        </div>
      </div>
    </section>
  )
}

function ThroughputPanel({ data }: { data: DashboardData }) {
  const interfaces = data.systemStats?.network_speed.interfaces ?? []
  const iface = interfaces.find((item) => item.interface === 'sipa_eth0') ?? interfaces[0]
  const history = iface ? data.speedHistory[iface.interface] : undefined
  const rx = history?.rx ?? []
  const tx = history?.tx ?? []
  const peak = Math.max(...rx, ...tx, 1)
  const rxPoints = wavePoints(rx, peak)
  const txPoints = wavePoints(tx, peak)
  const rate = (bytes: number) => {
    const [value = '0', unit = 'B/s'] = formatSpeed(bytes).split(' ')
    return { value, unit }
  }
  const down = rate(iface?.rx_bytes_per_sec ?? 0)
  const up = rate(iface?.tx_bytes_per_sec ?? 0)
  const v4 = data.connectivity?.ipv4.latency_ms
  const v6 = data.connectivity?.ipv6.latency_ms

  return (
    <section className="dv-panel dv-w5" aria-label="吞吐">
      <h2 className="dv-engr"><b>吞吐</b> · THROUGHPUT{iface ? ` · ${iface.interface}` : ''}</h2>
      <div className="dv-lcd dv-tp">
        <div className="dv-big dv-glow">
          <div className="dv-big-n">{down.value}<small>{down.unit} ▼</small></div>
          <div className="dv-big-n dv-big-up">{up.value}<small>{up.unit} ▲</small></div>
        </div>
        <div className="dv-scope-wrap">
          <svg className="dv-wave" viewBox={`0 0 ${WAVE_W} ${WAVE_H}`} preserveAspectRatio="none" aria-hidden="true">
            {[27, 55, 83].map((y) => <line key={y} className="gr" x1="0" y1={y} x2={WAVE_W} y2={y} />)}
            {[75, 150, 225].map((x) => <line key={x} className="gr" x1={x} y1="0" x2={x} y2={WAVE_H} />)}
            {rxPoints && <polygon className="ar" points={`0,${WAVE_H} ${rxPoints} ${WAVE_W},${WAVE_H}`} />}
            {rxPoints && <polyline className="l1" points={rxPoints} />}
            {txPoints && <polyline className="l2" points={txPoints} />}
          </svg>
          {rx.length < WAVE_MIN_POINTS && <div className="dv-wave-hint">正在累积采样点…</div>}
        </div>
        <div className="dv-legend"><span><i style={{ background: 'var(--dv-lcd-ink)' }} />下行</span><span><i style={{ background: 'var(--dv-cyan)' }} />上行</span><span style={{ marginLeft: 'auto' }}>{rx.length > 0 ? `${rx.length} 点` : ''}</span></div>
        <div className="dv-kvl">
          <div><small>IPv4 延迟</small><b className={`dv-glow dv-lat-${latencyTone(v4)}`}>{typeof v4 === 'number' ? `${Math.round(v4)} ms` : '—'}</b><em>{latencyDetail(data.connectivity?.ipv4)}</em></div>
          <div><small>IPv6 延迟</small><b className={`dv-glow dv-lat-${latencyTone(v6)}`}>{data.connectivity?.ipv6_available === false ? '未提供' : typeof v6 === 'number' ? `${Math.round(v6)} ms` : '—'}</b><em>{data.connectivity?.ipv6_available === false ? '' : latencyDetail(data.connectivity?.ipv6)}</em></div>
        </div>
      </div>
    </section>
  )
}

function UsagePanel({ data }: { data: DashboardData }) {
  const usage = data.trafficUsage
  const today = splitBytes(usage?.today.total_bytes ?? 0)
  const levels = dailyLevels(usage?.daily)
  const segments = 10

  return (
    <section className="dv-panel dv-w7" aria-label="流量用量">
      <h2 className="dv-engr"><b>用量</b> · TRAFFIC · 近 14 天</h2>
      <div className="dv-urow">
        <div>
          <span className="dv-lb">今日</span>
          <div className="dv-odo" role="text" aria-label={`今日 ${today.value} ${today.unit}`}>
            {odometerCells(today.value).map((cell, index) => <i key={index} className={cell.isDot ? 'is-dot' : undefined} aria-hidden="true">{cell.char}</i>)}
            <span className="dv-odo-unit">{today.unit}</span>
          </div>
        </div>
        <div className="dv-usub"><small>本月累计</small><b>{formatBytes(usage?.current_month.total_bytes ?? 0)}</b></div>
        <div className="dv-usub"><small>下载 / 上传</small><b>{formatBytes(usage?.today.rx_bytes ?? 0)} / {formatBytes(usage?.today.tx_bytes ?? 0)}</b></div>
      </div>
      {levels.length === 0
        ? <p className="dv-nodata">等待流量统计</p>
        : (
          <>
            <div className="dv-vu" role="img" aria-label="近 14 天每日用量相对高度">
              {levels.map((level, column) => {
                const lit = vuLit(level, segments)
                return (
                  <div key={column} className="dv-vu-col" title={`${usage?.daily.slice(-14)[column]?.period ?? ''} · ${formatBytes(usage?.daily.slice(-14)[column]?.total_bytes ?? 0)}`}>
                    {Array.from({ length: segments }, (_, index) => <i key={index} className={`${index < lit ? 'is-on ' : ''}${index < 6 ? 'dv-tone-good' : 'dv-tone-warn'}`} />)}
                  </div>
                )
              })}
            </div>
            <div className="dv-vu-lab"><span>-{levels.length} 天</span><span>今天</span></div>
          </>
        )}
    </section>
  )
}

function HealthPanel({ data }: { data: DashboardData }) {
  const stats = data.systemStats
  const disk = stats?.disk.find((item) => item.mount_point === '/home') ?? stats?.disk.find((item) => item.mount_point === '/mnt/data') ?? stats?.disk[0]
  const rows: { name: string; percent: number | null; tone: Tone }[] = [
    { name: 'CPU', percent: stats?.cpu_load.load_percent ?? null, tone: loadTone(stats?.cpu_load.load_percent, 70, 90) },
    { name: '内存', percent: stats?.memory.used_percent ?? null, tone: loadTone(stats?.memory.used_percent, 70, 90) },
    { name: '存储', percent: disk?.used_percent ?? null, tone: loadTone(disk?.used_percent, 70, 85) },
  ]
  const temperatures = selectTemperatures(stats?.temperature)

  return (
    <section className="dv-panel dv-w5" aria-label="设备健康">
      <h2 className="dv-engr"><b>设备健康</b> · HEALTH</h2>
      {rows.map((row) => (
        <div key={row.name} className="dv-hrow">
          <span className="dv-hrow-n">{row.name}</span>
          <Seg value={row.percent} min={0} max={100} segments={14} tone={row.tone} tall />
          <span className="dv-hrow-v">{row.percent === null ? '—' : `${Math.round(row.percent)}%`}</span>
        </div>
      ))}
      {temperatures.length > 0 && (
        <div className="dv-temps">
          {temperatures.map((sensor) => (
            <div key={sensor.key} className="dv-temp">
              <span title={sensor.type}>{sensor.label}</span>
              <div className="dv-therm"><i style={{ width: `${Math.min(100, Math.max(0, (sensor.celsius / TEMPERATURE_FULL_SCALE_C) * 100))}%` }} /></div>
              <b style={sensor.celsius >= 60 ? { color: 'var(--dv-amber)' } : undefined}>{sensor.celsius.toFixed(1)}°C</b>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default function ModernDashboard({ data, lastUpdatedAt }: Props) {
  return (
    <div className="dv-scope">
      <div className="dv-root">
        <FacePanel data={data} lastUpdatedAt={lastUpdatedAt} />
        <div className="dv-grid">
          <LinkPanel data={data} />
          <ThroughputPanel data={data} />
          <UsagePanel data={data} />
          <HealthPanel data={data} />
        </div>
      </div>
    </div>
  )
}
