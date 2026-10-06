/*
 * @Author: 1orz cloudorzi@gmail.com
 * @Date: 2025-12-10 09:19:05
 * @LastEditors: 1orz cloudorzi@gmail.com
 * @LastEditTime: 2025-12-13 12:43:08
 * @FilePath: /udx710-backend/frontend/src/components/Layout/Sidebar.tsx
 * @Description: 
 * 
 * Copyright (c) 2025 by 1orz, All Rights Reserved. 
 */
import { useNavigate, useLocation } from 'react-router-dom'
import { EASE_OUT, RADIUS, SURFACE_BY_MODE } from '../../theme'
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Divider,
  Box,
  Typography,
  Link,
  ListSubheader,
} from '@mui/material'
import {
  Dashboard as DashboardIcon,
  Devices as DevicesIcon,
  SignalCellularAlt as SignalIcon,
  Settings as SettingsIcon,
  Terminal as TerminalIcon,
  GitHub as GitHubIcon,
  MonitorHeart as DiagnosticsIcon,
  Phone as PhoneIcon,
  Sms as SmsIcon,
  SystemUpdateAlt as OtaIcon,
  CellTower as CellTowerIcon,
  DataUsage as DataUsageIcon,
  Lan as LanIcon,
  Usb as UsbIcon,
  Webhook as WebhookIcon,
} from '@mui/icons-material'

interface SidebarProps {
  drawerWidth: number
  mobileOpen: boolean
  desktopOpen: boolean
  onClose: () => void
  isMobile: boolean
}

// 导航分组保留原有路径，同时让长期运维入口更容易找到。
const menuGroups = [
  { label: '概览', items: [{ path: '/', label: '仪表盘', icon: DashboardIcon }] },
  { label: '设备与网络', items: [
    { path: '/device', label: '设备信息', icon: DevicesIcon },
    { path: '/cellular', label: '蜂窝信号', icon: CellTowerIcon },
    { path: '/data-network', label: '数据网络', icon: DataUsageIcon },
    { path: '/interfaces', label: '接口与流量', icon: LanIcon },
    { path: '/advanced-network', label: '高级网络', icon: SignalIcon },
  ] },
  { label: '通信', items: [
    { path: '/phone', label: '电话管理', icon: PhoneIcon },
    { path: '/sms', label: '短信管理', icon: SmsIcon },
  ] },
  { label: '系统', items: [
    { path: '/config', label: '系统维护', icon: SettingsIcon },
    { path: '/usb-mode', label: 'USB 模式', icon: UsbIcon },
    { path: '/notifications', label: '通知自动化', icon: WebhookIcon },
    { path: '/ota', label: 'OTA 更新', icon: OtaIcon },
    { path: '/diagnostics', label: '系统诊断', icon: DiagnosticsIcon },
  ] },
  { label: '高级', items: [
    { path: '/at-console', label: 'AT 控制台', icon: TerminalIcon },
    { path: '/terminal', label: 'Web 终端', icon: TerminalIcon },
  ] },
]

export default function Sidebar({ drawerWidth, mobileOpen, desktopOpen, onClose, isMobile }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()

  const handleNavigation = (path: string): void => {
    void navigate(path)
    if (isMobile) {
      onClose()
    }
  }

  const drawer = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 品牌块：色块 + 名称，替代原来纯文字的大标题 */}
      <Toolbar sx={{ minHeight: 62, px: 1.5, gap: 1.25, alignItems: 'center' }}>
        <Box sx={{
          width: 30, height: 30, flexShrink: 0, borderRadius: RADIUS.sm,
          bgcolor: 'primary.main', display: 'grid', placeItems: 'center',
          color: 'primary.contrastText', fontWeight: 800, fontSize: '0.95rem',
        }}>
          U
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, lineHeight: 1.2 }} noWrap component="div">UDX710</Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: '0.6875rem' }}>5G CPE Router</Typography>
        </Box>
      </Toolbar>
      <Divider />
      <List
        sx={{ flexGrow: 1, py: .75, overflowY: 'auto' }}
        subheader={<li />}
      >
        {menuGroups.map((group) => (
          <Box component="li" key={group.label} sx={{ listStyle: 'none' }}>
            {group.label && <ListSubheader
              disableSticky
              sx={{
                bgcolor: 'transparent',
                color: 'text.disabled',
                fontSize: '0.6875rem',
                fontWeight: 600,
                lineHeight: 2,
                letterSpacing: '0.06em',
                px: 2,
                mt: 0.5,
              }}
            >
              {group.label}
            </ListSubheader>}
            {group.items.map((item) => {
              const IconComponent = item.icon
              const selected = item.path === '/'
                ? location.pathname === '/'
                : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
              return (
                <ListItem key={item.path} disablePadding>
                  <ListItemButton
                    selected={selected}
                    onClick={() => handleNavigation(item.path)}
                    sx={(theme) => {
                      const surface = theme.palette.mode === 'dark' ? SURFACE_BY_MODE.dark : SURFACE_BY_MODE.light
                      return {
                        mx: 1,
                        mb: 0.25,
                        minHeight: 38,
                        borderRadius: RADIUS.sm,
                        color: 'text.secondary',
                        transition: `background-color 160ms ${EASE_OUT}, color 160ms ${EASE_OUT}`,
                        '& .MuiListItemIcon-root': {
                          color: 'inherit', minWidth: 32,
                          '& svg': { fontSize: 19 },
                        },
                        '& .MuiListItemText-primary': { fontSize: '0.8125rem', fontWeight: 500 },
                        '&:hover': { bgcolor: theme.palette.action.hover, color: 'text.primary' },
                        '&.Mui-selected': {
                          // 选中态：左侧色条 + 主色文字 + 高一级底色，不只靠背景色
                          position: 'relative',
                          bgcolor: surface.selected,
                          color: 'primary.main',
                          fontWeight: 600,
                          '&::before': {
                            content: '""',
                            position: 'absolute',
                            left: -8,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: 3,
                            height: 20,
                            borderRadius: '0 2px 2px 0',
                            bgcolor: 'primary.main',
                          },
                          '&:hover': { bgcolor: surface.selected },
                          '& .MuiListItemIcon-root': { color: 'inherit' },
                        },
                      }
                    }}
                  >
                    <ListItemIcon>
                      <IconComponent />
                    </ListItemIcon>
                    <ListItemText primary={item.label} />
                  </ListItemButton>
                </ListItem>
              )
            })}
          </Box>
        ))}
      </List>
      {/* Footer with copyright */}
      <Box sx={{ p: 2.25, borderTop: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
        <Link
          href="https://github.com/1orz/project-cpe"
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            color: 'text.secondary',
            textDecoration: 'none',
            fontSize: '0.75rem',
            '&:hover': {
              color: 'primary.main',
            },
          }}
        >
          <GitHubIcon sx={{ fontSize: 16 }} />
          <Typography variant="caption" color="inherit">
            1orz/project-cpe
          </Typography>
        </Link>
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
          v{__APP_VERSION__} ({__GIT_BRANCH__}/{__GIT_COMMIT__})
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
          Copyright 2025 1orz
        </Typography>
      </Box>
    </Box>
  )

  return (
    <Box
      component="nav"
      sx={{ 
        width: { xs: 0, sm: desktopOpen ? drawerWidth : 0 },
        flexShrink: { sm: 0 },
        transition: `width 0.3s ${EASE_OUT}`,
      }}
    >
      {/* 移动端抽屉 */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onClose}
        ModalProps={{
          keepMounted: true, // 提升移动端性能
        }}
        sx={{
          display: { xs: 'block', sm: 'none' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: drawerWidth,
          },
        }}
      >
        {drawer}
      </Drawer>

      {/* 桌面端可折叠抽屉 */}
      <Drawer
        variant="persistent"
        open={desktopOpen}
        sx={{
          display: { xs: 'none', sm: 'block' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: drawerWidth,
            transition: `transform 0.3s ${EASE_OUT}`,
          },
        }}
      >
        {drawer}
      </Drawer>
    </Box>
  )
}

