const API_BASE = '/api'
const inFlight = new Map<string, Promise<unknown>>()

interface RequestOptions extends RequestInit {
  returnText?: boolean
  timeoutMs?: number
}

export function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase()
  // Caller-owned signals and custom options must stay independent.
  const shareRead = method === 'GET' && Object.keys(options).length === 0
  const existing = shareRead ? inFlight.get(url) : undefined
  if (existing) return existing as Promise<T>

  // A refresh after mutation must not reuse an older read.
  if (method !== 'GET') inFlight.clear()

  const pending = execute<T>(url, options)
  if (method !== 'GET') {
    // Reads may also start while the mutation is still running.
    const invalidate = () => { inFlight.clear() }
    void pending.then(invalidate, invalidate)
  }
  if (shareRead) {
    inFlight.set(url, pending)
    const cleanup = () => {
      if (inFlight.get(url) === pending) inFlight.delete(url)
    }
    void pending.then(cleanup, cleanup)
  }
  return pending
}

async function execute<T>(url: string, options: RequestOptions): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase()
  const { returnText, timeoutMs = method !== 'GET' ? 120_000 : 30_000,
    signal, ...fetchOptions } = options
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const headers = new Headers(fetchOptions.headers)
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const response = await fetch(API_BASE + url, {
      ...fetchOptions, headers, signal: controller.signal,
    })
    if (returnText) {
      const text = await response.text()
      if (!response.ok) throw new Error(text || 'HTTP ' + response.status)
      return text as T
    }

    const body: unknown = await response.json().catch(() => {
      throw new Error(response.ok ? '服务器返回了无效的 JSON' : 'HTTP ' + response.status)
    })
    const envelope = typeof body === 'object' && body !== null
      ? body as { status?: unknown; message?: unknown }
      : undefined
    if (!response.ok || envelope?.status === 'error') {
      throw new Error(typeof envelope?.message === 'string'
        ? envelope.message : 'HTTP ' + response.status)
    }
    return body as T
  } catch (error) {
    if (timedOut) throw new Error('请求超时：' + url + '，请刷新确认设备状态')
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
