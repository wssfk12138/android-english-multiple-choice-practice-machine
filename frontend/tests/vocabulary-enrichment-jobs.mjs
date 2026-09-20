import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'
const read=name=>readFileSync(new URL('../src/platform/android/'+name+'.ts',import.meta.url),'utf8')
const ast=ts.createSourceFile('db.ts',read('database'),ts.ScriptTarget.Latest,true)
const schema=ast.statements.flatMap(s=>ts.isVariableStatement(s)?[...s.declarationList.declarations]:[]).find(d=>d.name.getText(ast)==='SCHEMA').initializer.text
const db=new DatabaseSync(':memory:');db.exec(schema)
db.exec("INSERT INTO vocabulary_entries(id,term,normalized_term,translation_status,common_meaning,user_edited) VALUES(1,'went','went','ready','manual',1),(2,'go','go','ready','去',0)")
db.exec("INSERT INTO ai_profiles(id,name,base_url,enabled,default_model) VALUES(1,'Test','http://mock',1,'mock')")
const database={rows:async(sql,args=[])=>db.prepare(sql).all(...args),row:async(sql,args=[])=>db.prepare(sql).get(...args),run:async(sql,args=[])=>db.prepare(sql).run(...args)}
let calls=[];let fail=false;let onEnrich=null
class LocalApiError extends Error {constructor(status,message){super(message);this.status=status}}
const helper={exports:{}}
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/vocabulary-context.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,helper)
const context={exports:{},setTimeout,require:name=>({'./database':database,'./errors':{LocalApiError},'./ai':{enrichVocabularyEntry:async id=>{calls.push(id);await Promise.resolve();if(onEnrich)await onEnrich(id);if(fail)throw new LocalApiError(502,'offline')}}})[name]}
const settingsModule={exports:{},require:()=>database}
vm.runInNewContext(ts.transpileModule(read('app-settings'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,settingsModule)
const originalRequire=context.require
context.require=name=>name==='./app-settings'?settingsModule.exports:name==='../../vocabulary-context'?helper.exports:originalRequire(name)
const runnerCode=ts.transpileModule(read('vocabulary-enrichment-runner'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
vm.runInNewContext(runnerCode,context)
const api=context.exports
await api.queueVocabularyEnrichment(1);await api.queueVocabularyEnrichment(1)
assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_enrichment_jobs').get().n,1)
await Promise.all([api.startVocabularyEnrichmentWorker(),api.startVocabularyEnrichmentWorker()])
assert.deepEqual(calls,[1]);assert.equal(db.prepare('SELECT state FROM vocabulary_enrichment_jobs').get().state,'ready')
assert.equal(db.prepare('SELECT common_meaning FROM vocabulary_entries WHERE id=1').get().common_meaning,'manual')
fail=true;await api.queueVocabularyEnrichment(1);await api.queueVocabularyEnrichment(2)
await api.startVocabularyEnrichmentWorker()
assert.equal(calls.length,2);assert.equal(db.prepare('SELECT state FROM vocabulary_enrichment_jobs WHERE entry_id=2').get().state,'queued')
assert.equal(db.prepare('SELECT state FROM vocabulary_enrichment_jobs WHERE entry_id=1').get().state,'failed')
fail=false;await api.requestVocabularyEnrichment(1)
assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_enrichment_jobs WHERE state='ready'").get().n,2)
// Context arriving during an in-flight model request must get a fresh pass.
let changed=false;const initialCalls=calls.length
onEnrich=async id=>{if(!changed){changed=true;await api.queueVocabularyEnrichment(id,true);throw new LocalApiError(409,'context changed')}}
await api.queueVocabularyEnrichment(1);await api.startVocabularyEnrichmentWorker()
assert.equal(calls.length,initialCalls+2)
assert.equal(db.prepare('SELECT state FROM vocabulary_enrichment_jobs WHERE entry_id=1').get().state,'ready')
onEnrich=null
// One retry enrolls every failed request but does not create paid work for untouched entries.
db.exec("UPDATE vocabulary_enrichment_jobs SET state='failed'; INSERT INTO vocabulary_entries(id,term,normalized_term,translation_status) VALUES(3,'untouched','untouched','ready')")
const beforeBulk=calls.length
await api.retryPendingVocabularyEnrichments()
assert.equal(calls.length-beforeBulk,2)
assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_enrichment_jobs WHERE state='ready'").get().n,2)
assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_enrichment_jobs WHERE entry_id=3').get().n,0)
db.exec('DELETE FROM vocabulary_entries WHERE id=1')
assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_enrichment_jobs').get().n,1)
await api.pauseVocabularyEnrichment()
await api.inventoryVocabularyEnrichment()
const inventoried=db.prepare('SELECT count(*) n FROM vocabulary_enrichment_jobs').get().n
await api.startVocabularyEnrichmentWorker()
assert.equal((await api.vocabularyEnrichmentProgress()).paused,true)
await api.inventoryVocabularyEnrichment()
assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_enrichment_jobs').get().n,inventoried)
await api.resumeVocabularyEnrichment()
await api.startVocabularyEnrichmentWorker()
assert.equal((await api.vocabularyEnrichmentProgress()).queued,0)
// More than one batch, interrupted inventory, persistent pause and missing configuration.
settingsModule.exports.invalidateAppSettings();db.exec("DELETE FROM app_settings WHERE key='vocabulary-enrichment-v4'")
for(let id=10;id<461;id++) db.prepare("INSERT INTO vocabulary_entries(id,term,normalized_term,translation_status) VALUES(?,?,?,'ready')").run(id,'fixture'+id,'fixture'+id)
await api.queueMissingVocabularyEnrichment(200)
await api.pauseVocabularyEnrichment()
const restarted={exports:{},setTimeout,require:context.require};vm.runInNewContext(runnerCode,restarted)
await restarted.exports.inventoryVocabularyEnrichment()
assert.equal((await restarted.exports.vocabularyEnrichmentProgress()).queued,451)
const beforePaused=calls.length
await restarted.exports.startVocabularyEnrichmentWorker();assert.equal(calls.length,beforePaused)
db.exec('UPDATE ai_profiles SET enabled=0')
await restarted.exports.resumeVocabularyEnrichment();await restarted.exports.startVocabularyEnrichmentWorker()
assert.equal(calls.length,beforePaused);assert.equal((await api.vocabularyEnrichmentProgress()).waiting_configuration,true)
db.exec('UPDATE ai_profiles SET enabled=1')
await restarted.exports.startVocabularyEnrichmentWorker()
assert.equal(calls.length-beforePaused,451)
// Checked empty arrays do not re-enrol even when inventory is rerun.
settingsModule.exports.invalidateAppSettings();db.exec("DELETE FROM app_settings WHERE key='vocabulary-enrichment-v4'")
await restarted.exports.inventoryVocabularyEnrichment();assert.equal((await api.vocabularyEnrichmentProgress()).queued,0)
// Fully populated old word whose only defect is an unknown label.
db.prepare("INSERT INTO vocabulary_entries(id,term,normalized_term,translation_status,phonetic,part_of_speech,common_meaning,memory_hint,synonyms,antonyms,similar_forms,morphology,generated_example) VALUES(900,'word','word','ready','p','n','meaning','hint','[{}]','[{}]','[{}]',?,?)").run(JSON.stringify({lemma:'word',currentForm:'unrecognized-form',forms:[],note:''}),JSON.stringify({sentence:'This is a word.',translation:'这是一个词。'}))
settingsModule.exports.invalidateAppSettings();db.exec("DELETE FROM app_settings WHERE key='vocabulary-enrichment-v4'")
await api.inventoryVocabularyEnrichment();assert.equal(db.prepare('SELECT state FROM vocabulary_enrichment_jobs WHERE entry_id=900').get().state,'queued')
await api.startVocabularyEnrichmentWorker()
settingsModule.exports.invalidateAppSettings();db.exec("DELETE FROM app_settings WHERE key='vocabulary-enrichment-v4'")
await api.inventoryVocabularyEnrichment();assert.equal((await api.vocabularyEnrichmentProgress()).queued,0)
api.reportVocabularyEnrichmentError('temporary');assert.equal(api.vocabularyEnrichmentError,'temporary')
await api.startVocabularyEnrichmentWorker();assert.equal(api.vocabularyEnrichmentError,'')
db.close();console.log('PASS durable jobs, 451-word inventory, restart/pause/configuration, empty-result and unknown-label idempotency, bounded failures and retry')
