import assert from 'node:assert/strict'
import { fixture, waitUntil, read, plain } from './helpers/vocabulary-request-fixture.mjs'

// A new accepted run arrives after the worker's empty claim, before it exits.
const f = fixture(); f.seed(1)
const store = f.load('platform/android/vocabulary-request-store')
const claim = store.claimVocabularyBatch
let release, drained = false, first = true
store.claimVocabularyBatch = async config => {
  const result = await claim(config)
  if (first && !result) {
    first = false; drained = true
    await new Promise(resolve => release = resolve)
  }
  return result
}
const runner = f.load('platform/android/vocabulary-request-runner')
const oldWorker = runner.startVocabularyRequestWorker()
await waitUntil(() => drained)
const accepted = await runner.requestVocabularyRun('translation', [1])
assert.equal(accepted.workerStarted, true)
release(); await oldWorker
await waitUntil(() => f.calls.length === 1)
await f.settle()
assert.equal(f.db.prepare('SELECT translation_status FROM vocabulary_entries').get().translation_status, 'ready', 'accepted work must not remain queued after the old worker exits')
assert.equal(f.calls.length, 1, 'wake-up must not duplicate transmission')
assert.equal((await store.vocabularyRequestStatus()).used, 1, 'wake-up never renews budget')
f.close()
const statusFixture = fixture(); statusFixture.seed(40)
const progressStore = statusFixture.load('platform/android/vocabulary-request-store')
const notice = statusFixture.load('services/vocabularyQueueStatus').translationQueueNotice
const config = await statusFixture.load('platform/android/vocabulary-request-config').vocabularyConfiguration()
const before = await progressStore.vocabularyRequestQueueState()
assert.equal(before.active, false); assert.equal(statusFixture.calls.length, 0)
await statusFixture.load('platform/android/vocabulary-request-runner').requestVocabularyRun('translation')
await statusFixture.settle()
const stopped = await progressStore.vocabularyRequestQueueState()
assert.equal(stopped.reason, 'budget'); assert.equal(stopped.active, false)
assert.equal(statusFixture.calls.length, 4)
assert.match(notice({ queued: 8, translating: 0, scheduler: stopped }), /4 次请求或 10 分钟/)
const apiSource = read('platform/android/local-api.ts')
const start = apiSource.indexOf("  if (pathname === '/vocabulary/translation-status'")
const end = apiSource.indexOf("  if (pathname === '/vocabulary/translation-runs'", start)
const api = statusFixture.evaluate('actual-translation-status', 'export async function status(){const pathname="/vocabulary/translation-status",method="GET";'+apiSource.slice(start,end)+'}').status
const reported = await api()
assert.equal(reported.queued, 8); assert.equal(reported.scheduler.reason, 'budget')
assert.equal(statusFixture.calls.length, 4, 'polling stopped queue never renews a run')
for (const reason of ['user','unknown','configuration','content_changed','validation','parse','truncated','save','http']) {
  statusFixture.db.prepare('UPDATE vocabulary_request_gate SET reason=?').run(reason)
  const snapshot = await progressStore.vocabularyRequestQueueState()
  assert.match(notice({ queued: 8, scheduler: snapshot }), /暂停|停止/)
}
statusFixture.db.exec("UPDATE vocabulary_request_gate SET reason='';DELETE FROM ai_profiles")
assert.match(notice({ queued: 8, scheduler: await progressStore.vocabularyRequestQueueState() }), /等待配置/)
assert.equal(notice({ queued: 8, translating: 1, scheduler: stopped }), '', 'real in-flight work takes priority over old stop reason')
assert.match(notice({ queued: 8, scheduler: { active: true, task: 'translation', reason: 'budget' } }), /准备/)
assert.match(notice({ queued: 8, scheduler: { active: true, task: 'enrichment' } }), /补缺/)
assert.equal(JSON.stringify(plain(reported)).includes('synthetic-key'), false)
statusFixture.close()
console.log('PASS translation queue: accepted work during worker shutdown is processed exactly once without renewing budget')
