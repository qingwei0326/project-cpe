/*
 * @Author: 1orz cloudorzi@gmail.com
 * @Date: 2025-12-10 09:19:05
 * @LastEditors: WorkBuddy
 * @FilePath: /udx710-backend/frontend/src/App.tsx
 * @Description: 路由表（设计稿 IA 重构后：蜂窝信号 / 数据网络 / 接口与流量 / USB 模式 / 通知自动化 均为独立页）
 */
import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from './contexts/ThemeContext'
import { queryClient } from './lib/queryClient'
import MainLayout from './components/Layout/MainLayout'
import { PageSkeleton } from './components/Layout/States'

// 路由级别代码分割 - 按需加载页面组件
const Dashboard = lazy(() => import('./pages/Dashboard'))
const DeviceInfo = lazy(() => import('./pages/DeviceInfo'))
const AdvancedNetwork = lazy(() => import('./pages/AdvancedNetwork'))
const Phone = lazy(() => import('./pages/Phone'))
const SMS = lazy(() => import('./pages/SMS'))
const Configuration = lazy(() => import('./pages/Configuration'))
const ATConsole = lazy(() => import('./pages/ATConsole'))
const Terminal = lazy(() => import('./pages/Terminal'))
const OtaUpdate = lazy(() => import('./pages/OtaUpdate'))
const Diagnostics = lazy(() => import('./pages/Diagnostics'))
const CellularSignal = lazy(() => import('./pages/CellularSignal'))
const DataNetwork = lazy(() => import('./pages/DataNetwork'))
const Interfaces = lazy(() => import('./pages/Interfaces'))
const UsbMode = lazy(() => import('./pages/UsbMode'))
const Notifications = lazy(() => import('./pages/Notifications'))

// 路由懒加载时的 fallback，用骨架屏而非转圈，避免整页空白
function PageLoading() {
  return <PageSkeleton tiles={4} blocks={2} blockHeight={132} />
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<MainLayout />}>
              <Route index element={<Suspense fallback={<PageLoading />}><Dashboard /></Suspense>} />
              <Route path="device" element={<Suspense fallback={<PageLoading />}><DeviceInfo /></Suspense>} />
              <Route path="advanced-network" element={<Suspense fallback={<PageLoading />}><AdvancedNetwork /></Suspense>} />
              <Route path="cellular" element={<Suspense fallback={<PageLoading />}><CellularSignal /></Suspense>} />
              <Route path="data-network" element={<Suspense fallback={<PageLoading />}><DataNetwork /></Suspense>} />
              <Route path="interfaces" element={<Suspense fallback={<PageLoading />}><Interfaces /></Suspense>} />
              {/* 旧路由重定向到高级网络页面 */}
              <Route path="network" element={<Navigate to="/advanced-network" replace />} />
              <Route path="network-interfaces" element={<Navigate to="/advanced-network" replace />} />
              <Route path="band-lock" element={<Navigate to="/advanced-network" replace />} />
              <Route path="phone" element={<Suspense fallback={<PageLoading />}><Phone /></Suspense>} />
              <Route path="sms" element={<Suspense fallback={<PageLoading />}><SMS /></Suspense>} />
              <Route path="config" element={<Suspense fallback={<PageLoading />}><Configuration /></Suspense>} />
              <Route path="usb-mode" element={<Suspense fallback={<PageLoading />}><UsbMode /></Suspense>} />
              <Route path="notifications" element={<Suspense fallback={<PageLoading />}><Notifications /></Suspense>} />
              <Route path="ota" element={<Suspense fallback={<PageLoading />}><OtaUpdate /></Suspense>} />
              <Route path="diagnostics" element={<Suspense fallback={<PageLoading />}><Diagnostics /></Suspense>} />
              <Route path="at-console" element={<Suspense fallback={<PageLoading />}><ATConsole /></Suspense>} />
              <Route path="terminal" element={<Suspense fallback={<PageLoading />}><Terminal /></Suspense>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export default App
