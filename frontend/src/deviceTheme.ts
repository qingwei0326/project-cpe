import { alpha, createTheme, type Theme } from '@mui/material/styles'

/**
 * 设备面板主题（深色）。
 *
 * 与仪表盘 / 侧边栏 / 顶栏共用同一套材质语言：
 * 石墨机身、凹槽（输入框/屏幕）、实体按键、指示灯配色。
 * 亮色主题保持原样，不在此处理。
 */
export const DEVICE = {
  bg: '#0c0d10',
  panelTop: '#272b31',
  panelBottom: '#1f2227',
  well: '#0f1114',
  edge: '#0a0b0d',
  hi: 'rgba(255, 255, 255, 0.08)',
  green: '#3dff8f',
  cyan: '#47e1ff',
  amber: '#ffb23d',
  red: '#ff5a52',
  ink: '#e8ebf0',
  muted: '#9aa1ac',
  engr: '#80868f',
  mono: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
} as const

const R = { sm: 10, md: 14, lg: 18 } as const
const WELL_SHADOW = `inset 0 0.15rem 0.35rem rgba(0, 0, 0, 0.8), 0 1px 0 ${DEVICE.hi}`
const KEY_SHADOW = `0 0 0 1px #000, inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0.15rem 0.3rem rgba(0, 0, 0, 0.5)`
const KEY_PRESSED = `0 0 0 1px #000, inset 0 0.2rem 0.4rem rgba(0, 0, 0, 0.7)`
const PANEL_SHADOW = `0 0 0 1px ${DEVICE.edge}, inset 0 1px 0 ${DEVICE.hi}, inset 0 -1px 0 rgba(0, 0, 0, 0.5), 0 0.5rem 1rem rgba(0, 0, 0, 0.3)`

type PaletteKey = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info'
const PALETTE_KEYS: readonly string[] = ['primary', 'secondary', 'success', 'warning', 'error', 'info']

function tone(theme: Theme, color: unknown): Theme['palette']['primary'] | null {
  if (typeof color === 'string' && PALETTE_KEYS.includes(color)) return theme.palette[color as PaletteKey]
  return null
}

export function createDeviceTheme() {
  return createTheme({
    palette: {
      mode: 'dark',
      primary: { main: DEVICE.green, light: '#8dffbf', dark: '#22c76b', contrastText: '#04200f' },
      secondary: { main: DEVICE.cyan, light: '#8ceeff', dark: '#1fb4d6', contrastText: '#021a21' },
      success: { main: DEVICE.green, light: '#8dffbf', dark: '#22c76b', contrastText: '#04200f' },
      warning: { main: DEVICE.amber, light: '#ffd27a', dark: '#e08e0b', contrastText: '#241500' },
      error: { main: DEVICE.red, light: '#ff8f89', dark: '#d83a33', contrastText: '#2a0705' },
      info: { main: DEVICE.cyan, light: '#8ceeff', dark: '#1fb4d6', contrastText: '#021a21' },
      background: { default: DEVICE.bg, paper: '#23262c' },
      text: { primary: DEVICE.ink, secondary: DEVICE.muted, disabled: '#6b717b' },
      divider: 'rgba(255, 255, 255, 0.09)',
    },
    typography: {
      fontFamily: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"PingFang SC"', '"Microsoft YaHei"', 'Roboto', 'Arial', 'sans-serif'].join(','),
      h4: { fontSize: 'clamp(1.65rem, 2.4vw, 2.15rem)', fontWeight: 800, letterSpacing: '0.04em' },
      h5: { fontSize: 'clamp(1.35rem, 2vw, 1.75rem)', fontWeight: 800, letterSpacing: '0.05em' },
      h6: { fontWeight: 700, letterSpacing: '0.02em' },
      subtitle1: { fontWeight: 700 },
      subtitle2: { fontWeight: 700, letterSpacing: '0.04em' },
      button: { fontWeight: 700, letterSpacing: '0.02em' },
    },
    shape: { borderRadius: R.sm },
    components: {
      MuiButtonBase: {
        styleOverrides: { root: { '&.Mui-focusVisible': { outline: `2px solid ${DEVICE.cyan}`, outlineOffset: 2 } } },
      },
      MuiCssBaseline: {
        styleOverrides: {
          html: { backgroundColor: DEVICE.bg },
          body: {
            backgroundColor: DEVICE.bg,
            backgroundImage: 'radial-gradient(110% 70% at 50% -10%, #2a2e35 0%, transparent 60%), linear-gradient(180deg, #14161a, #0c0d10)',
            backgroundAttachment: 'fixed',
            color: DEVICE.ink,
            scrollbarColor: '#343a43 transparent',
            '&::-webkit-scrollbar, & *::-webkit-scrollbar': { width: 9, height: 9 },
            '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': { borderRadius: 8, backgroundColor: '#343a43', border: `2px solid ${DEVICE.bg}` },
            '&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
          },
          '::selection': { backgroundColor: alpha(DEVICE.cyan, 0.28) },
        },
      },
      MuiAppBar: { defaultProps: { elevation: 0 } },
      MuiDrawer: { styleOverrides: { paper: { backgroundImage: 'none' } } },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: `linear-gradient(180deg, ${DEVICE.panelTop}, ${DEVICE.panelBottom})`,
            boxShadow: PANEL_SHADOW,
          },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { borderRadius: R.md, border: 'none' } },
      },
      MuiCardHeader: {
        styleOverrides: {
          root: { padding: '14px 16px 8px' },
          title: { fontWeight: 700, letterSpacing: '0.04em' },
          subheader: { color: DEVICE.muted },
        },
      },
      MuiCardContent: {
        styleOverrides: { root: { padding: '10px 16px 16px', '&:last-child': { paddingBottom: 16 } } },
      },
      MuiDivider: { styleOverrides: { root: { borderColor: '#0b0c0e', boxShadow: `0 1px 0 ${DEVICE.hi}` } } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: ({ theme }) => ({
            minHeight: 36, borderRadius: R.sm, textTransform: 'none', fontWeight: 700,
            transition: 'filter .15s, transform .08s, box-shadow .15s',
            '&:active': { transform: 'translateY(1px)' },
            '&.Mui-disabled': { opacity: 0.45, color: theme.palette.text.disabled },
          }),
          // 默认描边按钮 = 凸起的石墨按键
          outlined: ({ theme, ownerState }) => {
            const t = tone(theme, ownerState.color)
            return {
              border: 'none', color: t?.main ?? '#d3d8df',
              background: 'linear-gradient(180deg, #30343b, #1f2227)', boxShadow: KEY_SHADOW,
              '&:hover': { border: 'none', background: 'linear-gradient(180deg, #373c44, #23262c)', boxShadow: KEY_SHADOW },
              '&:active': { boxShadow: KEY_PRESSED },
              '&.Mui-disabled': { border: 'none', opacity: 0.45 },
            }
          },
          // 实心按钮 = 点亮的按键
          contained: ({ theme, ownerState }) => {
            const t = tone(theme, ownerState.color) ?? theme.palette.primary
            return {
              color: t.contrastText,
              background: `linear-gradient(180deg, ${t.light}, ${t.main})`,
              boxShadow: `0 0 0 1px #000, inset 0 1px 0 rgba(255, 255, 255, 0.45), 0 0 0.9rem ${alpha(t.main, 0.35)}`,
              '&:hover': { background: `linear-gradient(180deg, ${t.light}, ${t.light})`, filter: 'brightness(1.05)' },
              '&:active': { boxShadow: `0 0 0 1px #000, inset 0 0.2rem 0.4rem rgba(0, 0, 0, 0.35)` },
              '&.Mui-disabled': { background: '#2a2d33', boxShadow: KEY_SHADOW, color: '#6b717b' },
            }
          },
          text: { '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.06)' } },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: { borderRadius: R.sm, '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.07)' } },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 99, fontWeight: 600, '& .MuiChip-icon': { color: 'inherit' } },
          outlined: ({ theme, ownerState }) => {
            const t = tone(theme, ownerState.color)
            return {
              border: 'none', backgroundColor: DEVICE.well, boxShadow: WELL_SHADOW, color: t?.main ?? DEVICE.muted,
            }
          },
          filled: ({ theme, ownerState }) => {
            const t = tone(theme, ownerState.color)
            return t
              ? { backgroundColor: alpha(t.main, 0.16), color: t.main, boxShadow: `inset 0 0 0 1px ${alpha(t.main, 0.35)}` }
              : { backgroundColor: '#2c3037', color: DEVICE.ink }
          },
        },
      },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiInputLabel: {
        styleOverrides: { root: { color: DEVICE.muted, '&.Mui-focused': { color: DEVICE.cyan } } },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: R.sm, backgroundColor: DEVICE.well, boxShadow: WELL_SHADOW,
            '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
            '&:hover .MuiOutlinedInput-notchedOutline': { border: 'none' },
            '&.Mui-focused': { boxShadow: `${WELL_SHADOW}, 0 0 0 2px ${DEVICE.cyan}` },
            '&.Mui-error': { boxShadow: `${WELL_SHADOW}, 0 0 0 2px ${DEVICE.red}` },
            '&.Mui-disabled': { opacity: 0.55 },
          },
          input: { '&::placeholder': { color: '#6b717b', opacity: 1 } },
        },
      },
      MuiSelect: { styleOverrides: { icon: { color: DEVICE.muted } } },
      MuiSwitch: {
        styleOverrides: {
          root: { width: 46, height: 26, padding: 0 },
          switchBase: ({ theme, ownerState }) => {
            const t = tone(theme, ownerState.color) ?? theme.palette.primary
            return {
              padding: 3,
              '& .MuiSwitch-thumb': { width: 20, height: 20, boxShadow: '0 1px 2px rgba(0, 0, 0, 0.6)', backgroundColor: '#4a4f58', backgroundImage: 'none' },
              '&.Mui-checked': {
                transform: 'translateX(20px)',
                '& + .MuiSwitch-track': { backgroundColor: DEVICE.well, opacity: 1 },
                '& .MuiSwitch-thumb': {
                  backgroundColor: t.main,
                  backgroundImage: 'radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.7), transparent 45%)',
                  boxShadow: `0 0 0.8rem 0.1rem ${alpha(t.main, 0.7)}`,
                },
              },
              '&.Mui-disabled .MuiSwitch-thumb': { opacity: 0.5 },
            }
          },
          track: { borderRadius: 13, backgroundColor: DEVICE.well, opacity: 1, boxShadow: 'inset 0 0.15rem 0.3rem #000, 0 1px 0 rgba(255, 255, 255, 0.07)' },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: 46 },
          indicator: { height: 3, borderRadius: 3, backgroundColor: DEVICE.green, boxShadow: `0 0 0.6rem ${DEVICE.green}` },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { minHeight: 46, textTransform: 'none', fontWeight: 700, color: DEVICE.engr, '&.Mui-selected': { color: DEVICE.ink } },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderBottom: '1px dashed rgba(255, 255, 255, 0.1)', padding: '8px 10px' },
          head: { fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.12em', color: DEVICE.engr, backgroundColor: 'rgba(0, 0, 0, 0.28)' },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: R.md, alignItems: 'center' },
          standard: ({ theme, ownerState }) => {
            const t = tone(theme, ownerState.severity) ?? theme.palette.info
            return {
              color: DEVICE.ink, backgroundColor: alpha(t.main, 0.1), boxShadow: `inset 0 0 0 1px ${alpha(t.main, 0.45)}`,
              '& .MuiAlert-icon': { color: t.main },
            }
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { height: 8, borderRadius: 4, backgroundColor: DEVICE.well, boxShadow: 'inset 0 1px 3px #000' },
          bar: { borderRadius: 4 },
        },
      },
      MuiMenu: { styleOverrides: { paper: { borderRadius: R.md, marginTop: 4 }, list: { padding: 4 } } },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: 8, minHeight: 36,
            '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.06)' },
            '&.Mui-selected': { backgroundColor: DEVICE.well, boxShadow: 'inset 0 0.12rem 0.3rem rgba(0, 0, 0, 0.8)', color: DEVICE.green },
          },
        },
      },
      MuiPopover: { styleOverrides: { paper: { borderRadius: R.md } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: R.lg } } },
      MuiBackdrop: { styleOverrides: { root: { backgroundColor: 'rgba(5, 6, 8, 0.72)' } } },
      MuiAccordion: {
        styleOverrides: {
          root: {
            borderRadius: R.md, backgroundColor: '#1c1f24', backgroundImage: 'none', boxShadow: `inset 0 1px 0 ${DEVICE.hi}, 0 0 0 1px ${DEVICE.edge}`,
            '&:before': { display: 'none' },
            '&:first-of-type, &:last-of-type': { borderRadius: R.md },
          },
        },
      },
      MuiAccordionSummary: {
        styleOverrides: {
          root: { minHeight: 44, borderRadius: R.md, '&.Mui-expanded': { minHeight: 44 } },
          content: { margin: '8px 0', '&.Mui-expanded': { margin: '8px 0' } },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { borderRadius: 8, fontSize: '0.75rem', backgroundColor: DEVICE.well, color: '#d3d8df', boxShadow: `0 0 0 1px #2a2e35, 0 0.4rem 1rem rgba(0, 0, 0, 0.5)` },
          arrow: { color: DEVICE.well },
        },
      },
      MuiSkeleton: {
        styleOverrides: { root: { backgroundColor: 'rgba(255, 255, 255, 0.07)' }, rounded: { borderRadius: 10 }, rectangular: { borderRadius: 10 } },
      },
    },
  })
}
