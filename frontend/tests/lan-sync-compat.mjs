import assert from 'node:assert/strict'
import { unreferencedRemoteSessionIds } from '../src/platform/android/lan-sync-compat.ts'

const changes = {
  practice_sessions: [
    { sync_id: 'empty-orphan' },
    { sync_id: 'with-answer' },
    { sync_id: 'with-event' },
    { sync_id: 'with-submission' },
    { sync_id: 'with-round' },
    { sync_id: '' },
  ],
  practice_answers: [{ session_id_key: 'with-answer' }],
  practice_answer_events: [{ session_id_key: 'with-event' }],
  practice_unit_submissions: [{ session_id_key: 'with-submission' }],
  wrong_retry_rounds: [{ session_id_key: 'with-round' }],
}

assert.deepEqual(
  [...unreferencedRemoteSessionIds(changes)],
  ['empty-orphan'],
  'only a session without any remote learning rows may enter empty-orphan compatibility handling',
)

console.log('Android LAN sync empty-orphan compatibility: OK')
