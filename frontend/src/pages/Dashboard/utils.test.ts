import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatBearerRate } from './utils.ts'

void test('formats modem-reported bearer rates for the top status band', () => {
  // 模组上报单位为 kbps（3GPP TS 27.007）。
  assert.equal(formatBearerRate(3000000), '3000 Mbps')
  assert.equal(formatBearerRate(300000), '300 Mbps')
  assert.equal(formatBearerRate(30000), '30 Mbps')
})

void test('does not invent a contract rate when QCI data is absent', () => {
  assert.equal(formatBearerRate(null), '—')
  assert.equal(formatBearerRate(0), '—')
})
