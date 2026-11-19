import assert from 'node:assert/strict'
import { openAndroidSyncFixture, seedAndroidSyncBank } from './fixtures/lan-sync-android-runtime.mjs'

const host = 'http://127.0.0.1:8766'
const settings = {
  lan_sync_host: host,
  lan_sync_passcode: 'synthetic',
  lan_sync_device_id: 'synthetic-android',
  lan_sync_pairing_requested: '1',
  ['lan_sync_categories_v1:' + host + ':selected']: JSON.stringify(['practice', 'vocabulary', 'wrong']),
}
const categories = ['practice', 'vocabulary', 'wrong']
let capability
const outgoing = []
const f = await openAndroidSyncFixture({ settings, async post({ url, data }) {
  if (url.endsWith('/handshake')) return { status: 200, data: {
    token: 'synthetic-token', tables: [], category_protocol: 1, host_categories: categories, effective_categories: categories,
    ...(capability === undefined ? {} : { partial_submission_version: capability }),
  } }
  if (url.endsWith('/pull')) return { status: 200, data: { changes: {}, tombstones: [], cursor: {}, tombstone_cursor: {} } }
  assert.ok(url.endsWith('/push'))
  outgoing.push(data)
  return { status: 200, data: { applied: {} } }
} })
try {
  const { sqlite } = f
  seedAndroidSyncBank(sqlite)
  sqlite.exec(`
    INSERT INTO practice_sessions(id, mode, paper_id, unit_ids, status, sync_id, updated_at) VALUES
      (1, 'paper', 1, '[10,11]', 'submitted', 'whole-blank', '2031-03-01'),
      (2, 'paper', 1, '[10,11]', 'active', 'unit-blank', '2031-03-01'),
      (3, 'paper', 1, '[10,11]', 'active', 'unit-complete', '2031-03-01'),
      (4, 'paper', 1, '[10,11]', 'submitted', 'whole-complete', '2031-03-01');
    INSERT INTO practice_answers(session_id, question_id, user_answer, is_correct, sync_id, updated_at) VALUES
      (1, 110, 'A', 1, 'answer-whole', '2031-03-01'), (1, 111, '', NULL, 'blank-whole', '2031-03-01'),
      (2, 110, 'A', 1, 'answer-unit', '2031-03-01'), (2, 111, '', NULL, 'blank-unit', '2031-03-01'),
      (3, 110, 'A', 1, 'answer-complete-1', '2031-03-01'), (3, 111, 'B', 0, 'answer-complete-2', '2031-03-01'),
      (3, 112, '', NULL, 'open-other-unit', '2031-03-01'), (4, 110, 'A', 1, 'answer-complete-3', '2031-03-01');
    INSERT INTO practice_unit_submissions(session_id, unit_id, score, max_score, sync_id, updated_at) VALUES
      (2, 10, 2, 4, 'unit-partial-result', '2031-03-01'), (3, 10, 2, 4, 'unit-full-result', '2031-03-01');
    INSERT INTO practice_answer_events(session_id, question_id, user_answer, sync_id, updated_at) VALUES
      (2, 110, 'A', 'event-withheld', '2031-03-01'), (3, 110, 'A', 'event-safe', '2031-03-01');
    INSERT INTO vocabulary_entries(term, normalized_term, updated_at) VALUES('sample', 'sample', '2031-03-01');
    INSERT INTO wrong_stats(question_id, wrong_count, attempt_count, updated_at) VALUES(111, 1, 1, '2031-03-01');
  `)
  const payload = category => outgoing.find(x => x.category === category)?.changes
  const keys = (data, table) => data[table].map(row => row.sync_id).sort()
  const { runLanSync } = f.load('./lan-sync')
  const old = await runLanSync()
  assert.match(old.warning, /留空交卷的记录保留在本机.*升级电脑端/)
  const practice = payload('practice')
  assert.deepEqual(keys(practice, 'practice_sessions'), ['unit-complete', 'whole-complete'])
  assert.deepEqual(keys(practice, 'practice_answers'), ['answer-complete-1', 'answer-complete-2', 'answer-complete-3', 'open-other-unit'])
  assert.deepEqual(keys(practice, 'practice_unit_submissions'), ['unit-full-result'])
  assert.deepEqual(keys(practice, 'practice_answer_events'), ['event-safe'])
  assert.equal(payload('vocabulary').vocabulary_entries[0].normalized_term, 'sample')
  assert.equal(payload('wrong').wrong_stats[0].question_id_key, 'q-2')
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM practice_answers WHERE is_correct IS NULL').get().n, 3)
  outgoing.length = 0
  capability = '1'
  assert.match((await runLanSync()).warning, /升级/)
  assert.deepEqual(keys(payload('practice'), 'practice_sessions'), [])
  outgoing.length = 0
  capability = 1
  const upgraded = await runLanSync()
  assert.equal(upgraded.warning, undefined)
  assert.deepEqual(keys(payload('practice'), 'practice_sessions'), ['unit-blank', 'unit-complete', 'whole-blank', 'whole-complete'])
  for (const id of ['blank-whole', 'blank-unit']) {
    const answer = payload('practice').practice_answers.find(row => row.sync_id === id)
    assert.equal(answer.user_answer, '')
    assert.equal(answer.is_correct, null)
  }
  outgoing.length = 0
  await runLanSync()
  assert.deepEqual(keys(payload('practice'), 'practice_sessions'), [], 'upgrade replay happens once')
  console.log('PASS whole and single-unit blank submissions withheld, safe categories sync, qualified peer resumes')
} finally {
  f.sqlite.close()
}
