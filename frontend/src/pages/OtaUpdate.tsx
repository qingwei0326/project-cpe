/*
 * @Author: 1orz cloudorzi@gmail.com
 * @Date: 2025-12-10 09:19:05
 * @LastEditors: 1orz cloudorzi@gmail.com
 * @LastEditTime: 2025-12-13 12:44:57
 * @FilePath: /udx710-backend/frontend/src/pages/OtaUpdate.tsx
 * @Description: 
 * 
 * Copyright (c) 2025 by 1orz, All Rights Reserved. 
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  CircularProgress,
  Alert,
  AlertTitle,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Paper,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Divider,
} from '@mui/material'
import {
  CloudUpload,
  CheckCircle,
  Error as ErrorIcon,
  Warning,
  Info,
  Refresh,
  SystemUpdateAlt,
  Cancel,
  RestartAlt,
} from '@mui/icons-material'
import { api } from '../api'
import PageHeader from '../components/Layout/PageHeader'
import { PageSkeleton } from '../components/Layout/States'
import type { OtaStatusResponse, OtaUploadResponse } from '../api/types'
import { getOtaStageColor, getOtaStageLabel } from '../utils/ota'

type OtaFlowPhase =
  | 'idle'
  | 'reading'
  | 'uploading'
  | 'server_validation'
  | 'prepared'
  | 'awaiting_restart'
  | 'applying'
  | 'health_check'
  | 'completed'
  | 'rolled_back'
  | 'failed'

const RECOVERY_DELAYS_MS = [3_000, 5_000, 8_000, 13_000, 20_000, 30_000, 45_000]

const FLOW_PHASE_LABELS: Record<OtaFlowPhase, string> = {
  idle: '等待操作',
  reading: '读取文件',
  uploading: '上传中',
  server_validation: '服务端校验',
  prepared: '已准备，等待应用',
  awaiting_restart: '已应用，等待重启',
  applying: '应用中',
  health_check: '等待重启并进行健康检查',
  completed: '更新完成',
  rolled_back: '已回滚',
  failed: '需要处理',
}

function isExpectedRestartDisconnect(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /network|fetch|连接|超时|reset|aborted|abort|empty reply|failed to fetch/i.test(message)
}

export default function OtaUpdate() {
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [flowPhase, setFlowPhase] = useState<OtaFlowPhase>('idle')
  const [recoveryAttempt, setRecoveryAttempt] = useState(0)
  const [recoveryActive, setRecoveryActive] = useState(false)
  
  const [status, setStatus] = useState<OtaStatusResponse | null>(null)
  const [uploadResult, setUploadResult] = useState<OtaUploadResponse | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<'apply' | 'cancel' | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recoveryTokenRef = useRef(0)

  useEffect(() => () => {
    recoveryTokenRef.current += 1
  }, [])

  const loadStatus = useCallback(async (silent = false) => {
    try {
      const res = await api.getOtaStatus()
      if (res.data) {
        setStatus(res.data)
      }
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const waitForRecovery = useCallback(async (targetVersion?: string, targetCommit?: string) => {
    const token = ++recoveryTokenRef.current
    setRecoveryActive(true)
    setRecoveryAttempt(0)
    setFlowPhase('health_check')
    setSuccess('设备正在重启，等待服务恢复和版本确认…')

    for (let index = 0; index < RECOVERY_DELAYS_MS.length; index += 1) {
      await new Promise<void>(resolve => window.setTimeout(resolve, RECOVERY_DELAYS_MS[index]))
      if (recoveryTokenRef.current !== token) return

      const [healthResult, statusResult] = await Promise.allSettled([
        api.health(),
        api.getOtaStatus(),
      ])
      if (recoveryTokenRef.current !== token) return

      const nextStatus = statusResult.status === 'fulfilled' ? statusResult.value.data : undefined
      if (nextStatus) setStatus(nextStatus)
      setRecoveryAttempt(index + 1)

      if (nextStatus?.ota_state === 'rolled_back') {
        setRecoveryActive(false)
        setFlowPhase('rolled_back')
        setError('设备已回滚到上一版本，请查看诊断日志后再重试。')
        setSuccess(null)
        return
      }

      const healthy = healthResult.status === 'fulfilled' && healthResult.value.status === 'ok'
      const versionConfirmed = Boolean(
        healthy && nextStatus && (
          !targetVersion || nextStatus.current_version === targetVersion || nextStatus.ota_state === 'completed'
        ) && (!targetCommit || nextStatus.current_commit === targetCommit || nextStatus.ota_state === 'completed'),
      )
      if (versionConfirmed) {
        setRecoveryActive(false)
        setFlowPhase('completed')
        setSuccess(`更新完成，服务已恢复（${nextStatus?.current_version || targetVersion || '新版本'}）`)
        setError(null)
        return
      }
    }

    if (recoveryTokenRef.current === token) {
      setRecoveryActive(false)
      setFlowPhase('failed')
      setError('服务暂未恢复。请查看诊断页，确认设备网络和 OTA 日志后重试。')
      setSuccess(null)
    }
  }, [])

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // 验证文件类型（支持 tar.gz 和 zip 格式）
    const validExtensions = ['.tar.gz', '.tgz', '.zip']
    const isValid = validExtensions.some(ext => file.name.endsWith(ext))
    
    if (!isValid) {
      setError('请上传 .tar.gz 或 .zip 格式的 OTA 更新包')
      return
    }

    setUploading(true)
    setUploadProgress(0)
    setFlowPhase('reading')
    setError(null)
    setSuccess(null)
    setUploadResult(null)

    try {
      setFlowPhase('uploading')
      const res = await api.uploadOta(file, percent => {
        setUploadProgress(percent)
        if (percent >= 100) setFlowPhase('server_validation')
      })
      if (res.status === 'ok' && res.data) {
        setUploadResult(res.data)
        if (res.data.validation.valid) {
          setFlowPhase('prepared')
          setSuccess('OTA 包上传成功，验证通过')
        } else {
          setFlowPhase('failed')
          setError('OTA 包验证失败：' + (res.data.validation.error || '未知错误'))
        }
        await loadStatus(true)
      } else {
        setFlowPhase('failed')
        setError(res.message || '上传失败')
      }
    } catch (err) {
      setFlowPhase('failed')
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      // 清空文件选择
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleApply = async (restartNow: boolean) => {
    setConfirmDialog(null)
    setApplying(true)
    setError(null)
    setSuccess(null)
    setFlowPhase('applying')

    const targetVersion = uploadResult?.meta.version || status?.pending_meta?.version
    const targetCommit = uploadResult?.meta.commit || status?.pending_meta?.commit

    try {
      const res = await api.applyOta(restartNow)
      if (res.status === 'ok') {
        setSuccess(restartNow ? '更新已应用，设备即将重启…' : '更新文件已切换，请手动重启服务生效')
        setUploadResult(null)
        await loadStatus(true)
        if (restartNow) {
          await waitForRecovery(targetVersion, targetCommit)
        } else {
          setFlowPhase('awaiting_restart')
        }
      } else {
        setError(res.message || '应用更新失败')
        setFlowPhase('failed')
      }
    } catch (err) {
      // restart_now 时连接被设备主动关闭是正常现象，继续走恢复确认流程。
      if (restartNow && isExpectedRestartDisconnect(err)) {
        setFlowPhase('health_check')
        await waitForRecovery(targetVersion, targetCommit)
      } else {
        setFlowPhase('failed')
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setApplying(false)
    }
  }

  const handleCancel = async () => {
    setConfirmDialog(null)
    setError(null)
    setSuccess(null)

    try {
      const res = await api.cancelOta()
      if (res.status === 'ok') {
        setSuccess('已取消待安装的更新')
        setUploadResult(null)
        setFlowPhase('idle')
        await loadStatus(true)
      } else {
        setError(res.message || '取消失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading) {
    return <PageSkeleton tiles={2} blocks={2} blockHeight={124} />
  }

  return (
    <Box>
      <PageHeader
        eyebrow="系统 / 发布管理"
        title="OTA 更新"
        description="上传、校验和追踪系统更新，确认服务恢复后再标记完成。"
        actions={(
          <Button variant="outlined" startIcon={<Refresh />} onClick={() => void loadStatus()} disabled={loading}>
            刷新状态
          </Button>
        )}
      />

      {/* 错误/成功提示 */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <Stack spacing={3}>
        {/* 当前版本信息 */}
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" gap={1} mb={2}>
              <Info color="primary" />
              <Typography variant="h6">当前版本</Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell component="th" sx={{ width: 150 }}>版本号</TableCell>
                    <TableCell>
                      <Chip label={status?.current_version || 'N/A'} color="primary" size="small" />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell component="th">Commit</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>
                      {status?.current_commit || 'N/A'}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell component="th">更新阶段</TableCell>
                    <TableCell>
                      <Chip
                        label={getOtaStageLabel(status?.ota_state)}
                        color={getOtaStageColor(status?.ota_state)}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>

        {/* 待安装更新 */}
        {status?.pending_update && status.pending_meta && (
          <Card sx={{ borderColor: 'warning.main', borderWidth: 2, borderStyle: 'solid' }}>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <Warning color="warning" />
                <Typography variant="h6">待安装更新</Typography>
                <Chip 
                  label={status.pending_meta.version} 
                  color="warning" 
                  size="small" 
                  sx={{ ml: 1 }}
                />
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell component="th" sx={{ width: 150 }}>版本号</TableCell>
                      <TableCell>{status.pending_meta.version}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th">Commit</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{status.pending_meta.commit}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th">构建时间</TableCell>
                      <TableCell>{status.pending_meta.build_time}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th">架构</TableCell>
                      <TableCell>{status.pending_meta.arch}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
              <Divider sx={{ my: 2 }} />
              <Stack direction="row" spacing={2}>
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<SystemUpdateAlt />}
                  onClick={() => setConfirmDialog('apply')}
                  disabled={applying}
                >
                  {applying ? <CircularProgress size={20} /> : '应用更新'}
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<Cancel />}
                  onClick={() => setConfirmDialog('cancel')}
                >
                  取消更新
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* 上传新版本 */}
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" gap={1} mb={2}>
              <CloudUpload color="primary" />
              <Typography variant="h6">上传更新包</Typography>
            </Box>
            
            <Alert severity="info" sx={{ mb: 2 }}>
              <AlertTitle>OTA 更新包格式</AlertTitle>
              请上传 <code>.tar.gz</code> 格式的 OTA 更新包. 错误的包会导致系统无法启动.
            </Alert>

            <input
              ref={fileInputRef}
              type="file"
              accept=".gz,.tgz,.zip,application/gzip,application/x-gzip,application/x-tar,application/zip"
              style={{ display: 'none' }}
              onChange={(e) => void handleFileSelect(e)}
            />
            
            <Button
              variant="contained"
              startIcon={uploading ? <CircularProgress size={20} color="inherit" /> : <CloudUpload />}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              size="large"
            >
              {uploading ? '上传中...' : '选择更新包'}
            </Button>

            {uploading && (
              <Box sx={{ mt: 2 }}>
                <Box display="flex" justifyContent="space-between" mb={0.5}>
                  <Typography variant="body2" color="text.secondary">
                    {FLOW_PHASE_LABELS[flowPhase]}
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>{uploadProgress}%</Typography>
                </Box>
                <LinearProgress variant="determinate" value={uploadProgress} />
                <Typography variant="caption" color="text.secondary">
                  文件读取和传输完成后，还会等待服务端校验；请勿在此期间拔出设备。
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>

        {/* OTA 流程状态 */}
        {flowPhase !== 'idle' && !uploading && (
          <Card variant="outlined">
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={1}>
                {flowPhase === 'completed' ? <CheckCircle color="success" /> : flowPhase === 'failed' || flowPhase === 'rolled_back' ? <ErrorIcon color="error" /> : <SystemUpdateAlt color="primary" />}
                <Typography variant="h6">更新流程</Typography>
                <Chip
                  label={FLOW_PHASE_LABELS[flowPhase]}
                  color={flowPhase === 'completed' ? 'success' : flowPhase === 'failed' || flowPhase === 'rolled_back' ? 'error' : 'primary'}
                  size="small"
                  variant="outlined"
                />
              </Box>
              {recoveryActive && (
                <>
                  <LinearProgress sx={{ mb: 1 }} />
                  <Typography variant="body2" color="text.secondary">
                    第 {recoveryAttempt || 1} 次确认，采用递增等待，避免设备重启时重复请求。
                  </Typography>
                </>
              )}
              {flowPhase === 'health_check' && !recoveryActive && (
                <Alert severity="info">健康检查尚未完成，可以点击“刷新状态”重新确认。</Alert>
              )}
              {(flowPhase === 'failed' || flowPhase === 'rolled_back') && (
                <Button sx={{ mt: 1 }} size="small" variant="outlined" onClick={() => void loadStatus()} startIcon={<Refresh />}>
                  重新检查状态
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* 上传结果 */}
        {uploadResult && (
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                {uploadResult.validation.valid ? (
                  <CheckCircle color="success" />
                ) : (
                  <ErrorIcon color="error" />
                )}
                <Typography variant="h6">
                  验证结果
                </Typography>
                <Chip 
                  label={uploadResult.validation.valid ? '通过' : '失败'}
                  color={uploadResult.validation.valid ? 'success' : 'error'}
                  size="small"
                />
              </Box>
              
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell component="th" sx={{ width: 180 }}>版本号</TableCell>
                      <TableCell>{uploadResult.meta.version}</TableCell>
                      <TableCell align="right">
                        {uploadResult.validation.is_newer ? (
                          <Chip label="新版本" color="success" size="small" />
                        ) : (
                          <Chip label="旧版本或相同" color="warning" size="small" />
                        )}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th">Commit</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }} colSpan={2}>
                        {uploadResult.meta.commit}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th">构建时间</TableCell>
                      <TableCell colSpan={2}>{uploadResult.meta.build_time}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th">二进制 MD5</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {uploadResult.meta.binary_md5}
                      </TableCell>
                      <TableCell align="right">
                        {uploadResult.validation.binary_md5_match ? (
                          <CheckCircle color="success" fontSize="small" />
                        ) : (
                          <ErrorIcon color="error" fontSize="small" />
                        )}
                      </TableCell>
                    </TableRow>
                    {uploadResult.meta.binary_sha256 && (
                      <TableRow>
                        <TableCell component="th">二进制 SHA-256</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {uploadResult.meta.binary_sha256}
                        </TableCell>
                        <TableCell align="right">
                          {uploadResult.validation.binary_sha256_match ? (
                            <CheckCircle color="success" fontSize="small" />
                          ) : (
                            <ErrorIcon color="error" fontSize="small" />
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow>
                      <TableCell component="th">前端 MD5</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {uploadResult.meta.frontend_md5}
                      </TableCell>
                      <TableCell align="right">
                        {uploadResult.validation.frontend_md5_match ? (
                          <CheckCircle color="success" fontSize="small" />
                        ) : (
                          <ErrorIcon color="error" fontSize="small" />
                        )}
                      </TableCell>
                    </TableRow>
                    {uploadResult.meta.frontend_sha256 && (
                      <TableRow>
                        <TableCell component="th">前端 SHA-256</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {uploadResult.meta.frontend_sha256}
                        </TableCell>
                        <TableCell align="right">
                          {uploadResult.validation.frontend_sha256_match ? (
                            <CheckCircle color="success" fontSize="small" />
                          ) : (
                            <ErrorIcon color="error" fontSize="small" />
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow>
                      <TableCell component="th">架构</TableCell>
                      <TableCell>{uploadResult.meta.arch}</TableCell>
                      <TableCell align="right">
                        {uploadResult.validation.arch_match ? (
                          <CheckCircle color="success" fontSize="small" />
                        ) : (
                          <ErrorIcon color="error" fontSize="small" />
                        )}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>

              {uploadResult.validation.error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {uploadResult.validation.error}
                </Alert>
              )}
            </CardContent>
          </Card>
        )}
      </Stack>

      {/* 确认对话框 - 应用更新 */}
      <Dialog open={confirmDialog === 'apply'} onClose={() => setConfirmDialog(null)}>
        <DialogTitle>确认应用更新</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要应用此更新吗？更新将替换当前的后端程序和前端文件。
          </DialogContentText>
          <Alert severity="warning" sx={{ mt: 2 }}>
            建议在应用更新后重启服务以确保更新完全生效。
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(null)}>取消</Button>
          <Button 
            onClick={() => void handleApply(false)} 
            variant="outlined"
            color="primary"
          >
            仅应用（稍后重启）
          </Button>
          <Button 
            onClick={() => void handleApply(true)} 
            variant="contained"
            color="success"
            startIcon={<RestartAlt />}
          >
            应用并重启
          </Button>
        </DialogActions>
      </Dialog>

      {/* 确认对话框 - 取消更新 */}
      <Dialog open={confirmDialog === 'cancel'} onClose={() => setConfirmDialog(null)}>
        <DialogTitle>确认取消更新</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要取消待安装的更新吗？这将删除已上传的更新包。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(null)}>返回</Button>
          <Button 
            onClick={() => void handleCancel()} 
            variant="contained"
            color="error"
          >
            确认取消
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

