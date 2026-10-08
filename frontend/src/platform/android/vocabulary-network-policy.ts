/** Vocabulary only. Host + protocol, never a profile name or model-name guess. */
export function vocabularyNetworkPolicy(baseUrl: string, adapter: string) {
  const host = new URL(baseUrl).hostname.toLowerCase()
  const fastResponses = ['fastaitoken.com', 'www.fastaitoken.com'].includes(host) && adapter === 'openai-responses'
  return { connectTimeout: 15000, readTimeout: fastResponses ? 180000 : 60000, totalTimeout: 240000 }
}
