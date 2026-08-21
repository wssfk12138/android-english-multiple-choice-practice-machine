import { App } from '@capacitor/app'
import { CapacitorHttp, registerPlugin } from '@capacitor/core'
import { row, run } from './database'
import { LocalApiError } from './errors'
import { fetchQuestionBankCatalog, fetchUpdateManifest } from '../updates'
import type { QuestionBankRemotePackage } from '../types'
import { createEsqImportFromBytes } from './question-bank'

type JsonRecord = Record<string, any>

const BUILD_DEFAULTS: Record<string, string> = {
  // Public builds read the signed release manifest from GitHub. Internal
  // builds may override these values at build time or in local settings.
  app_update_manifest_url: 'https://raw.githubusercontent.com/wssfk12138/android-english-multiple-choice-practice-machine/main/android-update.json',
  question_bank_catalog_url: '',
  diagnostic_receiver_url: '',
}

interface AppUpdaterPlugin {
  downloadAndInstall(options: {
    url: string
    sha256: string
    fileName: string
    targetVersionCode: number
    targetVersionName: string
  }): Promise<{ launched: boolean }>
  getPendingInstallerCleanup(): Promise<PendingInstallerCleanup>
  resolveInstallerCleanup(options: { delete: boolean }): Promise<{
    deleted: boolean
    retained: boolean
  }>
}

export interface PendingInstallerCleanup {
  pending: boolean
  fileName: string
  versionName: string
  size: number
}

const NativeAppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater')

async function setting(key: string): Promise<string> {
  const defaultValue = BUILD_DEFAULTS[key] || ''
  if (defaultValue) return defaultValue
  const existing = await row<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key],
  )
  return existing?.value || ''
}

export async function updateSettings(body: JsonRecord): Promise<JsonRecord> {
  for (const key of ['app_update_manifest_url', 'question_bank_catalog_url', 'diagnostic_receiver_url']) {
    if (!(key in body)) continue
    await run(
      `INSERT INTO app_settings(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, String(body[key] || '').trim()],
    )
  }
  return readUpdateSettings()
}

export async function readUpdateSettings(): Promise<JsonRecord> {
  return {
    app_update_manifest_url: await setting('app_update_manifest_url'),
    question_bank_catalog_url: await setting('question_bank_catalog_url'),
    diagnostic_receiver_url: await setting('diagnostic_receiver_url'),
  }
}

export async function checkAppUpdate(): Promise<JsonRecord> {
  const url = await setting('app_update_manifest_url')
  if (!url) throw new LocalApiError(400, '请先填写程序更新清单地址')
  const manifest = await fetchUpdateManifest(url)
  const info = await App.getInfo()
  const currentVersionCode = Number(info.build || 0)
  return {
    current_version: info.version,
    current_version_code: currentVersionCode,
    available: manifest.versionCode > currentVersionCode,
    manifest,
  }
}

export async function installAppUpdate(body: JsonRecord): Promise<JsonRecord> {
  const manifest = body.manifest
  if (!manifest?.apkUrl
    || !manifest?.apkSha256
    || !manifest?.versionName
    || !Number.isInteger(manifest?.versionCode)
    || manifest.versionCode < 1) {
    throw new LocalApiError(400, '更新信息不完整，请重新检查更新')
  }
  return NativeAppUpdater.downloadAndInstall({
    url: manifest.apkUrl,
    sha256: manifest.apkSha256,
    fileName: `english-practice-machine-${manifest.versionName}.apk`,
    targetVersionCode: manifest.versionCode,
    targetVersionName: manifest.versionName,
  })
}

export async function pendingInstallerCleanup(): Promise<PendingInstallerCleanup> {
  return NativeAppUpdater.getPendingInstallerCleanup()
}

export async function resolveInstallerCleanup(shouldDelete: boolean): Promise<{
  deleted: boolean
  retained: boolean
}> {
  return NativeAppUpdater.resolveInstallerCleanup({ delete: shouldDelete })
}

export async function checkQuestionBankCatalog(): Promise<JsonRecord> {
  const url = await setting('question_bank_catalog_url')
  if (!url) return { configured: false, packages: [] }
  const catalog = await fetchQuestionBankCatalog(url)
  return { configured: true, ...catalog }
}

function assertDownloadUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new LocalApiError(422, '题库下载地址无效')
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new LocalApiError(422, '题库下载地址只允许使用 HTTP 或 HTTPS')
  }
  return url.toString()
}

function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !value) {
    throw new LocalApiError(422, '题库下载结果不是有效的二进制数据')
  }
  const binary = atob(value.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function validateRemotePackage(value: unknown): QuestionBankRemotePackage {
  const item = value as Partial<QuestionBankRemotePackage> | null
  if (!item
    || typeof item.packageId !== 'string'
    || typeof item.title !== 'string'
    || typeof item.contentVersion !== 'string'
    || typeof item.fileName !== 'string'
    || typeof item.downloadUrl !== 'string'
    || typeof item.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(item.sha256)) {
    throw new LocalApiError(422, '题库目录条目不完整')
  }
  if (item.size != null && (!Number.isFinite(item.size) || item.size < 1 || item.size > 100 * 1024 * 1024)) {
    throw new LocalApiError(422, '题库目录声明的文件大小无效')
  }
  return item as QuestionBankRemotePackage
}

export async function downloadQuestionBankPackage(body: JsonRecord): Promise<JsonRecord> {
  const item = validateRemotePackage(body.package)
  const response = await CapacitorHttp.get({
    url: assertDownloadUrl(item.downloadUrl),
    headers: { Accept: 'application/vnd.english-study-question-bank, application/zip' },
    responseType: 'arraybuffer',
    connectTimeout: 15000,
    readTimeout: 120000,
  })
  if (response.status < 200 || response.status >= 300) {
    throw new LocalApiError(400, `题库下载失败：${response.status}`)
  }
  const bytes = decodeBase64(response.data)
  if (bytes.byteLength > 100 * 1024 * 1024) {
    throw new LocalApiError(422, '下载的 ESQ 文件超过 100 MiB')
  }
  if (item.size != null && bytes.byteLength !== item.size) {
    throw new LocalApiError(422, '题库文件大小与目录声明不一致')
  }
  if ((await sha256(bytes)).toLowerCase() !== item.sha256.toLowerCase()) {
    throw new LocalApiError(422, '题库 SHA-256 校验失败，文件可能不完整或已被替换')
  }
  const safeName = item.fileName.replace(/[^A-Za-z0-9._-]/g, '_')
  const filename = safeName.toLowerCase().endsWith('.esq') ? safeName : `${safeName}.esq`
  const created = await createEsqImportFromBytes(filename, bytes)
  return {
    ...created,
    remote: {
      packageId: item.packageId,
      contentVersion: item.contentVersion,
      title: item.title,
    },
  }
}
