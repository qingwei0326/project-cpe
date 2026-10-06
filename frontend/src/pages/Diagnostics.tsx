import { useCallback, useMemo, useRef, useState, useEffect, type ReactNode } from 'react'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  CheckCircle,
  ContentCopy,
  Download,
  Error as ErrorIcon,
  Memory,
  MonitorHeart,
  Refresh,
  Storage,
  SystemUpdateAlt,
  Terminal,
  Timer,
} from '@mui/icons-material'
import { Link as RouterLink } from 'react-router-dom'
import { api } from '../api'
import { RADIUS } from '../theme'
import type { CpuInfo, DiagnosticsStatus, DiskInfo, SystemStatsResponse } from '../api/types'
import { usePolling } from '../hooks/usePolling'
import { useServiceStatus, getServiceStatusLabel } from '../contexts/ServiceStatusContext'
import { getOtaStageColor, getOtaStageLabel } from '../utils/ota'
import PageHeader from '../components/Layout/PageHeader'
import { PageSkeleton } from '../components/Layout/States'
import RebootButton from '../components/Layout/RebootButton'
import { groupDiagnosticIncidents, type DiagnosticIncident } from '../utils/diagnosticsIncidents'

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds < 1) return '未记录'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  return `${minutes} 分钟`
}

function incidentDuration(incident: DiagnosticIncident): string {
  if (!incident.start || !incident.end || incident.start.getTime() === incident.end.getTime()) return incident.ongoing ? '持续中' : '瞬时事件'
  const seconds = Math.max(1, (incident.end.getTime() - incident.start.getTime()) / 1000)
  return seconds < 60 ? `${Math.round(seconds)} 秒` : formatDuration(seconds)
}

function diskColor(disk?: DiskInfo): 'success' | 'warning' | 'error' | 'primary' {
  const used = disk?.used_percent ?? 0
  if (used >= 85) return 'error'
  if (used >= 70) return 'warning'
  return used > 0 ? 'success' : 'primary'
}

function DataCard({
  title,
  icon,
  children,
}: {
  title: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardHeader
        avatar={icon}
        title={title}
        titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }}
        sx={{ pb: 0 }}
      />
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export default function DiagnosticsPage() {
  const service = useServiceStatus()
  const [diagnostics, setDiagnostics] = useState<DiagnosticsStatus | null>(null)
  const [stats, setStats] = useState<SystemStatsResponse | null>(null)
  const [cpuInfo, setCpuInfo] = useState<CpuInfo | null>(null)
  const [log, setLog] = useState('')
  const [logMode, setLogMode] = useState<'active' | 'rotated'>('active')
  const logModeRef = useRef(logMode)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null)

  const loadData = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    const [diagnosticsResult, statsResult, cpuResult, logResult] = await Promise.allSettled([
      api.getDiagnostics(),
      api.getSystemStats(),
      api.getCpuInfo(),
      api.getDiagnosticsLog(logMode === 'rotated'),
    ])

    const errors: string[] = []
    if (diagnosticsResult.status === 'fulfilled' && diagnosticsResult.value.data) {
      setDiagnostics(diagnosticsResult.value.data)
    } else if (diagnosticsResult.status === 'rejected') {
      errors.push(diagnosticsResult.reason instanceof Error ? diagnosticsResult.reason.message : String(diagnosticsResult.reason))
    }
    if (statsResult.status === 'fulfilled' && statsResult.value.data) {
      setStats(statsResult.value.data)
    } else if (statsResult.status === 'rejected') {
      errors.push(statsResult.reason instanceof Error ? statsResult.reason.message : String(statsResult.reason))
    }
    if (cpuResult.status === 'fulfilled' && cpuResult.value.data) {
      setCpuInfo(cpuResult.value.data)
    } else if (cpuResult.status === 'rejected') {
      errors.push(cpuResult.reason instanceof Error ? cpuResult.reason.message : String(cpuResult.reason))
    }
    if (logResult.status === 'fulfilled') {
      setLog(logResult.value)
    } else {
      const message = logResult.reason instanceof Error ? logResult.reason.message : String(logResult.reason)
      // 日志文件在服务首次启动前可能不存在，此时不把它当成诊断页故障。
      if (!message.includes('HTTP 404')) errors.push(message)
    }

    if (errors.length) setError([...new Set(errors)].join('；'))
    setLastLoadedAt(Date.now())
    setLoading(false)
    setRefreshing(false)
  }, [logMode])

  useEffect(() => {
    if (logModeRef.current !== logMode) {
      logModeRef.current = logMode
      void loadData()
    }
  }, [logMode, loadData])

  usePolling(async () => loadData(), 30_000)

  const homeDisk = useMemo(
    () => stats?.disk?.find(disk => disk.mount_point === '/home'),
    [stats],
  )
  const recentIncidents = useMemo(() => groupDiagnosticIncidents(log), [log])

  const copyLog = async () => {
    if (!log) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(log)
      } else {
        // 设备管理页通常通过 HTTP 打开，Clipboard API 在非安全上下文中不可用。
        const textarea = document.createElement('textarea')
        textarea.value = log
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        const copied = document.execCommand('copy')
        textarea.remove()
        if (!copied) throw new Error('浏览器拒绝了复制操作')
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : '复制失败，请手动选择日志文本')
    }
  }

  const downloadLog = () => {
    if (!log) return
    const url = URL.createObjectURL(new Blob([log], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = logMode === 'rotated' ? 'udx710-diagnostics.log.1' : 'udx710-diagnostics.log'
    link.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return <PageSkeleton tiles={3} blocks={2} blockHeight={136} />
  }

  return (
    <Box>
      <PageHeader
        eyebrow="系统 / 运行证据"
        title="系统诊断"
        description="查看服务、存储、遥测和 OTA 运行证据，便于定位重启或掉线原因。"
        actions={(
          <Button
            variant="outlined"
            startIcon={refreshing ? <CircularProgress size={16} /> : <Refresh />}
            onClick={() => void loadData()}
            disabled={refreshing}
          >
            刷新诊断
          </Button>
        )}
      />

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
          <AlertTitle>部分诊断数据暂不可用</AlertTitle>
          {error}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <DataCard title="服务状态" icon={<MonitorHeart color="primary" />}>
            <Stack spacing={1.25}>
              <Box display="flex" alignItems="center" gap={1}>
                {service.status === 'ok' ? <CheckCircle color="success" /> : <ErrorIcon color="error" />}
                <Typography variant="h6">{getServiceStatusLabel(service.status)}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">{service.message}</Typography>
              <Divider />
              <Box display="flex" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">当前版本</Typography>
                <Typography variant="caption" fontFamily="monospace">{service.version || '未知'}</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">进程 PID</Typography>
                <Typography variant="caption" fontFamily="monospace">{diagnostics?.pid || '-'}</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">运行时间</Typography>
                <Typography variant="caption">{formatDuration(diagnostics?.uptime_seconds)}</Typography>
              </Box>
              <Typography variant="caption" color="text.disabled">
                最近检查：{lastLoadedAt ? new Date(lastLoadedAt).toLocaleTimeString() : '未记录'}
              </Typography>
            </Stack>
          </DataCard>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <DataCard title="存储状态" icon={<Storage color="primary" />}>
            <Stack spacing={1.5}>
              {homeDisk ? (
                <Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                    <Typography fontWeight={700}>/home</Typography>
                    <Chip
                      size="small"
                      label={`${homeDisk.used_percent.toFixed(0)}%`}
                      color={diskColor(homeDisk)}
                    />
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, homeDisk.used_percent)}
                    color={diskColor(homeDisk)}
                    sx={{ height: 8, borderRadius: RADIUS.full }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {formatBytes(homeDisk.used_bytes)} / {formatBytes(homeDisk.total_bytes)}，可用 {formatBytes(homeDisk.available_bytes)}
                  </Typography>
                  {homeDisk.used_percent >= 85 ? (
                    <Alert severity="error" sx={{ mt: 1.5 }}>空间紧张，OTA 前请先清理旧文件。</Alert>
                  ) : homeDisk.used_percent >= 70 ? (
                    <Alert severity="warning" sx={{ mt: 1.5 }}>空间已使用较多，建议检查 OTA 备份和日志。</Alert>
                  ) : null}
                </Box>
              ) : (
                <Typography color="text.secondary">暂时没有 /home 分区数据</Typography>
              )}
              <Divider />
              <Box display="flex" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">当前日志</Typography>
                <Typography variant="caption">{formatBytes(diagnostics?.log_bytes || 0)}</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">轮转日志</Typography>
                <Typography variant="caption">{formatBytes(diagnostics?.rotated_log_bytes || 0)}</Typography>
              </Box>
              <Typography variant="caption" color="text.disabled">
                日志上限：{formatBytes(diagnostics?.max_log_bytes || 0)}，只保留当前和一份轮转文件。
              </Typography>
            </Stack>
          </DataCard>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <DataCard title="OTA 状态" icon={<SystemUpdateAlt color="primary" />}>
            <Stack spacing={1.5}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" color="text.secondary">更新阶段</Typography>
                <Chip
                  size="small"
                  label={getOtaStageLabel(service.otaState)}
                  color={getOtaStageColor(service.otaState)}
                />
              </Box>
              <Typography variant="body2">
                {service.otaPending ? '存在待安装更新，请在确认版本后执行应用。' : '当前没有待安装更新。'}
              </Typography>
              <Button component={RouterLink} to="/ota" variant="outlined" size="small" fullWidth>
                打开 OTA 更新
              </Button>
              <Typography variant="caption" color="text.secondary">
                上次服务恢复：{service.lastSuccessAt ? new Date(service.lastSuccessAt).toLocaleString() : '暂无记录'}
              </Typography>
            </Stack>
          </DataCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <DataCard title="启动与重启证据" icon={<Timer color="primary" />}>
            <Stack spacing={1}>
              <Box display="flex" justifyContent="space-between" gap={1}>
                <Typography variant="caption" color="text.secondary">Boot ID</Typography>
                <Typography variant="caption" fontFamily="monospace" sx={{ overflowWrap: 'anywhere', textAlign: 'right' }}>
                  {diagnostics?.boot_id || '不可用'}
                </Typography>
              </Box>
              <Box display="flex" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">系统运行时间</Typography>
                <Typography variant="caption">{formatDuration(diagnostics?.system_uptime_seconds)}</Typography>
              </Box>
              <Divider />
              {(diagnostics?.reset_evidence ?? []).length ? (diagnostics?.reset_evidence ?? []).map((evidence, index) => {
                const label = evidence.source.includes('pstore') ? 'pstore' : evidence.source.includes('last_kmsg') ? 'last_kmsg' : evidence.source
                const readable = evidence.readable
                return (
                  <Box key={`${evidence.source}-${index}`} display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                    <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>{label}</Typography>
                    <Chip
                      size="small"
                      label={readable ? '可读' : evidence.available ? '不可读' : '不存在'}
                      color={readable ? 'success' : evidence.available ? 'warning' : 'default'}
                    />
                  </Box>
                )
              }) : (
                <Typography variant="caption" color="text.secondary">暂无 pstore 或 last_kmsg 证据。</Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                以上仅展示系统提供的 pstore / last_kmsg 内容；当前页面未获得内核复位证据时，不能据此判断具体复位原因。
              </Typography>
            </Stack>
          </DataCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <DataCard title="CPU 与系统信息" icon={<Memory color="primary" />}>
            <Stack spacing={1}>
              <Box display="flex" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">型号</Typography>
                <Typography variant="body2">{cpuInfo?.model_name || stats?.system_info?.machine || '-'}</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">硬件</Typography>
                <Typography variant="body2">{cpuInfo?.hardware || '-'}</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">核心数</Typography>
                <Typography variant="body2">{cpuInfo?.core_count || stats?.cpu_load?.core_count || '-'} 核</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">系统负载</Typography>
                <Typography variant="body2" fontFamily="monospace">
                  {stats?.cpu_load ? `${stats.cpu_load.load_1min.toFixed(2)} / ${stats.cpu_load.load_5min.toFixed(2)} / ${stats.cpu_load.load_15min.toFixed(2)}` : '-'}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                负载是运行队列平均值，CPU 使用率请看仪表盘的实时采样。
              </Typography>
            </Stack>
          </DataCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <DataCard title="最近事件" icon={<Timer color="primary" />}>
            {recentIncidents.length ? (
              <List dense disablePadding sx={{ maxHeight: 340, overflow: 'auto' }}>
                {recentIncidents.map((incident, index) => (
                  <ListItem key={`${incident.kind}-${incident.start?.toISOString() || index}`} disableGutters divider={index < recentIncidents.length - 1}>
                    <ListItemText
                      primary={(
                        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                          <Typography variant="caption" fontWeight={700}>{incident.label}</Typography>
                          <Chip size="small" label={incident.ongoing ? '持续中' : '已恢复'} color={incident.ongoing ? 'warning' : 'success'} />
                        </Box>
                      )}
                      secondary={(
                        <>
                          <Typography component="span" variant="caption" display="block">
                            开始：{incident.start ? incident.start.toLocaleString() : '时间不可用'} · 持续：{incidentDuration(incident)}
                          </Typography>
                          <Typography component="span" variant="caption" display="block">
                            恢复路径：{incident.path}
                          </Typography>
                        </>
                      )}
                      primaryTypographyProps={{
                        variant: 'caption',
                        fontFamily: 'monospace',
                        sx: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
                      }}
                      secondaryTypographyProps={{ component: 'div' }}
                    />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {log ? '暂无可归并的网络、恢复、重启或 OTA 故障事件。' : '暂无持久化诊断事件，日志文件可能尚未生成或当前不可用。'}
              </Typography>
            )}
          </DataCard>
        </Grid>

        <Grid size={12}>
          <Card>
            <CardHeader
              avatar={<Terminal color="primary" />}
              title="诊断日志"
              titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }}
              action={
                <Box display="flex" alignItems="center" gap={0.5}>
                  <ButtonGroup size="small" variant="outlined" aria-label="日志类型">
                    <Button
                      variant={logMode === 'active' ? 'contained' : 'outlined'}
                      onClick={() => setLogMode('active')}
                    >
                      活动日志
                    </Button>
                    <Button
                      variant={logMode === 'rotated' ? 'contained' : 'outlined'}
                      onClick={() => setLogMode('rotated')}
                    >
                      轮转日志
                    </Button>
                  </ButtonGroup>
                  <Tooltip title={copied ? '已复制' : '复制日志'}>
                    <span>
                      <IconButton size="small" onClick={() => void copyLog()} disabled={!log}>
                        <ContentCopy fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="下载日志">
                    <span>
                      <IconButton size="small" onClick={downloadLog} disabled={!log}>
                        <Download fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              }
            />
            <CardContent sx={{ pt: 0 }}>
              <Paper
                variant="outlined"
                sx={{
                  p: 1.5,
                  minHeight: 180,
                  maxHeight: 420,
                  overflow: 'auto',
                  bgcolor: 'background.default',
                }}
              >
                <Typography component="pre" variant="caption" sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'monospace' }}>
                  {log || (logMode === 'rotated' ? '暂无轮转日志。服务尚未产生轮转文件。' : '暂无日志内容。服务首次启动后会在这里记录启动、OTA 和异常事件。')}
                </Typography>
              </Paper>
              <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 1 }}>
                日志只读取最近内容，页面隐藏时暂停刷新。
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* 危险操作区：与其他操作分开，红色描边 + 二次确认（设计稿第六章） */}
        <Grid size={12}>
          <Card variant="outlined" sx={{ borderColor: 'error.main' }}>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} flexWrap="wrap">
                <Box>
                  <Typography variant="subtitle1" fontWeight={700} color="error.main">危险操作</Typography>
                  <Typography variant="body2" color="text.secondary">
                    重启会中断所有网络连接并重新注册，重启期间设备不可管理。
                  </Typography>
                </Box>
                <Box sx={{ minWidth: 180 }}>
                  <RebootButton />
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}
