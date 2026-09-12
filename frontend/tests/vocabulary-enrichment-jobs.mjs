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
const database={row:async(sql,args=[])=>db.prepare(sql).get(...args),run:async(sql,args=[])=>db.prepare(sql).run(...args)}
let calls=[];let fail=false;let onEnrich=null
class LocalApiError extends Error {constructor(status,message){super(message);this.status=status}}
const context={exports:{},require:name=>({'./database':database,'./errors':{LocalApiError},'./ai':{enrichVocabularyEntry:async id=>{calls.push(id);await Promise.resolve();if(onEnrich)await onEnrich(id);if(fail)throw new LocalApiError(502,'offline')}}})[name]}
vm.runInNewContext(ts.transpileModule(read('vocabulary-enrichment-runner'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
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
db.close();console.log('PASS durable jobs, deduplicated claims, manual protection, bounded failure, retry and deletion cascade')
