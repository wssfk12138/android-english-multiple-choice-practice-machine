export type AdapterId = 'openai-chat' | 'openai-responses' | 'anthropic' | 'google' | 'kiro' | 'command-code'
export type ReasoningEffort = '' | 'low' | 'medium' | 'high'

export type ImagePart = { type: 'image_url'; image_url: { url: string } }
export type TextPart = { type: 'text'; text: string }
export type ChatContent = string | Array<TextPart | ImagePart>
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: ChatContent }
export type ModelInfo = { id: string; owned_by: string }
export type ModelEndpoint = { url: string; source: string }
export type ResponseKind = 'json' | 'text' | 'bytes'

export type ChatOptions = {
  temperature: number
  maxTokens?: number
  responseFormat?: Record<string, unknown>
  reasoningEffort?: ReasoningEffort
}

export type AdapterDefinition = {
  id: AdapterId
  label: string
  description: string
  baseUrlPlaceholder: string
  supportsReasoningEffort: boolean
  responseKind: ResponseKind
  chatUrl(baseUrl: string, model: string): string
  headers(apiKey: string): Record<string, string>
  serialize(model: string, messages: ChatMessage[], options: ChatOptions): Record<string, unknown>
  parseText(data: unknown): string
  modelEndpoints(baseUrl: string): ModelEndpoint[]
  parseModels(data: unknown): ModelInfo[] | null
}

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const cleanBase = (value: string) => value.trim().replace(/\/+$/, '')
const text = (value: unknown) => typeof value === 'string' ? value : ''

function contentText(content: ChatContent): string {
  return typeof content === 'string'
    ? content
    : content.filter((part): part is TextPart => part.type === 'text').map(part => part.text).join('\n')
}

function splitSystem(messages: ChatMessage[]) {
  return {
    system: messages.filter(message => message.role === 'system').map(message => contentText(message.content)).filter(Boolean).join('\n'),
    messages: messages.filter(message => message.role !== 'system'),
  }
}

function dataImage(value: string) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value)
  return match ? { mediaType: match[1], data: match[2] } : null
}

function requireText(value: string): string {
  if (!value.trim()) throw new Error('模型没有返回可显示的正文')
  return value.trim()
}

function openAiModels(data: unknown): ModelInfo[] | null {
  const root = object(data)
  const raw = Array.isArray(root?.data) ? root.data : Array.isArray(root?.models) ? root.models : null
  if (!raw) return null
  return raw.map(item => {
    const model = object(item)
    const details = object(model?.details)
    return {
      id: text(model?.id) || text(model?.name) || text(model?.model),
      owned_by: text(model?.owned_by) || text(details?.family),
    }
  }).filter(model => model.id.trim()).map(model => ({ ...model, id: model.id.trim() }))
}

function openAiModelEndpoints(baseUrl: string): ModelEndpoint[] {
  const base = cleanBase(baseUrl)
  const ollama = base.endsWith('/v1') ? `${base.slice(0, -3)}/api/tags` : `${base}/api/tags`
  return [{ url: `${base}/models`, source: 'openai-compatible' }, { url: ollama, source: 'ollama' }]
}

const openAiChat: AdapterDefinition = {
  id: 'openai-chat',
  label: 'OpenAI Chat 兼容',
  description: '适用于 OpenAI Chat、DeepSeek、Ollama 和多数兼容中转。',
  baseUrlPlaceholder: 'https://api.example.com/v1',
  supportsReasoningEffort: true,
  responseKind: 'json',
  chatUrl: baseUrl => `${cleanBase(baseUrl)}/chat/completions`,
  headers: apiKey => {
    const headers: Record<string, string> = {}
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    return headers
  },
  serialize: (model, messages, options) => ({
    model, messages, temperature: options.temperature,
    ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
    ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
  }),
  parseText: data => {
    const choice = object(array(object(data)?.choices)[0])
    return requireText(text(object(choice?.message)?.content))
  },
  modelEndpoints: openAiModelEndpoints,
  parseModels: openAiModels,
}

function responseContent(message: ChatMessage) {
  const output = message.role === 'assistant'
  if (typeof message.content === 'string') {
    return [{ type: output ? 'output_text' : 'input_text', text: message.content }]
  }
  return message.content.map(part => part.type === 'text'
    ? { type: output ? 'output_text' : 'input_text', text: part.text }
    : { type: 'input_image', image_url: part.image_url.url })
}

const openAiResponses: AdapterDefinition = {
  ...openAiChat,
  id: 'openai-responses',
  label: 'OpenAI Responses',
  description: '适用于 OpenAI Responses API 和兼容端点。',
  chatUrl: baseUrl => `${cleanBase(baseUrl)}/responses`,
  serialize: (model, messages, options) => ({
    model,
    input: messages.map(message => ({ role: message.role, content: responseContent(message) })),
    temperature: options.temperature,
    ...(options.maxTokens ? { max_output_tokens: options.maxTokens } : {}),
    ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
  }),
  parseText: data => {
    const root = object(data)
    if (text(root?.output_text)) return requireText(text(root?.output_text))
    const pieces: string[] = []
    for (const item of array(root?.output)) {
      for (const part of array(object(item)?.content)) {
        const value = object(part)
        if (value?.type === 'output_text' && text(value.text)) pieces.push(text(value.text))
      }
    }
    return requireText(pieces.join(''))
  },
  modelEndpoints: baseUrl => [{ url: `${cleanBase(baseUrl)}/models`, source: 'openai-responses' }],
}

const anthropic: AdapterDefinition = {
  id: 'anthropic',
  label: 'Anthropic Messages',
  description: '适用于 Claude Messages API；推理强度一期不映射。',
  baseUrlPlaceholder: 'https://api.anthropic.com',
  supportsReasoningEffort: false,
  responseKind: 'json',
  chatUrl: baseUrl => { const base = cleanBase(baseUrl); return `${base}${base.endsWith('/v1') ? '' : '/v1'}/messages` },
  headers: apiKey => ({ ...(apiKey ? { 'x-api-key': apiKey } : {}), 'anthropic-version': '2023-06-01' }),
  serialize: (model, messages, options) => {
    if (!Number.isSafeInteger(options.maxTokens) || Number(options.maxTokens) <= 0) {
      throw new Error('Anthropic Messages 协议要求明确的 max_tokens；当前未取得该模型可靠的输出容量，无法使用服务端默认上限。请改用支持省略上限的协议配置。')
    }
    const split = splitSystem(messages)
    return {
      model, ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}), temperature: options.temperature,
      ...(split.system ? { system: split.system } : {}),
      messages: split.messages.map(message => ({
        role: message.role,
        content: typeof message.content === 'string' ? message.content : message.content.map(part => {
          if (part.type === 'text') return { type: 'text', text: part.text }
          const image = dataImage(part.image_url.url)
          return image
            ? { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }
            : { type: 'text', text: '[不支持的图片格式]' }
        }),
      })),
    }
  },
  parseText: data => requireText(array(object(data)?.content).map(item => {
    const part = object(item)
    return part?.type === 'text' ? text(part.text) : ''
  }).join('')),
  modelEndpoints: baseUrl => { const base = cleanBase(baseUrl); return [{ url: `${base}${base.endsWith('/v1') ? '' : '/v1'}/models`, source: 'anthropic' }] },
  parseModels: data => {
    const root = object(data)
    if (!Array.isArray(root?.data)) return null
    return root.data.map(item => ({ id: text(object(item)?.id).trim(), owned_by: 'anthropic' })).filter(item => item.id)
  },
}

const google: AdapterDefinition = {
  id: 'google',
  label: 'Google Gemini',
  description: '适用于 Gemini generateContent；推理强度一期不映射。',
  baseUrlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta',
  supportsReasoningEffort: false,
  responseKind: 'json',
  chatUrl: (baseUrl, model) => { const base = cleanBase(baseUrl); return `${base}${base.endsWith('/v1beta') ? '' : '/v1beta'}/models/${encodeURIComponent(model)}:generateContent` },
  headers: apiKey => {
    const headers: Record<string, string> = {}
    if (apiKey) headers['x-goog-api-key'] = apiKey
    return headers
  },
  serialize: (_model, messages, options) => {
    const split = splitSystem(messages)
    return {
      ...(split.system ? { systemInstruction: { parts: [{ text: split.system }] } } : {}),
      contents: split.messages.map(message => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: typeof message.content === 'string' ? [{ text: message.content }] : message.content.map(part => {
          if (part.type === 'text') return { text: part.text }
          const image = dataImage(part.image_url.url)
          return image ? { inlineData: { mimeType: image.mediaType, data: image.data } } : { text: '[不支持的图片格式]' }
        }),
      })),
      generationConfig: { temperature: options.temperature, ...(options.maxTokens ? { maxOutputTokens: options.maxTokens } : {}) },
    }
  },
  parseText: data => {
    const candidate = object(array(object(data)?.candidates)[0])
    const content = object(candidate?.content)
    return requireText(array(content?.parts).map(item => text(object(item)?.text)).join(''))
  },
  modelEndpoints: baseUrl => { const base = cleanBase(baseUrl); return [{ url: `${base}${base.endsWith('/v1beta') ? '' : '/v1beta'}/models`, source: 'google' }] },
  parseModels: data => {
    const root = object(data)
    if (!Array.isArray(root?.models)) return null
    return root.models.map(item => ({ id: text(object(item)?.name).replace(/^models\//, '').trim(), owned_by: 'google' })).filter(item => item.id)
  },
}

function commandCodeModelsUrl(baseUrl: string) {
  const base = cleanBase(baseUrl)
  try { return new URL('/provider/v1/models', base + '/').toString() }
  catch { return base + '/provider/v1/models' }
}

export function parseCommandCodeText(value: unknown): string {
  const pieces: string[] = []
  let failure = ''
  for (const rawLine of (typeof value === 'string' ? value : '').split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^data:\s*/, '')
    if (!line) continue
    try {
      const event = object(JSON.parse(line))
      if (event?.type === 'text-delta' && text(event.text)) pieces.push(text(event.text))
      if (event?.type === 'error') failure = text(object(event.error)?.message) || text(event.message) || 'Command Code 返回错误'
      const reason = text(event?.rawFinishReason) || text(event?.finishReason)
      if ((event?.type === 'finish' || event?.type === 'finish-step') && reason === 'error') failure = 'Command Code 生成失败'
    } catch { /* Ignore keepalive and unknown non-JSON lines. */ }
  }
  if (failure) throw new Error(failure)
  return requireText(pieces.join(''))
}

const commandCode: AdapterDefinition = {
  id: 'command-code',
  label: 'Command Code',
  description: '适用于 Command Code /alpha/generate；响应为 NDJSON 流。',
  baseUrlPlaceholder: 'https://api.commandcode.ai',
  supportsReasoningEffort: true,
  responseKind: 'text',
  chatUrl: baseUrl => cleanBase(baseUrl) + '/alpha/generate',
  headers: apiKey => ({
    ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}),
    'User-Agent': 'cli',
    'x-command-code-version': '0.52.1',
    'x-cli-environment': 'production',
    'x-taste-learning': 'false',
    'x-co-flag': 'false',
    'x-session-id': crypto.randomUUID(),
  }),
  serialize: (model, messages, options) => {
    const split = splitSystem(messages)
    return {
      config: {}, memory: '', taste: null, skills: null,
      permissionMode: 'standard', mode: 'agent',
      params: {
        model,
        messages: split.messages.map(message => ({
          role: message.role,
          content: typeof message.content === 'string'
            ? [{ type: 'text', text: message.content }]
            : message.content.map(part => part.type === 'text'
              ? { type: 'text', text: part.text }
              : { type: 'image', image: part.image_url.url }),
        })),
        tools: [], system: split.system, ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        stream: true, temperature: options.temperature,
        ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
      },
    }
  },
  parseText: parseCommandCodeText,
  modelEndpoints: baseUrl => [{ url: commandCodeModelsUrl(baseUrl), source: 'command-code' }],
  parseModels: openAiModels,
}

export const KIRO_MODELS = [
  'kiro-auto', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
  'claude-sonnet-5', 'claude-opus-5', 'claude-opus-4.8', 'claude-opus-4.7',
  'claude-opus-4.6', 'claude-opus-4.5', 'claude-sonnet-4.6', 'claude-sonnet-4.5',
  'claude-sonnet-4.0', 'claude-haiku-4.5', 'deepseek-3.2', 'minimax-m2.5',
  'minimax-m2.1', 'glm-5', 'qwen3-coder-next',
] as const

function kiroPayload(model: string, messages: ChatMessage[], options: ChatOptions) {
  const split = splitSystem(messages)
  const turns = split.messages.map(message => ({ role: message.role, content: contentText(message.content), raw: message.content }))
  const currentIndex = turns.map(turn => turn.role).lastIndexOf('user')
  if (currentIndex < 0) throw new Error('Kiro 请求必须包含用户消息')
  const wireMessage = (turn: typeof turns[number]) => {
    const images = typeof turn.raw === 'string' ? [] : turn.raw.flatMap(part => {
      if (part.type !== 'image_url') return []
      const image = dataImage(part.image_url.url)
      return image ? [{ format: image.mediaType.split('/')[1] || 'png', source: { bytes: image.data } }] : []
    })
    return { content: turn.content, modelId: model, origin: 'KIRO_CLI', ...(images.length ? { images } : {}) }
  }
  const current = wireMessage(turns[currentIndex])
  if (split.system) current.content = split.system + '\n\n' + current.content
  const history = turns.slice(0, currentIndex).map(turn => turn.role === 'assistant'
    ? { assistantResponseMessage: { content: turn.content } }
    : { userInputMessage: wireMessage(turn) })
  const payload: Record<string, unknown> = {
    conversationState: {
      chatTriggerType: 'MANUAL', agentContinuationId: crypto.randomUUID(), agentTaskType: 'vibe',
      conversationId: crypto.randomUUID(), currentMessage: { userInputMessage: current },
      ...(history.length ? { history } : {}),
    },
  }
  if (options.reasoningEffort && (model === 'gpt-5.6-sol' || model === 'claude-opus-5')) {
    const field = model === 'gpt-5.6-sol' ? 'reasoning' : 'output_config'
    payload.additionalModelRequestFields = { [field]: { effort: options.reasoningEffort } }
  }
  return payload
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array) {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function eventHeaders(bytes: Uint8Array) {
  const result: Record<string, string> = {}
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  while (offset < bytes.length) {
    const nameLength = view.getUint8(offset++)
    const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength)); offset += nameLength
    const type = view.getUint8(offset++)
    if (type !== 7) throw new Error('Kiro event-stream 包含不受支持的头类型')
    const valueLength = view.getUint16(offset, false); offset += 2
    result[name] = new TextDecoder().decode(bytes.subarray(offset, offset + valueLength)); offset += valueLength
  }
  return result
}

export function parseKiroText(value: unknown): string {
  if (!(value instanceof Uint8Array)) throw new Error('Kiro 响应不是 event-stream 二进制数据')
  const pieces: string[] = []
  let offset = 0
  while (offset < value.length) {
    if (value.length - offset < 16) throw new Error('Kiro event-stream 帧不完整')
    const view = new DataView(value.buffer, value.byteOffset + offset, value.length - offset)
    const total = view.getUint32(0, false)
    const headersLength = view.getUint32(4, false)
    if (total < 16 || offset + total > value.length || headersLength > total - 16) throw new Error('Kiro event-stream 帧长度无效')
    const frame = value.subarray(offset, offset + total)
    if (crc32(frame.subarray(0, 8)) !== view.getUint32(8, false)) throw new Error('Kiro event-stream prelude CRC 校验失败')
    if (crc32(frame.subarray(0, total - 4)) !== view.getUint32(total - 4, false)) throw new Error('Kiro event-stream message CRC 校验失败')
    const headers = eventHeaders(frame.subarray(12, 12 + headersLength))
    const payloadText = new TextDecoder().decode(frame.subarray(12 + headersLength, total - 4))
    if (headers[':message-type'] === 'exception' || headers[':message-type'] === 'error') throw new Error('Kiro 上游返回协议错误')
    if (headers[':event-type'] === 'assistantResponseEvent') {
      try { pieces.push(text(object(JSON.parse(payloadText))?.content)) } catch { throw new Error('Kiro 正文事件不是有效 JSON') }
    }
    if (headers[':event-type'] === 'invalidStateEvent' || headers[':event-type'] === 'error') throw new Error('Kiro 会话状态无效')
    offset += total
  }
  return requireText(pieces.join(''))
}

const kiro: AdapterDefinition = {
  id: 'kiro', label: 'Kiro',
  description: '适用于 Kiro API Key（ksk_）；使用 CodeWhisperer event-stream 协议。',
  baseUrlPlaceholder: 'https://runtime.us-east-1.kiro.dev', supportsReasoningEffort: true,
  responseKind: 'bytes', chatUrl: baseUrl => cleanBase(baseUrl) + '/',
  headers: apiKey => ({
    ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}), Accept: '*/*',
    'Content-Type': 'application/x-amz-json-1.0',
    'x-amz-target': 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse',
    'x-amzn-codewhisperer-optout': 'true', 'amz-sdk-invocation-id': crypto.randomUUID(),
    ...(apiKey.startsWith('ksk_') ? { tokentype: 'API_KEY' } : {}),
  }),
  serialize: kiroPayload, parseText: parseKiroText, modelEndpoints: () => [],
  parseModels: () => KIRO_MODELS.map(id => ({ id, owned_by: 'kiro' })),
}

export const ADAPTERS: Readonly<Record<AdapterId, AdapterDefinition>> = {
  'openai-chat': openAiChat,
  'openai-responses': openAiResponses,
  anthropic,
  google,
  kiro,
  'command-code': commandCode,
}
export const SELECTABLE_ADAPTERS = Object.values(ADAPTERS)
export const DEFAULT_ADAPTER: AdapterId = 'openai-chat'

export function normalizeAdapterId(value: unknown): AdapterId {
  const id = String(value || DEFAULT_ADAPTER)
  return id in ADAPTERS ? id as AdapterId : DEFAULT_ADAPTER
}

export function adapterFor(value: unknown): AdapterDefinition {
  return ADAPTERS[normalizeAdapterId(value)]
}
