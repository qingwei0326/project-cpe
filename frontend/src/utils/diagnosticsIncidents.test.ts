import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupDiagnosticIncidents } from './diagnosticsIncidents.ts'

const probe = (time: string, ok: boolean) =>
  `2026-10-06T${time}+00:00 DATA_CONNECTIVITY_PROBE ipv4=${ok} ipv4_ms=${ok ? '88.1' : '-'} ipv4_p95_ms=${ok ? '120.0' : '-'} ipv4_loss=${ok ? '0.0' : '100.0'} ipv4_ok=${ok} ipv4_err=- ipv6=${ok} ipv6_ms=70.2 ipv6_loss=0.0 ipv6_ok=${ok} ipv6_err=-`

void test('a single failed probe is closed by the next healthy probe and is not stretched by later healthy ones', () => {
  // 真机日志：12:52:21 失败一次，32 秒后恢复，此后一直健康。
  const lines = [probe('12:52:21.356', false)]
  for (let seconds = 0; seconds < 20 * 60; seconds += 32) {
    const total = 52 * 60 + 53 + seconds
    const hh = String(12 + Math.floor(total / 3600)).padStart(2, '0')
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
    const ss = String(total % 60).padStart(2, '0')
    lines.push(probe(`${hh}:${mm}:${ss}.000`, true))
  }
  const incidents = groupDiagnosticIncidents(lines.join('\n'))
  assert.equal(incidents.length, 1)
  const [incident] = incidents
  assert.equal(incident?.kind, 'network')
  assert.equal(incident?.ongoing, false)
  const seconds = ((incident?.end?.getTime() ?? 0) - (incident?.start?.getTime() ?? 0)) / 1000
  assert.ok(seconds >= 30 && seconds <= 40, `fault lasted ${seconds}s, expected about 32s`)
})

void test('healthy probes alone never create an incident', () => {
  const lines = [probe('12:53:25.000', true), probe('12:53:57.000', true), probe('12:54:30.000', true)]
  assert.deepEqual(groupDiagnosticIncidents(lines.join('\n')), [])
})

void test('consecutive failures extend one open fault until the first healthy probe', () => {
  const lines = [probe('13:19:43.000', false), probe('13:20:15.000', false), probe('13:21:21.000', false), probe('13:22:25.000', true), probe('13:23:29.000', true)]
  const incidents = groupDiagnosticIncidents(lines.join('\n'))
  assert.equal(incidents.length, 1)
  assert.equal(incidents[0]?.ongoing, false)
  assert.equal(incidents[0]?.end?.toISOString(), '2026-10-06T13:22:25.000Z')
  assert.equal(incidents[0]?.details.length, 4)
})

void test('a fault with no recovery yet stays ongoing', () => {
  const incidents = groupDiagnosticIncidents([probe('13:44:57.000', false)].join('\n'))
  assert.equal(incidents[0]?.ongoing, true)
})

void test('failures separated by more than 30 minutes are separate incidents, newest first', () => {
  const lines = [probe('10:00:00.000', false), probe('10:00:32.000', true), probe('11:30:00.000', false), probe('11:30:32.000', true)]
  const incidents = groupDiagnosticIncidents(lines.join('\n'))
  assert.equal(incidents.length, 2)
  assert.equal(incidents[0]?.start?.toISOString(), '2026-10-06T11:30:00.000Z')
})

void test('process starts still produce a reboot incident', () => {
  const line = '2026-10-06T13:44:33.541+00:00 STARTUP pid=2422 version=3.3.11 commit=38f367e-dirty bind=0.0.0.0:80'
  const incidents = groupDiagnosticIncidents(line)
  assert.equal(incidents[0]?.kind, 'reboot')
  assert.equal(incidents[0]?.ongoing, false)
})
