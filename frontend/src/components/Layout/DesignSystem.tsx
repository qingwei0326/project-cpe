import type { ReactNode } from 'react'
import { alpha } from '@mui/material/styles'
import { Box, Chip, Paper, Stack, Typography, useTheme, type ChipProps, type SxProps, type Theme } from '@mui/material'
import { RADIUS } from '../../theme'

/** 角落的小螺丝。 */
const screw = (side: 'left' | 'right') => ({
  content: '""',
  position: 'absolute' as const,
  top: 8,
  [side]: 8,
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: 'radial-gradient(circle at 35% 30%, #5b616b, #14161a 70%)',
  boxShadow: '0 0 0 1px #0a0b0d',
  pointerEvents: 'none' as const,
})

export function Surface({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Paper elevation={0} sx={[
      {
        position: 'relative',
        p: { xs: 1.5, md: 1.75 },
        border: 'none',
        borderRadius: '14px',
        overflow: 'hidden',
        '&::before': screw('left'),
        '&::after': screw('right'),
      },
      ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
    ]}>
      {children}
    </Paper>
  )
}

export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={1.25} mb={1.25}>
      <Box minWidth={0}>
        <Typography
          variant="subtitle1"
          fontWeight={800}
          noWrap
          sx={{ fontSize: '0.8125rem', letterSpacing: '0.12em', color: '#d3d8df', textShadow: '0 1px 0 rgba(255,255,255,.05)' }}
        >
          {title}
        </Typography>
        {description && <Typography variant="caption" color="text.secondary" noWrap>{description}</Typography>}
      </Box>
      {action}
    </Box>
  )
}

export function StatusBadge({ label, color = 'default', variant = 'outlined' }: { label: string; color?: ChipProps['color']; variant?: ChipProps['variant'] }) {
  return <Chip size="small" label={label} color={color} variant={variant} />
}

export function MetricTile({ label, value, detail, icon, color = 'info' }: { label: string; value: string; detail?: string; icon?: ReactNode; color?: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' }) {
  const theme = useTheme<Theme>()
  const tint = theme.palette[color].main
  return (
    <Box sx={{ minWidth: 0, p: 1.25, borderRadius: '12px', bgcolor: '#0f1114', boxShadow: 'inset 0 .15rem .4rem rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.07)' }}>
      <Stack direction="row" spacing={1} alignItems="center">
        {icon && (
          <Box sx={{ width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: RADIUS.full, color: tint, bgcolor: 'transparent', boxShadow: `0 0 0 1px ${alpha(tint, .5)}, 0 0 .7rem ${alpha(tint, .35)}` }}>
            {icon}
          </Box>
        )}
        <Box minWidth={0}>
          <Typography variant="caption" color="text.secondary" noWrap display="block">{label}</Typography>
          <Typography variant="body2" fontWeight={800} noWrap sx={{ fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace', fontSize: '0.95rem' }}>{value}</Typography>
          {detail && <Typography variant="caption" color="text.secondary" noWrap display="block">{detail}</Typography>}
        </Box>
      </Stack>
    </Box>
  )
}

export function DenseGrid({ children, columns = { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, sx }: { children: ReactNode; columns?: Record<string, string>; sx?: SxProps<Theme> }) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: columns, gap: { xs: 1.25, md: 1.5 }, alignItems: 'stretch', ...sx }}>{children}</Box>
}
