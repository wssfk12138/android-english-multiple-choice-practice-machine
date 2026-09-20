import { App } from '@capacitor/app'
import { registerPlugin } from '@capacitor/core'
import { row, run } from './database'
import { LocalApiError } from './errors'
import { JsonResponseError } from '../json-response.ts'
import { fetchQuestionBankCatalogFromSources, fetchUpdateManifest, resolveQuestionBankCatalogSources, validateQuestionBankRemoteUrl } from '../updates'
import { createEsqImportFromNativePackage } from './question-bank'
import { officialDownloadSources, withOfficialDownloadFallback, OFFICIAL_CATALOG, LEGACY_OFFICIAL_CATALOGS } from '../official-download-sources'

type JsonRecord = Record<string, any>

const BUILD_DEFAULTS: Record<string, string> = {
  question_bank_catalog_url: String(import.meta.env.VITE_QUESTION_BANK_CATALOG_URL || '').trim()
    || OFFICIAL_CATALOG,
}

const DEFAULT_APP_UPDATE_MANIFEST_URL =
  'https://github.com/wssfk12138/android-english-multiple-choice-practice-machine/releases/latest/download/android-update.json'

// Controlled HTTPS mirrors are opt-in build inputs. The public source tree
// intentionally ships with an empty mirror list.
const CONTROLLED_APP_UPDATE_MIRROR_MANIFEST_URLS = String(
  import.meta.env.VITE_APP_UPDATE_MIRROR_MANIFEST_URLS || '',
).split(/[\r\n,]+/).map(item => item.trim()).filter(Boolean)

const CONTROLLED_QUESTION_BANK_MIRROR_URLS = String(
  import.meta.env.VITE_QUESTION_BANK_CATALOG_MIRROR_URLS || '',
).split(/[\r\n,]+/).map(item => item.trim()).filter(Boolean)

function appUpdateManifestUrls(): string[] {
  const envManifest = String(import.meta.env.VITE_APP_UPDATE_MANIFEST_URL || '').trim()
  const candidates = [
    envManifest || DEFAULT_APP_UPDATE_MANIFEST_URL,
    ...CONTROLLED_APP_UPDATE_MIRROR_MANIFEST_URLS,
  ]
  // 公共版更新只接受 HTTPS，避免可配置地址把 APK 下载引向明文或非 HTTP 协议。
  const httpsOnly = candidates.filter((item) => {
    if (!item) return false
    try {
      return new URL(item).protocol === 'https:'
    } catch {
      return false
    }
  })
  return [...new Set(httpsOnly)]
}

async function questionBankCatalog() {
  const storedUrl = await setting('question_bank_catalog_url')
  // Older builds persisted official defaults; keep those settings without bypassing mirrors.
  const usesOfficialSources = storedUrl === BUILD_DEFAULTS.question_bank_catalog_url
    || (BUILD_DEFAULTS.question_bank_catalog_url === OFFICIAL_CATALOG && LEGACY_OFFICIAL_CATALOGS.includes(storedUrl))
  const sources = resolveQuestionBankCatalogSources({
    officialUrl: BUILD_DEFAULTS.question_bank_catalog_url,
    controlledMirrorUrls: [
      ...CONTROLLED_QUESTION_BANK_MIRROR_URLS,
      ...officialDownloadSources(BUILD_DEFAULTS.question_bank_catalog_url!, BUILD_DEFAULTS.question_bank_catalog_url === OFFICIAL_CATALOG).slice(1),
    ],
    thirdPartyUrl: usesOfficialSources ? '' : storedUrl,
  })
  if (!sources.length) return null
  const catalog = await fetchQuestionBankCatalogFromSources(sources)
  return { ...catalog, publicProxyFallback: (!storedUrl || usesOfficialSources) && BUILD_DEFAULTS.question_bank_catalog_url === OFFICIAL_CATALOG }
}

function mirrorRewriteApkUrl(manifestUrl: string, apkUrl: string): string {
  const marker = 'https://github.com/'
  const markerIndex = manifestUrl.indexOf(marker)
  if (markerIndex <= 0 || !apkUrl.startsWith(marker)) return apkUrl
  return `${manifestUrl.slice(0, markerIndex)}${apkUrl}`
}

interface AppUpdaterPlugin {
  downloadAndInstall(options: {
    url: string
    sha256: string
    fileName: string
    expectedSize?: number
    targetVersionCode: number
    targetVersionName: string
  }): Promise<{ launched: boolean }>
  getPendingInstallerCleanup(): Promise<PendingInstallerCleanup>
  resolveInstallerCleanup(options: { delete: boolean }): Promise<{
    deleted: boolean
    retained: boolean
  }>
  downloadQuestionBank(options: {
    url: string
    sha256: string
    expectedSize: number
    fileName: string
  }): Promise<{ packageData: string; cleanupToken: string }>
  resolveQuestionBankAssets(options: {
    cleanupToken: string
    delete: boolean
  }): Promise<{ deleted: boolean; retained: boolean }>
}

export interface PendingInstallerCleanup {
  pending: boolean
  fileName: string
  versionName: string
  size: number
}

const NativeAppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater')

async function setting(key: string): Promise<string> {
  const existing = await row<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key],
  )
  if (existing) return existing.value || ''
  // Build defaults belong to the official fallback chain, not user settings.
  return ''
}

export async function updateSettings(body: JsonRecord): Promise<JsonRecord> {
  for (const key of ['question_bank_catalog_url']) {
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
    question_bank_catalog_url: await setting('question_bank_catalog_url'),
  }
}

export async function checkAppUpdate(): Promise<JsonRecord> {
  const info = await App.getInfo()
  const currentVersionCode = Number(info.build || 0)
  const urls = appUpdateManifestUrls()
  let lastError: unknown = null
  for (let index = 0; index < urls.length; index += 1) {
    try {
      const sourceUrl = urls[index]
      const manifest = await fetchUpdateManifest(sourceUrl)
      return {
        current_version: info.version,
        current_version_code: currentVersionCode,
        available: manifest.versionCode > currentVersionCode,
        manifest: { ...manifest, apkUrl: mirrorRewriteApkUrl(sourceUrl, manifest.apkUrl) },
        checked_sources: index + 1,
        fallback_used: index > 0,
      }
    } catch (cause) {
      lastError = cause
    }
  }
  if (lastError instanceof JsonResponseError) throw lastError
  throw new JsonResponseError('无法连接更新服务，请检查网络后重试', 'REMOTE_NETWORK')
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
  let apkUrl: URL
  try {
    apkUrl = new URL(manifest.apkUrl)
  } catch {
    throw new LocalApiError(400, 'APK 下载地址无效，请重新检查更新')
  }
  if (apkUrl.protocol !== 'https:') {
    throw new LocalApiError(400, 'APK 下载地址必须使用 HTTPS')
  }
  return NativeAppUpdater.downloadAndInstall({
    url: apkUrl.toString(),
    sha256: manifest.apkSha256,
    fileName: `english-practice-machine-${manifest.versionName}.apk`,
    expectedSize: Number.isInteger(manifest.apkSize) ? manifest.apkSize : undefined,
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
  const catalog = await questionBankCatalog()
  if (!catalog) return { configured: false, packages: [] }
  return { configured: true, ...catalog }
}

export async function downloadQuestionBankPackage(body: JsonRecord): Promise<JsonRecord> {
  const profileId = body.profile_id
  const newProfileName = body.new_profile_name
  if ((profileId !== undefined) === (newProfileName !== undefined)) {
    throw new LocalApiError(422, '请明确选择一个导入目标题库')
  }
  if (profileId !== undefined && (!Number.isSafeInteger(profileId) || profileId < 1)) {
    throw new LocalApiError(422, '目标题库无效')
  }
  if (newProfileName !== undefined && (typeof newProfileName !== 'string' || !newProfileName.trim() || newProfileName.trim().length > 80)) {
    throw new LocalApiError(422, '请输入 1–80 字的题库名称')
  }
  if (profileId !== undefined && !await row('SELECT id FROM question_bank_profiles WHERE id = ? AND deleted_at IS NULL', [profileId])) {
    throw new LocalApiError(404, '题库配置不存在')
  }
  if (newProfileName !== undefined && await row('SELECT id FROM question_bank_profiles WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL', [newProfileName.trim()])) {
    throw new LocalApiError(409, '已经存在同名题库配置')
  }
  const packageId = typeof body.package_id === 'string' ? body.package_id : ''
  const contentVersion = typeof body.content_version === 'string' ? body.content_version : ''
  if (!packageId || !contentVersion) {
    throw new LocalApiError(400, '请指定要下载的题库和版本')
  }
  const catalog = await questionBankCatalog()
  if (!catalog) throw new LocalApiError(400, '当前没有可用的远程题库目录，请先填写第三方目录地址')
  const item = catalog.packages.find(candidate => (
    candidate.packageId === packageId && candidate.contentVersion === contentVersion
  ))
  if (!item) {
    throw new LocalApiError(404, '所选题库已不在当前远程目录中，请刷新后重试')
  }
  const safeName = item.fileName.replace(/[^A-Za-z0-9._-]/g, '_')
  const filename = safeName.toLowerCase().endsWith('.esq') ? safeName : `${safeName}.esq`
  const downloaded = await withOfficialDownloadFallback(item.downloadUrl, catalog.publicProxyFallback, url => NativeAppUpdater.downloadQuestionBank({
    url: validateQuestionBankRemoteUrl(url, '题库下载地址'),
    sha256: item.sha256,
    expectedSize: Number(item.size),
    fileName: filename,
  }))
  let packageData: JsonRecord
  try {
    packageData = JSON.parse(downloaded.packageData)
  } catch {
    throw new LocalApiError(422, '原生题库导入器返回了无效数据')
  }
  let created: JsonRecord
  try {
    created = await createEsqImportFromNativePackage(filename, packageData, profileId, newProfileName?.trim())
  } catch (error) {
    if (downloaded.cleanupToken) {
      await NativeAppUpdater.resolveQuestionBankAssets({
        cleanupToken: downloaded.cleanupToken,
        delete: true,
      }).catch(() => undefined)
    }
    throw error
  }
  if (downloaded.cleanupToken) {
    await NativeAppUpdater.resolveQuestionBankAssets({
      cleanupToken: downloaded.cleanupToken,
      delete: false,
    })
  }
  return {
    ...created,
    remote: {
      packageId: item.packageId,
      contentVersion: item.contentVersion,
      title: item.title,
    },
  }
}
