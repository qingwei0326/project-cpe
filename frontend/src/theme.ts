import { alpha, createTheme, type PaletteMode } from '@mui/material/styles'

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
  bg: '#0d1117',
  surface: '#161b22',
  border: '#2d2d2d',
  divider: '#333333',
  text: '#e6edf3',
  muted: '#9aa4b2',
  accent: '#4fc3f7',
  success: '#4caf50',
  successText: '#a5d6a7',
  error: '#f44336',
  errorText: '#ef9a9a',
} as const

/**
 * 表面层级：主卡用 background.paper，次级容器（指标卡、侧栏）用这里。
 * 层次靠明度分级，不再让所有卡片共用同一底色 + 统一描边。
 */
export const SURFACE_BY_MODE = {
  dark: { muted: '#111A2C', rail: '#0E1729', selected: '#16233C' },
  light: { muted: '#F7FAFD', rail: '#FFFFFF', selected: '#E8EEFB' },
} as const

const paletteByMode = (mode: PaletteMode) => {
  const dark = mode === 'dark'
  return {
    mode,
    // 主色改为青绿：原蓝紫主色只出现在图标上，页面 90% 面积发灰。
    // 青绿饱和度高，用在主数字/信号格/激活态时能真正带起整页。
    primary: {
      main: dark ? '#2DD4BF' : '#0E9384',
      light: dark ? '#5EE7D6' : '#2BB8A6',
      dark: dark ? '#14A898' : '#0A6E63',
      contrastText: dark ? '#04201C' : '#FFFFFF',
    },
    secondary: {
      main: dark ? '#7C9CFF' : '#4B6BD6',
      light: dark ? '#A7BCFF' : '#7B93E6',
      dark: dark ? '#5A78E0' : '#3953AC',
      contrastText: dark ? '#0A1024' : '#FFFFFF',
    },
    success: {
      main: dark ? '#4ADE80' : '#178A56',
      light: dark ? '#86EFAC' : '#4FC58B',
      dark: dark ? '#22C55E' : '#14764A',
      contrastText: dark ? '#052012' : '#FFFFFF',
    },
    warning: {
      main: dark ? '#FBBF24' : '#B8720C',
      light: dark ? '#FCD34D' : '#D9962F',
      dark: dark ? '#E0A106' : '#8A5607',
      contrastText: dark ? '#241703' : '#FFFFFF',
    },
    error: {
      main: dark ? '#F87171' : '#D64B5A',
      light: dark ? '#FCA5A5' : '#EB7C87',
      dark: dark ? '#DC2626' : '#A93442',
      contrastText: dark ? '#26090A' : '#FFFFFF',
    },
    info: {
      main: dark ? '#7C9CFF' : '#2579C7',
      light: dark ? '#A7BCFF' : '#5CA4E2',
      dark: dark ? '#5A78E0' : '#1A5B9B',
      contrastText: dark ? '#0A1024' : '#FFFFFF',
    },
    // 页面底比主卡更暗一档，卡片层次靠明度而不是统一描边
    background: {
      default: dark ? '#0B1220' : '#F4F7FB',
      paper: dark ? '#141E33' : '#FFFFFF',
    },
    text: {
      primary: dark ? '#E8EEF9' : '#16223A',
      secondary: dark ? '#8B9AB8' : '#5E6C85',
      disabled: dark ? '#5C6B88' : '#98A4B8',
    },
    divider: dark ? 'rgba(148, 173, 214, 0.12)' : 'rgba(35, 58, 96, 0.12)',
  }
}

export function createAppTheme(mode: PaletteMode) {
  const dark = mode === 'dark'
  const palette = paletteByMode(mode)

  return createTheme({
    palette,
    typography: {
      fontFamily: [
        'Inter',
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
        '"Apple Color Emoji"',
        '"Segoe UI Emoji"',
      ].join(','),
      h4: { fontSize: 'clamp(1.65rem, 2.4vw, 2.15rem)', fontWeight: 750, letterSpacing: '-0.025em' },
      h5: { fontSize: 'clamp(1.35rem, 2vw, 1.75rem)', fontWeight: 720, letterSpacing: '-0.02em' },
      h6: { fontWeight: 700, letterSpacing: '-0.01em' },
      subtitle1: { fontWeight: 650 },
      subtitle2: { fontWeight: 700, letterSpacing: '0.01em' },
      button: { fontWeight: 650, letterSpacing: '0.005em' },
    },
    shape: { borderRadius: 8 },
    // 统一缓动：收尾更柔和的 easeOut，避免 MUI 默认 linear 的生硬感
    transitions: {
      easing: {
        easeOut: EASE_OUT,
        easeInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
      },
    },
    components: {
      MuiButtonBase: {
        styleOverrides: {
          root: {
            '&.Mui-focusVisible': {
              outline: `2px solid ${palette.primary.main}`,
              outlineOffset: 2,
            },
          },
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          html: { backgroundColor: palette.background.default },
          body: {
            backgroundColor: palette.background.default,
            color: palette.text.primary,
            scrollbarColor: dark ? '#43526D #101A2C' : '#BCC6D4 #EEF2F7',
            '&::-webkit-scrollbar, & *::-webkit-scrollbar': { width: 9, height: 9 },
            '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
              borderRadius: 8,
              backgroundColor: dark ? '#43526D' : '#BCC6D4',
              border: `2px solid ${palette.background.default}`,
            },
            '&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track': { backgroundColor: palette.background.default },
          },
          '::selection': { backgroundColor: alpha(palette.primary.main, 0.22) },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: dark ? '#101c2e' : alpha(palette.background.paper, 0.94),
            color: palette.text.primary,
            borderBottom: `1px solid ${palette.divider}`,
            backdropFilter: 'blur(18px)',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: palette.background.paper,
            backgroundImage: 'none',
            borderRight: `1px solid ${palette.divider}`,
          },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            borderRadius: RADIUS.md,
            border: `1px solid ${palette.divider}`,
            boxShadow: dark ? '0 8px 20px rgba(0, 0, 0, 0.14)' : '0 10px 28px rgba(29, 55, 98, 0.06)',
            transition: `border-color 180ms ${EASE_OUT}, box-shadow 180ms ${EASE_OUT}, transform 180ms ${EASE_OUT}`,
            '&:hover': {
              borderColor: alpha(palette.primary.main, 0.28),
              boxShadow: dark ? '0 12px 26px rgba(0, 0, 0, 0.22)' : '0 14px 34px rgba(29, 55, 98, 0.1)',
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
      MuiCardHeader: {
        styleOverrides: {
          root: { padding: '14px 16px 8px' },
          title: { fontWeight: 700 },
          subheader: { color: palette.text.secondary },
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: { padding: '10px 16px 16px', '&:last-child': { paddingBottom: 16 } },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { minHeight: 36, borderRadius: RADIUS.sm, textTransform: 'none', fontWeight: 650 },
          contained: { boxShadow: 'none' },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: { borderRadius: RADIUS.sm },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: RADIUS.sm, fontWeight: 650 },
        },
      },
      MuiTextField: {
        defaultProps: { size: 'small' },
        styleOverrides: {
          root: { '& .MuiOutlinedInput-root': { borderRadius: RADIUS.sm } },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: { borderRadius: RADIUS.md, marginTop: 4 },
          list: { padding: 4 },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: { borderRadius: RADIUS.sm, minHeight: 36 },
        },
      },
      MuiPopover: {
        styleOverrides: { paper: { borderRadius: RADIUS.md } },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: RADIUS.md } },
      },
      MuiSelect: {
        styleOverrides: { outlined: { borderRadius: RADIUS.sm } },
      },
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: 48 },
          indicator: { height: 3, borderRadius: RADIUS.xs },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { minHeight: 48, textTransform: 'none', fontWeight: 650, borderRadius: `${RADIUS.sm} ${RADIUS.sm} 0 0` },
        },
      },
      MuiLinearProgress: {
        styleOverrides: { root: { borderRadius: RADIUS.xs, height: 6 } },
      },
      MuiSkeleton: {
        styleOverrides: {
          rounded: { borderRadius: RADIUS.sm },
          rectangular: { borderRadius: RADIUS.sm },
        },
      },
      MuiAlert: {
        styleOverrides: { root: { borderRadius: RADIUS.md, alignItems: 'center' } },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: palette.divider, padding: '8px 10px' },
          head: { fontWeight: 700, color: palette.text.secondary, backgroundColor: alpha(palette.primary.main, dark ? 0.08 : 0.04) },
        },
      },
      MuiAccordion: {
        styleOverrides: {
          root: {
            border: `1px solid ${palette.divider}`,
            borderRadius: RADIUS.md,
            backgroundColor: alpha(palette.background.paper, dark ? .72 : 1),
            '&:before': { display: 'none' },
            '&:first-of-type, &:last-of-type': { borderRadius: RADIUS.md },
          },
        },
      },
      MuiAccordionSummary: {
        styleOverrides: { root: { minHeight: 44, borderRadius: RADIUS.md, '&.Mui-expanded': { minHeight: 44 } }, content: { margin: '8px 0', '&.Mui-expanded': { margin: '8px 0' } } },
      },
      MuiTooltip: {
        styleOverrides: { tooltip: { borderRadius: RADIUS.sm, fontSize: '0.75rem' } },
      },
    },
  })
}

export const theme = createAppTheme('light')
export const darkTheme = createAppTheme('dark')
