import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [database, ai, settings, assistant] = await Promise.all([
  readFile(new URL('../src/platform/android/database.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/platform/android/ai.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/SettingsView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AiAssistant.vue', import.meta.url), 'utf8'),
])

assert.ok(database.includes("reasoning_effort TEXT NOT NULL DEFAULT ''"))
assert.ok(database.includes("ensureColumn(db, 'ai_profiles', 'reasoning_effort'"))

assert.ok(ai.includes("type ReasoningEffort = '' | 'low' | 'medium' | 'high'"))
assert.ok(ai.includes('normalizeReasoningEffort(body.reasoning_effort)'))
assert.ok(ai.includes('adapter.supportsReasoningEffort ? reasoningEffort'))
assert.ok(ai.includes("throw new LocalApiError(400, '推理强度只支持未设置、低、中或高')"))
assert.ok(ai.includes('body.reasoning_effort == null'))

for (const value of ['', 'low', 'medium', 'high']) {
  assert.ok(settings.includes(`value="${value}"`))
}
assert.ok(settings.includes('v-model="profile.reasoning_effort"'))
assert.ok(assistant.includes('推理强度'))
assert.ok(assistant.includes('跟随配置'))
assert.ok(assistant.includes('...(reasoningEffort.value ? { reasoning_effort: reasoningEffort.value } : {})'))
assert.ok(assistant.includes("reasoningEffort.value = ''"))

console.log('AI reasoning-effort contract verified')
