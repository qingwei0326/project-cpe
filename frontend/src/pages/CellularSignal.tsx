import { useState } from 'react'
import {
  Box,
  Chip,
  Typography,
  useTheme,
  type Theme,
} from '@mui/material'
import { SignalCellularAlt } from '@mui/icons-material'
import { usePolling } from '../hooks/usePolling'
import { useRefreshInterval } from '@/contexts/RefreshContext'
import { api } from '../api'
import type { CellsResponse, NetworkInfo } from '../api/types'
import PageHeader from '../components/Layout/PageHeader'
import { PageSkeleton } from '@/components/Layout/States'
import { SectionHeader, Surface } from '@/components/Layout/DesignSystem'
import { RADIUS } from '../theme'
import { localizeOperator } from '../utils/carriers'

/** 后端信号字段是「原始值 ×100」的字符串，展示层统一 ÷100 还原为 dB/dBm。 */
const toDb = (value?: string | number | null): number | null => {
  if (value === undefined || value === null || value === '') return null
  const n = typeof value === 'string' ? parseFloat(value) : value
  return Number.isFinite(n) ? n / 100 : null
}

const rsrpColor = (v: number | null, t: Theme) => {
  if (v === null) return t.palette.text.secondary
  if (v >= -80) return t.palette.success.main
  if (v >= -100) return t.palette.info.main
  if (v >= -110) return t.palette.warning.main
  return t.palette.error.main
}
const sinrColor = (v: number | null, t: Theme) => {
  if (v === null) return t.palette.text.secondary
  if (v >= 20) return t.palette.success.main
  if (v >= 10) return t.palette.info.main
  if (v >= 0) return t.palette.warning.main
  return t.palette.error.main
}

function Metric({ label, value, unit, color, hint }: {
  label: string
  value: string
  unit: string
  color: string
  hint?: string
}) {
  return (
    <Box minWidth={0}>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="h6" sx={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums', color, lineHeight: 1.2 }}>
        {value}<Box component="span" sx={{ fontSize: '0.7rem', color: 'text.tertiary', ml: 0.25 }}>{unit}</Box>
      </Typography>
      {hint && <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.25 }}>{hint}</Typography>}
    </Box>
  )
}

export default function CellularSignal() {
  const theme = useTheme()
  const { resourceRefreshInterval, refreshKey } = useRefreshInterval()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cells, setCells] = useState<CellsResponse | null>(null)
  const [network, setNetwork] = useState<NetworkInfo | null>(null)

  usePolling(async () => {
    try {
      const [c, n] = await Promise.all([
        api.getCellsInfo(),
        api.getNetworkInfo(),
      ])
      if (c.data) setCells(c.data)
      if (n.data) setNetwork(n.data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, resourceRefreshInterval === 0 ? 0 : Math.max(resourceRefreshInterval, 5000), refreshKey)

  if (loading) return <PageSkeleton tiles={4} blocks={2} blockHeight={148} />

  const serving = cells?.cells.find(item => item.is_serving) ?? cells?.cells[0] ?? null
  const rsrp = toDb(serving?.rsrp)
  const rsrq = toDb(serving?.rsrq)
  const sinr = toDb(serving?.sinr)
  const neighbors = (cells?.cells ?? []).filter(item => !item.is_serving)
  const operator = localizeOperator(network?.operator_name, network?.mcc, network?.mnc)
  const ca = cells?.ca ?? null

  return (
    <Box>
      <PageHeader
        eyebrow="设备与网络 / 连接质量"
        title="蜂窝信号"
        description={`服务小区实时信号与邻区测量${operator.matched ? ` · ${operator.display}` : ''}。`}
        actions={operator.matched && operator.rawName !== operator.display
          ? <Chip size="small" variant="outlined" label={operator.rawName} />
          : undefined}
      />

      {error && (
        <Box sx={{ color: 'error.main', fontSize: 13, mb: 2 }}>{error}</Box>
      )}

      {serving && (
        <Surface sx={{ mb: 1.5, p: { xs: 1.25, md: 1.5 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
            <SignalCellularAlt fontSize="small" color="primary" />
            <Typography fontWeight={800}>服务小区</Typography>
            <Chip size="small" label={`PCI ${serving.pci ?? '—'}`} color="primary" variant="filled" />
            <Chip size="small" label={network?.technology_preference || serving.tech?.toUpperCase() || '未知'} />
            <Chip size="small" label={serving.band ? `${serving.band}` : '—'} />
          </Box>
          <Typography variant="caption" color="text.tertiary" display="block" sx={{ mb: 1.5 }}>
            ARFCN {String(serving.arfcn ?? serving.earfcn ?? '—')} · TAC {cells?.serving_cell.tac ?? '—'}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
            <Metric label="RSRP" value={rsrp !== null ? rsrp.toFixed(2) : '—'} unit=" dBm" color={rsrpColor(rsrp, theme)} />
            <Metric
              label="RSRQ"
              value={rsrq !== null ? rsrq.toFixed(2) : '—'}
              unit=" dB"
              color={theme.palette.warning.main}
              hint={rsrq !== null && (rsrq < -20 || rsrq > -3) ? '固件值超出常规，待确认缩放' : undefined}
            />
            <Metric label="SINR" value={sinr !== null ? sinr.toFixed(2) : '—'} unit=" dB" color={sinrColor(sinr, theme)} />
          </Box>
        </Surface>
      )}

      {ca && (
        <Surface sx={{ mb: 1.5, p: { xs: 1.25, md: 1.5 } }}>
          <SectionHeader title="载波聚合 (CA)" description="多载波并发可提升峰值速率" />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Chip
              size="small"
              color={ca.active ? 'success' : 'default'}
              label={ca.active ? `已激活 ${ca.scc_count} 个辅载波` : '未激活（单载波）'}
            />
            {ca.bands.length > 0 && (
              <Typography variant="caption" color="text.secondary">{ca.bands.join(' / ')}</Typography>
            )}
          </Box>
        </Surface>
      )}

      <Surface sx={{ p: { xs: 1.25, md: 1.5 } }}>
        <SectionHeader
          title="邻区"
          description={neighbors.length ? `检测到 ${neighbors.length} 个同频/异频邻区` : '当前无邻区测量'}
        />
        {neighbors.length === 0 ? (
          <Typography variant="body2" color="text.secondary">暂无邻区数据。</Typography>
        ) : (
          <Box sx={{ display: 'grid', gap: 1 }}>
            {neighbors.map((cell, idx) => {
              const nRsrp = toDb(cell.rsrp)
              const nSinr = toDb(cell.sinr)
              const betterThanServing = nSinr !== null && sinr !== null && nSinr > sinr
              return (
                <Box
                  key={`${cell.pci}-${idx}`}
                  sx={{
                    p: 1.25,
                    borderRadius: RADIUS.md,
                    border: '0.5px solid',
                    borderColor: betterThanServing ? 'warning.main' : 'divider',
                    bgcolor: betterThanServing ? 'rgba(251,191,36,0.06)' : 'background.default',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      PCI {cell.pci}
                      {cell.band ? <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary', ml: 1, fontSize: 12 }}>{cell.band}</Box> : null}
                    </Typography>
                    {betterThanServing && <Chip size="small" color="warning" label="比服务小区更好" />}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                    <Typography variant="caption" color="text.secondary">
                      RSRP <Box component="span" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{nRsrp !== null ? nRsrp.toFixed(2) : '—'}</Box>
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      RSRQ <Box component="span" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{cell.rsrq !== undefined ? (toDb(cell.rsrq)?.toFixed(2) ?? '—') : '—'}</Box>
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      SINR <Box component="span" sx={{ color: nSinr !== null && nSinr < 0 ? 'error.main' : 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{nSinr !== null ? nSinr.toFixed(2) : '—'}</Box>
                    </Typography>
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
