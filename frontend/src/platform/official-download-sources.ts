/** 题库目录的规范地址：独立题库仓库 main 分支（迁移文档里的“推荐固定目录”）。 */
export const OFFICIAL_CATALOG =
  'https://raw.githubusercontent.com/wssfk12138/english-question-banks/main/question-bank-catalog.json'

const OLD_RELEASE = 'https://github.com/wssfk12138/english-multiple-choice-practice-machine/releases/download/question-banks-v1.2.0/'
const BANK_RELEASES = 'https://github.com/wssfk12138/english-question-banks/releases/download/'
const ASSET_RE = /^https:\/\/github\.com\/wssfk12138\/(?:english-question-banks|english-multiple-choice-practice-machine)\/releases\/download\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * 规范地址不可达时的同源备用入口（2026-09-28 实测三条都可读且内容一致）：
 * 独立题库仓库的固定 Release 目录，以及迁移前的旧目录入口（仍在同步维护）。
 */
export const OFFICIAL_CATALOG_FALLBACKS = [
  `${BANK_RELEASES}question-banks-2026-09-20/question-bank-catalog.json`,
  `${OLD_RELEASE}question-bank-catalog.json`,
]

const PROXY_ORIGINS = ['https://ghfast.top/', 'https://gh-proxy.com/']

/**
 * 官方来源（规范地址与两个备用入口）走直链 + 两个代理；第三方地址始终只有它自己。
 * 两个代理对 raw 与 Release 附件两种形式都实测可用。
 */
export function officialDownloadSources(url: string, enabled: boolean): string[] {
  if (!enabled) return [url]
  const supported = url === OFFICIAL_CATALOG || ASSET_RE.test(url)
  if (!supported) return [url]
  return [url, ...PROXY_ORIGINS.map(origin => origin + url)]
}

export async function withOfficialDownloadFallback<T>(
  url: string,
  enabled: boolean,
  download: (source: string) => Promise<T>,
): Promise<T> {
  const sources = officialDownloadSources(url, enabled)
  for (let index = 0; index < sources.length; index += 1) {
    try { return await download(sources[index]!) }
    catch (error) { if (index === sources.length - 1) throw error }
  }
  throw new Error('没有可用的下载地址')
}

