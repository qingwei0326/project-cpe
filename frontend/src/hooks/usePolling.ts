import { useEffect, useRef } from 'react'
import { startPolling } from '../utils/polling'

// Keep the latest callback without restarting polling on every render.
export function usePolling(
  callback: (force: boolean) => Promise<void>,
  interval: number,
  refreshKey = 0,
) {
  const callbackRef = useRef(callback)
  const pendingRef = useRef<Promise<void> | null>(null)
  useEffect(() => { callbackRef.current = callback }, [callback])
  useEffect(() => startPolling(force => callbackRef.current(force), {
    interval,
    visibility: document,
    pending: pendingRef,
    onError: error => { console.error('刷新失败:', error) },
  }), [interval, refreshKey])
}
