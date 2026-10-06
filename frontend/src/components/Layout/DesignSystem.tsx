import type { ReactNode } from 'react'
import { alpha } from '@mui/material/styles'
import { Box, Chip, Paper, Stack, Typography, useTheme, type ChipProps, type SxProps, type Theme } from '@mui/material'
import { RADIUS } from '../../theme'

export function Surface({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Paper elevation={0} sx={{
      p: { xs: 1.25, md: 1.5 },
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: RADIUS.md,
      // Use the active theme's paper surface so the component remains legible in both modes.
      bgcolor: 'background.paper',
      overflow: 'hidden',
      ...sx,
    }}>
      {children}
    </Paper>
  )
}

export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={1.25} mb={1}>
      <Box minWidth={0}>
        <Typography variant="subtitle1" fontWeight={800} noWrap>{title}</Typography>
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
    <Box sx={{ minWidth: 0, p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: RADIUS.md, bgcolor: alpha(tint, .06) }}>
      <Stack direction="row" spacing={1} alignItems="center">
        {icon && <Box sx={{ width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: RADIUS.full, bgcolor: alpha(tint, .14), color: tint }}>{icon}</Box>}
        <Box minWidth={0}>
          <Typography variant="caption" color="text.secondary" noWrap display="block">{label}</Typography>
          <Typography variant="body2" fontWeight={800} noWrap>{value}</Typography>
          {detail && <Typography variant="caption" color="text.secondary" noWrap display="block">{detail}</Typography>}
        </Box>
      </Stack>
    </Box>
  )
}

export function DenseGrid({ children, columns = { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, sx }: { children: ReactNode; columns?: Record<string, string>; sx?: SxProps<Theme> }) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: columns, gap: { xs: 1.25, md: 1.5 }, alignItems: 'stretch', ...sx }}>{children}</Box>
}
