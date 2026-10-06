import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'
import {
  CheckCircle,
  Flight,
  Public,
  Refresh,
  Search,
  SignalWifi4Bar,
  SimCard,
  WifiTethering,
} from '@mui/icons-material'
import { usePolling } from '../hooks/usePolling'
import { useRefreshInterval } from '@/contexts/RefreshContext'
import { api } from '../api'
import type {
  AirplaneModeResponse,
  ApnContext,
  DataConnectionStatus,
  NetworkInfo,
  OperatorInfo,
  RoamingResponse,
} from '../api/types'
import PageHeader from '../components/Layout/PageHeader'
import { PageSkeleton } from '@/components/Layout/States'
import { SectionHeader, Surface } from '@/components/Layout/DesignSystem'
import { RADIUS } from '../theme'
import { localizeOperator } from '../utils/carriers'

type Feedback = { kind: 'success' | 'error'; message: string } | null

interface SwitchRowProps {
  icon: React.ReactNode
  title: string
  caption: string
  checked: boolean
  disabled?: boolean
  busy?: boolean
  onChange: () => void
}

function SwitchRow({ icon, title, caption, checked, disabled, busy, onChange }: SwitchRowProps) {
  const theme = useTheme()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 0.5, py: 1 }}>
      <Box sx={{
        width: 38, height: 38, flexShrink: 0, display: 'grid', placeItems: 'center',
        borderRadius: RADIUS.md, bgcolor: theme.palette.primary.main + '14', color: 'primary.main',
      }}>
        {icon}
      </Box>
      <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
        <Typography fontWeight={700} noWrap>{title}</Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.3 }}>
          {caption}
        </Typography>
      </Box>
      {busy
        ? <CircularProgress size={20} sx={{ color: 'text.secondary' }} />
        : <Switch checked={checked} disabled={disabled} onChange={onChange} edge="end" />}
    </Box>
  )
}

const PROTOCOLS = ['ip', 'ipv6', 'dual']
const AUTH_METHODS = ['none', 'pap', 'chap']

export default function DataNetwork() {
  const theme = useTheme()
  const { resourceRefreshInterval, refreshKey } = useRefreshInterval()
  const [loading, setLoading] = useState(true)

  const [dataStatus, setDataStatus] = useState<DataConnectionStatus | null>(null)
  const [roaming, setRoaming] = useState<RoamingResponse | null>(null)
  const [airplane, setAirplane] = useState<AirplaneModeResponse | null>(null)
  const [apnContexts, setApnContexts] = useState<ApnContext[]>([])
  const [operators, setOperators] = useState<OperatorInfo[]>([])
  const [network, setNetwork] = useState<NetworkInfo | null>(null)

  const [switchBusy, setSwitchBusy] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [registering, setRegistering] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const [selectedContext, setSelectedContext] = useState<string | null>(null)
  const [apnForm, setApnForm] = useState({ apn: '', protocol: 'ip', username: '', password: '', auth_method: 'none' })
  const [apnSaving, setApnSaving] = useState(false)

  const fetchAll = async () => {
    try {
      const [d, r, a, apn, ops, n] = await Promise.all([
        api.getDataStatus(),
        api.getRoamingStatus(),
        api.getAirplaneMode(),
        api.getApnList(),
        api.getOperators(),
        api.getNetworkInfo(),
      ])
      if (d.data) setDataStatus(d.data)
      if (r.data) setRoaming(r.data)
      if (a.data) setAirplane(a.data)
      if (apn.data) setApnContexts(apn.data.contexts)
      if (ops.data) setOperators(ops.data.operators)
      if (n.data) setNetwork(n.data)
      setFeedback(null)
    } catch (e) {
      setFeedback({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoading(false)
    }
  }

  usePolling(fetchAll, resourceRefreshInterval === 0 ? 0 : Math.max(resourceRefreshInterval, 5000), refreshKey)

  const dataOn = dataStatus?.active ?? false
  const roamingOn = roaming?.roaming_allowed ?? false
  const airplaneOn = airplane?.enabled ?? false
  // 飞行模式或数据关闭时，漫游无从生效，禁用开关避免误导。
  const roamingDisabled = airplaneOn || !dataOn
  const operator = localizeOperator(network?.operator_name, network?.mcc, network?.mnc)
  const currentOperator = operators.find(op => op.status === 'current')

  const toggleData = async () => {
    const next = !dataOn
    setSwitchBusy('data')
    try {
      const res = await api.setDataStatus(next)
      if (res.data) setDataStatus(res.data)
      setFeedback({ kind: 'success', message: `移动数据已${next ? '启用' : '断开'}` })
    } catch (e) {
      setFeedback({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSwitchBusy(null)
    }
  }

  const toggleRoaming = async () => {
    const next = !roamingOn
    setSwitchBusy('roaming')
    try {
      const res = await api.setRoamingAllowed(next)
      if (res.data) setRoaming(res.data)
      setFeedback({ kind: 'success', message: `数据漫游已${next ? '允许' : '关闭'}` })
    } catch (e) {
      setFeedback({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSwitchBusy(null)
    }
  }

  const toggleAirplane = async () => {
    const next = !airplaneOn
    setSwitchBusy('airplane')
    try {
      const res = await api.setAirplaneMode(next)
      if (res.data) setAirplane(res.data)
      setFeedback({ kind: 'success', message: `飞行模式已${next ? '开启' : '关闭'}` })
    } catch (e) {
      setFeedback({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSwitchBusy(null)
    }
  }

  const handleScan = async () => {
    setScanning(true)
    setFeedback({ kind: 'success', message: '正在扫描可用运营商，约需 2 分钟…' })
    try {
      const res = await api.scanOperators()
      if (res.data) setOperators(res.data.operators)
      setFeedback({ kind: 'success', message: `扫描完成，找到 ${res.data?.operators.length ?? 0} 个运营商` })
    } catch (e) {
      setFeedback({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setScanning(false)
    }
  }

  const handleRegisterAuto = async () => {
    setRegistering('auto')
    try {
      await api.registerOperatorAuto()
      setFeedback({ kind: 'success', message: '已请求自动注册，正在重连…' })
      await fetchAll()
    } catch (e) {
      setFeedback({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setRegistering(null)
    }
  }

  const handleRegisterManual = async (op: OperatorInfo) => {
    const mccmnc = `${op.mcc}${op.mnc}`
    setRegistering(mccmnc)
    try {
      await api.registerOperatorManual(mccmnc)
      setFeedback({ kind: 'success', message: `正在注册到 ${localizeOperator(op.name, op.mcc, op.mnc).display}…` })
      await fetchAll()
    } catch (e) {
      setFeedback({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setRegistering(null)
    }
  }

  const selectContext = (ctx: ApnContext) => {
    setSelectedContext(ctx.path)
    setApnForm({
      apn: ctx.apn,
      protocol: ctx.protocol || 'ip',
      username: ctx.username || '',
      password: ctx.password || '',
      auth_method: ctx.auth_method || 'none',
    })
  }

  const saveApn = async () => {
    if (!selectedContext) {
      setFeedback({ kind: 'error', message: '请选择一个 APN 配置槽位' })
      return
    }
    setApnSaving(true)
    try {
      await api.setApn({ context_path: selectedContext, ...apnForm })
      setFeedback({ kind: 'success', message: 'APN 配置已保存' })
      await fetchAll()
    } catch (e) {
      setFeedback({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setApnSaving(false)
    }
  }

  if (loading) return <PageSkeleton tiles={3} blocks={2} blockHeight={148} />

  return (
    <Box>
      <PageHeader
        eyebrow="设备与网络 / 数据连接"
        title="数据网络"
        description={
          operator.matched
            ? `当前运营商 ${operator.display}${roaming?.is_roaming ? ' · 漫游中' : ''}`
            : '管理移动数据、漫游、飞行模式与 APN 接入点。'
        }
        actions={operator.matched && operator.rawName !== operator.display
          ? <Chip size="small" variant="outlined" label={operator.rawName} />
          : undefined}
      />

      {feedback && (
        <Box sx={{ mb: 1.5 }}>
          <Alert severity={feedback.kind} onClose={() => setFeedback(null)} sx={{ borderRadius: RADIUS.md }}>
            {feedback.message}
          </Alert>
        </Box>
      )}

      {/* 开关组：数据 / 漫游 / 飞行 */}
      <Surface sx={{ mb: 1.5 }}>
        <SectionHeader title="连接开关" description="移动数据、漫游与飞行模式" />
        <Stack divider={<Divider flexItem />}>
          <SwitchRow
            icon={<SignalWifi4Bar fontSize="small" />}
            title="移动数据"
            caption={dataOn ? '已连接，可访问互联网' : '已断开移动数据连接'}
            checked={dataOn}
            busy={switchBusy === 'data'}
            onChange={() => { void toggleData() }}
          />
          <SwitchRow
            icon={<WifiTethering fontSize="small" />}
            title="数据漫游"
            caption={roamingDisabled ? '需先开启移动数据且关闭飞行模式' : (roamingOn ? '允许使用其他运营商网络' : '仅在归属网络使用数据')}
            checked={roamingOn}
            disabled={roamingDisabled}
            busy={switchBusy === 'roaming'}
            onChange={() => { void toggleRoaming() }}
          />
          <SwitchRow
            icon={<Flight fontSize="small" />}
            title="飞行模式"
            caption={airplaneOn ? '射频已关闭，无法连接移动网络' : '关闭射频以断开所有无线连接'}
            checked={airplaneOn}
            busy={switchBusy === 'airplane'}
            onChange={() => { void toggleAirplane() }}
          />
        </Stack>
      </Surface>

      {/* APN 配置 */}
      <Surface sx={{ mb: 1.5 }}>
        <SectionHeader title="APN 配置" description="移动数据连接的接入点名称（选择槽位后可编辑）" />
        {apnContexts.length === 0 ? (
          <Typography variant="body2" color="text.secondary">未找到可用的 APN 配置。</Typography>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1 }}>
            {apnContexts.map(ctx => {
              const active = selectedContext === ctx.path
              return (
                <Box
                  key={ctx.path}
                  onClick={() => selectContext(ctx)}
                  sx={{
                    p: 1.25, borderRadius: RADIUS.md, cursor: 'pointer',
                    border: '1px solid', borderColor: active ? 'primary.main' : 'divider',
                    bgcolor: active ? theme.palette.primary.main + '0A' : 'background.default',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Typography fontWeight={700} noWrap sx={{ minWidth: 0 }}>
                      <SimCard fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5, color: 'text.secondary' }} />
                      {ctx.name}
                    </Typography>
                    {ctx.active && <Chip size="small" color="success" label="已激活" />}
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25, fontVariantNumeric: 'tabular-nums' }}>
                    APN {ctx.apn || '—'} · {ctx.protocol?.toUpperCase() || 'IP'} · {ctx.context_type}
                  </Typography>
                </Box>
              )
            })}
          </Box>
        )}

        {selectedContext && (
          <Box sx={{ mt: 1.5, p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: RADIUS.md }}>
            <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>编辑 · {apnContexts.find(c => c.path === selectedContext)?.name}</Typography>
            <Stack spacing={1.25}>
              <TextField
                label="APN 名称" size="small" value={apnForm.apn}
                onChange={e => setApnForm({ ...apnForm, apn: e.target.value })}
                helperText="运营商提供的接入点名称"
              />
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
                <TextField select label="协议" size="small" value={apnForm.protocol}
                  onChange={e => setApnForm({ ...apnForm, protocol: e.target.value })}>
                  {PROTOCOLS.map(p => <MenuItem key={p} value={p}>{p.toUpperCase()}</MenuItem>)}
                </TextField>
                <TextField select label="认证方式" size="small" value={apnForm.auth_method}
                  onChange={e => setApnForm({ ...apnForm, auth_method: e.target.value })}>
                  {AUTH_METHODS.map(p => <MenuItem key={p} value={p}>{p.toUpperCase()}</MenuItem>)}
                </TextField>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
                <TextField label="用户名" size="small" value={apnForm.username}
                  onChange={e => setApnForm({ ...apnForm, username: e.target.value })} />
                <TextField label="密码" size="small" type="password" value={apnForm.password}
                  onChange={e => setApnForm({ ...apnForm, password: e.target.value })} />
              </Box>
              <Box>
                <Button variant="contained" onClick={() => { void saveApn() }} disabled={apnSaving}>
                  {apnSaving ? '保存中…' : '保存 APN 配置'}
                </Button>
              </Box>
            </Stack>
          </Box>
        )}
      </Surface>

      {/* 运营商注册 */}
      <Surface>
        <SectionHeader
          title="运营商注册"
          description="当前网络与可用运营商列表"
          action={
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button size="small" variant="outlined" startIcon={<Refresh />} onClick={() => { void handleRegisterAuto() }} disabled={registering === 'auto'}>
                {registering === 'auto' ? '注册中…' : '自动注册'}
              </Button>
              <Button size="small" variant="contained" startIcon={<Search />} onClick={() => { void handleScan() }} disabled={scanning}>
                {scanning ? '扫描中…' : '扫描运营商'}
              </Button>
            </Stack>
          }
        />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.25 }}>
          <Public fontSize="small" color="primary" />
          <Typography fontWeight={700}>当前</Typography>
          <Chip size="small" color="primary" variant="filled" label={operator.display} />
          {(currentOperator || operator.rawName) && operator.rawName !== operator.display && (
            <Typography variant="caption" color="text.secondary">固件原始：{operator.rawName}</Typography>
          )}
          {roaming?.is_roaming && <Chip size="small" color="warning" label="漫游中" />}
        </Box>

        {operators.length === 0 ? (
          <Typography variant="body2" color="text.secondary">暂无运营商数据，点击「扫描运营商」刷新列表。</Typography>
        ) : (
          <Box sx={{ display: 'grid', gap: 1 }}>
            {operators.map(op => {
              const localized = localizeOperator(op.name, op.mcc, op.mnc)
              const isCurrent = op.status === 'current'
              const isForbidden = op.status === 'forbidden'
              return (
                <Box
                  key={op.path}
                  sx={{
                    p: 1.25, borderRadius: RADIUS.md, border: '1px solid',
                    borderColor: isCurrent ? 'primary.main' : 'divider',
                    bgcolor: isCurrent ? theme.palette.primary.main + '0A' : 'background.default',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontWeight={700} noWrap>
                        {localized.display}
                        {localized.rawName !== localized.display && (
                          <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary', ml: 1, fontSize: 12 }}>
                            {localized.rawName}
                          </Box>
                        )}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {op.mcc}-{op.mnc} · {op.technologies.join(' / ') || '未知制式'}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      {isCurrent
                        ? <Chip size="small" color="success" icon={<CheckCircle />} label="已注册" />
                        : <Chip size="small" color={isForbidden ? 'error' : 'default'} label={isForbidden ? '禁用' : '可用'} />}
                      {!isCurrent && (
                        <Button
                          size="small" variant="outlined"
                          disabled={registering === `${op.mcc}${op.mnc}` || isForbidden}
                          onClick={() => { void handleRegisterManual(op) }}
                        >
                          {registering === `${op.mcc}${op.mnc}` ? '注册中…' : '注册'}
                        </Button>
                      )}
                    </Stack>
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}
      </Surface>
    </Box>
  )
}
