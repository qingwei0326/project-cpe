/*
 * 通知自动化页（设计稿第六章）：启用开关 + URL 输入(空时不许开启) + 短信/来电模板编辑
 * (模板变量可点击插入) + 测试发送。从 Configuration.tsx 抽出独立成页。
 */
import { useEffect, useState, type ChangeEvent } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Typography,
  Alert,
  Button,
  CircularProgress,
  Switch,
  FormControlLabel,
  TextField,
  IconButton,
  Chip,
  Stack,
  Snackbar,
  Tooltip,
} from '@mui/material'
import {
  PlayArrow,
  Add,
  ExpandMore,
  RestartAlt,
} from '@mui/icons-material'
import { api } from '../api'
import PageHeader from '../components/Layout/PageHeader'
import { PageSkeleton } from '@/components/Layout/States'
import { SectionHeader, Surface } from '@/components/Layout/DesignSystem'
import { RADIUS } from '../theme'
import type { WebhookConfig } from '../api/types'
import { DEFAULT_SMS_TEMPLATE, DEFAULT_CALL_TEMPLATE } from '../api/types'

const SMS_VARS = ['phone_number', 'content', 'timestamp', 'direction', 'status']
const CALL_VARS = ['phone_number', 'duration', 'start_time', 'end_time', 'answered', 'direction']

export default function NotificationsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [webhookConfig, setWebhookConfig] = useState<WebhookConfig>({
    enabled: false,
    url: '',
    forward_sms: true,
    forward_calls: true,
    headers: {},
    secret: '',
    sms_template: DEFAULT_SMS_TEMPLATE,
    call_template: DEFAULT_CALL_TEMPLATE,
  })
  const [webhookLoading, setWebhookLoading] = useState(false)
  const [webhookTesting, setWebhookTesting] = useState(false)
  const [newHeaderKey, setNewHeaderKey] = useState('')
  const [newHeaderValue, setNewHeaderValue] = useState('')
  const [focusedTemplate, setFocusedTemplate] = useState<'sms' | 'call' | null>(null)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getWebhookConfig()
      if (res.data) {
        // 后端可能缺省 headers/secret/template 字段，统一补齐，避免 Object.keys(undefined) 崩溃
        setWebhookConfig({
          enabled: res.data.enabled ?? false,
          url: res.data.url ?? '',
          forward_sms: res.data.forward_sms ?? true,
          forward_calls: res.data.forward_calls ?? true,
          headers: res.data.headers ?? {},
          secret: res.data.secret ?? '',
          sms_template: res.data.sms_template ?? DEFAULT_SMS_TEMPLATE,
          call_template: res.data.call_template ?? DEFAULT_CALL_TEMPLATE,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  // 启用开关与 URL 校验联动：URL 为空时不许开启
  const handleEnabledChange = (checked: boolean) => {
    if (checked && !webhookConfig.url.trim()) {
      setError('请先填写 Webhook URL，再启用转发')
      return
    }
    setWebhookConfig({ ...webhookConfig, enabled: checked })
  }

  // 模板变量点击插入到当前聚焦的模板（默认短信模板）
  const insertVariable = (variable: string) => {
    const token = `{{${variable}}}`
    const target = focusedTemplate ?? 'sms'
    if (target === 'sms') {
      setWebhookConfig({ ...webhookConfig, sms_template: `${webhookConfig.sms_template ?? ''}${token}` })
    } else {
      setWebhookConfig({ ...webhookConfig, call_template: `${webhookConfig.call_template ?? ''}${token}` })
    }
  }

  const handleSave = async () => {
    setWebhookLoading(true)
    setError(null)
    try {
      const res = await api.setWebhookConfig(webhookConfig)
      if (res.status === 'ok') setSuccess('Webhook 配置已保存')
      else setError(res.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWebhookLoading(false)
    }
  }

  const handleTest = async () => {
    setWebhookTesting(true)
    setError(null)
    try {
      const res = await api.testWebhook()
      if (res.status === 'ok' && res.data) {
        if (res.data.success) setSuccess(res.data.message)
        else setError(res.data.message)
      } else {
        setError(res.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWebhookTesting(false)
    }
  }

  const handleAddHeader = () => {
    if (newHeaderKey.trim() && newHeaderValue.trim()) {
      setWebhookConfig({
        ...webhookConfig,
        headers: { ...(webhookConfig.headers ?? {}), [newHeaderKey.trim()]: newHeaderValue.trim() },
      })
      setNewHeaderKey('')
      setNewHeaderValue('')
    }
  }

  const handleRemoveHeader = (key: string) => {
    const next = { ...(webhookConfig.headers ?? {}) }
    delete next[key]
    setWebhookConfig({ ...webhookConfig, headers: next })
  }

  if (loading) {
    return <PageSkeleton tiles={3} blocks={2} blockHeight={140} />
  }

  return (
    <Box>
      <PageHeader
        eyebrow="系统 / 自动化"
        title="通知自动化"
        description="启用来电与短信的 Webhook 转发，并自定义推送模板。"
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

      {/* 启用与 URL */}
      <Surface sx={{ mb: 1.5 }}>
        <SectionHeader title="转发开关" description="启用来电与短信自动转发到 Webhook" />
        <FormControlLabel
          control={
            <Switch
              checked={webhookConfig.enabled}
              onChange={(e: ChangeEvent<HTMLInputElement>) => handleEnabledChange(e.target.checked)}
              color="success"
            />
          }
          label={(
            <Box>
              <Typography variant="body1" fontWeight={600}>
                {webhookConfig.enabled ? '转发已启用' : '转发已禁用'}
              </Typography>
              <Typography variant="caption" color="text.secondary">启用后来电和短信将自动转发</Typography>
            </Box>
          )}
        />
        <TextField
          fullWidth
          label="Webhook URL"
          value={webhookConfig.url}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setWebhookConfig({ ...webhookConfig, url: e.target.value })}
          placeholder="https://example.com/webhook"
          sx={{ mt: 1.5 }}
          disabled={!webhookConfig.enabled}
        />
        <Stack direction="row" spacing={2} mt={1.5}>
          <FormControlLabel
            control={<Switch checked={webhookConfig.forward_sms} onChange={(e) => setWebhookConfig({ ...webhookConfig, forward_sms: e.target.checked })} disabled={!webhookConfig.enabled} />}
            label="转发短信"
          />
          <FormControlLabel
            control={<Switch checked={webhookConfig.forward_calls} onChange={(e) => setWebhookConfig({ ...webhookConfig, forward_calls: e.target.checked })} disabled={!webhookConfig.enabled} />}
            label="转发来电"
          />
        </Stack>
        <TextField
          fullWidth
          label="签名密钥 (可选)"
          type="password"
          value={webhookConfig.secret}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setWebhookConfig({ ...webhookConfig, secret: e.target.value })}
          placeholder="用于验证 Webhook 请求的密钥"
          sx={{ mt: 1.5 }}
          disabled={!webhookConfig.enabled}
          helperText="设置后将在请求头添加 X-Webhook-Signature"
        />
      </Surface>

      {/* 高级设置：自定义请求头 + 消息模板（默认折叠，日常只需要开关和 URL） */}
      <Accordion disableGutters sx={{ mb: 1.5 }}>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography fontWeight={700}>高级设置</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5, alignSelf: 'center' }}>自定义请求头 · 消息模板</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 1 }}>
      {/* 自定义请求头 */}
      <Surface sx={{ mb: 1.5 }}>
        <SectionHeader title="自定义请求头" description="随转发请求一起发送" />
        <Stack direction="row" spacing={1} mb={1}>
          <TextField
            size="small"
            label="Header Key"
            value={newHeaderKey}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewHeaderKey(e.target.value)}
            disabled={!webhookConfig.enabled}
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            label="Header Value"
            value={newHeaderValue}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewHeaderValue(e.target.value)}
            disabled={!webhookConfig.enabled}
            sx={{ flex: 1 }}
          />
          <Tooltip title="添加请求头">
            <span>
              <IconButton color="primary" onClick={handleAddHeader} disabled={!webhookConfig.enabled || !newHeaderKey.trim() || !newHeaderValue.trim()}>
                <Add />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        {Object.keys(webhookConfig.headers ?? {}).length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {Object.entries(webhookConfig.headers ?? {}).map(([key, value]) => (
              <Chip
                key={key}
                label={`${key}: ${value}`}
                onDelete={() => handleRemoveHeader(key)}
                size="small"
                disabled={!webhookConfig.enabled}
              />
            ))}
          </Stack>
        )}
      </Surface>

      {/* Payload 模板 */}
      <Surface sx={{ mb: 1.5 }}>
        <SectionHeader title="Payload 模板" description="点击变量标签即可插入到对应模板" />
        <Alert severity="info" sx={{ mb: 1.5, borderRadius: RADIUS.md }}>
          <Typography variant="body2">
            <strong>可点击插入的模板变量：</strong><br />
            短信: {SMS_VARS.map((v) => `{{${v}}}`).join('、')}<br />
            通话: {CALL_VARS.map((v) => `{{${v}}}`).join('、')}
          </Typography>
        </Alert>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
          {[...new Set([...SMS_VARS, ...CALL_VARS])].map((v) => (
            <Chip
              key={v}
              label={`{{${v}}}`}
              size="small"
              color="primary"
              variant="outlined"
              onClick={() => insertVariable(v)}
              disabled={!webhookConfig.enabled}
              sx={{ cursor: 'pointer', fontFamily: 'monospace' }}
            />
          ))}
        </Stack>

        <Typography variant="subtitle2" gutterBottom>短信通知模板</Typography>
        <TextField
          fullWidth
          multiline
          rows={6}
          value={webhookConfig.sms_template}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setWebhookConfig({ ...webhookConfig, sms_template: e.target.value })}
          onFocus={() => setFocusedTemplate('sms')}
          sx={{ mb: 1.5, fontFamily: 'monospace' }}
          disabled={!webhookConfig.enabled}
          placeholder={DEFAULT_SMS_TEMPLATE}
          InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
        />

        <Typography variant="subtitle2" gutterBottom>通话通知模板</Typography>
        <TextField
          fullWidth
          multiline
          rows={6}
          value={webhookConfig.call_template}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setWebhookConfig({ ...webhookConfig, call_template: e.target.value })}
          onFocus={() => setFocusedTemplate('call')}
          sx={{ mb: 1.5 }}
          disabled={!webhookConfig.enabled}
          placeholder={DEFAULT_CALL_TEMPLATE}
          InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
        />

        <Button
          size="small"
          variant="outlined"
          startIcon={<RestartAlt />}
          onClick={() => setWebhookConfig({ ...webhookConfig, sms_template: DEFAULT_SMS_TEMPLATE, call_template: DEFAULT_CALL_TEMPLATE })}
          disabled={!webhookConfig.enabled}
        >
          重置为默认模板
        </Button>
      </Surface>
        </AccordionDetails>
      </Accordion>

      {/* 操作 */}
      <Surface>
        <Stack direction="row" spacing={1.5}>
          <Button
            variant="contained"
            fullWidth
            onClick={() => void handleSave()}
            disabled={webhookLoading}
            startIcon={webhookLoading ? <CircularProgress size={20} /> : undefined}
          >
            {webhookLoading ? '保存中…' : '保存配置'}
          </Button>
          <Button
            variant="outlined"
            fullWidth
            onClick={() => void handleTest()}
            disabled={webhookTesting || !webhookConfig.enabled || !webhookConfig.url}
            startIcon={webhookTesting ? <CircularProgress size={20} /> : <PlayArrow />}
          >
            {webhookTesting ? '测试中…' : '测试发送'}
          </Button>
        </Stack>
        <Alert severity="success" sx={{ mt: 1.5, borderRadius: RADIUS.md }}>
          点击「测试」会用短信模板发送一条模拟消息到 Webhook URL，用于验证配置是否正确。
        </Alert>
      </Surface>
    </Box>
  )
}
