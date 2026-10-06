import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getOtaStageColor, getOtaStageLabel } from './ota.ts'

void test('OTA backend stages are mapped to readable operations states', () => {
  assert.equal(getOtaStageLabel('prepared'), '准备中')
  assert.equal(getOtaStageLabel('health_check'), '健康检查')
  assert.equal(getOtaStageLabel('completed'), '已完成')
  assert.equal(getOtaStageLabel('rolled_back'), '已回滚')
  assert.equal(getOtaStageColor('applying'), 'warning')
  assert.equal(getOtaStageColor('completed'), 'success')
  assert.equal(getOtaStageColor('rolling_back'), 'error')
  assert.equal(getOtaStageLabel('future_state'), 'future_state')
})
