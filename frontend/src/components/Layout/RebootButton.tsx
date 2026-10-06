/*
 * 危险操作：重启设备。统一红色描边按钮 + 二次确认弹框（设计稿第六章规范）。
 * 重启、卡槽切换、清空短信、OTA 应用 等危险操作均应使用红色描边 + 确认。
 */
import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Snackbar,
  Alert,
  CircularProgress,
} from '@mui/material'
import { RestartAlt } from '@mui/icons-material'
import { api } from '../../api'

interface RebootButtonProps {
  fullWidth?: boolean
  label?: string
}

export default function RebootButton({ fullWidth = false, label = '重启设备' }: RebootButtonProps) {
  const [open, setOpen] = useState(false)
  const [rebooting, setRebooting] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setOpen(false)
    setRebooting(true)
    setError(null)
    try {
      await api.systemReboot(3)
      setSuccess('系统将在 3 秒后重启…')
    } catch (err) {
      setRebooting(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <Button
        variant="outlined"
        color="error"
        fullWidth={fullWidth}
        onClick={() => setOpen(true)}
        disabled={rebooting}
        startIcon={rebooting ? <CircularProgress size={16} /> : <RestartAlt />}
      >
        {rebooting ? '重启中…' : label}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>重启设备？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            设备将中断所有网络连接并重新注册，约 3 秒后重启。重启期间无法管理设备，确认继续？
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={() => void confirm()} color="error" variant="contained">
            确认重启
          </Button>
        </DialogActions>
      </Dialog>

      {success && (
        <Snackbar open autoHideDuration={3000} onClose={() => setSuccess(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
          <Alert severity="success" variant="filled" onClose={() => setSuccess(null)}>{success}</Alert>
        </Snackbar>
      )}
      {error && (
        <Snackbar open autoHideDuration={4000} onClose={() => setError(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
          <Alert severity="error" variant="filled" onClose={() => setError(null)}>{error}</Alert>
        </Snackbar>
      )}
    </>
  )
}
