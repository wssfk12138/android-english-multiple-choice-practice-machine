import { registerPlugin, type HttpOptions } from '@capacitor/core'
import { LocalApiError } from './errors'
import type { ResponseKind } from './ai-adapters'

type VocabularyRequest = HttpOptions & { totalTimeout: number }
type VocabularyResponse = { status: number; headers: Record<string, string>; body: string }
const transport = registerPlugin<{
  request(options: VocabularyRequest & { data: string }): Promise<VocabularyResponse>
}>('VocabularyHttp')

/** Only the durable vocabulary scheduler uses this bridge. No fallback or replay. */
export async function vocabularyNativeRequest(
  options: VocabularyRequest,
  kind: ResponseKind,
  observed: (status: number, headers: Record<string, string>) => void,
): Promise<unknown> {
  let response: VocabularyResponse
  try {
    response = await transport.request({ ...options, data: JSON.stringify(options.data) })
  } catch {
    // Native/transport exceptions can contain the URL or provider content. Never persist them.
    throw new LocalApiError(502, '词汇传输未确认完成，结果未知；未自动重发')
  }
  observed(response.status, response.headers)
  if (response.status < 200 || response.status >= 300) {
    throw new LocalApiError(502, '词汇请求失败：HTTP ' + response.status + '，未自动降级或重发', { httpStatus: response.status })
  }
  const binary = atob(response.body)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  if (kind === 'bytes') return bytes
  const text = new TextDecoder().decode(bytes)
  if (kind === 'text') return text
  try { return JSON.parse(text) }
  catch { throw new LocalApiError(502, '词汇响应不是完整 JSON，未自动重发') }
}
