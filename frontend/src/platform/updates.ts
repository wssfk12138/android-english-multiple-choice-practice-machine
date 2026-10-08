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

/**
 * Capacitor 只在响应头声明 application/json 时才自动解析 JSON；GitHub Release
 * 附件以 application/octet-stream 下发，raw 文件是 text/plain，若沿用默认解析会
 * 把整个清单当成字符串而校验失败。这里固定按文本取回，再自行解析。
 */
async function fetchJsonSource(
  url: string,
  label: string,
  connectTimeoutMs = 10000,
): Promise<{ status: number, url: unknown, text: string }> {
  const response = await CapacitorHttp.get({
    url,
    headers: { Accept: 'application/json' },
    connectTimeout: connectTimeoutMs,
    readTimeout: 30000,
    responseType: 'text',
  })
  return {
    status: response.status,
    url: response.url,
    text: typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? null),
  }
}

function parseJsonSource(text: string, label: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new UpdateManifestError(`${label}响应不是有效 JSON，请确认地址指向 JSON 文件而不是网页`)
  }
}

/** 失败提示里带上响应的顶层结构，用户自己就能看出填错了哪种地址。 */
function describeJsonShape(value: unknown): string {
  if (Array.isArray(value)) return `数组（${value.length} 项）`
  if (!isRecord(value)) return typeof value
  const keys = Object.keys(value)
  return keys.length ? `字段 ${keys.slice(0, 8).join('、')}${keys.length > 8 ? '…' : ''}` : '空对象'
}

function looksLikeUpdateManifest(value: unknown): boolean {
  return isRecord(value)
    && value.schemaVersion === 1
    && typeof value.channel === 'string'
    && typeof value.apkUrl === 'string'
}

function describeSourceHost(url: string): string {
  try { return new URL(url).host } catch { return url }
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
  const response = await fetchJsonSource(url, '更新清单')
  if (response.status < 200 || response.status >= 300) {
    throw new UpdateManifestError(`更新清单请求失败：${response.status}`)
  }
  const data = parseJsonSource(response.text, '更新清单')
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
  const octets = url.hostname.split('.').map(part => Number(part))
  const isIpv4Literal = octets.length === 4
    && octets.every((octet, index) => Number.isInteger(octet)
      && octet >= 0
      && octet <= 255
      && String(octet) === url.hostname.split('.')[index])
  const isPrivateIpv4 = isIpv4Literal && (
    octets[0] === 10
    || (octets[0] === 127)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
  )
  const isAllowedHttp = url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '[::1]' || isPrivateIpv4)
  if ((url.protocol !== 'https:' && !isAllowedHttp) || url.username || url.password) {
    throw new UpdateManifestError(`${label}必须使用 HTTPS；HTTP 仅限本机或私有局域网 IP`)
  }
  return url.toString()
}

function normalizeCatalogPackage(item: unknown, index: number): QuestionBankRemotePackage {
  const label = `题库目录第 ${index + 1} 项`
  if (!isRecord(item)) throw new UpdateManifestError(`${label}无效`)
  const packageId = item.packageId
  const contentVersion = item.contentVersion
  const title = item.title
  const fileName = item.fileName
  const sha256 = item.sha256
  const size = item.size
  const license = item.license
  const years = item.years
  if (typeof packageId !== 'string' || !PACKAGE_ID_RE.test(packageId)) {
    throw new UpdateManifestError(`${label} packageId 无效`)
  }
  if (typeof contentVersion !== 'string' || !SEMVER_RE.test(contentVersion)) {
    throw new UpdateManifestError(`${label} contentVersion 无效`)
  }
  if (typeof title !== 'string' || !title.trim() || title.length > 200) {
    throw new UpdateManifestError(`${label} title 无效`)
  }
  if (typeof fileName !== 'string'
    || !fileName
    || fileName !== fileName.trim()
    || fileName.includes('/')
    || fileName.includes('\\')
    || fileName === '.'
    || fileName === '..'
    || /^[A-Za-z]:/.test(fileName)
    || !fileName.toLowerCase().endsWith('.esq')) {
    throw new UpdateManifestError(`${label} fileName 无效`)
  }
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) {
    throw new UpdateManifestError(`${label} SHA-256 无效`)
  }
  if (!Number.isInteger(size) || Number(size) < 1 || Number(size) > MAX_ESQ_BYTES) {
    throw new UpdateManifestError(`${label} size 无效`)
  }
  if (typeof license !== 'string' || !license.trim() || license.length > 2000) {
    throw new UpdateManifestError(`${label} license 无效`)
  }
  if (!Array.isArray(years)
    || years.length > 100
    || years.some(year => !Number.isInteger(year) || year < 1900 || year > 2200)) {
    throw new UpdateManifestError(`${label} years 无效`)
  }
  return {
    packageId,
    contentVersion,
    title: title.trim(),
    fileName,
    downloadUrl: validateQuestionBankRemoteUrl(item.downloadUrl, `${label} downloadUrl`),
    sha256: sha256.toLowerCase(),
    size: Number(size),
    license: license.trim(),
    years: [...new Set(years as number[])].sort((left, right) => left - right),
  }
}

export function validateQuestionBankCatalog(value: unknown): QuestionBankRemoteCatalog {
  if (!isRecord(value) || value.catalogVersion !== 1 || !Array.isArray(value.packages)) {
    // 更新清单和题库目录都是 JSON：填错地址时必须能一眼看出是哪种文件。
    if (looksLikeUpdateManifest(value)) {
      throw new UpdateManifestError('这个地址返回的是程序更新清单，不是题库目录；请填写题库目录地址')
    }
    throw new UpdateManifestError(`题库目录 catalogVersion 或 packages 不受支持（收到的 JSON：${describeJsonShape(value)}）`)
  }
  if (value.packages.length > MAX_CATALOG_PACKAGES) {
    throw new UpdateManifestError('题库目录 packages 超过 500 项')
  }
  const packages = value.packages.map(normalizeCatalogPackage)
  const identities = new Set<string>()
  for (const item of packages) {
    const identity = `${item.packageId}\u0000${item.contentVersion}`
    if (identities.has(identity)) {
      throw new UpdateManifestError('题库目录包含重复的 packageId + contentVersion')
    }
    identities.add(identity)
  }
  if (value.updatedAt != null && typeof value.updatedAt !== 'string') {
    throw new UpdateManifestError('题库目录 updatedAt 无效')
  }
  return {
    catalogVersion: 1,
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
    packages,
  }
}

export async function fetchQuestionBankCatalog(url: string): Promise<QuestionBankRemoteCatalog> {
  const sourceUrl = validateQuestionBankRemoteUrl(url, '题库目录地址')
  // 现场实测：受限网络里直连源会卡满连接超时。目录有多个候选源，
  // 4 秒足够建连，能省下约 26 秒白等，不影响可用源。
  const response = await fetchJsonSource(sourceUrl, '题库目录', 4000)
  if (response.status < 200 || response.status >= 300) {
    throw new UpdateManifestError(`题库目录请求失败：${response.status}`)
  }
  validateQuestionBankRemoteUrl(response.url, '题库目录最终响应地址')
  const byteLength = new TextEncoder().encode(response.text).byteLength
  if (byteLength > MAX_CATALOG_BYTES) {
    throw new UpdateManifestError('题库目录超过 2 MiB 大小上限')
  }
  const data = parseJsonSource(response.text, '题库目录')
  return validateQuestionBankCatalog(data)
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
      failures.push(`${describeSourceHost(sources[index]!)}：${String(error instanceof Error ? error.message : error)}`)
    }
  }
  throw new UpdateManifestError(`题库目录均不可用：${failures.join('；')}`)
}
