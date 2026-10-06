export type OtaStage =
  | 'prepared'
  | 'applying'
  | 'health_check'
  | 'healthy'
  | 'completed'
  | 'rolling_back'
  | 'rolled_back'

const OTA_STAGE_LABELS: Record<OtaStage, string> = {
  prepared: '准备中',
  applying: '应用中',
  health_check: '健康检查',
  healthy: '已恢复',
  completed: '已完成',
  rolling_back: '回滚中',
  rolled_back: '已回滚',
}

export function getOtaStageLabel(stage?: string | null): string {
  if (!stage) return '无记录'
  return OTA_STAGE_LABELS[stage as OtaStage] || stage
}

export function getOtaStageColor(
  stage?: string | null,
): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' {
  switch (stage) {
    case 'prepared':
      return 'info'
    case 'applying':
    case 'health_check':
      return 'warning'
    case 'healthy':
    case 'completed':
      return 'success'
    case 'rolling_back':
    case 'rolled_back':
      return 'error'
    default:
      return 'default'
  }
}
