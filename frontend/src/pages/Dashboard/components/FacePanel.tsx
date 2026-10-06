import { Link as RouterLink } from 'react-router-dom'
import type { DashboardData } from '../hooks/useDashboardData'
import { localizeOperator } from '../../../utils/carriers'
import { buildLeds, collectAlerts, type LedSpec } from '../deviceStatus'

const ICONS: Record<NonNullable<LedSpec['icon']>, React.ReactNode> = {
  power: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v9" /><path d="M6.5 6.5a8 8 0 1 0 11 0" /></svg>,
  data: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 20V6m0 0L4 10m4-4 4 4" /><path d="M16 4v14m0 0-4-4m4 4 4-4" /></svg>,
  temperature: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z" /></svg>,
  signal: <svg viewBox="0 0 24 24" aria-hidden="true" />,
}

const BAR_HEIGHTS = [30, 48, 66, 84, 100]

function Led({ led }: { led: LedSpec }) {
  const state = led.on ? `${led.label}：${led.small || '开启'}` : `${led.label}：关闭`
  return (
    <li
      className={`dv-led dv-tone-${led.tone}${led.on ? ' is-on' : ''}`}
      aria-label={led.detail ? `${state}（${led.detail}）` : state}
      title={led.detail || undefined}
    >
      <span className="dv-led-ico">
        {led.icon === 'signal'
          ? (
            <span className="dv-sigbars" aria-hidden="true">
              {BAR_HEIGHTS.map((height, index) => (
                <span key={height} className={index < (led.bars ?? 0) ? 'is-on' : undefined} style={{ height: `${height}%` }} />
              ))}
            </span>
          )
          : led.icon ? ICONS[led.icon] : <span className="dv-led-glyph">{led.glyph}</span>}
      </span>
      <span className="dv-lamp" aria-hidden="true" />
      <span className="dv-led-name" aria-hidden="true">{led.label}</span>
      <span className="dv-led-val" aria-hidden="true">{led.small}</span>
    </li>
  )
}

export default function FacePanel({ data, lastUpdatedAt }: { data: DashboardData; lastUpdatedAt: number | null }) {
  const operator = localizeOperator(data.networkInfo?.operator_name, data.networkInfo?.mcc ?? data.simInfo?.mcc, data.networkInfo?.mnc ?? data.simInfo?.mnc)
  const mcc = data.networkInfo?.mcc ?? data.simInfo?.mcc
  const mnc = data.networkInfo?.mnc ?? data.simInfo?.mnc
  const leds = buildLeds(data)
  const alerts = collectAlerts(data)
  const stats = data.systemStats
  const sync = lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : '--:--:--'
  const registration = data.networkInfo?.registration_status ?? '—'
  const kernel = stats ? `Linux ${stats.system_info.release} · ${stats.system_info.machine}` : '—'

  return (
    <section className="dv-face" aria-label="设备前面板">
      <div className="dv-logo">
        <div className="dv-logo-m">UDX710<i> · </i>5G</div>
        <div className="dv-logo-s">5G CPE · Router</div>
        <div className="dv-logo-op">
          <b>{operator.display}</b>{mcc && mnc ? ` ${mcc}-${mnc}` : ''} · {registration}
        </div>
        {alerts.length > 0 && (
          <div className="dv-alerts" role="status">
            {alerts.map((alert) => (
              alert.to
                ? <RouterLink key={alert.key} to={alert.to} className={`dv-alert dv-tone-${alert.tone}`}>{alert.label}</RouterLink>
                : <span key={alert.key} className={`dv-alert dv-tone-${alert.tone}`} title={alert.title}>{alert.label}</span>
            ))}
          </div>
        )}
      </div>

      <ul className="dv-leds" aria-label="状态指示灯">
        {leds.map((led) => <Led key={led.key} led={led} />)}
      </ul>

      <div className="dv-right">
        <div className="dv-oled" aria-hidden="true">
          <div className="dv-oled-1"><span>运行 {stats?.uptime.uptime_formatted ?? '—'}</span><span className="dv-oled-dim">{sync}</span></div>
          <div className="dv-oled-dim">{kernel}</div>
        </div>
      </div>
    </section>
  )
}
