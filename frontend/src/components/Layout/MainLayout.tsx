/*
 * @Author: 1orz cloudorzi@gmail.com
 * @Date: 2025-11-22 10:30:41
 * @LastEditors: 1orz cloudorzi@gmail.com
 * @LastEditTime: 2025-12-13 12:43:05
 * @FilePath: /udx710-backend/frontend/src/components/Layout/MainLayout.tsx
 * @Description: 
 * 
 * Copyright (c) 2025 by 1orz, All Rights Reserved. 
 */
import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Box, useMediaQuery, useTheme, type Theme } from '@mui/material'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { RefreshContext } from '../../contexts/RefreshContext'
import { ServiceStatusProvider } from '../../contexts/ServiceStatusContext'

const DRAWER_WIDTH = 196
const RESOURCE_REFRESH_STORAGE_KEY = 'udx710.resourceRefreshInterval'
const CELL_REFRESH_STORAGE_KEY = 'udx710.cellRefreshInterval'
const RESOURCE_REFRESH_OPTIONS = [0, 5000, 10000, 30000, 60000]
const CELL_REFRESH_OPTIONS = [0, 30000, 60000, 300000]

function readRefreshInterval(key: string, fallback: number, options: number[]) {
  if (typeof window === 'undefined') return fallback
  try {
    const stored = window.localStorage.getItem(key)
    if (stored === null) return fallback
    const value = Number(stored)
    return options.includes(value) ? value : fallback
  } catch {
    return fallback
  }
}

function writeRefreshInterval(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // 浏览器禁用本地存储时仍保留当前页面的设置。
  }
}

export default function MainLayout() {
  const theme = useTheme<Theme>()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [desktopOpen, setDesktopOpen] = useState(true) // 桌面端侧边栏状态，默认展开
  const [resourceRefreshInterval, setResourceRefreshIntervalState] = useState(() =>
    readRefreshInterval(RESOURCE_REFRESH_STORAGE_KEY, 10000, RESOURCE_REFRESH_OPTIONS),
  )
  const [cellRefreshInterval, setCellRefreshIntervalState] = useState(() =>
    readRefreshInterval(CELL_REFRESH_STORAGE_KEY, 60000, CELL_REFRESH_OPTIONS),
  )
  const [refreshKey, setRefreshKey] = useState(0)

  const setResourceRefreshInterval = (interval: number) => {
    if (!RESOURCE_REFRESH_OPTIONS.includes(interval)) return
    setResourceRefreshIntervalState(interval)
    writeRefreshInterval(RESOURCE_REFRESH_STORAGE_KEY, interval)
    setRefreshKey((previous) => previous + 1)
  }

  const setCellRefreshInterval = (interval: number) => {
    if (!CELL_REFRESH_OPTIONS.includes(interval)) return
    setCellRefreshIntervalState(interval)
    writeRefreshInterval(CELL_REFRESH_STORAGE_KEY, interval)
    setRefreshKey((previous) => previous + 1)
  }

  const handleDrawerToggle = () => {
    if (isMobile) {
      setMobileOpen(!mobileOpen)
    } else {
      setDesktopOpen(!desktopOpen)
    }
  }

  const triggerRefresh = () => {
    setRefreshKey((prev) => prev + 1)
  }

  return (
    <ServiceStatusProvider>
      <RefreshContext.Provider
        value={{
          resourceRefreshInterval,
          setResourceRefreshInterval,
          cellRefreshInterval,
          setCellRefreshInterval,
          refreshKey,
          triggerRefresh,
        }}
      >
        <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
        {/* 顶部导航栏 */}
        <TopBar
          drawerWidth={desktopOpen ? DRAWER_WIDTH : 0}
          onMenuClick={handleDrawerToggle}
          resourceRefreshInterval={resourceRefreshInterval}
          onResourceRefreshIntervalChange={setResourceRefreshInterval}
          cellRefreshInterval={cellRefreshInterval}
          onCellRefreshIntervalChange={setCellRefreshInterval}
        />

        {/* 侧边栏 */}
        <Sidebar
          drawerWidth={DRAWER_WIDTH}
          mobileOpen={mobileOpen}
          desktopOpen={desktopOpen}
          onClose={handleDrawerToggle}
          isMobile={isMobile}
        />

        {/* 主内容区 */}
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: { xs: 1, sm: 1.5, lg: 1.75 },
            width: { 
              xs: '100%',
              sm: desktopOpen ? `calc(100% - ${DRAWER_WIDTH}px)` : '100%'
            },
            ml: {
              xs: 0,
              sm: desktopOpen ? 0 : 0
            },
            mt: { xs: 6.5, sm: 7.5 },
            minHeight: '100vh',
            backgroundColor: 'background.default',
            transition: theme.transitions.create(['width', 'margin'], {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.leavingScreen,
            }),
          }}
        >
          <Box sx={{ width: '100%', maxWidth: 'none', mx: 0 }}>
            <Outlet />
          </Box>
        </Box>
        </Box>
      </RefreshContext.Provider>
    </ServiceStatusProvider>
  )
}
