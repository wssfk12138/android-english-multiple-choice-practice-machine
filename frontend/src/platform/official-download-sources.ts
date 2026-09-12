const OFFICIAL_RELEASE = 'https://github.com/wssfk12138/english-multiple-choice-practice-machine/releases/download/question-banks-v1.2.0/'
export const OFFICIAL_CATALOG = OFFICIAL_RELEASE + 'question-bank-catalog.json'
const PROXY_ORIGINS = ['https://ghfast.top/', 'https://gh-proxy.com/']

export function officialDownloadSources(url: string, enabled: boolean): string[] {
  if (!enabled || !url.startsWith(OFFICIAL_RELEASE)) return [url]
  const name = url.slice(OFFICIAL_RELEASE.length)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return [url]
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
