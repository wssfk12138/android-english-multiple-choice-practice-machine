import { App } from '@capacitor/app'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

export type DiagnosticCategory =
  | 'question_bank_import'
  | 'remote_question_bank'
  | 'app_update'
  | 'startup'

export interface DiagnosticLogEntry {
  createdAt: string
  event: string
  module: DiagnosticCategory
  appVersion: string
  errorCategory: string
  symptom: string
}

type DiagnosticContext = Record<string, unknown>
type JsonRecord = Record<string, unknown>

interface DiagnosticNativePlugin {
  shareText(options: { text: string, fileName: string, title: string }): Promise<{ launched: boolean }>
}

const DiagnosticNative = registerPlugin<DiagnosticNativePlugin>('DiagnosticLog')
const STORAGE_KEY = 'diagnostic_logs_v1'
const MAX_ENTRIES = 50
const MAX_EXPORT_BYTES = 1024 * 1024
const MAX_EVENT_LENGTH = 80
const MAX_VERSION_LENGTH = 40
const MAX_ERROR_CATEGORY_LENGTH = 64
const MAX_SYMPTOM_LENGTH = 240
const ALLOWED_EVENTS = new Set([
  'local_esq_read_and_validate',
  'android_document_extract_and_parse',
  'model_assisted_proofreading',
  'document_database_publish',
  'database_publish_transaction',
  'manifest_fetch_and_validate',
  'apk_download_verify_and_install',
  'catalog_fetch_and_validate',
  'download_hash_and_import_preview',
  'bundled_question_bank_install',
])

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 1))}…` : value
}

export function sanitizeDiagnosticValue(value: unknown, limit = MAX_SYMPTOM_LENGTH): string {
  let text = typeof value === 'string'
    ? value
    : value instanceof Error
      ? value.message
      : String(value ?? '')

  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, '[API Key 已隐藏]')
    .replace(/((?:api[-_ ]?key|authorization|access[-_ ]?token|refresh[-_ ]?token|secret|password)\s*[:=]\s*)[^\s,;}\]]+/gi, '$1[已隐藏]')
    .replace(/https?:\/\/[^\s\"'<>]+/gi, '[URL 已隐藏]')
    .replace(/[A-Za-z]:\\(?:[^\\\r\n]+\\)+[^\\\r\n]*/g, '[完整路径已隐藏]')
    .replace(/\/(?:home|Users|storage|data|sdcard|mnt|var|tmp)\/[^\s\"'<>]*/gi, '[完整路径已隐藏]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP 已隐藏]')
    .replace(/\b(?:[A-F0-9]{0,4}:){2,7}[A-F0-9]{0,4}\b/gi, '[IP 已隐藏]')
    .replace(/((?:android[-_ ]?id|device[-_ ]?id|fingerprint|imei|serial)\s*[:=]\s*)[^\s,;}\]]+/gi, '$1[设备标识已隐藏]')
    .replace(/((?:question|题目|题库正文|answer|答案正文|chat|聊天内容|learning[-_ ]?record|学习记录)\s*[:=：]\s*)[^\r\n;}]*/gi, '$1[内容已隐藏]')
    .replace(/\s+/g, ' ')
    .trim()

  return truncate(text, limit)
}

function safeIdentifier(value: unknown, fallback: string, limit: number): string {
  const candidate = sanitizeDiagnosticValue(value, limit)
  return /^[A-Za-z0-9_.-]+$/.test(candidate) ? candidate : fallback
}

function safeAppVersion(value: unknown): string {
  const candidate = sanitizeDiagnosticValue(value, MAX_VERSION_LENGTH)
  return /^(?:unknown|v?\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?(?: \([A-Za-z0-9_.-]+\))?)$/.test(candidate)
    ? candidate
    : 'unknown'
}

function safeEvent(value: unknown): string {
  const candidate = safeIdentifier(value, 'unknown_event', MAX_EVENT_LENGTH)
  return ALLOWED_EVENTS.has(candidate) ? candidate : 'unknown_event'
}

function isDiagnosticCategory(value: unknown): value is DiagnosticCategory {
  return ['question_bank_import', 'remote_question_bank', 'app_update', 'startup'].includes(String(value))
}

function safeTimestamp(value: unknown): string {
  const parsed = new Date(String(value ?? ''))
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

export function safeErrorCategory(cause: unknown): string {
  const candidate = cause as { status?: unknown, code?: unknown, name?: unknown }
  if (candidate?.code) return safeIdentifier(candidate.code, 'UNKNOWN_ERROR', MAX_ERROR_CATEGORY_LENGTH)
  if (candidate?.status) return safeIdentifier(`HTTP_${candidate.status}`, 'UNKNOWN_ERROR', MAX_ERROR_CATEGORY_LENGTH)
  const message = cause instanceof Error ? cause.message : String(cause ?? '')
  const installerCategories: Array<[RegExp, string]> = [
    [/APK .*?(?:SHA-256|校验失败)/i, 'APK_HASH_MISMATCH'],
    [/APK 文件大小|大小与清单声明不一致/i, 'APK_SIZE_MISMATCH'],
    [/APK 下载失败/i, 'APK_DOWNLOAD_FAILED'],
    [/缓存目录不可用/i, 'CACHE_UNAVAILABLE'],
    [/保存安装包清理状态/i, 'CLEANUP_STATE_WRITE_FAILED'],
    [/打开系统安装界面/i, 'INSTALLER_LAUNCH_FAILED'],
    [/确认当前应用版本/i, 'VERSION_CHECK_FAILED'],
    [/更新地址|下载地址/i, 'INVALID_UPDATE_SOURCE'],
  ]
  for (const [pattern, category] of installerCategories) {
    if (pattern.test(message)) return category
  }
  if (candidate?.name) return safeIdentifier(candidate.name, 'UNKNOWN_ERROR', MAX_ERROR_CATEGORY_LENGTH)
  return 'UNKNOWN_ERROR'
}

function genericSymptom(errorCategory: string): string {
  return `操作未完成（${errorCategory}），请重试；如仍失败，可主动导出此诊断。`
}

function projectEntry(value: unknown): DiagnosticLogEntry | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const module = isDiagnosticCategory(source.module)
    ? source.module
    : isDiagnosticCategory(source.category)
      ? source.category
      : null
  if (!module) return null
  const version = [source.appVersion, source.appVersionCode].filter(Boolean).join(' (')
  const errorCategory = safeIdentifier(source.errorCategory ?? source.errorCode, 'UNKNOWN_ERROR', MAX_ERROR_CATEGORY_LENGTH)
  return {
    createdAt: safeTimestamp(source.createdAt),
    event: safeEvent(source.event ?? source.stage),
    module,
    appVersion: safeAppVersion(version ? `${version}${source.appVersionCode ? ')' : ''}` : 'unknown'),
    errorCategory,
    symptom: genericSymptom(errorCategory),
  }
}

export function projectDiagnosticEntries(values: unknown): DiagnosticLogEntry[] {
  if (!Array.isArray(values)) return []
  return values.map(projectEntry).filter((entry): entry is DiagnosticLogEntry => entry !== null).slice(0, MAX_ENTRIES)
}

async function readEntries(): Promise<DiagnosticLogEntry[]> {
  try {
    const stored = await Preferences.get({ key: STORAGE_KEY })
    return stored.value ? projectDiagnosticEntries(JSON.parse(stored.value)) : []
  } catch {
    return []
  }
}

async function writeEntries(entries: DiagnosticLogEntry[]): Promise<void> {
  await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(projectDiagnosticEntries(entries)) })
}

async function appVersion(): Promise<string> {
  try {
    const info = await App.getInfo()
    return safeAppVersion(`${info.version} (${info.build})`)
  } catch {
    return 'unknown'
  }
}

export async function recordDiagnosticError(
  category: DiagnosticCategory,
  stage: string,
  cause: unknown,
  _context: DiagnosticContext = {},
): Promise<DiagnosticLogEntry> {
  const errorCategory = safeErrorCategory(cause)
  const entry: DiagnosticLogEntry = {
    createdAt: new Date().toISOString(),
    event: safeEvent(stage),
    module: category,
    appVersion: await appVersion(),
    errorCategory,
    symptom: genericSymptom(errorCategory),
  }
  await writeEntries([entry, ...await readEntries()])
  return entry
}

export async function listDiagnosticLogs(): Promise<DiagnosticLogEntry[]> { return readEntries() }
export async function clearDiagnosticLogs(): Promise<void> { await Preferences.remove({ key: STORAGE_KEY }) }

export function diagnosticPayload(entries: unknown): JsonRecord {
  return {
    format: 'english-practice-machine-diagnostics',
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    privacyNotice: '仅包含事件、模块、应用版本、时间、错误类别和短症状；不含题库、答案、聊天或学习记录。',
    entries: projectDiagnosticEntries(entries),
  }
}

export function serializeDiagnosticPayload(entries: unknown): string {
  const projected = projectDiagnosticEntries(entries)
  while (projected.length) {
    const text = JSON.stringify(diagnosticPayload(projected), null, 2)
    if (new TextEncoder().encode(text).byteLength <= MAX_EXPORT_BYTES) return text
    projected.pop()
  }
  return JSON.stringify(diagnosticPayload([]), null, 2)
}

export async function copyDiagnosticText(text: string): Promise<void> {
  if (new TextEncoder().encode(text).byteLength > MAX_EXPORT_BYTES) {
    throw new Error('诊断包超过 1 MiB 上限')
  }
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
}

export async function copyIssueReportTemplate(): Promise<void> {
  const version = await appVersion()
  await copyDiagnosticText([
    '# 英语刷题机公测问题报告',
    `应用版本：${version}`,
    '问题发生时间：',
    '所在功能：',
    '复现步骤：',
    '预期结果：',
    '实际结果：',
    '是否每次出现：',
    '补充说明：',
    '',
    '请勿填写 API Key、题库或答案正文、聊天内容、学习记录及完整文件路径。',
  ].join('\n'))
}

export async function copyDiagnosticLogs(): Promise<number> {
  const entries = await readEntries()
  if (!entries.length) return 0
  await copyDiagnosticText(serializeDiagnosticPayload(entries))
  return entries.length
}

export async function shareDiagnosticLogs(): Promise<number> {
  const entries = await readEntries()
  if (!entries.length) return 0
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `english-practice-diagnostics-${timestamp}.json`
  const text = serializeDiagnosticPayload(entries)
  await shareDiagnosticText(text, fileName, '分享英语刷题机脱敏诊断')
  return entries.length
}

export async function shareDiagnosticText(text: string, fileName: string, title: string): Promise<void> {
  if (new TextEncoder().encode(text).byteLength > MAX_EXPORT_BYTES) {
    throw new Error('诊断包超过 1 MiB 上限')
  }
  if (Capacitor.isNativePlatform()) {
    await DiagnosticNative.shareText({ text, fileName, title })
  } else {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }
}
