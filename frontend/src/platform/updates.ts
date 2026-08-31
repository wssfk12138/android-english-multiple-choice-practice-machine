import { CapacitorHttp } from '@capacitor/core'
import type { QuestionBankRemoteCatalog, QuestionBankRemotePackage, UpdateManifest } from './types'
import { MAX_ESQ_BYTES } from './question-bank-limits.ts'

const MAX_CATALOG_BYTES = 2 * 1024 * 1024
const MAX_CATALOG_PACKAGES = 500
const PACKAGE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/
const SHA256_RE = /^[a-f0-9]{64}$/i

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

export function validateQuestionBankRemoteUrl(raw: unknown, label = '远程地址'): string {
  if (typeof raw !== 'string') throw new UpdateManifestError(`${label}无效`)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UpdateManifestError(`${label}无效`)
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const ipv4 = hostname.split('.').map(Number)
  const privateIpv4 = ipv4.length === 4 && ipv4.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
    && (ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127 || ipv4[0] >= 224
      || (ipv4[0] === 169 && ipv4[1] === 254)
      || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
      || (ipv4[0] === 192 && ipv4[1] === 168))
  const privateIpv6 = hostname === '::' || hostname === '::1' || hostname.startsWith('fc')
    || hostname.startsWith('fd') || /^fe[89ab]/.test(hostname)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new UpdateManifestError(`${label}必须使用不含凭据的 HTTPS URL`)
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
    || privateIpv4 || privateIpv6) {
    throw new UpdateManifestError(`${label}不能指向本机、局域网或保留网络`)
  }
  return url.toString()
}

function normalizeCatalogPackage(item: unknown, index: number): QuestionBankRemotePackage {
  const label = `题库目录第 ${index + 1} 项`
  if (!isRecord(item)) throw new UpdateManifestError(`${label}无效`)
  const { packageId, contentVersion, title, fileName, sha256, size, license, years } = item
  if (typeof packageId !== 'string' || !PACKAGE_ID_RE.test(packageId)) throw new UpdateManifestError(`${label} packageId 无效`)
  if (typeof contentVersion !== 'string' || !SEMVER_RE.test(contentVersion)) throw new UpdateManifestError(`${label} contentVersion 无效`)
  if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new UpdateManifestError(`${label} title 无效`)
  if (typeof fileName !== 'string' || !fileName || fileName !== fileName.trim()
    || fileName.includes('/') || fileName.includes('\\') || fileName === '.' || fileName === '..'
    || /^[A-Za-z]:/.test(fileName) || !fileName.toLowerCase().endsWith('.esq')) {
    throw new UpdateManifestError(`${label} fileName 无效`)
  }
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) throw new UpdateManifestError(`${label} SHA-256 无效`)
  if (!Number.isInteger(size) || Number(size) < 1 || Number(size) > MAX_ESQ_BYTES) throw new UpdateManifestError(`${label} size 无效`)
  if (typeof license !== 'string' || !license.trim() || license.length > 2000) throw new UpdateManifestError(`${label} license 无效`)
  if (!Array.isArray(years) || years.length > 100
    || years.some(year => !Number.isInteger(year) || Number(year) < 1900 || Number(year) > 2200)) {
    throw new UpdateManifestError(`${label} years 无效`)
  }
  return {
    packageId, contentVersion, title: title.trim(), fileName,
    downloadUrl: validateQuestionBankRemoteUrl(item.downloadUrl, `${label} downloadUrl`),
    sha256: sha256.toLowerCase(), size: Number(size), license: license.trim(),
    years: [...new Set(years as number[])].sort((left, right) => left - right),
  }
}

export function validateQuestionBankCatalog(value: unknown): QuestionBankRemoteCatalog {
  if (!isRecord(value) || value.catalogVersion !== 1 || !Array.isArray(value.packages)) {
    throw new UpdateManifestError('题库目录 catalogVersion 或 packages 不受支持')
  }
  if (value.packages.length > MAX_CATALOG_PACKAGES) throw new UpdateManifestError('题库目录 packages 超过 500 项')
  const packages = value.packages.map(normalizeCatalogPackage)
  const identities = new Set<string>()
  for (const item of packages) {
    const identity = `${item.packageId}\u0000${item.contentVersion}`
    if (identities.has(identity)) throw new UpdateManifestError('题库目录包含重复的 packageId + contentVersion')
    identities.add(identity)
  }
  if (value.updatedAt !== undefined && typeof value.updatedAt !== 'string') throw new UpdateManifestError('题库目录 updatedAt 无效')
  return { catalogVersion: 1, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '', packages }
}

export async function fetchQuestionBankCatalog(url: string): Promise<QuestionBankRemoteCatalog> {
  const sourceUrl = validateQuestionBankRemoteUrl(url, '题库目录地址')
  const response = await CapacitorHttp.get({
    url: sourceUrl,
    headers: { Accept: 'application/json' },
    connectTimeout: 10000,
    readTimeout: 30000,
  })
  if (response.status < 200 || response.status >= 300) {
    throw new UpdateManifestError(`题库目录请求失败：${response.status}`)
  }
  validateQuestionBankRemoteUrl(response.url, '题库目录最终响应地址')
  const data: unknown = response.data
  const byteLength = new TextEncoder().encode(JSON.stringify(data)).byteLength
  if (byteLength > MAX_CATALOG_BYTES) throw new UpdateManifestError('题库目录超过 2 MiB 大小上限')
  return validateQuestionBankCatalog(data)
}

export function resolveQuestionBankCatalogSources(options: {
  officialUrl?: string
  controlledMirrorUrls?: string[]
  thirdPartyUrl?: string
}): string[] {
  const thirdPartyUrl = String(options.thirdPartyUrl || '').trim()
  if (thirdPartyUrl) return [thirdPartyUrl]
  return [...new Set([
    String(options.officialUrl || '').trim(),
    ...(options.controlledMirrorUrls || []).map(url => String(url).trim()),
  ].filter(Boolean))]
}

export async function fetchQuestionBankCatalogFromSources(
  urls: string[],
): Promise<QuestionBankRemoteCatalog & { sourceUrl: string, checkedSources: number }> {
  const sources = [...new Set(urls.map(url => url.trim()).filter(Boolean))]
  if (!sources.length) throw new UpdateManifestError('没有可用的题库目录地址')
  const failures: string[] = []
  for (let index = 0; index < sources.length; index += 1) {
    try {
      const catalog = await fetchQuestionBankCatalog(sources[index])
      return { ...catalog, sourceUrl: sources[index], checkedSources: index + 1 }
    } catch (error) {
      failures.push(String(error instanceof Error ? error.message : error))
    }
  }
  throw new UpdateManifestError(`题库目录均不可用：${failures.join('；')}`)
}
