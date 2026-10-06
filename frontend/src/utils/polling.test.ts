import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startPolling } from './polling.ts'

class Visibility extends EventTarget {
  hidden = false
  change(hidden: boolean) {
    this.hidden = hidden
    this.dispatchEvent(new Event('visibilitychange'))
  }
}
const tick = () => new Promise<void>(resolve => { setTimeout(resolve, 0) })
const wait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms) })

void test('slow requests never overlap; stopping prevents future runs', async () => {
  const visibility = new Visibility()
  let calls = 0
  let release!: () => void
  const stop = startPolling(() => {
    calls++
    return new Promise<void>(resolve => { release = resolve })
  }, { interval: 5, visibility, pending: { current: null }, onError: error => { throw error } })
  try {
    await wait(25)
    assert.equal(calls, 1)
    release()
    await wait(25)
    assert.equal(calls, 2)
  } finally {
    stop()
    release()
  }
  await wait(15)
  assert.equal(calls, 2)
})

void test('hidden pages pause and resume; manual mode still loads once when revealed', async () => {
  const visibility = new Visibility()
  visibility.hidden = true
  const forces: boolean[] = []
  const stop = startPolling(force => {
    forces.push(force)
    return Promise.resolve()
  }, { interval: 0, visibility, pending: { current: null }, onError: error => { throw error } })
  try {
    await tick()
    assert.equal(forces.length, 0)
    visibility.change(false)
    await tick()
    assert.deepEqual(forces, [true])
    visibility.change(true)
    visibility.change(false)
    await tick()
    assert.equal(forces.length, 1)
  } finally { stop() }
})

void test('restarting polling waits for the previous request and uses the new callback', async () => {
  const visibility = new Visibility()
  const pending = { current: null as Promise<void> | null }
  let release!: () => void
  const stopFirst = startPolling(() => new Promise<void>(resolve => { release = resolve }),
    { interval: 0, visibility, pending, onError: error => { throw error } })
  await tick()
  stopFirst()
  let calls = 0
  const stopSecond = startPolling(() => {
    calls++
    return Promise.resolve()
  }, { interval: 0, visibility, pending, onError: error => { throw error } })
  try {
    await tick()
    assert.equal(calls, 0)
    release()
    await tick()
    assert.equal(calls, 1)
  } finally { stopSecond() }
})

void test('periodic refresh pauses while hidden and resumes without overlap', async () => {
  const visibility = new Visibility()
  let calls = 0
  const stop = startPolling(() => {
    calls++
    return Promise.resolve()
  }, { interval: 5, visibility, pending: { current: null }, onError: error => { throw error } })
  try {
    await tick()
    visibility.change(true)
    const before = calls
    await wait(20)
    assert.equal(calls, before)
    visibility.change(false)
    await tick()
    assert.equal(calls, before + 1)
  } finally { stop() }
})

void test('failed refreshes use finite backoff and recover at the normal interval', async () => {
  const visibility = new Visibility()
  let calls = 0
  const errors: unknown[] = []
  const stop = startPolling(() => {
    calls += 1
    return calls === 1 ? Promise.reject(new Error('modem busy')) : Promise.resolve()
  }, { interval: 50, visibility, pending: { current: null }, onError: error => errors.push(error) })
  try {
    await wait(30)
    assert.equal(calls, 1)
    await wait(30)
    assert.equal(calls, 1)
    await wait(50)
    assert.equal(calls, 2)
    assert.equal(errors.length, 1)
  } finally { stop() }
})
