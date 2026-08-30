import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const database = readFileSync(
  fileURLToPath(new URL('../src/platform/android/database.ts', import.meta.url)),
  'utf8',
)
const labeling = readFileSync(
  fileURLToPath(new URL('../src/platform/android/question-labeling.ts', import.meta.url)),
  'utf8',
)

assert.match(
  database,
  /question-label-auto-lock-v1[\s\S]*?UPDATE question_ai_labels[\s\S]*?SET locked = 1[\s\S]*?TRIM\(COALESCE\(primary_skill, ''\)\) <> ''[\s\S]*?TRIM\(COALESCE\(model_name, ''\)\) <> ''[\s\S]*?user_edited = 1/,
  'legacy non-empty or user-edited labels must be locked by a one-time migration',
)
assert.match(
  labeling,
  /VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, 1, 0, \?\)/,
  'new model labels must be inserted as locked',
)
assert.match(
  labeling,
  /confidence = excluded\.confidence,\s*locked = 1,\s*model_name = excluded\.model_name/,
  'explicitly unlocked labels must be relocked after a successful model rewrite',
)
assert.match(
  labeling,
  /WHERE question_ai_labels\.locked = 0/,
  'locked labels must remain protected from model overwrite',
)

console.log('Android question-label auto-lock contracts: OK')
