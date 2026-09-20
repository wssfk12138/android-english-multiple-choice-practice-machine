const OLD_RELEASE = 'https://github.com/wssfk12138/english-multiple-choice-practice-machine/releases/download/question-banks-v1.2.0/'
const BANK_RELEASES = 'https://github.com/wssfk12138/english-question-banks/releases/download/'
export const OFFICIAL_CATALOG = 'https://raw.githubusercontent.com/wssfk12138/english-question-banks/main/question-bank-catalog.json'
export const LEGACY_OFFICIAL_CATALOGS = [
  OLD_RELEASE + 'question-bank-catalog.json',
  'https://github.com/wssfk12138/english-multiple-choice-practice-machine/releases/latest/download/question-bank-catalog.json',
]
const PROXY_ORIGINS = ['https://ghfast.top/', 'https://gh-proxy.com/']

export function officialDownloadSources(url: string, enabled: boolean): string[] {
  if (!enabled) return [url]
  // Exact catalog or release assets only; never proxy credentials, query strings,
  // path traversal, other repositories or third-party sources.
  const oldAsset = url.startsWith(OLD_RELEASE)
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(url.slice(OLD_RELEASE.length))
  const bankAsset = url.startsWith(BANK_RELEASES)
    && /^question-banks-[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\.esq$/.test(url.slice(BANK_RELEASES.length))
  if (url !== OFFICIAL_CATALOG && !oldAsset && !bankAsset) return [url]
  return [url, ...PROXY_ORIGINS.map(origin => origin + url)]
}

export async function withOfficialDownloadFallback<T>(
  url: string, enabled: boolean, download: (source: string) => Promise<T>,
): Promise<T> {
  const sources = officialDownloadSources(url, enabled)
  for (let index = 0; index < sources.length; index += 1) {
    try { return await download(sources[index]!) }
    catch (error) { if (index === sources.length - 1) throw error }
  }
  throw new Error('没有可用的下载地址')
}
