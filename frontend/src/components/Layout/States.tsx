import type { ReactNode } from 'react'
import { alpha } from '@mui/material/styles'
import { Box, Paper, Skeleton, Stack, Typography, useTheme, type SxProps, type Theme } from '@mui/material'
import { RADIUS } from '../../theme'
import { useAnimatedValue } from '../../hooks/useAnimatedValue'

/**
 * 页面级骨架屏。
 *
 * 首屏等数据时如果只放一个转圈，用户看到的是"整页空白"；
 * 骨架屏先给出结构轮廓，感知速度明显更快，也能避免内容到达时的布局跳动。
 */
export function PageSkeleton({
  tiles = 4,
  blocks = 2,
  blockHeight = 132,
}: {
  tiles?: number
  blocks?: number
  blockHeight?: number
}) {
  return (
    <Box aria-busy="true" aria-live="polite" aria-label="页面加载中">
      <Box mb={2.5}>
        <Skeleton variant="text" width={208} height={30} />
        <Skeleton variant="text" width="46%" height={17} />
      </Box>

      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
        gap: { xs: 1.25, md: 1.5 },
      }}>
        {Array.from({ length: tiles }, (_, index) => (
          <Paper key={index} elevation={0} sx={{
            p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: RADIUS.md,
          }}>
            <Stack direction="row" spacing={1.25} alignItems="center">
              <Skeleton variant="circular" width={34} height={34} />
              <Box flex={1} minWidth={0}>
                <Skeleton variant="text" width="58%" height={14} />
                <Skeleton variant="text" width="38%" height={21} />
              </Box>
            </Stack>
          </Paper>
        ))}
      </Box>

      {Array.from({ length: blocks }, (_, index) => (
        <Paper key={index} elevation={0} sx={{
          mt: 1.5, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: RADIUS.md,
        }}>
          <Skeleton variant="text" width={148} height={19} sx={{ mb: 1.25 }} />
          <Skeleton variant="rounded" height={blockHeight} />
        </Paper>
      ))}
    </Box>
  )
}

/**
 * 统一的空状态。
 *
 * 之前各页空态各写各的（Alert / 裸 Typography / 无状态），
 * 现在统一为：圆形图标底 + 标题 + 描述 + 可选操作。
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  minHeight = 200,
  sx,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  minHeight?: number | string
  sx?: SxProps<Theme>
}) {
  const theme = useTheme<Theme>()
  return (
    <Box sx={{
      display: 'grid', placeItems: 'center', textAlign: 'center',
      minHeight, px: 2, py: 3.5, ...sx,
    }}>
      <Box sx={{ maxWidth: 360 }}>
        {icon && (
          <Box sx={{
            width: 56, height: 56, mx: 'auto', mb: 1.5,
            display: 'grid', placeItems: 'center',
            borderRadius: RADIUS.full,
            bgcolor: alpha(theme.palette.text.primary, 0.06),
            color: 'text.secondary',
            fontSize: 26,
          }}>
            {icon}
          </Box>
        )}
        <Typography variant="subtitle1" fontWeight={800}>{title}</Typography>
        {description && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, lineHeight: 1.75 }}>
            {description}
          </Typography>
        )}
        {action && <Box mt={2}>{action}</Box>}
      </Box>
    </Box>
  )
}


/**
 * 数值变化时平滑滚动到新值。
 *
 * 速率、CPU/内存这类高频刷新的数字，直接跳变会显得很生硬。
 * tabular-nums 保证宽度不跳动。
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  duration = 450,
  format,
  sx,
}: {
  value: number
  decimals?: number
  duration?: number
  /** 自定义格式化，例如速率这类会自动换算单位的数值 */
  format?: (value: number) => string
  sx?: SxProps<Theme>
}) {
  const display = useAnimatedValue(value, duration)
  const render = (n: number) => (format ? format(n) : n.toFixed(decimals))

  if (!Number.isFinite(value)) {
    return <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', ...sx }}>--</Box>
  }

  return (
    <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', ...sx }}>
      {render(display)}
    </Box>
  )
}
