import { useEffect, useRef, useState } from 'react'

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/**
 * 把数值变化补间成平滑过渡（easeOutCubic）。
 *
 * 抽成独立 hook 是为了让"环形进度弧线"和"中心数字"共用同一个动画值——
 * 否则只有数字在动、弧线还是瞬间跳，反而更违和。
 * 同时尊重系统的"减弱动效"设置。
 *
 * 注意：所有 setState 都在 requestAnimationFrame 回调里触发，
 * 避免在 effect 体内同步 setState 引起的级联渲染。
 */
export function useAnimatedValue(value: number, duration = 450): number {
  const [display, setDisplay] = useState(value)
  const currentRef = useRef(value)

  useEffect(() => {
    // 非有限值不参与补间，交给渲染层显示占位
    if (!Number.isFinite(value)) return

    const from = currentRef.current
    const delta = value - from
    if (Math.abs(delta) < 1e-9) return

    const commit = (next: number) => {
      currentRef.current = next
      setDisplay(next)
    }

    if (prefersReducedMotion() || duration <= 0) {
      const raf = requestAnimationFrame(() => commit(value))
      return () => cancelAnimationFrame(raf)
    }

    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - progress) ** 3
      commit(from + delta * eased)
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  return display
}
