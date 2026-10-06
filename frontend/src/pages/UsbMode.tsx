/*
 * USB 模式页（设计稿第六章）：当前模式大卡 + 模式选择 + configfs 诊断快照(默认折叠)
 * + needs_reboot 时顶部常驻琥珀提示条并带重启按钮。从 Configuration.tsx 抽出独立成页。
 */
import { useEffect, useState, type ChangeEvent } from 'react'
import {
  Box,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  Button,
  CircularProgress,
  Radio,
  RadioGroup,
  FormControl,
  FormControlLabel,
  FormLabel,
  Chip,
  Divider,
  Stack,
  Snackbar,
  Grid,
} from '@mui/material'
import {
  ExpandMore,
  BugReport,
  RestartAlt,
  Save,
} from '@mui/icons-material'
import { api } from '../api'
import PageHeader from '../components/Layout/PageHeader'
import { PageSkeleton } from '@/components/Layout/States'
import { SectionHeader, Surface } from '@/components/Layout/DesignSystem'
import RebootButton from '../components/Layout/RebootButton'
import { RADIUS } from '../theme'
import type { UsbModeResponse, UsbDiagnosticsResponse } from '../api/types'

const getModeNameByValue = (mode: number) => {
  switch (mode) {
    case 1: return 'CDC-NCM'
    case 2: return 'CDC-ECM'
    case 3: return 'RNDIS'
    default: return 'Unknown'
  }
}

export default function UsbModePage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [usbMode, setUsbMode] = useState<UsbModeResponse | null>(null)
  const [selectedUsbMode, setSelectedUsbMode] = useState<number>(1)
  const [usbModePermanent, setUsbModePermanent] = useState<boolean>(false)
  const [usbDiagnostics, setUsbDiagnostics] = useState<UsbDiagnosticsResponse | null>(null)
  const [applying, setApplying] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [usbRes, usbDiagRes] = await Promise.all([
        api.getUsbMode(),
        api.getUsbDiagnostics().catch(() => null),
      ])
      if (usbRes.data) {
        setUsbMode(usbRes.data)
        setSelectedUsbMode(usbRes.data.current_mode || 1)
        setUsbModePermanent(usbRes.data.permanent_mode !== null && usbRes.data.permanent_mode !== undefined)
      }
      if (usbDiagRes?.data) setUsbDiagnostics(usbDiagRes.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const handleApply = async () => {
    setApplying(true)
    setError(null)
    setSuccess(null)
    try {
      await api.setUsbMode(selectedUsbMode, usbModePermanent)
      setSuccess(`USB 模式已设置为 ${getModeNameByValue(selectedUsbMode)}（${usbModePermanent ? '永久' : '临时'}），请重启设备后生效`)
      setTimeout(() => { void loadData() }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  const getDiagnosticValue = (name: string) => {
    const entry = usbDiagnostics?.entries.find((item) => item.name === name)
    if (!entry) return 'N/A'
    if (entry.value) return entry.value
    return entry.exists ? entry.error || 'N/A' : '不存在'
  }
  const activeFunctionLinks = usbDiagnostics?.functions.filter((item) => item.exists) ?? []

  if (loading) {
    return <PageSkeleton tiles={3} blocks={2} blockHeight={140} />
  }

  return (
    <Box>
      <PageHeader
        eyebrow="系统 / USB"
        title="USB 模式"
        description="选择 USB 网络模式并查看 configfs 诊断。模式变更需重启后生效。"
        actions={<Button variant="outlined" onClick={() => void loadData()} disabled={loading}>刷新</Button>}
      />

      {error && (
        <Snackbar open autoHideDuration={4000} onClose={() => setError(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }} sx={{ mb: 1.5 }}>
          <Alert severity="error" variant="filled" onClose={() => setError(null)}>{error}</Alert>
        </Snackbar>
      )}
      {success && (
        <Snackbar open autoHideDuration={3000} onClose={() => setSuccess(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }} sx={{ mb: 1.5 }}>
          <Alert severity="success" variant="filled" onClose={() => setSuccess(null)}>{success}</Alert>
        </Snackbar>
      )}

      {/* needs_reboot 常驻琥珀提示条 + 重启按钮（设计稿第六章） */}
      {usbMode?.needs_reboot && (
        <Alert
          severity="warning"
          icon={<RestartAlt />}
          sx={{ mb: 1.5, borderRadius: RADIUS.md, alignItems: 'center' }}
        >
          <Box display="flex" justifyContent="space-between" alignItems="center" gap={2} flexWrap="wrap" width="100%">
            <Box>
              <Typography fontWeight={700}>配置将在重启后生效</Typography>
              <Typography variant="body2">USB 模式已修改，重启设备后新配置才会应用。</Typography>
            </Box>
            <RebootButton label="立即重启" />
          </Box>
        </Alert>
      )}

      {/* 当前模式大卡 */}
      <Surface sx={{ mb: 1.5 }}>
        <SectionHeader title="当前 USB 模式" description="设备实际运行的网络模式" />
        <Box display="flex" alignItems="center" gap={2}>
          <Chip
            label={usbMode?.current_mode_name || 'N/A'}
            color="primary"
            sx={{ fontSize: '1.1rem', height: 40, px: 2 }}
          />
          <Box>
            <Typography variant="body2" color="text.secondary">
              模式代码: {usbMode?.current_mode ?? 'N/A'}
            </Typography>
            {usbMode?.temporary_mode !== null && usbMode?.temporary_mode !== undefined && (
              <Typography variant="caption" color="warning.main">
                待重启后切换到: {getModeNameByValue(usbMode.temporary_mode)}
              </Typography>
            )}
          </Box>
        </Box>
      </Surface>

      {/* 模式选择 */}
      <Surface sx={{ mb: 1.5 }}>
        <SectionHeader title="模式选择" description="不同模式在操作系统上的兼容性和性能各有差异" />
        <FormControl component="fieldset" fullWidth>
          <FormLabel component="legend" sx={{ mb: 0.5 }}>USB 网络模式</FormLabel>
          <RadioGroup
            value={selectedUsbMode}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSelectedUsbMode(Number(e.target.value))}
          >
            <FormControlLabel
              value={1}
              control={<Radio />}
              label={(
                <Box>
                  <Typography variant="body1">CDC-NCM（推荐）</Typography>
                  <Typography variant="caption" color="text.secondary">网络控制模型，性能最好，支持 Linux / macOS</Typography>
                </Box>
              )}
            />
            <FormControlLabel
              value={2}
              control={<Radio />}
              label={(
                <Box>
                  <Typography variant="body1">CDC-ECM</Typography>
                  <Typography variant="caption" color="text.secondary">以太网控制模型，兼容性好，适用于旧系统</Typography>
                </Box>
              )}
            />
            <FormControlLabel
              value={3}
              control={<Radio />}
              label={(
                <Box>
                  <Typography variant="body1">RNDIS</Typography>
                  <Typography variant="caption" color="text.secondary">远程网络驱动接口，Windows 专用模式</Typography>
                </Box>
              )}
            />
          </RadioGroup>
        </FormControl>

        <Divider sx={{ my: 2 }} />

        <FormControl component="fieldset" fullWidth sx={{ mb: 2 }}>
          <FormLabel component="legend" sx={{ mb: 0.5 }}>配置模式</FormLabel>
          <RadioGroup
            value={usbModePermanent ? 'permanent' : 'temporary'}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setUsbModePermanent(e.target.value === 'permanent')}
          >
            <FormControlLabel
              value="temporary"
              control={<Radio />}
              label={(
                <Box>
                  <Typography variant="body1">临时模式（推荐）</Typography>
                  <Typography variant="caption" color="text.secondary">系统启动时生效一次，然后自动删除配置</Typography>
                </Box>
              )}
            />
            <FormControlLabel
              value="permanent"
              control={<Radio />}
              label={(
                <Box>
                  <Typography variant="body1">永久模式</Typography>
                  <Typography variant="caption" color="text.secondary">每次系统启动都使用此配置</Typography>
                </Box>
              )}
            />
          </RadioGroup>
        </FormControl>

        <Button
          variant="contained"
          fullWidth
          startIcon={applying ? <CircularProgress size={20} /> : <Save />}
          onClick={() => void handleApply()}
          disabled={applying || selectedUsbMode === usbMode?.current_mode}
        >
          {applying ? '保存中…' : '保存配置'}
        </Button>
        <Alert severity="info" sx={{ mt: 1.5, borderRadius: RADIUS.md }}>
          USB 模式配置需要重启设备后才能生效。当前硬件运行模式：{usbMode?.current_mode_name || 'N/A'}
        </Alert>
      </Surface>

      {/* configfs 诊断快照（默认折叠） */}
      {usbDiagnostics && (
        <Surface>
          <Accordion disableGutters elevation={0} square sx={{ bgcolor: 'transparent', '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMore />} sx={{ px: 0 }}>
              <Box display="flex" alignItems="center" gap={1}>
                <BugReport color="primary" fontSize="small" />
                <Typography fontWeight={700}>configfs 诊断快照</Typography>
                <Chip
                  size="small"
                  label={usbDiagnostics.gadget_exists ? 'gadget 已挂载' : 'gadget 缺失'}
                  color={usbDiagnostics.gadget_exists ? 'success' : 'error'}
                  variant="outlined"
                />
                <Chip size="small" label={`UDC: ${usbDiagnostics.udc_name}`} variant="outlined" />
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 0 }}>
              <Grid container spacing={1.5}>
                {[
                  ['VID', getDiagnosticValue('idVendor')],
                  ['PID', getDiagnosticValue('idProduct')],
                  ['UDC', getDiagnosticValue('UDC')],
                  ['配置', getDiagnosticValue('configuration')],
                  ['IPA 协议', getDiagnosticValue('pamu3_protocol')],
                  ['SFP', getDiagnosticValue('sfp_enable')],
                  ['usb0', getDiagnosticValue('usb0_operstate')],
                  ['usb0 MAC', getDiagnosticValue('usb0_address')],
                ].map(([label, value]) => (
                  <Grid key={label} size={{ xs: 12, sm: 6, md: 3 }}>
                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{value}</Typography>
                  </Grid>
                ))}
              </Grid>
              <Divider sx={{ my: 1.5 }} />
              <Typography variant="caption" color="text.secondary" display="block" gutterBottom>Function 链接</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {activeFunctionLinks.length > 0 ? (
                  activeFunctionLinks.map((link) => (
                    <Chip
                      key={link.name}
                      size="small"
                      label={`${link.name} → ${link.target?.split('/').pop() || 'unknown'}`}
                      variant="outlined"
                    />
                  ))
                ) : (
                  <Chip size="small" label="无 active function 链接" variant="outlined" />
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>
        </Surface>
      )}
    </Box>
  )
}
