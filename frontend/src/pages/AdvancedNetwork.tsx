/*
 * 高级网络页（设计稿第六章落地）：把原 Network.tsx 中独有的射频工程能力
 * —— 频段锁定 / 小区锁定 / 基站定位 —— 抽成独立页。原巨页 Network.tsx 已删除。
 */
import { useEffect, useState, useCallback } from 'react'
import {
  Box,
  Typography,
  Alert,
  Button,
  CircularProgress,
  Chip,
  Divider,
  Stack,
  Snackbar,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Checkbox,
  FormControlLabel,
  Grid,
} from '@mui/material'
import type { Theme } from '@mui/material/styles'
import {
  ExpandMore,
  Lock,
  LockOpen,
  MyLocation,
  ContentCopy,
  Tune,
  Refresh,
  LocationOff as LocationOffIcon,
} from '@mui/icons-material'
import { api, type RadioMode, type BandLockStatus, type BandLockRequest } from '../api'
import type {
  CellsResponse,
  CellLocationResponse,
  CellLockStatusResponse,
} from '../api/types'
import PageHeader from '../components/Layout/PageHeader'
import { PageSkeleton } from '@/components/Layout/States'
import { SectionHeader, Surface } from '@/components/Layout/DesignSystem'
import { RADIUS } from '../theme'
import { formatSignalValue, getSignalChipColor } from './Dashboard/utils'

// UDX710 设备支持的频段列表
const LTE_FDD_BANDS = [1, 3, 5, 8]
const LTE_TDD_BANDS = [39, 41]
const NR_FDD_BANDS = [1, 3, 28]
const NR_TDD_BANDS = [41, 77, 78, 79]

export default function AdvancedNetworkPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // 小区信息 / 基站定位 / 小区锁定
  const [cellsInfo, setCellsInfo] = useState<CellsResponse | null>(null)
  const [cellLocation, setCellLocation] = useState<CellLocationResponse | null>(null)
  const [cellLockStatus, setCellLockStatus] = useState<CellLockStatusResponse | null>(null)

  // 频段锁定
  const [currentRadioMode, setCurrentRadioMode] = useState<RadioMode>('auto')
  const [lockMode, setLockMode] = useState<'unlocked' | 'custom'>('unlocked')
  const [lteFddBands, setLteFddBands] = useState<number[]>([])
  const [lteTddBands, setLteTddBands] = useState<number[]>([])
  const [nrFddBands, setNrFddBands] = useState<number[]>([])
  const [nrTddBands, setNrTddBands] = useState<number[]>([])
  const [bandLockStatus, setBandLockStatus] = useState<BandLockStatus | null>(null)
  const [modeLoading, setModeLoading] = useState(false)
  const [bandLoading, setBandLoading] = useState(false)
  const [bandConfigRefreshing, setBandConfigRefreshing] = useState(false)

  // 加载小区信息 + 基站定位 + 小区锁定状态
  const loadCellsAndLock = useCallback(async () => {
    const [cellsRes, locRes, lockRes] = await Promise.all([
      api.getCellsInfo(false),
      api.getCellLocationInfo(false),
      api.getCellLockStatus(),
    ])
    if (cellsRes.data) setCellsInfo(cellsRes.data)
    if (locRes.data) setCellLocation(locRes.data)
    if (lockRes.data) setCellLockStatus(lockRes.data)
  }, [])

  // 加载频段锁定配置（射频模式 + 锁定状态）
  const loadBandLockConfig = useCallback(async () => {
    setBandConfigRefreshing(true)
    try {
      const [radioModeRes, bandLockRes] = await Promise.all([
        api.getRadioMode(),
        api.getBandLockStatus(),
      ])
      if (radioModeRes.data) {
        const mode = radioModeRes.data.mode
        if (mode === 'auto' || mode === 'lte' || mode === 'nr') {
          setCurrentRadioMode(mode as RadioMode)
        }
      }
      if (bandLockRes.data) {
        setBandLockStatus(bandLockRes.data)
        const isLocked = bandLockRes.data.locked
        const hasAnyBands =
          bandLockRes.data.lte_fdd_bands.length > 0 ||
          bandLockRes.data.lte_tdd_bands.length > 0 ||
          bandLockRes.data.nr_fdd_bands.length > 0 ||
          bandLockRes.data.nr_tdd_bands.length > 0
        if (!isLocked || !hasAnyBands) {
          setLockMode('unlocked')
          setLteFddBands([])
          setLteTddBands([])
          setNrFddBands([])
          setNrTddBands([])
        } else {
          setLockMode('custom')
          setLteFddBands(bandLockRes.data.lte_fdd_bands)
          setLteTddBands(bandLockRes.data.lte_tdd_bands)
          setNrFddBands(bandLockRes.data.nr_fdd_bands)
          setNrTddBands(bandLockRes.data.nr_tdd_bands)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBandConfigRefreshing(false)
    }
  }, [])

  const loadAll = useCallback(async () => {
    setError(null)
    try {
      await Promise.all([loadCellsAndLock(), loadBandLockConfig()])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [loadCellsAndLock, loadBandLockConfig])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const handleRefreshBandConfig = () => {
    void loadBandLockConfig()
  }

  // ===== 小区锁定 =====
  const getAllLocationCells = () => {
    if (!cellLocation?.available) return []
    const cells: typeof cellLocation.neighbor_cells = []
    if (cellLocation.cell_info) {
      cells.push(cellLocation.cell_info)
    }
    cells.push(...cellLocation.neighbor_cells)
    return cells
  }

  const handleCopyCellLocation = () => {
    const cells = getAllLocationCells()
    if (!cells.length) return
    const cell = cells[0]
    const text = JSON.stringify(cell, null, 2)
    void navigator.clipboard.writeText(text)
    setSuccess('已复制基站定位参数到剪贴板')
  }

  // ===== 频段锁定 =====
  const handleRadioModeChange = async (mode: RadioMode) => {
    setModeLoading(true)
    setError(null)
    try {
      const response = await api.setRadioMode(mode)
      setSuccess(response.message || '射频模式已切换')
      setCurrentRadioMode(mode)
      setTimeout(() => void loadBandLockConfig(), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setModeLoading(false)
    }
  }

  const handleApplyBandLock = async () => {
    setBandLoading(true)
    setError(null)
    const request: BandLockRequest = lockMode === 'unlocked'
      ? { lte_fdd_bands: [], lte_tdd_bands: [], nr_fdd_bands: [], nr_tdd_bands: [] }
      : { lte_fdd_bands: lteFddBands, lte_tdd_bands: lteTddBands, nr_fdd_bands: nrFddBands, nr_tdd_bands: nrTddBands }
    try {
      const response = await api.setBandLock(request)
      setSuccess(response.message || '频段锁定配置已应用')
      setTimeout(() => void loadBandLockConfig(), 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBandLoading(false)
    }
  }

  const handleUnlockAllBands = async () => {
    setBandLoading(true)
    setError(null)
    const request: BandLockRequest = { lte_fdd_bands: [], lte_tdd_bands: [], nr_fdd_bands: [], nr_tdd_bands: [] }
    try {
      const response = await api.setBandLock(request)
      setSuccess(response.message || '频段限制已取消，所有频段可用')
      setLteFddBands([])
      setLteTddBands([])
      setNrFddBands([])
      setNrTddBands([])
      setTimeout(() => void loadBandLockConfig(), 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBandLoading(false)
    }
  }

  const toggleBand = (band: number, setter: React.Dispatch<React.SetStateAction<number[]>>) => {
    setter((prev) => (prev.includes(band) ? prev.filter((b) => b !== band) : [...prev, band]))
  }

  if (loading) {
    return <PageSkeleton tiles={3} blocks={3} blockHeight={140} />
  }

  return (
    <Box>
      <PageHeader
        eyebrow="设备与网络 / 射频运维"
        title="高级网络"
        description="频段锁定、小区锁定与基站定位参数——面向射频调试与定点测试的高级能力。"
        actions={<Button variant="outlined" onClick={() => void loadAll()} disabled={loading}>刷新</Button>}
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

      {/* 频段锁定 */}
      <Surface sx={{ mb: 1.5 }}>
        <SectionHeader
          title="频段锁定"
          description="限制设备只使用指定频段（调试用）"
          action={
            <Button size="small" variant="text" startIcon={bandConfigRefreshing ? <CircularProgress size={14} /> : <Refresh />} onClick={handleRefreshBandConfig} disabled={bandConfigRefreshing}>
              刷新
            </Button>
          }
        />

        {/* 当前锁定状态摘要 */}
        {bandLockStatus?.locked ? (
          <Alert severity="warning" sx={{ mb: 1.5, borderRadius: RADIUS.md }} icon={<Tune fontSize="small" />}>
            已锁定频段：
            {[...bandLockStatus.lte_fdd_bands.map((b) => `B${b}`), ...bandLockStatus.lte_tdd_bands.map((b) => `B${b}`), ...bandLockStatus.nr_fdd_bands.map((b) => `n${b}`), ...bandLockStatus.nr_tdd_bands.map((b) => `n${b}`)].join('、') || '无'}
          </Alert>
        ) : (
          <Alert severity="success" sx={{ mb: 1.5, borderRadius: RADIUS.md }}>
            当前未锁定，设备将使用所有支持的频段。
          </Alert>
        )}

        {/* 射频模式切换 */}
        <Box mb={2}>
          <Typography variant="caption" color="text.secondary" gutterBottom display="block">射频模式</Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {(['auto', 'lte', 'nr'] as RadioMode[]).map((mode) => (
              <Chip
                key={mode}
                label={mode.toUpperCase()}
                size="small"
                color={currentRadioMode === mode ? 'primary' : 'default'}
                onClick={() => void handleRadioModeChange(mode)}
                disabled={modeLoading}
              />
            ))}
            {modeLoading && <CircularProgress size={16} />}
          </Stack>
        </Box>

        <Divider sx={{ my: 1.5 }} />

        {/* 锁定模式选择 */}
        <Box mb={2}>
          <Typography variant="caption" color="text.secondary" gutterBottom display="block">锁定模式</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              label="未锁定（使用所有频段）"
              size="small"
              color={lockMode === 'unlocked' ? 'success' : 'default'}
              onClick={() => setLockMode('unlocked')}
              disabled={bandLoading}
              icon={lockMode === 'unlocked' ? <LockOpen /> : undefined}
            />
            <Chip
              label="自定义锁定（选择允许的频段）"
              size="small"
              color={lockMode === 'custom' ? 'warning' : 'default'}
              onClick={() => setLockMode('custom')}
              disabled={bandLoading}
              icon={lockMode === 'custom' ? <Lock /> : undefined}
            />
          </Stack>
        </Box>

        <Divider sx={{ my: 1.5 }} />

        {/* 频段选择区域 */}
        {lockMode === 'custom' && (
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Typography variant="caption" color="text.secondary" gutterBottom display="block">LTE FDD (允许)</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
                {LTE_FDD_BANDS.map((band) => (
                  <FormControlLabel
                    key={`lte-fdd-${band}`}
                    control={<Checkbox checked={lteFddBands.includes(band)} onChange={() => toggleBand(band, setLteFddBands)} size="small" sx={{ p: 0.25 }} />}
                    label={<Typography variant="caption">B{band}</Typography>}
                    sx={{ mr: 0.5, ml: 0 }}
                  />
                ))}
              </Box>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Typography variant="caption" color="text.secondary" gutterBottom display="block">LTE TDD (允许)</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
                {LTE_TDD_BANDS.map((band) => (
                  <FormControlLabel
                    key={`lte-tdd-${band}`}
                    control={<Checkbox checked={lteTddBands.includes(band)} onChange={() => toggleBand(band, setLteTddBands)} size="small" sx={{ p: 0.25 }} />}
                    label={<Typography variant="caption">B{band}</Typography>}
                    sx={{ mr: 0.5, ml: 0 }}
                  />
                ))}
              </Box>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Typography variant="caption" color="text.secondary" gutterBottom display="block">NR FDD (允许)</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
                {NR_FDD_BANDS.map((band) => (
                  <FormControlLabel
                    key={`nr-fdd-${band}`}
                    control={<Checkbox checked={nrFddBands.includes(band)} onChange={() => toggleBand(band, setNrFddBands)} size="small" sx={{ p: 0.25 }} />}
                    label={<Typography variant="caption">n{band}</Typography>}
                    sx={{ mr: 0.5, ml: 0 }}
                  />
                ))}
              </Box>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Typography variant="caption" color="text.secondary" gutterBottom display="block">NR TDD (允许)</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
                {NR_TDD_BANDS.map((band) => (
                  <FormControlLabel
                    key={`nr-tdd-${band}`}
                    control={<Checkbox checked={nrTddBands.includes(band)} onChange={() => toggleBand(band, setNrTddBands)} size="small" sx={{ p: 0.25 }} />}
                    label={<Typography variant="caption">n{band}</Typography>}
                    sx={{ mr: 0.5, ml: 0 }}
                  />
                ))}
              </Box>
            </Grid>
          </Grid>
        )}

        {lockMode === 'custom' && (
          <Alert severity="info" sx={{ mt: 1.5, mb: 1.5, borderRadius: RADIUS.md }}>
            <Typography variant="caption" display="block">💡 勾选的频段表示允许使用；4G 频段用于 4G 连接及 5G 弱信号回退，5G 频段用于 5G 连接。</Typography>
          </Alert>
        )}

        <Box sx={{ mt: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            color="primary"
            size="small"
            onClick={() => void handleApplyBandLock()}
            disabled={bandLoading}
            startIcon={bandLoading ? <CircularProgress size={14} /> : <Lock />}
          >
            应用
          </Button>
          <Button
            variant="outlined"
            color="success"
            size="small"
            onClick={() => void handleUnlockAllBands()}
            disabled={bandLoading}
            startIcon={<LockOpen />}
          >
            取消限制
          </Button>
        </Box>
      </Surface>

      {/* 小区锁定 */}
      <Surface sx={{ mb: 1.5 }}>
        <SectionHeader
          title="小区锁定"
          description="只读展示当前小区与锁定状态（锁定/解锁写操作已移除）"
        />

        {cellLockStatus?.any_locked && (
          <Alert
            severity="warning"
            sx={{ mb: 1.5, borderRadius: RADIUS.md }}
            icon={<Lock fontSize="small" />}
          >
            {cellLockStatus?.rat_status?.filter((s) => s.enabled).map((status, idx) => (
              <Typography key={idx} variant="caption" display="block">
                {status.rat_name}: ARFCN={status.arfcn}, PCI={status.pci}
              </Typography>
            ))}
          </Alert>
        )}

        {cellsInfo?.serving_cell && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5, p: 1, bgcolor: 'action.hover', borderRadius: RADIUS.sm }}>
            <Chip label={cellsInfo.serving_cell.tech?.toUpperCase() || '-'} size="small" color="primary" />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              CID: <strong>{cellsInfo.serving_cell.cell_id}</strong>
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              TAC: <strong>{cellsInfo.serving_cell.tac}</strong>
            </Typography>
          </Box>
        )}

        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: { xs: 350, sm: 400 }, borderRadius: RADIUS.md }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ py: 0.5, px: 1, fontSize: '0.7rem', minWidth: 55 }}>频段</TableCell>
                <TableCell align="right" sx={{ py: 0.5, px: 0.5, fontSize: '0.7rem', minWidth: 55 }}>ARFCN</TableCell>
                <TableCell align="right" sx={{ py: 0.5, px: 0.5, fontSize: '0.7rem', minWidth: 40 }}>PCI</TableCell>
                <TableCell align="right" sx={{ py: 0.5, px: 0.5, fontSize: '0.7rem', minWidth: 50 }}>RSRP</TableCell>
                <TableCell align="right" sx={{ py: 0.5, px: 0.5, fontSize: '0.7rem', minWidth: 45, display: { xs: 'none', sm: 'table-cell' } }}>RSRQ</TableCell>
                <TableCell align="right" sx={{ py: 0.5, px: 0.5, fontSize: '0.7rem', minWidth: 45, display: { xs: 'none', sm: 'table-cell' } }}>SINR</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {cellsInfo?.cells && cellsInfo.cells.length > 0 ? (
                cellsInfo.cells.map((cell, idx) => {
                  const cellArfcn = Number(cell.arfcn || cell.earfcn || cell.nrarfcn || 0)
                  const cellPci = Number(cell.pci || 0)
                  const cellTech = cell.tech || (cell.type === 'NR' ? 'nr' : 'lte')
                  const isLocked = cellLockStatus?.rat_status?.some(
                    (s) => s.enabled &&
                      s.arfcn === cellArfcn &&
                      s.pci === cellPci &&
                      ((cellTech.toLowerCase() === 'nr' && s.rat === 16) ||
                        (cellTech.toLowerCase() !== 'nr' && s.rat === 12)),
                  )
                  return (
                    <TableRow
                      key={idx}
                      sx={{
                        bgcolor: isLocked
                          ? (theme: Theme) => theme.palette.mode === 'dark' ? 'rgba(237, 108, 2, 0.15)' : 'warning.light'
                          : cell.is_serving
                            ? (theme: Theme) => theme.palette.mode === 'dark' ? 'rgba(102, 187, 106, 0.15)' : 'rgba(102, 187, 106, 0.08)'
                            : 'inherit',
                      }}
                    >
                      <TableCell sx={{ py: 0.5, px: 1 }}>
                        <Box display="flex" alignItems="center" gap={0.5}>
                          {isLocked ? (
                            <Lock sx={{ width: 10, height: 10, color: 'warning.main' }} />
                          ) : cell.is_serving ? (
                            <Box sx={{ width: 6, height: 6, borderRadius: RADIUS.full, bgcolor: 'success.main', flexShrink: 0 }} />
                          ) : null}
                          <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: cell.is_serving ? 600 : 400 }}>
                            {cell.band && cell.band !== '0' ? cell.band : '-'}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ py: 0.5, px: 0.5, fontSize: '0.75rem', fontFamily: 'monospace' }}>
                        {cell.arfcn || cell.earfcn || cell.nrarfcn || '-'}
                      </TableCell>
                      <TableCell align="right" sx={{ py: 0.5, px: 0.5, fontSize: '0.75rem', fontFamily: 'monospace' }}>
                        {cell.pci || '-'}
                      </TableCell>
                      <TableCell align="right" sx={{ py: 0.5, px: 0.5 }}>
                        {cell.rsrp !== undefined ? (
                          <Chip label={formatSignalValue(cell.rsrp)} size="small" color={getSignalChipColor(cell.rsrp)} sx={{ height: 18, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.5 } }} />
                        ) : cell.ssb_rsrp !== undefined ? (
                          <Chip label={formatSignalValue(cell.ssb_rsrp)} size="small" color={getSignalChipColor(cell.ssb_rsrp)} sx={{ height: 18, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.5 } }} />
                        ) : '-'}
                      </TableCell>
                      <TableCell align="right" sx={{ py: 0.5, px: 0.5, fontSize: '0.7rem', fontFamily: 'monospace', display: { xs: 'none', sm: 'table-cell' } }}>
                        {cell.rsrq !== undefined ? formatSignalValue(cell.rsrq) : cell.ssb_rsrq !== undefined ? formatSignalValue(cell.ssb_rsrq) : '-'}
                      </TableCell>
                      <TableCell align="right" sx={{ py: 0.5, px: 0.5, fontSize: '0.7rem', fontFamily: 'monospace', display: { xs: 'none', sm: 'table-cell' } }}>
                        {cell.sinr !== undefined ? formatSignalValue(cell.sinr) : cell.ssb_sinr !== undefined ? formatSignalValue(cell.ssb_sinr) : '-'}
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 2 }}>
                    <Typography variant="caption" color="text.secondary">暂无小区数据</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Surface>

      {/* 基站定位参数 */}
      <Surface>
        <SectionHeader title="基站定位参数" description="用于第三方基站定位 API（高德、百度、Google）" />
        <Accordion disableGutters elevation={0} square sx={{ bgcolor: 'transparent', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMore />} sx={{ px: 0 }}>
            <Box display="flex" alignItems="center" gap={1}>
              <MyLocation color="primary" fontSize="small" />
              <Typography fontWeight={700}>基站定位参数</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0 }}>
            {(() => {
              const cells = getAllLocationCells()
              return cells.length > 0 ? (
                <>
                  <Alert severity="info" sx={{ mb: 2, borderRadius: RADIUS.md }} icon={false}>
                    以下参数可用于第三方基站定位 API（高德、百度、Google）
                  </Alert>
                  <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: RADIUS.md }}>
                    <Table size="small" sx={{ minWidth: 420 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ py: 0.5, fontSize: '0.75rem' }}>MCC</TableCell>
                          <TableCell sx={{ py: 0.5, fontSize: '0.75rem' }}>MNC</TableCell>
                          <TableCell sx={{ py: 0.5, fontSize: '0.75rem' }}>LAC/TAC</TableCell>
                          <TableCell sx={{ py: 0.5, fontSize: '0.75rem' }}>CID</TableCell>
                          <TableCell sx={{ py: 0.5, fontSize: '0.75rem' }}>信号</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {cells.map((cell, idx) => (
                          <TableRow key={idx}>
                            <TableCell sx={{ py: 0.5, fontSize: '0.75rem' }}>{cell.mcc}</TableCell>
                            <TableCell sx={{ py: 0.5, fontSize: '0.75rem' }}>{cell.mnc}</TableCell>
                            <TableCell sx={{ py: 0.5, fontSize: '0.75rem' }}>{cell.lac}</TableCell>
                            <TableCell sx={{ py: 0.5, fontSize: '0.75rem', fontFamily: 'monospace' }}>{cell.cid}</TableCell>
                            <TableCell sx={{ py: 0.5, fontSize: '0.75rem' }}>{cell.signal_strength} dBm</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Button variant="outlined" size="small" startIcon={<ContentCopy />} onClick={handleCopyCellLocation} sx={{ mt: 1 }}>
                    复制 JSON
                  </Button>
                </>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 2 }}>
                  <LocationOffIcon color="disabled" />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    暂无基站定位数据，需要至少 2 个邻区才能解算位置，请稍后重试。
                  </Typography>
                </Box>
              )
            })()}
          </AccordionDetails>
        </Accordion>
      </Surface>
    </Box>
  )
}
