import { App } from '@capacitor/app'
import { registerPlugin } from '@capacitor/core'
import { row, run } from './database'
import { LocalApiError } from './errors'
import { fetchQuestionBankCatalogFromSources, fetchUpdateManifest, validateQuestionBankRemoteUrl } from '../updates'
import { createEsqImportFromNativePackage } from './question-bank'
import { resolveUpdateSetting } from './update-settings'
import { officialDownloadSources, withOfficialDownloadFallback } from '../official-download-sources'

type JsonRecord = Record<string, any>

const BUILD_OVERRIDES: Record<string, string> = {
  app_update_manifest_url: String(import.meta.env.VITE_APP_UPDATE_MANIFEST_URL || '').trim(),
  question_bank_catalog_url: String(import.meta.env.VITE_QUESTION_BANK_CATALOG_URL || '').trim(),
}

const FALLBACK_DEFAULTS: Record<string, string> = {
  app_update_manifest_url: 'https://raw.githubusercontent.com/wssfk12138/android-english-multiple-choice-practice-machine/main/android-update.json',
  question_bank_catalog_url: '',
}

const OFFICIAL_QUESTION_BANK_CATALOG_URL =
  'https://github.com/wssfk12138/english-multiple-choice-practice-machine/releases/download/question-banks-v1.2.0/question-bank-catalog.json'
const OFFICIAL_QUESTION_BANK_MIRRORS = String(
  import.meta.env.VITE_QUESTION_BANK_CATALOG_MIRROR_URLS || '',
).split(/[\r\n,]+/).map(item => item.trim()).filter(Boolean)

async function questionBankCatalog() {
  const thirdPartyUrl = await setting('question_bank_catalog_url')
  // A user-entered third-party catalog is an explicit alternative. It never
  // becomes a fallback member of the official distribution chain.
  const catalog = await (thirdPartyUrl
    ? fetchQuestionBankCatalogFromSources([thirdPartyUrl])
    : fetchQuestionBankCatalogFromSources([
      OFFICIAL_QUESTION_BANK_CATALOG_URL,
      ...OFFICIAL_QUESTION_BANK_MIRRORS,
      ...officialDownloadSources(OFFICIAL_QUESTION_BANK_CATALOG_URL, true).slice(1),
    ]))
  return { ...catalog, publicProxyFallback: !thirdPartyUrl }
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
  return resolveUpdateSetting(
    BUILD_OVERRIDES[key],
    existing?.value,
    FALLBACK_DEFAULTS[key] || '',
  )
}

export async function updateSettings(body: JsonRecord): Promise<JsonRecord> {
  for (const key of ['app_update_manifest_url', 'question_bank_catalog_url']) {
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
  const catalog = await questionBankCatalog()
  return { configured: true, ...catalog }
}

export async function downloadQuestionBankPackage(body: JsonRecord): Promise<JsonRecord> {
  const packageId = typeof body.package_id === 'string' ? body.package_id : ''
  const contentVersion = typeof body.content_version === 'string' ? body.content_version : ''
  const profileId = Number(body.profile_id)
  if (!packageId || !contentVersion || !Number.isInteger(profileId) || profileId < 1) {
    throw new LocalApiError(400, '请指定要下载的题库、版本和导入位置')
  }
  if (!await row('SELECT id FROM question_bank_profiles WHERE id = ? AND deleted_at IS NULL', [profileId])) {
    throw new LocalApiError(404, '目标题库配置不存在，请重新选择导入位置')
  }
  const catalog = await questionBankCatalog()
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
    expectedSize: item.size,
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
    created = await createEsqImportFromNativePackage(filename, packageData, profileId)
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
