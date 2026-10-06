import type { ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'

interface PageHeaderProps {
  title: string
  description?: string
  eyebrow?: string
  actions?: ReactNode
}

export default function PageHeader({ title, description, eyebrow = 'UDX710 / 终端管理', actions }: PageHeaderProps) {
  return (
    <Box
      component="header"
      sx={{
        display: 'flex',
        alignItems: { xs: 'flex-start', sm: 'flex-end' },
        justifyContent: 'space-between',
        gap: 2,
        mb: { xs: 1, sm: 1.25 },
        flexWrap: 'wrap',
      }}
    >
      {/* minWidth: 0 让 flex 子项可以收缩，否则 nowrap 的长描述会把整页撑宽 */}
      <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
        <Typography
          variant="overline"
          sx={{
            display: 'block',
            mb: 0,
            color: 'primary.main',
            fontWeight: 800,
            letterSpacing: '0.14em',
            lineHeight: 1.05,
          }}
        >
          {eyebrow}
        </Typography>
        <Typography variant="h5" component="h1" sx={{ lineHeight: 1.05 }}>
          {title}
        </Typography>
        {description && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mt: 0.25,
              maxWidth: 640,
              lineHeight: 1.2,
              // 窄屏换行而不是截断或撑破布局；sm 以上才收成单行省略
              whiteSpace: { xs: 'normal', sm: 'nowrap' },
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              overflowWrap: 'anywhere',
            }}
          >
            {description}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {actions}
        </Stack>
      )}
    </Box>
  )
}
