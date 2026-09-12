export class JsonResponseError extends Error {
  code: string

  constructor(message: string, code = 'REMOTE_JSON_SCHEMA') {
    super(message)
    this.name = 'JsonResponseError'
    this.code = code
  }
}

export function decodeJsonResponse(data: unknown, label: string, maxBytes = 2 * 1024 * 1024): unknown {
  const encoded = typeof data === 'string' ? data : JSON.stringify(data)
  if (typeof encoded !== 'string') throw new JsonResponseError(label + '格式不受支持')
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) {
    throw new JsonResponseError(label + '超过响应大小上限', 'REMOTE_JSON_SIZE')
  }
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data)
  } catch {
    throw new JsonResponseError(label + '不是有效 JSON', 'REMOTE_JSON_SYNTAX')
  }
}

export function remoteRequestFailure(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : String((cause as { message?: unknown })?.message || '')
  if (/timeout|timed out/i.test(message)) {
    throw new JsonResponseError('远程请求超时，请稍后重试', 'REMOTE_TIMEOUT')
  }
  throw new JsonResponseError('无法连接远程服务，请检查网络后重试', 'REMOTE_NETWORK')
}
