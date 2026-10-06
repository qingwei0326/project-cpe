/*
 * @Author: 1orz cloudorzi@gmail.com
 * @Date: 2025-12-10 09:19:05
 * @LastEditors: WorkBuddy
 * @FilePath: /udx710-backend/frontend/src/pages/DeviceInfo.tsx
 * @Description: 设备信息页（设计稿第六章：身份卡 + SIM 卡，长串 tabular-nums + 点选复制，卡槽切换危险操作二次确认）
 */
import { useEffect, useState } from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Chip,
  CircularProgress,
  Button,
  Tooltip,
  Snackbar,
  Alert,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material'
import {
  PhoneAndroid,
  Tag,
  SimCard,
  Visibility,
  VisibilityOff,
  SwapHoriz,
  ContentCopy,
} from '@mui/icons-material'
import Grid from '@mui/material/Grid'
import { api } from '../api'
import ErrorSnackbar from '../components/ErrorSnackbar'
import PageHeader from '../components/Layout/PageHeader'
import { PageSkeleton } from '../components/Layout/States'
import { EASE_OUT } from '../theme'
import type { DeviceInfo, SimInfo, SimSlotResponse, ImeisvResponse } from '../api/types'

/** 部分调制解调器返回占位值（如 `Fake Modem Model` / `N/A`），显示出来没有信息量。 */
const isPlaceholder = (value?: string) => !value || /^(fake\b|n\/a$)/i.test(value.trim())

interface SystemSummary { version: string; kernel: string; uptime: string }

export default function DeviceInfoPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  // 每个功能块独立的敏感信息显示状态
  const [showDeviceId, setShowDeviceId] = useState(false)
  const [showSimInfo, setShowSimInfo] = useState(false)

  // 设备信息（包含 online, powered, manufacturer, model）
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  // SIM 信息（包含所有 SIM 相关数据）
  const [simInfo, setSimInfo] = useState<SimInfo | null>(null)

  // 扩展状态
  const [imeisv, setImeisv] = useState<ImeisvResponse | null>(null)
  const [simSlot, setSimSlot] = useState<SimSlotResponse | null>(null)
  const [system, setSystem] = useState<SystemSummary | null>(null)
  const [switchingSlot, setSwitchingSlot] = useState(false)
  const [slotConfirmOpen, setSlotConfirmOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setError(null)

    try {
      const [deviceRes, simRes] = await Promise.all([
        api.getDeviceInfo(),
        api.getSimInfo(),
      ])

      if (deviceRes.data) setDeviceInfo(deviceRes.data)
      if (simRes.data) setSimInfo(simRes.data)

      // 加载扩展数据
      try {
        const [imeisvRes, simSlotRes] = await Promise.all([
          api.getImeisv(),
          api.getSimSlot(),
        ])
        if (imeisvRes.data) setImeisv(imeisvRes.data)
        if (simSlotRes.data) setSimSlot(simSlotRes.data)
      } catch (extErr) {
        console.warn('部分扩展信息加载失败:', extErr)
      }

      try {
        const [healthRes, statsRes] = await Promise.all([api.health(), api.getSystemStats()])
        const info = statsRes.data?.system_info
        setSystem({
          version: healthRes.version,
          kernel: info ? `Linux ${info.release} · ${info.machine}` : '—',
          uptime: statsRes.data?.uptime.uptime_formatted ?? '—',
        })
      } catch (sysErr) {
        console.warn('系统信息加载失败:', sysErr)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const switchSimSlot = async () => {
    if (!simSlot) return
    const targetSlot = simSlot.active_slot === 1 ? 2 : 1
    setSwitchingSlot(true)
    try {
      const res = await api.switchSimSlot(targetSlot)
      if (res.status === 'ok') {
        setSuccess(`正在切换到卡槽 ${targetSlot}...`)
        setTimeout(loadData, 2000)
      } else {
        setError(res.message || '切换失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSwitchingSlot(false)
    }
  }

  // 敏感信息模糊样式
  const getSensitiveStyle = (show: boolean) => ({
    filter: show ? 'none' : 'blur(5px)',
    transition: `filter 0.3s ${EASE_OUT}`,
    userSelect: show ? 'auto' : 'none',
    cursor: show ? 'text' : 'default',
  })

  // 长串点选复制（非安全上下文降级到 execCommand）
  const copyText = async (text: string) => {
    if (!text) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 复制失败静默忽略，用户仍可手动选择
    }
  }

  // 等宽 + tabular-nums + 点选复制的敏感值渲染
  const renderCopyable = (value: string, show: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <Typography
        component="span"
        sx={{
          fontFamily: 'monospace',
          fontVariantNumeric: 'tabular-nums',
          fontSize: '0.9rem',
          flex: 1,
          minWidth: 0,
          overflowWrap: 'anywhere',
          ...getSensitiveStyle(show),
        }}
      >
        {value || 'N/A'}
      </Typography>
      {show && value && (
        <Tooltip title={copied ? '已复制' : '复制'}>
          <span>
            <IconButton size="small" onClick={() => void copyText(value)} sx={{ flexShrink: 0 }}>
              <ContentCopy fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Box>
  )

  useEffect(() => {
    void loadData()
  }, [])

  if (loading) {
    return <PageSkeleton tiles={4} blocks={2} blockHeight={128} />
  }

  return (
    <Box>
      <PageHeader
        eyebrow="设备与网络 / 终端"
        title="设备信息"
        description="查看设备状态、固件、SIM 标识和卡槽配置。"
        actions={<Button variant="outlined" onClick={() => void loadData()} disabled={loading}>刷新设备</Button>}
      />
      {/* 错误和成功提示 Snackbar */}
      <ErrorSnackbar error={error} onClose={() => setError(null)} />
      {success && (
        <Snackbar
          open={true}
          autoHideDuration={3000}
          onClose={() => setSuccess(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
          <Alert severity="success" variant="filled" onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        </Snackbar>
      )}
      <Grid container spacing={1.5}>
        {/* Modem 基础信息 */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardHeader
              avatar={<PhoneAndroid color="primary" />}
              title="设备状态"
              titleTypographyProps={{ variant: 'h6' }}
            />
            <CardContent>
              <TableContainer>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell component="th" width="40%">在线状态</TableCell>
                      <TableCell>
                        <Chip
                          label={deviceInfo?.online ? '在线' : '离线'}
                          color={deviceInfo?.online ? 'success' : 'error'}
                          size="small"
                        />
                      </TableCell>
                    </TableRow>
                    {([
                      ['制造商', deviceInfo?.manufacturer],
                      ['型号', deviceInfo?.model],
                      ['固件版本', deviceInfo?.revision],
                    ] as [string, string | undefined][])
                      .filter(([, value]) => !isPlaceholder(value))
                      .map(([label, value]) => (
                        <TableRow key={label}>
                          <TableCell component="th">{label}</TableCell>
                          <TableCell>{value}</TableCell>
                        </TableRow>
                      ))}
                    {system && (
                      <>
                        <TableRow>
                          <TableCell component="th">后端版本</TableCell>
                          <TableCell>{system.version}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell component="th">系统内核</TableCell>
                          <TableCell>{system.kernel}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell component="th">运行时长</TableCell>
                          <TableCell>{system.uptime}</TableCell>
                        </TableRow>
                      </>
                    )}
                    <TableRow>
                      <TableCell component="th">电源状态</TableCell>
                      <TableCell>
                        <Chip
                          label={deviceInfo?.powered ? '已开启' : '已关闭'}
                          color={deviceInfo?.powered ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* 设备标识信息 */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardHeader
              avatar={<Tag color="primary" />}
              title="设备标识"
              titleTypographyProps={{ variant: 'h6' }}
              action={
                <Tooltip title={showDeviceId ? '隐藏敏感信息' : '显示完整信息'}>
                  <IconButton
                    size="small"
                    onClick={() => setShowDeviceId(!showDeviceId)}
                    color="primary"
                  >
                    {showDeviceId ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </Tooltip>
              }
            />
            <CardContent>
              <TableContainer>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell component="th" width="40%">IMEI</TableCell>
                      <TableCell>{renderCopyable(deviceInfo?.imei ?? '', showDeviceId)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th">IMEISV (软件版本)</TableCell>
                      <TableCell>
                        {renderCopyable(imeisv?.software_version_number ?? '', true)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th">ICCID</TableCell>
                      <TableCell>{renderCopyable(simInfo?.iccid ?? '', showDeviceId)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th">IMSI</TableCell>
                      <TableCell>{renderCopyable(simInfo?.imsi ?? '', showDeviceId)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* SIM 卡完整信息 */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardHeader
              avatar={<SimCard color="primary" />}
              title="SIM 卡信息"
              titleTypographyProps={{ variant: 'h6' }}
              action={
                <Tooltip title={showSimInfo ? '隐藏敏感信息' : '显示完整信息'}>
                  <IconButton
                    size="small"
                    onClick={() => setShowSimInfo(!showSimInfo)}
                    color="primary"
                  >
                    {showSimInfo ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </Tooltip>
              }
            />
            <CardContent>
              <TableContainer>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell component="th" width="40%">SIM 卡状态</TableCell>
                      <TableCell>
                        <Chip
                          label={simInfo?.present ? '已插入' : '未插入'}
                          color={simInfo?.present ? 'success' : 'error'}
                          size="small"
                        />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th">PIN 状态</TableCell>
                      <TableCell>{simInfo?.pin_required || 'N/A'}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th">手机号码</TableCell>
                      <TableCell>{renderCopyable(simInfo?.phone_numbers?.join(', ') ?? '', showSimInfo)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th">MCC / MNC</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
                        {simInfo?.mcc || 'N/A'} / {simInfo?.mnc || 'N/A'}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th">短信中心号码</TableCell>
                      <TableCell>{renderCopyable(simInfo?.sms_center ?? '', showSimInfo)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th">首选语言</TableCell>
                      <TableCell>
                        {simInfo?.preferred_languages?.map((lang: string) => (
                          <Chip key={lang} label={lang.toUpperCase()} size="small" sx={{ mr: 0.5 }} />
                        )) || 'N/A'}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* SIM 卡槽管理 */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardHeader
              avatar={<SwapHoriz color="primary" />}
              title="SIM 卡槽"
              titleTypographyProps={{ variant: 'h6' }}
            />
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                <Box>
                  <Typography variant="body1">
                    当前卡槽: <Chip
                      label={simSlot?.active_slot ? `卡槽 ${simSlot.active_slot}` : '未知'}
                      color="primary"
                      size="small"
                    />
                  </Typography>
                  {simSlot?.raw_value && (
                    <Typography variant="caption" color="text.secondary">
                      原始值: {simSlot.raw_value}
                    </Typography>
                  )}
                </Box>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<SwapHoriz />}
                  onClick={() => setSlotConfirmOpen(true)}
                  disabled={switchingSlot || !simSlot}
                >
                  {switchingSlot ? <CircularProgress size={20} /> : `切换到卡槽 ${simSlot?.active_slot === 1 ? 2 : 1}`}
                </Button>
              </Box>
              <Alert severity="info" variant="outlined">
                切换 SIM 卡槽后，设备可能需要重新注册网络。此为危险操作，请确认后再执行。
              </Alert>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* 卡槽切换二次确认（危险操作规范：红色描边 + 确认框写明后果） */}
      <Dialog open={slotConfirmOpen} onClose={() => setSlotConfirmOpen(false)}>
        <DialogTitle>切换 SIM 卡槽？</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            即将从卡槽 {simSlot?.active_slot} 切换到卡槽 {simSlot?.active_slot === 1 ? 2 : 1}。
            切换后设备会短暂掉线并重新注册网络，正在进行的通话或数据连接会中断。确认继续？
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSlotConfirmOpen(false)}>取消</Button>
          <Button
            color="error"
            variant="contained"
            disabled={switchingSlot}
            onClick={() => {
              setSlotConfirmOpen(false)
              void switchSimSlot()
            }}
          >
            确认切换
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
