/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import { usePolling } from '../hooks/usePolling'
import { getOtaStageLabel } from '../utils/ota'

export type ServiceStatus = 'checking' | 'ok' | 'error'

export interface ServiceStatusSnapshot {
  status: ServiceStatus
  message: string
  version?: string
  otaState?: string
  otaPending: boolean
  lastCheckedAt: number | null
  lastSuccessAt: number | null
  refreshing: boolean
}

interface ServiceStatusContextValue extends ServiceStatusSnapshot {
  refresh: () => Promise<void>
}

const defaultSnapshot: ServiceStatusContextValue = {
  status: 'checking',
  message: '正在检查服务',
  otaPending: false,
  lastCheckedAt: null,
  lastSuccessAt: null,
  refreshing: false,
  refresh: async () => {},
}

const ServiceStatusContext = createContext<ServiceStatusContextValue>(defaultSnapshot)

export function ServiceStatusProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ServiceStatusSnapshot>({
    status: 'checking',
    message: '正在检查服务',
    otaPending: false,
    lastCheckedAt: null,
    lastSuccessAt: null,
    refreshing: false,
  })

  const refresh = useCallback(async () => {
    const checkedAt = Date.now()
    setSnapshot(previous => ({ ...previous, refreshing: true, lastCheckedAt: checkedAt }))

    const [healthResult, otaResult] = await Promise.allSettled([
      api.health(),
      api.getOtaStatus(),
    ])

    const health = healthResult.status === 'fulfilled' ? healthResult.value : null
    const ota = otaResult.status === 'fulfilled' ? otaResult.value.data : undefined
    const healthError = healthResult.status === 'rejected'
      ? (healthResult.reason instanceof Error ? healthResult.reason.message : String(healthResult.reason))
      : ''

    setSnapshot(previous => ({
      ...previous,
      status: health?.status === 'ok' ? 'ok' : 'error',
      message: health?.message || healthError || '服务状态异常',
      version: health?.version || previous.version,
      otaState: ota?.ota_state || previous.otaState,
      otaPending: ota?.pending_update ?? previous.otaPending,
      lastSuccessAt: health?.status === 'ok' ? checkedAt : previous.lastSuccessAt,
      refreshing: false,
    }))
  }, [])

  usePolling(async () => refresh(), 15_000)

  const value = useMemo<ServiceStatusContextValue>(() => ({
    ...snapshot,
    refresh,
  }), [refresh, snapshot])

  return (
    <ServiceStatusContext.Provider value={value}>
      {children}
    </ServiceStatusContext.Provider>
  )
}

export function useServiceStatus() {
  return useContext(ServiceStatusContext)
}

export function getServiceStatusLabel(status: ServiceStatus): string {
  if (status === 'checking') return '连接中'
  if (status === 'ok') return '服务正常'
  return '服务异常'
}

export function getServiceOtaLabel(state?: string | null, pending = false): string {
  if (pending && (!state || state === 'completed')) return 'OTA：待应用'
  if (state) return `OTA：${getOtaStageLabel(state)}`
  return pending ? 'OTA：待应用' : ''
}
