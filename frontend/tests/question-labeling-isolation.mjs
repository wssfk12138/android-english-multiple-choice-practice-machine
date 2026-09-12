import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [labeling, localApi, settings] = await Promise.all([
  readFile(new URL('../src/platform/android/question-labeling.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/platform/android/local-api.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/SettingsView.vue', import.meta.url), 'utf8'),
])

assert.ok(labeling.includes('question_bank_profile_id'))
assert.ok(labeling.includes("existing.status === 'paused' || existing.status === 'failed'"))
assert.ok(labeling.includes("u.unit_type <> 'listening'"))
assert.ok(labeling.includes('WHERE question_ai_labels.locked = 0'))
assert.ok(labeling.includes('export async function pauseLabelRun'))
assert.ok(labeling.includes('export async function failLabelRun'))

assert.ok(localApi.includes("pathname === '/ai/question-labels/next'"))
assert.ok(localApi.includes("await failLabelRun(String(body?.run_id || ''), error)"))
assert.ok(localApi.includes('pauseLabelRun(decodeURIComponent(params[1]))'))

assert.ok(settings.includes("await post(`/ai/question-labels/runs/${encodeURIComponent(runId)}/pause`, {})"))
assert.ok(settings.includes('while (labeling.value)'))

console.log('Question-labeling isolation contract verified')
