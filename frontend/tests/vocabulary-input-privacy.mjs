import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, validWord } from './helpers/vocabulary-request-fixture.mjs'
const execution={beforeSend:async()=>{},response:()=>{},current:async()=>true,commit:async()=>{}}
test('translation sends only entryId/term/reliable sentence; local learning fields stay local',async()=>{
  const f=fixture();f.seed(1,'translating')
  f.db.exec("UPDATE vocabulary_entries SET encounter_count=88,review_stage=4,common_meaning='private definition'")
  f.db.exec("INSERT INTO vocabulary_occurrences(entry_id,surface_form,context_sentence) VALUES(1,'go','Go away.')")
  f.setResponse(ids=>({translations:ids.map(validWord)}))
  await f.load('platform/android/ai').translateVocabularyEntries([1],execution)
  const payload=JSON.parse(f.calls[0].messages[1].content)
  assert.deepEqual(Object.keys(payload.items[0]).sort(),['entryId','sentence','term'])
  assert.deepEqual(payload.items[0],{entryId:1,term:'go',sentence:''})
  assert.ok(!f.calls[0].messages[1].content.includes('private definition'))
  f.close()
})
test('enrichment keeps commonMeaning but excludes review/history and unsupported source sentences',async()=>{
  const f=fixture();f.seed(1,'ready');f.db.exec("UPDATE vocabulary_entries SET common_meaning='去',encounter_count=88,review_stage=4")
  f.db.exec("INSERT INTO vocabulary_occurrences(entry_id,surface_form,context_sentence) VALUES(1,'go','Go away.')")
  f.setResponse(()=>validWord(1))
  await f.load('platform/android/ai').enrichVocabularyEntry(1,execution)
  const payload=JSON.parse(f.calls[0].messages[1].content)
  assert.deepEqual(Object.keys(payload).sort(),['commonMeaning','entryId','sentence','term'])
  assert.equal(payload.commonMeaning,'去');assert.equal(payload.sentence,'')
  f.close()
})
