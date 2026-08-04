import { App } from '@capacitor/app'
import { registerPlugin } from '@capacitor/core'
import { row, run } from './database'
import { LocalApiError } from './errors'
import { fetchQuestionBankCatalog, fetchUpdateManifest } from '../updates'

type JsonRecord = Record<string, any>

interface AppUpdaterPlugin {
  downloadAndInstall(options: {
    url: string
    sha256: string
    fileName: string
  }): Promise<{ launched: boolean }>
}

const NativeAppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater')

async function setting(key: string): Promise<string> {
  return (await row<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key],
  ))?.value || ''
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
  if (!manifest?.apkUrl || !manifest?.apkSha256 || !manifest?.versionName) {
    throw new LocalApiError(400, '更新信息不完整，请重新检查更新')
  }
  return NativeAppUpdater.downloadAndInstall({
    url: manifest.apkUrl,
    sha256: manifest.apkSha256,
    fileName: `english-practice-machine-${manifest.versionName}.apk`,
  })
}

export async function checkQuestionBankCatalog(): Promise<JsonRecord> {
  const url = await setting('question_bank_catalog_url')
  if (!url) return { configured: false, packages: [] }
  const catalog = await fetchQuestionBankCatalog(url)
  return { configured: true, ...catalog }
}
