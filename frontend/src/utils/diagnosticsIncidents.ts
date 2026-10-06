export type IncidentKind = 'network' | 'recovery' | 'reboot' | 'ota'

export interface DiagnosticIncident {
  kind: IncidentKind
  label: string
  start?: Date
  end?: Date
  ongoing: boolean
  path: string
  details: string[]
}

/** 同一类事件两次记录相隔超过该时长，就视为两起独立事件。 */
const INCIDENT_MERGE_WINDOW_MS = 30 * 60 * 1000

export function parseDiagnosticLine(line: string): { at?: Date; text: string } {
  const match = line.match(/^(\S+)\s+(.+)$/)
  if (!match) return { text: line }
  const at = new Date(match[1])
  return Number.isNaN(at.getTime()) ? { text: line } : { at, text: match[2] }
}

export function classifyDiagnosticEvent(text: string): { kind: IncidentKind; salient: boolean; recovered: boolean; path: string } | null {
  if (text.startsWith('DATA_CONNECTIVITY_PROBE')) {
    const failed = /ipv4=false\b/.test(text) && /ipv6=false\b/.test(text)
    const recovered = /ipv4=true\b/.test(text) && /ipv6=true\b/.test(text)
    return failed || recovered ? { kind: 'network', salient: true, recovered, path: '网络探测' } : null
  }
  if (text.startsWith('DATA_CONTEXT_RECOVERY_')) {
    const path = text.match(/path_class=([^\s]+)/)?.[1] || '数据上下文'
    return { kind: 'recovery', salient: true, recovered: text.includes('DONE') || text.includes('CONFIRMED'), path }
  }
  if (text.startsWith('USB_PATH_STALLED') || text.startsWith('USB_PATH_RECOVERY_')) {
    return { kind: 'recovery', salient: true, recovered: text.includes('DONE') && /success=true\b/.test(text), path: 'USB 网络路径' }
  }
  if (/^(STARTUP|SHUTDOWN|PANIC)\b/.test(text)) {
    return { kind: 'reboot', salient: true, recovered: text.startsWith('STARTUP'), path: '进程/系统启动' }
  }
  if (text.startsWith('OTA')) {
    return { kind: 'ota', salient: true, recovered: /completed|active after service restart|success=true/.test(text), path: 'OTA' }
  }
  return null
}

const INCIDENT_LABELS: Record<IncidentKind, string> = {
  network: '网络故障',
  recovery: '恢复事件',
  reboot: '重启/启动',
  ota: 'OTA 事件',
}

/**
 * 把诊断日志归并成「事件」。
 *
 * 网络故障的规则：只有「IPv4 与 IPv6 同时失败」的探测会打开 / 延长故障；
 * 第一次「同时成功」的探测把故障关闭，之后的健康探测不再延长它，
 * 也不会在没有故障时凭空生成事件。
 * （之前每次健康探测都会延长事件，导致 32 秒的一次失败被显示成「持续 17 分钟」。）
 */
export function groupDiagnosticIncidents(logText: string): DiagnosticIncident[] {
  const incidents: DiagnosticIncident[] = []
  for (const rawLine of logText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    const parsed = parseDiagnosticLine(rawLine)
    const event = classifyDiagnosticEvent(parsed.text)
    if (!event || !event.salient) continue

    if (event.kind === 'network') {
      const open = [...incidents].reverse().find(incident => incident.kind === 'network' && incident.ongoing)
      const withinWindow = open !== undefined && (!open.end || !parsed.at || parsed.at.getTime() - open.end.getTime() <= INCIDENT_MERGE_WINDOW_MS)
      if (event.recovered) {
        if (open && withinWindow) {
          open.end = parsed.at || open.end
          open.ongoing = false
          open.details.push(parsed.text)
        }
        continue
      }
      if (open && withinWindow) {
        open.end = parsed.at || open.end
        open.details.push(parsed.text)
      } else {
        incidents.push({ kind: 'network', label: INCIDENT_LABELS.network, start: parsed.at, end: parsed.at, ongoing: true, path: event.path, details: [parsed.text] })
      }
      continue
    }

    const previous = incidents[incidents.length - 1]
    const sameIncident = previous && previous.kind === event.kind &&
      (!previous.end || !parsed.at || parsed.at.getTime() - previous.end.getTime() <= INCIDENT_MERGE_WINDOW_MS)
    if (sameIncident) {
      previous.end = parsed.at || previous.end
      previous.ongoing = previous.ongoing && !event.recovered
      if (event.path !== previous.path && !previous.path.includes(event.path)) previous.path += `、${event.path}`
      previous.details.push(parsed.text)
    } else {
      incidents.push({
        kind: event.kind,
        label: INCIDENT_LABELS[event.kind],
        start: parsed.at,
        end: parsed.at,
        ongoing: !event.recovered,
        path: event.path,
        details: [parsed.text],
      })
    }
  }
  return incidents.slice(-8).reverse()
}
