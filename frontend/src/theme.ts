import { createDeviceTheme } from './deviceTheme.ts'

/**
 * 圆角只有四档。任何组件都从这里取值，不允许再手写 borderRadius。
 * xs   = 数据图形（柱状图顶端、进度条）
 * sm   = 可点击控件（按钮、图标钮、Chip、Tab）
 * md   = 容器（卡片、Tile、表格、折叠面板、输入框）
 * full = 圆形元素（头像、状态点、环形图）
 */
export const RADIUS = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  full: '9999px',
} as const

export type RadiusToken = keyof typeof RADIUS

/**
 * 全局统一的缓动曲线（收尾柔和的 easeOut）。
 * 硬件写死的 transition 一律引用这里，避免各处 `ease` / `linear` 手感不一致。
 */
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)' as const

/**
 * 终端与 AT 控制台刻意保持深色（模拟物理终端，也便于长时间盯屏），
 * 这在浅色主题下是正确的设计决策 —— 但色值必须集中在此，
 * 且容器外框走主题 divider，让它看起来是「故意嵌入」而不是「没适配」。
 */
export const TERMINAL_PALETTE = {
  bg: '#0f1114',
  surface: '#14171b',
  border: '#2a2e35',
  divider: '#2a2e35',
  text: '#e6edf3',
  muted: '#9aa4b2',
  accent: '#4fc3f7',
  success: '#4caf50',
  successText: '#a5d6a7',
  error: '#f44336',
  errorText: '#ef9a9a',
} as const

/** 应用主题：设备面板（石墨机身），见 deviceTheme.ts。 */
export const appTheme = createDeviceTheme()
