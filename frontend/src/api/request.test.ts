import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from './request.ts'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

void test('HTTP 200 business errors reject with the device message', async () => {
  globalThis.fetch = () => Promise.resolve(Response.json({ status: 'error', message: 'modem busy' }))
  await assert.rejects(request('/data', { method: 'POST' }), /modem busy/)
})

void test('concurrent reads share work, but completed reads are not cached', async () => {
  let calls = 0
  let release!: (response: Response) => void
  globalThis.fetch = () => {
    calls++
    return new Promise<Response>(resolve => { release = resolve })
  }
  const first = request('/device')
  const second = request('/device')
  assert.equal(calls, 1)
  release(Response.json({ status: 'ok', data: { model: 'UDX710' } }))
  assert.deepEqual(await first, await second)
  const third = request('/device')
  assert.equal(calls, 2)
  release(Response.json({ status: 'ok' }))
  await third
})

void test('mutations invalidate pre-existing in-flight reads without aborting them', async () => {
  const releases: ((response: Response) => void)[] = []
  globalThis.fetch = () => new Promise<Response>(resolve => { releases.push(resolve) })
  const oldRead = request('/data')
  const mutation = request('/data', { method: 'POST' })
  const newRead = request('/data')
  assert.equal(releases.length, 3)
  releases.forEach(resolve => { resolve(Response.json({ status: 'ok' })) })
  await Promise.all([oldRead, mutation, newRead])
})

void test('timeout aborts the request and permits retry', async () => {
  globalThis.fetch = (_input, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
  await assert.rejects(request('/slow', { timeoutMs: 5 }), /请求超时/)
  globalThis.fetch = () => Promise.resolve(Response.json({ status: 'ok' }))
  assert.deepEqual(await request('/slow'), { status: 'ok' })
})

void test('failed shared reads are removed so a subsequent request can recover', async () => {
  globalThis.fetch = () => Promise.reject(new Error('offline'))
  await assert.rejects(request('/recover'), /offline/)
  globalThis.fetch = () => Promise.resolve(Response.json({ status: 'ok' }))
  assert.deepEqual(await request('/recover'), { status: 'ok' })
})

void test('custom headers and caller cancellation survive request wrapping', async () => {
  const controller = new AbortController()
  globalThis.fetch = (_input, options) => {
    assert.equal(new Headers(options?.headers).get('Content-Type'), 'application/octet-stream')
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => { reject(options.signal?.reason instanceof Error ? options.signal.reason : new Error('cancelled')) }, { once: true })
    })
  }
  const pending = request('/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, signal: controller.signal,
  })
  controller.abort(new Error('cancelled'))
  await assert.rejects(pending, /cancelled/)
})

void test('diagnostics text responses bypass JSON parsing', async () => {
  globalThis.fetch = () => Promise.resolve(new Response('STARTUP pid=7\nOTA completed', {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  }))
  assert.equal(await request<string>('/diagnostics/log', { returnText: true }), 'STARTUP pid=7\nOTA completed')
})

void test('refresh after mutation does not reuse a read started during the mutation', async () => {
  const releases: ((response: Response) => void)[] = []
  globalThis.fetch = () => new Promise<Response>(resolve => { releases.push(resolve) })
  const mutation = request('/data', { method: 'POST' })
  const duringMutation = request('/data')
  releases[0](Response.json({ status: 'ok' }))
  await mutation
  const afterMutation = request('/data')
  assert.equal(releases.length, 3)
  releases[1](Response.json({ status: 'ok', data: false }))
  releases[2](Response.json({ status: 'ok', data: true }))
  assert.deepEqual(await duringMutation, { status: 'ok', data: false })
  assert.deepEqual(await afterMutation, { status: 'ok', data: true })
})
