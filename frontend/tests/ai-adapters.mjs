import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  ADAPTERS,
  DEFAULT_ADAPTER,
  SELECTABLE_ADAPTERS,
  KIRO_MODELS,
  adapterFor,
  normalizeAdapterId,
} from '../src/platform/android/ai-adapters.ts'

const secret = ['contract', 'secret', 'value'].join('-')
const messages = [
  { role: 'system', content: 'Be concise.' },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Describe this image.' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
    ],
  },
]
const options = { temperature: 0.2, maxTokens: 321, reasoningEffort: 'high' }

assert.equal(DEFAULT_ADAPTER, 'openai-chat')
assert.deepEqual(
  SELECTABLE_ADAPTERS.map(adapter => adapter.id),
  ['openai-chat', 'openai-responses', 'anthropic', 'google', 'kiro', 'command-code'],
)
assert.equal('kiro' in ADAPTERS, true)
assert.equal('command-code' in ADAPTERS, true)
assert.equal(normalizeAdapterId(undefined), 'openai-chat')
assert.equal(normalizeAdapterId('legacy-or-unknown'), 'openai-chat')
const [databaseSource, settingsSource, aiSource] = await Promise.all([
  readFile(new URL('../src/platform/android/database.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/SettingsView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/platform/android/ai.ts', import.meta.url), 'utf8'),
])
assert.ok(databaseSource.includes("adapter TEXT NOT NULL DEFAULT 'openai-chat'"))
assert.ok(databaseSource.includes("ensureColumn(db, 'ai_profiles', 'adapter'"))
assert.ok(settingsSource.includes('v-for="adapter in adapters"'))
assert.ok(aiSource.includes("VALUES (?, 'user', ?, ?, ?, ?)`"))

const chat = adapterFor('openai-chat')
assert.equal(chat.chatUrl('https://api.example.com/v1/', 'ignored'), 'https://api.example.com/v1/chat/completions')
assert.deepEqual(chat.headers(secret), { Authorization: `Bearer ${secret}` })
assert.deepEqual(chat.headers(''), {})
assert.equal(Object.values(chat.headers('')).includes(undefined), false)
const chatBody = chat.serialize('chat-model', messages, options)
assert.equal(chatBody.model, 'chat-model')
assert.equal(chatBody.reasoning_effort, 'high')
assert.equal('max_tokens' in chatBody, false)
assert.equal(chat.parseText({ choices: [{ message: { content: ' chat answer ' } }] }), 'chat answer')
assert.deepEqual(chat.modelEndpoints('http://localhost:11434/v1').map(item => item.url), [
  'http://localhost:11434/v1/models',
  'http://localhost:11434/api/tags',
])
assert.deepEqual(chat.parseModels({ data: [{ id: 'gpt-test', owned_by: 'openai' }] }), [
  { id: 'gpt-test', owned_by: 'openai' },
])
assert.deepEqual(chat.parseModels({ models: [{ name: 'qwen', details: { family: 'qwen' } }] }), [
  { id: 'qwen', owned_by: 'qwen' },
])

const responses = adapterFor('openai-responses')
assert.equal(responses.chatUrl('https://api.openai.com/v1', 'ignored'), 'https://api.openai.com/v1/responses')
const responsesBody = responses.serialize('response-model', messages, options)
assert.deepEqual(responsesBody.reasoning, { effort: 'high' })
assert.equal(responsesBody.max_output_tokens, 321)
assert.equal(responsesBody.input[1].content[1].type, 'input_image')
assert.equal(responses.parseText({ output_text: 'response answer' }), 'response answer')
assert.equal(responses.parseText({ output: [{ content: [{ type: 'output_text', text: 'nested answer' }] }] }), 'nested answer')
assert.deepEqual(responses.modelEndpoints('https://api.openai.com/v1'), [
  { url: 'https://api.openai.com/v1/models', source: 'openai-responses' },
])

const anthropic = adapterFor('anthropic')
assert.equal(anthropic.chatUrl('https://api.anthropic.com', 'ignored'), 'https://api.anthropic.com/v1/messages')
assert.equal(anthropic.chatUrl('https://proxy.example/v1/', 'ignored'), 'https://proxy.example/v1/messages')
assert.deepEqual(anthropic.headers(secret), { 'x-api-key': secret, 'anthropic-version': '2023-06-01' })
assert.deepEqual(anthropic.headers(''), { 'anthropic-version': '2023-06-01' })
assert.equal(Object.values(anthropic.headers('')).includes(undefined), false)
const anthropicBody = anthropic.serialize('claude-test', messages, options)
assert.equal(anthropicBody.system, 'Be concise.')
assert.equal(anthropicBody.max_tokens, 321)
assert.equal(anthropicBody.messages[0].content[1].source.media_type, 'image/png')
assert.equal('reasoning_effort' in anthropicBody, false)
assert.equal('reasoning' in anthropicBody, false)
assert.equal(anthropic.parseText({ content: [{ type: 'text', text: 'anthropic answer' }] }), 'anthropic answer')
assert.deepEqual(anthropic.parseModels({ data: [{ id: 'claude-test' }] }), [
  { id: 'claude-test', owned_by: 'anthropic' },
])

const google = adapterFor('google')
assert.equal(
  google.chatUrl('https://generativelanguage.googleapis.com/v1beta/', 'gemini 2.5'),
  'https://generativelanguage.googleapis.com/v1beta/models/gemini%202.5:generateContent',
)
assert.deepEqual(google.headers(secret), { 'x-goog-api-key': secret })
assert.deepEqual(google.headers(''), {})
assert.equal(Object.values(google.headers('')).includes(undefined), false)
const googleBody = google.serialize('gemini-test', messages, options)
assert.equal(googleBody.systemInstruction.parts[0].text, 'Be concise.')
assert.equal(googleBody.contents[0].parts[1].inlineData.mimeType, 'image/png')
assert.equal(googleBody.generationConfig.maxOutputTokens, 321)
assert.equal('reasoning_effort' in googleBody, false)
assert.equal('reasoning' in googleBody, false)
assert.equal(google.parseText({ candidates: [{ content: { parts: [{ text: 'google answer' }] } }] }), 'google answer')
assert.deepEqual(google.modelEndpoints('https://generativelanguage.googleapis.com/v1beta'), [
  { url: 'https://generativelanguage.googleapis.com/v1beta/models', source: 'google' },
])
assert.deepEqual(google.parseModels({ models: [{ name: 'models/gemini-test' }] }), [
  { id: 'gemini-test', owned_by: 'google' },
])

const commandCode = adapterFor('command-code')
assert.equal(commandCode.chatUrl('https://api.commandcode.ai/', 'ignored'), 'https://api.commandcode.ai/alpha/generate')
const commandHeaders = commandCode.headers(secret)
assert.equal(commandHeaders.Authorization, 'Bearer ' + secret)
assert.equal(commandHeaders['x-command-code-version'], '0.52.1')
assert.equal(Object.values(commandHeaders).includes(undefined), false)
const commandBody = commandCode.serialize('deepseek/deepseek-v4-flash', messages, options)
assert.equal(commandBody.params.stream, true)
assert.equal(commandBody.params.reasoning_effort, 'high')
assert.equal(commandBody.params.messages[0].content[1].type, 'image')
assert.equal(commandCode.parseText('{"type":"text-delta","text":"command "}\n{"type":"text-delta","text":"answer"}\n{"type":"finish"}'), 'command answer')
assert.deepEqual(commandCode.modelEndpoints('https://api.commandcode.ai'), [
  { url: 'https://api.commandcode.ai/provider/v1/models', source: 'command-code' },
])

const kiro = adapterFor('kiro')
assert.equal(kiro.chatUrl('https://runtime.us-east-1.kiro.dev/', 'ignored'), 'https://runtime.us-east-1.kiro.dev/')
assert.equal(kiro.headers(secret).tokentype, undefined)
assert.equal(kiro.headers('ksk_test').tokentype, 'API_KEY')
assert.equal(kiro.headers('ksk_test')['Content-Type'], 'application/x-amz-json-1.0')
assert.equal(Object.values(kiro.headers('')).includes(undefined), false)
const kiroBody = kiro.serialize('gpt-5.6-sol', messages, options)
assert.equal(kiroBody.conversationState.currentMessage.userInputMessage.modelId, 'gpt-5.6-sol')
assert.equal(kiroBody.conversationState.currentMessage.userInputMessage.images[0].format, 'png')
assert.deepEqual(kiroBody.additionalModelRequestFields, { reasoning: { effort: 'high' } })
assert.equal('additionalModelRequestFields' in kiro.serialize('kiro-auto', messages, options), false)
assert.equal(kiro.modelEndpoints('ignored').length, 0)
assert.equal(kiro.parseModels(null).length, KIRO_MODELS.length)

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()
function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}
function stringHeader(name, value) {
  const encoder = new TextEncoder()
  const nameBytes = encoder.encode(name)
  const valueBytes = encoder.encode(value)
  const bytes = new Uint8Array(1 + nameBytes.length + 1 + 2 + valueBytes.length)
  const view = new DataView(bytes.buffer)
  let offset = 0
  view.setUint8(offset++, nameBytes.length)
  bytes.set(nameBytes, offset); offset += nameBytes.length
  view.setUint8(offset++, 7)
  view.setUint16(offset, valueBytes.length, false); offset += 2
  bytes.set(valueBytes, offset)
  return bytes
}
function eventFrame(eventType, payload) {
  const encoder = new TextEncoder()
  const headers = [
    stringHeader(':message-type', 'event'),
    stringHeader(':event-type', eventType),
    stringHeader(':content-type', 'application/json'),
  ]
  const headerLength = headers.reduce((sum, item) => sum + item.length, 0)
  const body = encoder.encode(JSON.stringify(payload))
  const total = 16 + headerLength + body.length
  const frame = new Uint8Array(total)
  const view = new DataView(frame.buffer)
  view.setUint32(0, total, false)
  view.setUint32(4, headerLength, false)
  view.setUint32(8, crc32(frame.subarray(0, 8)), false)
  let offset = 12
  for (const header of headers) { frame.set(header, offset); offset += header.length }
  frame.set(body, offset)
  view.setUint32(total - 4, crc32(frame.subarray(0, total - 4)), false)
  return frame
}
const kiroFrame = eventFrame('assistantResponseEvent', { content: 'kiro answer' })
assert.equal(kiro.parseText(kiroFrame), 'kiro answer')
const corruptKiroFrame = kiroFrame.slice()
corruptKiroFrame[corruptKiroFrame.length - 5] ^= 1
assert.throws(() => kiro.parseText(corruptKiroFrame), /message CRC/)

for (const adapter of SELECTABLE_ADAPTERS) {
  assert.equal(adapter.supportsReasoningEffort, ['openai-chat', 'openai-responses', 'kiro', 'command-code'].includes(adapter.id))
  assert.equal(JSON.stringify(adapter.serialize('test', messages, options)).includes(secret), false)
}

console.log('AI adapter contracts verified without exposing credentials')
