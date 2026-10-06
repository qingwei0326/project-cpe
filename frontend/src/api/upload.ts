import type { ApiResponse } from './types'

export interface UploadOptions {
  onProgress?: (percent: number) => void
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Upload a binary payload while exposing browser upload progress.
 * The normal request helper intentionally stays fetch based; XHR is used
 * here because it is the browser API that reports upload progress reliably.
 */
export function uploadJson<T>(url: string, payload: Blob, options: UploadOptions = {}): Promise<T> {
  const { onProgress, signal, timeoutMs = 300_000 } = options

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false

    const cleanup = () => {
      signal?.removeEventListener('abort', abort)
    }

    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    const abort = () => {
      xhr.abort()
      fail(signal?.reason instanceof Error ? signal.reason : new Error('上传已取消'))
    }

    xhr.open('POST', '/api' + url, true)
    xhr.timeout = timeoutMs
    xhr.responseType = 'text'
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    onProgress?.(0)

    xhr.upload.addEventListener('progress', event => {
      if (event.lengthComputable) {
        onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)))
      }
    })

    xhr.addEventListener('load', () => {
      if (settled) return
      const raw = xhr.responseText || ''
      let body: unknown
      try {
        body = JSON.parse(raw)
      } catch {
        fail(new Error(xhr.status >= 200 && xhr.status < 300 ? '服务器返回了无效的 JSON' : `HTTP ${xhr.status}`))
        return
      }

      const envelope = typeof body === 'object' && body !== null
        ? body as Partial<ApiResponse<unknown>>
        : undefined
      if (xhr.status < 200 || xhr.status >= 300 || envelope?.status === 'error') {
        fail(new Error(typeof envelope?.message === 'string' ? envelope.message : `HTTP ${xhr.status}`))
        return
      }

      settled = true
      cleanup()
      onProgress?.(100)
      resolve(body as T)
    })
    xhr.addEventListener('error', () => fail(new Error('上传失败：设备连接异常')))
    xhr.addEventListener('timeout', () => fail(new Error('上传超时：请确认设备状态后重试')))
    xhr.addEventListener('abort', () => {
      if (!settled) fail(new Error('上传已取消'))
    })

    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    xhr.send(payload)
  })
}
