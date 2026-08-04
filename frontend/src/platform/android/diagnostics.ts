import { App } from '@capacitor/app'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

export type DiagnosticCategory =
  | 'question_bank_import'
  | 'remote_question_bank'
  | 'app_update'
  | 'startup'

export interface DiagnosticLogEntry {
  id: string
  createdAt: string
  category: DiagnosticCategory
  stage: string
  errorCode: string
  message: string
  technicalMessage: string
  appVersion: string
  appVersionCode: string
  platform: string
  androidVersion: string
  deviceModel: string
  fileName?: string
  fileExtension?: string
  fileSize?: number
  schemaVersion?: string
  stack?: string
}

type DiagnosticContext = {
  fileName?: string
  fileSize?: number
  schemaVersion?: string
}

interface DiagnosticNativePlugin {
  getDeviceInfo(): Promise<{ androidVersion?: string, deviceModel?: string }>
  shareText(options: { text: string, fileName: string, title: string }): Promise<{ launched: boolean }>
}

const DiagnosticNative = registerPlugin<DiagnosticNativePlugin>('DiagnosticLog')
const STORAGE_KEY = 'diagnostic_logs_v1'
const MAX_ENTRIES = 50
const MAX_MESSAGE_LENGTH = 1000
const MAX_TECHNICAL_LENGTH = 2000
const MAX_STACK_LENGTH = 6000

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

function basename(value: string): string {
  const segments = value.replaceAll('\\', '/').split('/')
  return segments.at(-1) || ''
}

function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return raw
  }
}

export function sanitizeDiagnosticValue(value: unknown, limit = MAX_TECHNICAL_LENGTH): string {
  let text = typeof value === 'string'
    ? value
    : value instanceof Error
      ? value.message
      : String(value ?? '')

  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[API Key 已隐藏]')
    .replace(/((?:api[-_ ]?key|authorization|access[-_ ]?token|secret)\s*[:=]\s*)[^\s,;}\]]+/gi, '$1[已隐藏]')
    .replace(/([?&](?:key|api_key|apikey|token|access_token|secret)=)[^&#\s]+/gi, '$1[已隐藏]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, match => sanitizeUrl(match))
    .replace(/[A-Za-z]:\\(?:[^\\\r\n]+\\)+([^\\\r\n]+)/g, '[本机路径]/$1')
    .replace(/\/(?:storage|data|sdcard|mnt)\/[^\s"'<>]+/gi, match => `[设备路径]/${basename(match)}`)
    .replace(/\s+/g, ' ')
    .trim()

  return truncate(text, limit)
}

function safeFileName(value?: string): string | undefined {
  if (!value) return undefined
  return truncate(sanitizeDiagnosticValue(basename(value), 180), 180)
}

function errorCode(cause: unknown): string {
  const candidate = cause as { status?: unknown, code?: unknown, name?: unknown }
  if (candidate?.code) return sanitizeDiagnosticValue(candidate.code, 80)
  if (candidate?.status) return `HTTP_${sanitizeDiagnosticValue(candidate.status, 24)}`
  if (candidate?.name) return sanitizeDiagnosticValue(candidate.name, 80)
  return 'UNKNOWN_ERROR'
}

async function readEntries(): Promise<DiagnosticLogEntry[]> {
  try {
    const stored = await Preferences.get({ key: STORAGE_KEY })
    if (!stored.value) return []
    const parsed: unknown = JSON.parse(stored.value)
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ENTRIES) as DiagnosticLogEntry[] : []
  } catch {
    return []
  }
}

async function writeEntries(entries: DiagnosticLogEntry[]): Promise<void> {
  await Preferences.set({
    key: STORAGE_KEY,
    value: JSON.stringify(entries.slice(0, MAX_ENTRIES)),
  })
}

async function runtimeInfo() {
  let appVersion = 'unknown'
  let appVersionCode = 'unknown'
  let androidVersion = ''
  let deviceModel = ''
  try {
    const info = await App.getInfo()
    appVersion = info.version
    appVersionCode = info.build
  } catch {
    // Browser preview or unavailable native bridge.
  }
  if (Capacitor.isNativePlatform()) {
    try {
      const device = await DiagnosticNative.getDeviceInfo()
      androidVersion = sanitizeDiagnosticValue(device.androidVersion || '', 80)
      deviceModel = sanitizeDiagnosticValue(device.deviceModel || '', 120)
    } catch {
      // Device metadata is helpful but never required for saving an error.
    }
  }
  return { appVersion, appVersionCode, androidVersion, deviceModel }
}

export async function recordDiagnosticError(
  category: DiagnosticCategory,
  stage: string,
  cause: unknown,
  context: DiagnosticContext = {},
): Promise<DiagnosticLogEntry> {
  const details = cause as { message?: unknown, detail?: unknown, stack?: unknown }
  const message = sanitizeDiagnosticValue(details?.message ?? cause, MAX_MESSAGE_LENGTH)
  const technical = details?.detail != null && details.detail !== details.message
    ? sanitizeDiagnosticValue(details.detail, MAX_TECHNICAL_LENGTH)
    : message
  const fileName = safeFileName(context.fileName)
  const runtime = await runtimeInfo()
  const entry: DiagnosticLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
    category,
    stage: sanitizeDiagnosticValue(stage, 100),
    errorCode: errorCode(cause),
    message,
    technicalMessage: technical,
    appVersion: runtime.appVersion,
    appVersionCode: runtime.appVersionCode,
    platform: Capacitor.getPlatform(),
    androidVersion: runtime.androidVersion,
    deviceModel: runtime.deviceModel,
    ...(fileName ? {
      fileName,
      fileExtension: fileName.includes('.') ? `.${fileName.split('.').at(-1)!.toLowerCase()}` : '',
    } : {}),
    ...(Number.isFinite(context.fileSize) ? { fileSize: Number(context.fileSize) } : {}),
    ...(context.schemaVersion
      ? { schemaVersion: sanitizeDiagnosticValue(context.schemaVersion, 40) }
      : {}),
    ...(details?.stack
      ? { stack: sanitizeDiagnosticValue(details.stack, MAX_STACK_LENGTH) }
      : {}),
  }
  const entries = await readEntries()
  await writeEntries([entry, ...entries])
  return entry
}

export async function listDiagnosticLogs(): Promise<DiagnosticLogEntry[]> {
  return readEntries()
}

export async function clearDiagnosticLogs(): Promise<void> {
  await Preferences.remove({ key: STORAGE_KEY })
}

function exportPayload(entries: DiagnosticLogEntry[]): string {
  return JSON.stringify({
    format: 'english-practice-machine-diagnostics',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    privacyNotice: '日志已过滤密钥、请求参数、题库正文、答案正文、个人学习记录和本机完整路径。',
    entries,
  }, null, 2)
}

export async function copyDiagnosticLogs(): Promise<number> {
  const entries = await readEntries()
  if (!entries.length) return 0
  const text = exportPayload(entries)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    if (!copied) throw new Error('系统剪贴板不可用')
  }
  return entries.length
}

export async function shareDiagnosticLogs(): Promise<number> {
  const entries = await readEntries()
  if (!entries.length) return 0
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `english-practice-diagnostics-${timestamp}.json`
  const text = exportPayload(entries)
  if (Capacitor.isNativePlatform()) {
    await DiagnosticNative.shareText({
      text,
      fileName,
      title: '发送英语刷题机诊断日志',
    })
  } else {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return entries.length
}
