import { Alert, Box, Button } from '@mui/material'
import { Refresh } from '@mui/icons-material'
import { useRefreshInterval } from '@/contexts/RefreshContext'
import ErrorSnackbar from '@/components/ErrorSnackbar'
import { PageSkeleton } from '@/components/Layout/States'
import { useDashboardData } from './hooks/useDashboardData'
import ModernDashboard from './components/ModernDashboard'

export default function Dashboard() {
  const { resourceRefreshInterval, cellRefreshInterval, refreshKey } = useRefreshInterval()
  const { initialLoading, error, setError, lastUpdatedAt, failedKeys, data, actions } = useDashboardData(
    resourceRefreshInterval,
    cellRefreshInterval,
    refreshKey,
  )

  if (initialLoading) {
    return <PageSkeleton tiles={7} blocks={2} blockHeight={148} />
  }

  return (
    <Box>
      <ErrorSnackbar error={error} onClose={() => setError(null)} />

      {failedKeys.length > 0 && (
        <Alert
          severity="warning"
          sx={{ mb: 2.5 }}
          action={(
            <Button color="inherit" size="small" startIcon={<Refresh />} onClick={() => void actions.loadData()}>
              重试
            </Button>
          )}
        >
          {failedKeys.length} 项数据暂时不可用，页面保留最近一次有效值。
        </Alert>
      )}

      <ModernDashboard data={data} lastUpdatedAt={lastUpdatedAt} />
    </Box>
  )
}
