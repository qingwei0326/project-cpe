/*
 * 系统维护页（设计稿 IA 重构后）：USB 模式、通知自动化已拆为独立页，
 * 数据连接 / 飞行模式已并入数据网络页，本页仅保留健康检查与重启。
 */
import { useEffect, useState } from 'react'
import {
  Box,
  Typography,
  Alert,
  Button,
  CircularProgress,
  Chip,
  LinearProgress,
} from '@mui/material'
import { CheckCircle, Error as ErrorIcon, Refresh } from '@mui/icons-material'
import { api } from '../api'
import PageHeader from '../components/Layout/PageHeader'
import { SectionHeader, Surface } from '@/components/Layout/DesignSystem'
import RebootButton from '../components/Layout/RebootButton'
import { RADIUS } from '../theme'

export default function ConfigurationPage() {
  const [healthStatus, setHealthStatus] = useState<{ status: string; timestamp?: string } | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)

  const checkHealth = async () => {
    setHealthLoading(true)
    try {
      const res = await api.health()
      setHealthStatus({ status: res.status, timestamp: new Date().toISOString() })
    } catch {
      setHealthStatus({ status: 'error', timestamp: new Date().toISOString() })
    } finally {
      setHealthLoading(false)
    }
  }

  useEffect(() => {
    void checkHealth()
    const interval = setInterval(() => { void checkHealth() }, 30_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <Box>
      <PageHeader
        eyebrow="系统 / 维护"
        title="系统维护"
        description="查看后端健康状态并管理设备重启。"
      />

      <Surface sx={{ mb: 1.5 }}>
        <SectionHeader
          title="系统健康检查"
          description="后端服务运行状态"
          action={
            <Button size="small" onClick={() => void checkHealth()} disabled={healthLoading} startIcon={healthLoading ? <CircularProgress size={16} /> : <Refresh />}>
              刷新
            </Button>
          }
        />
        {healthLoading && !healthStatus ? (
          <LinearProgress />
        ) : (
          <Box display="flex" alignItems="center" gap={2}>
            {healthStatus?.status === 'ok' ? (
              <CheckCircle sx={{ fontSize: 48, color: 'success.main' }} />
            ) : (
              <ErrorIcon sx={{ fontSize: 48, color: 'error.main' }} />
            )}
            <Box>
              <Typography variant="h6" fontWeight={600}>
                {healthStatus?.status === 'ok' ? '系统正常' : '系统异常'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                后端服务:{' '}
                <Chip
                  label={healthStatus?.status === 'ok' ? '运行中' : '异常'}
                  size="small"
                  color={healthStatus?.status === 'ok' ? 'success' : 'error'}
                />
              </Typography>
              {healthStatus?.timestamp && (
                <Typography variant="caption" color="text.secondary">
                  上次检查: {new Date(healthStatus.timestamp).toLocaleTimeString()}
                </Typography>
              )}
            </Box>
          </Box>
        )}
      </Surface>

      <Surface>
        <SectionHeader title="危险操作" description="重启会中断所有网络连接" />
        <Alert severity="warning" sx={{ mb: 1.5, borderRadius: RADIUS.md }}>
          重启设备将中断所有网络连接并重新注册，重启期间设备不可管理。
        </Alert>
        <RebootButton fullWidth />
      </Surface>
    </Box>
  )
}
