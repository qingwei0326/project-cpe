/*
 * @Author: 1orz cloudorzi@gmail.com
 * @Date: 2025-12-10 10:15:57
 * @LastEditors: 1orz cloudorzi@gmail.com
 * @LastEditTime: 2025-12-13 12:44:40
 * @FilePath: /udx710-backend/frontend/src/pages/Dashboard/hooks/useDashboardData.ts
 * @Description: 
 * 
 * Copyright (c) 2025 by 1orz, All Rights Reserved. 
 */
import { useState, useCallback, useRef } from 'react'
import { api } from '../../../api'
import { usePolling } from '../../../hooks/usePolling'
import type {
  DeviceInfo,
  NetworkInfo,
  CellsResponse,
  QosInfo,
  SimInfo,
  SystemStatsResponse,
  TrafficUsageResponse,
  AirplaneModeResponse,
  ImsStatusResponse,
  RoamingResponse,
  DashboardFreshness,
  DashboardSnapshot,
} from '../../../api/types'

// 网速历史记录的最大数据点数
export const SPEED_HISTORY_MAX_POINTS = 30
const CONNECTIVITY_REFRESH_INTERVAL_MS = 60_000
const NETWORK_REFRESH_INTERVAL_MS = 30_000
const DATA_STATUS_REFRESH_INTERVAL_MS = 30_000
const AIRPLANE_REFRESH_INTERVAL_MS = 30_000
const TRAFFIC_USAGE_REFRESH_INTERVAL_MS = 60_000

// 单个接口的速度历史类型
export interface InterfaceSpeedHistory {
  rx: number[]
  tx: number[]
  totalRx: number
  totalTx: number
}

export interface PingSummary {
  success: boolean
  latency_ms?: number
  min_latency_ms?: number
  max_latency_ms?: number
  p95_latency_ms?: number
  packet_loss_percent?: number
}

export interface ConnectivityResult {
  ipv4: PingSummary
  ipv6: PingSummary
  ipv6_available: boolean
}

export interface DashboardData {
  deviceInfo: DeviceInfo | null
  simInfo: SimInfo | null
  systemStats: SystemStatsResponse | null
  trafficUsage: TrafficUsageResponse | null
  networkInfo: NetworkInfo | null
  dataStatus: boolean
  cellsInfo: CellsResponse | null
  qosInfo: QosInfo | null
  airplaneMode: AirplaneModeResponse | null
  imsStatus: ImsStatusResponse | null
  connectivity: ConnectivityResult | null
  speedHistory: Record<string, InterfaceSpeedHistory>
  roaming: RoamingResponse | null
  freshness: Record<string, DashboardFreshness>
  snapshotErrors: Record<string, string>
}

export interface DashboardActions {
  toggleData: () => Promise<void>
  toggleAirplaneMode: () => Promise<void>
  toggleRoaming: () => Promise<void>
  loadData: () => Promise<void>
}

export function useDashboardData(
  resourceRefreshInterval: number,
  cellRefreshInterval: number,
  refreshKey: number,
) {
  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 数据状态
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  const [simInfo, setSimInfo] = useState<SimInfo | null>(null)
  const [systemStats, setSystemStats] = useState<SystemStatsResponse | null>(null)
  const [trafficUsage, setTrafficUsage] = useState<TrafficUsageResponse | null>(null)
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null)
  const [dataStatus, setDataStatus] = useState(false)
  const [cellsInfo, setCellsInfo] = useState<CellsResponse | null>(null)
  const [qosInfo, setQosInfo] = useState<QosInfo | null>(null)
  const [airplaneMode, setAirplaneMode] = useState<AirplaneModeResponse | null>(null)
  const [imsStatus, setImsStatus] = useState<ImsStatusResponse | null>(null)
  const [connectivity, setConnectivity] = useState<ConnectivityResult | null>(null)
  const [roaming, setRoaming] = useState<RoamingResponse | null>(null)
  const [freshness, setFreshness] = useState<Record<string, DashboardFreshness>>({})
  const [snapshotErrors, setSnapshotErrors] = useState<Record<string, string>>({})

  // 网速历史记录
  const [speedHistory, setSpeedHistory] = useState<Record<string, InterfaceSpeedHistory>>({})
  const speedHistoryRef = useRef<Record<string, InterfaceSpeedHistory>>({})
  const loadInFlightRef = useRef(false)
  const lastUpdatedRef = useRef(new Map<string, number>())
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [failedKeys, setFailedKeys] = useState<string[]>([])

  // 更新速度历史记录
  const updateSpeedHistory = useCallback((stats: SystemStatsResponse | null) => {
    if (!stats?.network_speed?.interfaces) return

    const newHistory = { ...speedHistoryRef.current }
    
    for (const iface of stats.network_speed.interfaces) {
      const existing = newHistory[iface.interface] || { rx: [], tx: [], totalRx: 0, totalTx: 0 }
      
      const rxHistory = [...existing.rx, iface.rx_bytes_per_sec]
      const txHistory = [...existing.tx, iface.tx_bytes_per_sec]
      
      if (rxHistory.length > SPEED_HISTORY_MAX_POINTS) {
        rxHistory.shift()
        txHistory.shift()
      }
      
      newHistory[iface.interface] = {
        rx: rxHistory,
        tx: txHistory,
        totalRx: iface.total_rx_bytes,
        totalTx: iface.total_tx_bytes,
      }
    }
    
    speedHistoryRef.current = newHistory
    setSpeedHistory(newHistory)
  }, [])

  const applySnapshot = useCallback((snapshot: DashboardSnapshot) => {
    const { sections } = snapshot
    // A null section represents an unavailable source, not a value to clear from the UI.
    if (sections.device) setDeviceInfo(sections.device)
    if (sections.sim) setSimInfo(sections.sim)
    if (sections.network) setNetworkInfo(sections.network)
    if (sections.cells) setCellsInfo(sections.cells)
    if (sections.qos) setQosInfo(sections.qos)
    if (sections.data) setDataStatus(sections.data.active)
    if (sections.roaming) setRoaming(sections.roaming)
    if (sections.airplane_mode) setAirplaneMode(sections.airplane_mode)
    if (sections.ims) setImsStatus(sections.ims)
    if (sections.connectivity) setConnectivity(sections.connectivity)
    if (sections.stats) {
      setSystemStats(sections.stats)
      updateSpeedHistory(sections.stats)
    }
    if (sections.traffic) setTrafficUsage(sections.traffic)
    setFreshness(snapshot.freshness)
    setSnapshotErrors(Object.fromEntries(snapshot.errors.map(({ section, message }) => [section, message])))
    const updatedAt = Date.parse(snapshot.generated_at)
    setLastUpdatedAt(Number.isFinite(updatedAt) ? updatedAt : Date.now())
    setFailedKeys(Object.entries(snapshot.freshness)
      .filter(([, value]) => value.state !== 'fresh')
      .map(([key]) => key))
  }, [updateSpeedHistory])

  // Legacy endpoints are used only when this backend does not expose the snapshot route.
  const loadData = useCallback(async (force = true) => {
    if (loadInFlightRef.current) return
    loadInFlightRef.current = true
    setError(null)
    const jobs: Promise<void>[] = []
    const update = <T,>(
      key: string, maxAge: number,
      fetcher: () => Promise<{ data?: T | null }>,
      apply: (data: T) => void,
    ) => {
      const lastUpdated = lastUpdatedRef.current.get(key)
      if (!force && maxAge < 0) return
      if (!force && maxAge > 0 && lastUpdated !== undefined && Date.now() - lastUpdated < maxAge) return
      jobs.push((async () => {
        try {
          const response = await fetcher()
          if (response.data !== null && response.data !== undefined) {
            apply(response.data)
            setInitialLoading(false)
            const updatedAt = Date.now()
            lastUpdatedRef.current.set(key, updatedAt)
            setLastUpdatedAt(previous => Math.max(previous || 0, updatedAt))
            setFailedKeys(previous => previous.filter(failedKey => failedKey !== key))
          }
        } catch (error) {
          setFailedKeys(previous => previous.includes(key) ? previous : [...previous, key])
          throw error
        }
      })())
    }

    try {
      try {
        const snapshot = await api.getDashboardSnapshot()
        if (snapshot.data) {
          applySnapshot(snapshot.data)
          setInitialLoading(false)
          return
        }
        throw new Error('dashboard snapshot returned no data')
      } catch (snapshotError) {
        const message = snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
        // The request helper deliberately hides transport details; these are the route-level
        // responses emitted by supported older backends. Other failures retain the last snapshot.
        if (!/(HTTP (404|405|5\d\d)|not found|route.*not.*found|internal server error)/i.test(message)) {
          setFailedKeys(previous => previous.includes('snapshot') ? previous : [...previous, 'snapshot'])
          setError(message)
          return
        }
      }
      update('stats', 0, () => api.getSystemStats(), stats => {
        setSystemStats(stats)
        updateSpeedHistory(stats)
      })
      update('trafficUsage', TRAFFIC_USAGE_REFRESH_INTERVAL_MS, () => api.getTrafficUsage(), setTrafficUsage)
      update('network', NETWORK_REFRESH_INTERVAL_MS, () => api.getNetworkInfo(), setNetworkInfo)
      update('data', DATA_STATUS_REFRESH_INTERVAL_MS, () => api.getDataStatus(), data => { setDataStatus(data.active) })
      // 小区间隔到期时显式刷新服务端快照；服务端仍会合并同一秒内的重复请求。
      update('cells', cellRefreshInterval === 0 ? -1 : cellRefreshInterval, () => api.getCellsInfo(true), setCellsInfo)
      update('airplane', AIRPLANE_REFRESH_INTERVAL_MS, () => api.getAirplaneMode(), setAirplaneMode)
      update('qos', 15_000, () => api.getQosInfo(), setQosInfo)
      update('ims', 30_000, () => api.getImsStatus(), setImsStatus)
      update('roaming', 30_000, () => api.getRoamingStatus(), setRoaming)
      update('device', 60_000, () => api.getDeviceInfo(), setDeviceInfo)
      update('sim', 60_000, () => api.getSimInfo(), setSimInfo)
      update('connectivity', CONNECTIVITY_REFRESH_INTERVAL_MS, () => api.getConnectivity(), setConnectivity)

      const results = await Promise.allSettled(jobs)
      const errors = results.flatMap(result => result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
        : [])
      if (errors.length) setError([...new Set(errors)].join('；'))
    } finally {
      loadInFlightRef.current = false
      setInitialLoading(false)
    }
  }, [applySnapshot, cellRefreshInterval, updateSpeedHistory])

  // 切换数据连接
  const toggleData = useCallback(async () => {
    try {
      const newStatus = !dataStatus
      const response = await api.setDataStatus(newStatus)
      if (response.data) setDataStatus(response.data.active)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [dataStatus])

  // 切换飞行模式
  const toggleAirplaneMode = useCallback(async () => {
    try {
      const newEnabled = !airplaneMode?.enabled
      const response = await api.setAirplaneMode(newEnabled)
      if (response.data) {
        setAirplaneMode(response.data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [airplaneMode?.enabled])

  // 切换漫游
  const toggleRoaming = useCallback(async () => {
    try {
      const newAllowed = !roaming?.roaming_allowed
      const response = await api.setRoamingAllowed(newAllowed)
      if (response.data) {
        setRoaming(response.data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [roaming?.roaming_allowed])

  usePolling(loadData, resourceRefreshInterval, refreshKey)

  return {
    initialLoading,
    error,
    setError,
    lastUpdatedAt,
    failedKeys,
    data: {
      deviceInfo,
      simInfo,
      systemStats,
      trafficUsage,
      networkInfo,
      dataStatus,
      cellsInfo,
      qosInfo,
      airplaneMode,
      imsStatus,
      connectivity,
      speedHistory,
      roaming,
      freshness,
      snapshotErrors,
    } as DashboardData,
    actions: {
      toggleData,
      toggleAirplaneMode,
      toggleRoaming,
      loadData,
    } as DashboardActions,
  }
}
