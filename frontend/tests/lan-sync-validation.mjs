import assert from 'node:assert/strict'
import {
  validateLanSyncHandshakeResponse,
  validateLanSyncPullResponse,
  validateLanSyncPushResponse,
} from '../src/platform/android/lan-sync-validation.ts'

const tables = ['practice_sessions', 'vocabulary_entries']
const validPull = () => ({
  changes: { practice_sessions: [{ sync_id: 'session-1' }] },
  tombstones: [{ table_name: 'practice_sessions', object_key: 'old-session' }],
  cursor: { practice_sessions: { updated_at: '2026-08-31 10:00:00', rowid: 7 } },
  tombstone_cursor: { deleted_at: '2026-08-31 10:01:00', rowid: 3 },
})

assert.deepEqual(
  validateLanSyncHandshakeResponse({ token: 'short-lived', tables }, tables),
  { token: 'short-lived' },
)
assert.equal(validateLanSyncPullResponse(validPull(), tables).changes.practice_sessions.length, 1)
assert.deepEqual(
  validateLanSyncPushResponse({ applied: { practice_sessions: 1, _tombstones: 1 } }, tables),
  { practice_sessions: 1, _tombstones: 1 },
)

assert.throws(
  () => validateLanSyncPullResponse([], tables),
  /pull 必须是普通对象/,
)
assert.throws(
  () => validateLanSyncPullResponse({ ...validPull(), changes: { unknown_table: [] } }, tables),
  /不允许的表 unknown_table/,
)
assert.throws(
  () => validateLanSyncPullResponse({ ...validPull(), changes: { practice_sessions: {} } }, tables),
  /changes.practice_sessions 必须是数组/,
)
assert.throws(
  () => validateLanSyncPullResponse({
    ...validPull(),
    changes: { practice_sessions: Array.from({ length: 10_001 }, () => ({})) },
  }, tables),
  /总行数超过 10000/,
)
assert.throws(
  () => validateLanSyncPullResponse({ ...validPull(), tombstones: [null] }, tables),
  /tombstones\[0\] 必须是普通对象/,
)
assert.throws(
  () => validateLanSyncPullResponse({
    ...validPull(),
    cursor: { practice_sessions: [] },
  }, tables),
  /cursor.practice_sessions 必须是普通对象/,
)
assert.throws(
  () => validateLanSyncPullResponse({
    ...validPull(),
    tombstone_cursor: [],
  }, tables),
  /tombstone_cursor 必须是普通对象/,
)
assert.throws(
  () => validateLanSyncPullResponse({
    ...validPull(),
    changes: { practice_sessions: [{ payload: 'x'.repeat(16 * 1024 * 1024) }] },
  }, tables),
  /内容超过 16 MiB/,
)

const tooManyTables = Array.from({ length: 65 }, (_, index) => `table_${index}`)
assert.throws(
  () => validateLanSyncPullResponse({
    changes: Object.fromEntries(tooManyTables.map(table => [table, []])),
    tombstones: [],
    cursor: {},
    tombstone_cursor: {},
  }, tooManyTables),
  /表数量超过 64/,
)
assert.throws(
  () => validateLanSyncPushResponse({ applied: { unknown_table: 1 } }, tables),
  /不允许的表 unknown_table/,
)
for (const count of [-1, 1.5, Number.POSITIVE_INFINITY]) {
  assert.throws(
    () => validateLanSyncPushResponse({ applied: { practice_sessions: count } }, tables),
    /必须是非负安全整数/,
  )
}

console.log('Android LAN sync external response validation: OK')
