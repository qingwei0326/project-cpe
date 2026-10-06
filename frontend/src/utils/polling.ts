interface PollingOptions {
  interval: number
  visibility: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>
  pending: { current: Promise<void> | null }
  onError: (error: unknown) => void
}

// Schedule from completion, pause in the background, and share pending work across restarts.
export function startPolling(
  callback: (force: boolean) => Promise<void>,
  { interval, visibility, pending, onError }: PollingOptions,
): () => void {
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let started = false
  let failureCount = 0

  const run = async (force: boolean) => {
    if (disposed || running || visibility.hidden) return
    running = true
    clearTimeout(timer)
    try {
      // Interval changes and StrictMode must not overlap a previous run.
      await pending.current?.catch(() => {})
      if (disposed || visibility.hidden) return
      started = true
      const task = callback(force)
      pending.current = task
      try {
        await task
        failureCount = 0
      } finally {
        if (pending.current === task) pending.current = null
      }
    } catch (error) {
      failureCount = Math.min(failureCount + 1, 3)
      onError(error)
    } finally {
      running = false
      if (!disposed && !visibility.hidden && interval > 0) {
        // Modem/USB 重连期间采用有限指数退避，成功一次后恢复用户设置的周期。
        const delay = failureCount > 0
          ? Math.min(interval * (2 ** failureCount), interval * 8)
          : interval
        timer = setTimeout(() => { void run(false) }, delay)
      }
    }
  }

  const onVisibilityChange = () => {
    clearTimeout(timer)
    if (!visibility.hidden && (!started || interval > 0)) void run(!started)
  }
  void run(true)
  visibility.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    disposed = true
    clearTimeout(timer)
    visibility.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
