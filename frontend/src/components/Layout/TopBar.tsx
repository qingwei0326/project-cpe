/*
 * @Author: 1orz cloudorzi@gmail.com
 * @Date: 2025-11-22 10:30:41
 * @LastEditors: 1orz cloudorzi@gmail.com
 * @LastEditTime: 2025-12-13 12:43:28
 * @FilePath: /udx710-backend/frontend/src/components/Layout/TopBar.tsx
 * @Description: 
 * 
 * Copyright (c) 2025 by 1orz, All Rights Reserved. 
 */
/*
 * @Author: 1orz cloudorzi@gmail.com
 * @Date: 2025-11-22 10:30:41
 * @LastEditors: 1orz cloudorzi@gmail.com
 * @LastEditTime: 2025-12-13 12:43:22
 * @FilePath: /udx710-backend/frontend/src/components/Layout/TopBar.tsx
 * @Description: 
 * 
 * Copyright (c) 2025 by 1orz, All Rights Reserved. 
 */
import { useState } from 'react'
import {
  AppBar,
  Toolbar,
  IconButton,
  Box,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Tooltip,
} from '@mui/material'
import {
  Menu as MenuIcon,
  Refresh as RefreshIcon,
  MoreVert as MoreVertIcon,
  Speed as SpeedIcon,
} from '@mui/icons-material'
import { useRefreshInterval } from '../../contexts/RefreshContext'
import {
  getServiceOtaLabel,
  getServiceStatusLabel,
  useServiceStatus,
} from '../../contexts/ServiceStatusContext'
import { getOtaStageColor } from '../../utils/ota'
import { Link as RouterLink } from 'react-router-dom'
import './shell.css'

/** 把 MUI 语义色映射为前面板指示灯的色调。 */
function lampTone(color: string): 'good' | 'info' | 'warn' | 'bad' {
  if (color === 'success') return 'good'
  if (color === 'error') return 'bad'
  if (color === 'warning') return 'warn'
  return 'info'
}

interface TopBarProps {
  drawerWidth: number
  onMenuClick: () => void
  resourceRefreshInterval: number
  onResourceRefreshIntervalChange: (interval: number) => void
  cellRefreshInterval: number
  onCellRefreshIntervalChange: (interval: number) => void
}

export default function TopBar({
  drawerWidth,
  onMenuClick,
  resourceRefreshInterval,
  onResourceRefreshIntervalChange,
  cellRefreshInterval,
  onCellRefreshIntervalChange,
}: TopBarProps) {
  const { triggerRefresh } = useRefreshInterval()
  const service = useServiceStatus()
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const [refreshMenuAnchor, setRefreshMenuAnchor] = useState<null | HTMLElement>(null)

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }

  const handleMenuClose = () => {
    setAnchorEl(null)
  }

  const handleRefreshMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setRefreshMenuAnchor(event.currentTarget)
  }

  const handleRefreshMenuClose = () => {
    setRefreshMenuAnchor(null)
  }

  const handleResourceRefreshIntervalChange = (interval: number) => {
    onResourceRefreshIntervalChange(interval)
    handleRefreshMenuClose()
  }

  const handleCellRefreshIntervalChange = (interval: number) => {
    onCellRefreshIntervalChange(interval)
    handleRefreshMenuClose()
  }

  const handleRefresh = () => {
    triggerRefresh()
    void service.refresh()
  }

  const getRefreshLabel = (interval: number) => {
    if (interval === 0) return '手动'
    return `${interval / 1000}秒`
  }

  return (
    <AppBar
      position="fixed"
      className="dv-top"
      sx={{
        width: { sm: `calc(100% - ${drawerWidth}px)` },
        ml: { sm: `${drawerWidth}px` },
      }}
    >
      <Toolbar sx={{ minHeight: { xs: 58, sm: 68 }, px: { xs: 1.5, sm: 3 } }}>
        {/* 菜单折叠按钮 - 所有屏幕尺寸都可见 */}
        <IconButton
          className="dv-btn"
          aria-label="切换侧边栏"
          edge="start"
          onClick={onMenuClick}
          sx={{ mr: { xs: 1, sm: 2 } }}
        >
          <MenuIcon />
        </IconButton>

        {/* 页面名交给内容区的 PageHeader，顶栏只留全局状态，避免两处重复表达
            「你在哪个页面」。 */}
        <Box sx={{ flexGrow: 1, minWidth: 0 }} />

        {/* 全局服务状态：指示灯 + 等宽文字，与前面板同一语言 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: { xs: 1, md: 1.5 } }}>
          <Tooltip title={service.message}>
            <span
              className={`dv-status dv-tone-${service.status === 'ok' ? 'good' : service.status === 'error' ? 'bad' : 'warn'}${service.status === 'checking' ? ' is-checking' : ''}`}
              role="status"
            >
              <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{getServiceStatusLabel(service.status)}</Box>
            </span>
          </Tooltip>
          {(service.otaPending || Boolean(service.otaState && service.otaState !== 'completed')) && (
            <RouterLink to="/ota" className={`dv-status dv-tone-${lampTone(getOtaStageColor(service.otaState))}`}>
              {getServiceOtaLabel(service.otaState, service.otaPending)}
            </RouterLink>
          )}
          {service.lastSuccessAt && (
            <Box component="span" className="dv-sync" sx={{ display: { xs: 'none', md: 'inline' } }}>
              同步 {new Date(service.lastSuccessAt).toLocaleTimeString()}
            </Box>
          )}
        </Box>

        {/* 右侧按钮组 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 } }}>
          {/* 刷新按钮 - 始终显示 */}
          <IconButton
            className="dv-btn"
            onClick={handleRefresh}
            title="刷新页面"
            aria-label="刷新页面"
          >
            <RefreshIcon />
          </IconButton>

          {/* 更多选项按钮 - 折叠其他功能 */}
          <IconButton
            className="dv-btn"
            onClick={handleMenuOpen}
            title="更多选项"
            aria-label="更多选项"
          >
            <MoreVertIcon />
          </IconButton>
        </Box>

        {/* 更多选项菜单 */}
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleMenuClose}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'right',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'right',
          }}
          PaperProps={{
            className: 'dv-menu-paper',
            sx: {
              minWidth: 200,
              mt: 1,
            },
          }}
        >
          {/* 刷新频率 */}
          <MenuItem onClick={handleRefreshMenuOpen}>
            <ListItemIcon>
              <SpeedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="刷新频率"
              secondary={`资源 ${getRefreshLabel(resourceRefreshInterval)} · 小区 ${getRefreshLabel(cellRefreshInterval)}`}
              secondaryTypographyProps={{ variant: 'caption' }}
            />
          </MenuItem>
        </Menu>

        {/* 刷新频率子菜单 */}
        <Menu
          anchorEl={refreshMenuAnchor}
          open={Boolean(refreshMenuAnchor)}
          onClose={handleRefreshMenuClose}
          anchorOrigin={{
            vertical: 'top',
            horizontal: 'left',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'right',
          }}
          PaperProps={{
            className: 'dv-menu-paper',
            sx: {
              minWidth: 150,
            },
          }}
        >
          <MenuItem disabled>资源数据（网速、CPU、内存）</MenuItem>
          <MenuItem
            selected={resourceRefreshInterval === 5000}
            onClick={() => handleResourceRefreshIntervalChange(5000)}
          >
            资源 5秒/次
          </MenuItem>
          <MenuItem
            selected={resourceRefreshInterval === 10000}
            onClick={() => handleResourceRefreshIntervalChange(10000)}
          >
            资源 10秒/次
          </MenuItem>
          <MenuItem
            selected={resourceRefreshInterval === 30000}
            onClick={() => handleResourceRefreshIntervalChange(30000)}
          >
            资源 30秒/次
          </MenuItem>
          <Divider />
          <MenuItem
            selected={resourceRefreshInterval === 0}
            onClick={() => handleResourceRefreshIntervalChange(0)}
          >
            资源 手动刷新
          </MenuItem>
          <Divider />
          <MenuItem disabled>小区与信号数据</MenuItem>
          <MenuItem
            selected={cellRefreshInterval === 30000}
            onClick={() => handleCellRefreshIntervalChange(30000)}
          >
            小区 30秒/次
          </MenuItem>
          <MenuItem
            selected={cellRefreshInterval === 60000}
            onClick={() => handleCellRefreshIntervalChange(60000)}
          >
            小区 60秒/次
          </MenuItem>
          <MenuItem
            selected={cellRefreshInterval === 300000}
            onClick={() => handleCellRefreshIntervalChange(300000)}
          >
            小区 5分钟/次
          </MenuItem>
          <MenuItem
            selected={cellRefreshInterval === 0}
            onClick={() => handleCellRefreshIntervalChange(0)}
          >
            小区 仅手动
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  )
}
