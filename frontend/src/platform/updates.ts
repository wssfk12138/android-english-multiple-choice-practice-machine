import { CapacitorHttp } from '@capacitor/core'
import type { QuestionBankRemoteCatalog, UpdateManifest } from './types'

export class UpdateManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UpdateManifestError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assertManifest(value: unknown): asserts value is UpdateManifest {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.channel !== 'string'
    || typeof value.versionName !== 'string'
    || typeof value.versionCode !== 'number'
    || typeof value.apkUrl !== 'string'
    || typeof value.apkSha256 !== 'string') {
    throw new UpdateManifestError('更新清单格式不受支持')
  }
}

export async function fetchUpdateManifest(url: string): Promise<UpdateManifest> {
  const response = await CapacitorHttp.get({
    url,
    headers: { Accept: 'application/json' },
    connectTimeout: 10000,
    readTimeout: 30000,
  })
  if (response.status < 200 || response.status >= 300) {
    throw new UpdateManifestError(`更新清单请求失败：${response.status}`)
  }
  const data: unknown = response.data
  assertManifest(data)
  return data
}

function assertCatalog(value: unknown): asserts value is QuestionBankRemoteCatalog {
  if (!isRecord(value)
    || typeof value.catalogVersion !== 'number'
    || typeof value.updatedAt !== 'string'
    || !Array.isArray(value.packages)) {
    throw new UpdateManifestError('题库目录格式不受支持')
  }
  for (const item of value.packages) {
    if (!isRecord(item)
      || typeof item.packageId !== 'string'
      || typeof item.title !== 'string'
      || typeof item.contentVersion !== 'string'
      || typeof item.fileName !== 'string'
      || typeof item.downloadUrl !== 'string'
      || typeof item.sha256 !== 'string') {
      throw new UpdateManifestError('题库目录包含无效条目')
    }
  }
}

export async function fetchQuestionBankCatalog(url: string): Promise<QuestionBankRemoteCatalog> {
  const response = await CapacitorHttp.get({
    url,
    headers: { Accept: 'application/json' },
    connectTimeout: 10000,
    readTimeout: 30000,
  })
  if (response.status < 200 || response.status >= 300) {
    throw new UpdateManifestError(`题库目录请求失败：${response.status}`)
  }
  const data: unknown = response.data
  assertCatalog(data)
  return data
}
