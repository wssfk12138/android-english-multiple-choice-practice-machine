import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const library = await readFile(new URL('../src/views/LibraryView.vue', import.meta.url), 'utf8')
const practice = await readFile(new URL('../src/platform/android/practice.ts', import.meta.url), 'utf8')
const questionBank = await readFile(new URL('../src/platform/android/question-bank.ts', import.meta.url), 'utf8')

for (const contract of [
  'async function restartPaper', 'force_new: true', 'paper.active_session_id',
  "paper.active_session_id ? '继续练习' : '开始整卷'", '重新开始',
  'paper.active_done', 'paper.unit_count', 'paper.last_score', 'paper.last_max_score',
]) assert.ok(library.includes(contract), `LibraryView contract missing: ${contract}`)

for (const contract of [
  "status = 'abandoned'", "status = 'active' AND mode = 'paper'",
  'resumed: true', 'progress:', 'answered:', 'total:',
]) assert.ok(practice.includes(contract), `Practice contract missing: ${contract}`)

for (const contract of [
  'deletedMatches.length > 1', 'reusingDeleted', 'deleted_at = NULL',
  "resource_type = 'paper'",
]) assert.ok(questionBank.includes(contract), `Stable re-import contract missing: ${contract}`)

console.log('PASS paper resume and stable ESQ re-import contracts')
