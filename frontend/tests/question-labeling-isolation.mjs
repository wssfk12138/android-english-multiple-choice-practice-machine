import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [labeling, localApi, labelingService] = await Promise.all([
  readFile(new URL('../src/platform/android/question-labeling.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/platform/android/local-api.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/questionLabeling.ts', import.meta.url), 'utf8'),
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

// 2026-09-12 起：智能标注唯一入口在导入题库（ImportView 的智能标注中心），
// 运行循环与暂停调用收敛在 services/questionLabeling.ts；模型设置页不再包含标注工作区。
assert.match(labelingService, /post\([\s\S]*?question-labels\/runs\/[\s\S]*?encodeURIComponent\(questionLabelingState.runId\)[\s\S]*?\/pause/)
assert.ok(labelingService.includes('while (questionLabelingState.isRunning'))

const settings = await readFile(new URL('../src/views/SettingsView.vue', import.meta.url), 'utf8')
assert.ok(!settings.includes('question-labels'), '模型设置页不应包含智能标注入口')

console.log('Question-labeling isolation contract verified')
