import assert from 'node:assert/strict'
import { selectResumableWrongSession } from '../src/platform/android/practice-session-resume.ts'

const candidates = [
  { id: 14, mode: 'wrong', unit_ids: '[96]', question_ids: '1,2,3', answered_rows: 2, updated_at: '2026-08-28 12:00:00' },
  { id: 15, mode: 'wrong', unit_ids: '[96]', question_ids: [3, 2, 1], answered_rows: 4, updated_at: '2026-08-28 11:00:00' },
  { id: 20, mode: 'wrong', unit_ids: '[96]', question_ids: [1, 2, 3], answered_rows: 4, updated_at: '2026-08-28 12:00:00' },
  { id: 21, mode: 'wrong_history', unit_ids: '[96]', question_ids: [1, 2, 3], answered_rows: 9, updated_at: '2026-08-28 13:00:00' },
  { id: 22, mode: 'wrong', unit_ids: '[96]', question_ids: [1, 2], answered_rows: 9, updated_at: '2026-08-28 13:00:00' },
]

assert.equal(selectResumableWrongSession(candidates, 'wrong', [96], [3, 1, 2])?.id, 20)
assert.equal(selectResumableWrongSession(candidates, 'wrong_history', [96], [1, 2, 3])?.id, 21)
assert.equal(selectResumableWrongSession(candidates, 'wrong', [96], [1, 2])?.id, 22)
assert.equal(selectResumableWrongSession(candidates, 'wrong', [96, 97], [1, 2, 3]), null)
assert.equal(selectResumableWrongSession(candidates, 'wrong', [96], [1, 2, 4]), null)

console.log('practice session resume tests passed')
