import { LocalApiError } from './errors.ts'

export const LAN_SYNC_ERROR_CODES = [
  'AUTH_EXPIRED',
  'SERVICE_DISABLED',
  'CONNECTION_REFUSED',
  'TIMEOUT',
  'INVALID_CONFIGURATION',
  'DATA_REJECTED',
  'PULL_FAILED',
  'PUSH_FAILED',
] as const

export type LanSyncErrorCode = typeof LAN_SYNC_ERROR_CODES[number]

export class LanSyncError extends Error {
  readonly code: LanSyncErrorCode
  readonly retryable: boolean
  readonly pauseAuto: boolean

  constructor(code: LanSyncErrorCode, message: string, options: { retryable?: boolean, pauseAuto?: boolean } = {}) {
    super(message)
    this.name = 'LanSyncError'
    this.code = code
    this.retryable = options.retryable ?? !['AUTH_EXPIRED', 'INVALID_CONFIGURATION'].includes(code)
    this.pauseAuto = options.pauseAuto ?? code === 'AUTH_EXPIRED'
  }
}

function statusOf(cause: unknown): number {
  return cause instanceof LocalApiError ? Number(cause.status || 0) : Number((cause as any)?.status || 0)
}

function nativeCodeOf(cause: unknown): string {
  return String((cause as any)?.code || '')
}

export function classifyLanSyncError(cause: unknown): LanSyncError {
  if (cause instanceof LanSyncError) return cause
  const status = statusOf(cause)
  const nativeCode = nativeCodeOf(cause)
  const message = cause instanceof Error ? cause.message : String(cause || '局域网同步失败')
  const lower = message.toLocaleLowerCase()

  if (nativeCode === 'LAN_TLS_IDENTITY_ERROR' || /安全同步|安全绑定/.test(message)) {
    return new LanSyncError('INVALID_CONFIGURATION', '安全连接或主机身份验证失败，已停止同步；请核对电脑并重新扫码', { retryable: false, pauseAuto: true })
  }

  if (status === 401 || status === 403 || /首次绑定|绑定已失效|口令|unauthori[sz]ed|forbidden/.test(message)) {
    return new LanSyncError('AUTH_EXPIRED', '设备绑定已失效，请输入电脑端当前口令重新绑定', { retryable: false })
  }
  if (nativeCode === 'LAN_REQUEST_INVALID' || /地址格式|同步地址|配置/.test(message)) {
    return new LanSyncError('INVALID_CONFIGURATION', '局域网同步地址或配置无效，请检查电脑端地址', { retryable: false })
  }
  if (status === 422) {
    return new LanSyncError('DATA_REJECTED', '学习记录未被接收，请检查两端题库归属与内容是否一致。本机记录已保留，处理后请手动同步', { retryable: false, pauseAuto: true })
  }
  if (nativeCode === 'LAN_TIMEOUT' || status === 408 || status === 504 || /timeout|超时|timed out/.test(lower)) {
    return new LanSyncError('TIMEOUT', '电脑端同步请求超时，稍后会自动重试')
  }
  if (nativeCode === 'LAN_NETWORK_ERROR' || /连接|network|socket|unreachable|refused|offline|离线/.test(lower)) {
    return new LanSyncError('CONNECTION_REFUSED', '暂时无法连接电脑端，恢复同一局域网后会自动重试')
  }
  if (status === 404 || status === 503 || /未开启|未在监听|service unavailable|not found/.test(lower)) {
    return new LanSyncError('SERVICE_DISABLED', '电脑端局域网同步服务未开启，开启后会自动重试')
  }
  if (/拉取|pull/.test(message)) {
    return new LanSyncError('PULL_FAILED', '从电脑端读取学习记录失败，稍后会自动重试')
  }
  if (/推送|push/.test(message)) {
    return new LanSyncError('PUSH_FAILED', '向电脑端写入学习记录失败，稍后会自动重试')
  }
  return new LanSyncError('CONNECTION_REFUSED', '局域网同步暂时失败，稍后会自动重试')
}
