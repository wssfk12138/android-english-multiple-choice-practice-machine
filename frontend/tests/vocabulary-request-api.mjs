import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, read, plain } from './helpers/vocabulary-request-fixture.mjs'
function routes(f) {
  const source=read('platform/android/local-api.ts')
  const start=source.indexOf("  if (pathname === '/vocabulary/request-status'")
  const end=source.indexOf('  params = match(pathname',start)
  return f.evaluate('actual-local-api-clauses', 'export async function route(pathname:string,method:string,body:any){'+source.slice(start,end)+'}',{LocalApiError:class extends Error{constructor(status,message){super(message);this.status=status}}}).route
}
test('API validates task, ID array and command; state reads send nothing',async()=>{
  const f=fixture();f.seed(3,'failed');const route=routes(f)
  const before=await route('/vocabulary/request-status','GET')
  assert.equal(before.retryIds.translation.length,3);assert.equal(f.calls.length,0)
  for(const body of [{action:'retry',task:'wrong',entry_ids:[1],command_id:'valid-command-01'},{action:'retry',task:'translation',entry_ids:['1'],command_id:'valid-command-01'},{action:'retry',task:'translation',command_id:'valid-command-01'},{action:'continue',task:'translation'}])await assert.rejects(route('/vocabulary/request-runs','POST',body))
  assert.equal(f.calls.length,0)
  await route('/vocabulary/request-runs','POST',{action:'retry',task:'translation',entry_ids:[2],command_id:'valid-command-02'})
  await f.settle();assert.deepEqual(f.calls.map(call=>plain(call.ids)),[[2]])
  f.close()
})
test('current detail retry API uses only one word and never wakes enrichment',async()=>{
  const f=fixture();f.seed(3,'failed');f.seed(1,'ready',4)
  f.db.exec("INSERT INTO vocabulary_enrichment_jobs(entry_id,state) VALUES(4,'failed')")
  const source=read('platform/android/local-api.ts')
  const start=source.indexOf('    const id = Number(params[1])', source.indexOf("/^\\/vocabulary\\/(\\d+)\\/retry$/"))
  assert.ok(start>0)
  const end=source.indexOf('\n  }',start)
  const route=f.evaluate('actual-detail-retry', 'export async function route(){const params=[null,"2"];'+source.slice(start,end)+'}',{
    retryVocabulary:async id=>f.load('platform/android/vocabulary-request-runner').requestVocabularyRun('translation',[id],{explicit:true,retry:true}),notifyLocalChange:()=>{},
  }).route
  await route();await f.settle();assert.deepEqual(f.calls.map(call=>plain(call.ids)),[[2]])
  assert.equal(f.db.prepare('SELECT state FROM vocabulary_enrichment_jobs').get().state,'failed');f.close()
})
test('unknown handling requires explicit acknowledgement and does not start a request',async()=>{
  const f=fixture();f.db.exec("INSERT INTO vocabulary_request_attempts(id,task,state,ids,created_at) VALUES('old','translation','unknown','[1]',1);UPDATE vocabulary_request_gate SET reason='unknown'")
  const route=routes(f)
  await assert.rejects(route('/vocabulary/request-runs','POST',{action:'acknowledge',attempt_id:'old'}),/确认/)
  await route('/vocabulary/request-runs','POST',{action:'acknowledge',attempt_id:'old',confirmed:true})
  assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT state FROM vocabulary_request_attempts').get().state,'acknowledged')
  f.close()
})

test('original maintenance retry without entry_ids remains compatible and bounded to enrichment', async () => {
  const f = fixture(); f.seed(5, 'ready'); f.seed(1, 'failed', 10)
  for (let id = 1; id <= 5; id++) f.db.prepare("INSERT INTO vocabulary_enrichment_jobs(entry_id,state) VALUES(?,'failed')").run(id)
  f.setResponse(ids => ({ entryId: ids[0], lemma: 'go', phonetic: '', partOfSpeech: 'verb', commonMeaning: '去', memoryHint: '', synonyms: [], antonyms: [], similarForms: [],
    morphology: { lemma: 'go', currentForm: '原形', ambiguous: false, note: '', forms: [] }, generatedExample: { sentence: 'Go away.', translation: '走开。' } }))
  const source = read('platform/android/local-api.ts')
  const start = source.indexOf("  if (pathname === '/vocabulary/enrichment-runs'")
  const end = source.indexOf("  if (pathname === '/vocabulary/translation-status'", start)
  const route = f.evaluate('legacy-enrichment-route', 'export async function route(body:any){const pathname="/vocabulary/enrichment-runs",method="POST";'+source.slice(start,end)+'}', { LocalApiError: class extends Error {} }).route
  await route({ action: 'retry' }); await f.settle()
  assert.deepEqual(f.calls.map(call => plain(call.ids)), [[1],[2],[3],[4]])
  assert.ok(f.calls.every(call => call.task === 'enrichment'))
  assert.equal(f.db.prepare('SELECT translation_status FROM vocabulary_entries WHERE id=10').get().translation_status, 'failed')
  assert.equal(f.db.prepare('SELECT state FROM vocabulary_enrichment_jobs WHERE entry_id=5').get().state, 'queued')
  assert.equal((await f.load('platform/android/vocabulary-request-store').vocabularyRequestStatus()).reason, 'budget')
  f.close()
})
