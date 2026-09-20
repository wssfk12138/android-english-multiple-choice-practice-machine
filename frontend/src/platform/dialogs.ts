// 自有确认/输入弹层的全局状态。所有需要确认或轻量输入的操作
// 都通过 confirmDialog / promptDialog 走同一主题化弹层，
// 不再使用系统 confirm/prompt（样式失控且无法自定义按钮语义）。
import { reactive } from 'vue'

export type AppDialogOptions = {
  title: string
  /** 支持多段文字：对象、影响、恢复期限逐条说明。 */
  message: string | string[]
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** 可选的单行输入（重命名等场景）。 */
  input?: { label?: string; value?: string; placeholder?: string; required?: boolean }
}

type ActiveDialog = AppDialogOptions & {
  busy: boolean
  inputValue: string
  error: string
}

type DialogState = {
  current: ActiveDialog | null
}

export const dialogState = reactive<DialogState>({ current: null })

type PendingResolve = {
  resolve: (value: boolean | string | null) => void
  options: AppDialogOptions
}

let pending: PendingResolve | null = null

function finish(result: boolean | string | null) {
  const current = pending
  pending = null
  dialogState.current = null
  current?.resolve(result)
}

export function confirmDialog(options: AppDialogOptions): Promise<boolean> {
  if (pending) return Promise.resolve(false)
  return new Promise(resolve => {
    pending = { resolve: (value) => resolve(value === true), options }
    dialogState.current = {
      ...options,
      busy: false,
      inputValue: options.input?.value ?? '',
      error: '',
    }
  })
}

export function promptDialog(options: AppDialogOptions): Promise<string | null> {
  if (pending) return Promise.resolve(null)
  return new Promise(resolve => {
    pending = { resolve: (value) => resolve(typeof value === 'string' ? value : null), options }
    dialogState.current = {
      ...options,
      busy: false,
      inputValue: options.input?.value ?? '',
      error: '',
    }
  })
}

function settle(value: boolean | string | null) {
  const dialog = dialogState.current
  if (!dialog || dialog.busy) return
  if (dialog.input && value !== null && value !== false) {
    const text = dialog.inputValue.trim()
    if (!text && dialog.input.required) {
      dialog.error = '请输入内容后再继续'
      return
    }
    finish(text)
    return
  }
  finish(value)
}

export const dialogActions = {
  confirm: () => settle(true),
  cancel: () => settle(false),
  setInput(value: string) {
    if (dialogState.current) {
      dialogState.current.inputValue = value
      dialogState.current.error = ''
    }
  },
  /** 异步确认操作期间置忙，按钮禁用且返回键/取消不重复提交。 */
  async withBusy<T>(action: () => Promise<T>): Promise<T | undefined> {
    const dialog = dialogState.current
    if (!dialog || dialog.busy) return undefined
    dialog.busy = true
    try {
      return await action()
    } finally {
      // 操作完成后弹层一般已被调用方关闭；若仍打开则恢复可用。
      if (dialogState.current === dialog) dialog.busy = false
    }
  },
}
