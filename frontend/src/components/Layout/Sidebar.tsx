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
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { EASE_OUT } from '../../theme'
import { Drawer, Box } from '@mui/material'
import {
  Dashboard as DashboardIcon,
  Devices as DevicesIcon,
  SignalCellularAlt as SignalIcon,
  Terminal as TerminalIcon,
  GitHub as GitHubIcon,
  MonitorHeart as DiagnosticsIcon,
  Phone as PhoneIcon,
  Sms as SmsIcon,
  SystemUpdateAlt as OtaIcon,
  DataUsage as DataUsageIcon,
  Lan as LanIcon,
  Usb as UsbIcon,
  Webhook as WebhookIcon,
} from '@mui/icons-material'
import { useServiceStatus } from '../../contexts/ServiceStatusContext'
import './shell.css'

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
    { path: '/data-network', label: '数据网络', icon: DataUsageIcon },
    { path: '/interfaces', label: '接口与流量', icon: LanIcon },
    { path: '/advanced-network', label: '高级网络', icon: SignalIcon },
  ] },
  { label: '通信', items: [
    { path: '/phone', label: '电话管理', icon: PhoneIcon },
    { path: '/sms', label: '短信管理', icon: SmsIcon },
  ] },
  { label: '系统', items: [
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
  const location = useLocation()
  const service = useServiceStatus()
  // 品牌旁的指示灯直接反映后端服务状态。
  const lampTone = service.status === 'ok' ? 'good' : service.status === 'error' ? 'bad' : 'warn'

  const drawer = (
    <div className="dv-side">
      <div className="dv-side-brand">
        <div className="dv-side-logo">
          <b>UDX710<i> · </i>5G</b>
          <small>5G CPE · Router</small>
        </div>
        <span className={`dv-lamp-s dv-tone-${lampTone} is-on`} role="img" aria-label={`服务状态：${service.status === 'ok' ? '正常' : service.status === 'error' ? '异常' : '连接中'}`} />
      </div>

      <nav className="dv-nav" aria-label="主导航">
        {menuGroups.map((group) => (
          <section key={group.label}>
            <h2 className="dv-nav-grp">{group.label}</h2>
            <ul>
              {group.items.map((item) => {
                const IconComponent = item.icon
                const selected = item.path === '/'
                  ? location.pathname === '/'
                  : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
                return (
                  <li key={item.path}>
                    <RouterLink
                      to={item.path}
                      aria-current={selected ? 'page' : undefined}
                      onClick={isMobile ? onClose : undefined}
                    >
                      <IconComponent />
                      {item.label}
                    </RouterLink>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </nav>

      <div className="dv-side-foot">
        <a href="https://github.com/1orz/project-cpe" target="_blank" rel="noopener noreferrer">
          <GitHubIcon />1orz/project-cpe
        </a>
        <span>v{__APP_VERSION__} ({__GIT_BRANCH__}/{__GIT_COMMIT__})</span>
        <span>Copyright 2025 1orz</span>
      </div>
    </div>
  )

  return (
    <Box
      component="aside"
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
