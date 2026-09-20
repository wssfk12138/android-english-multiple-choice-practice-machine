import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'
const read = name => readFileSync(new URL('../src/platform/android/'+name+'.ts', import.meta.url),'utf8')
const ast=ts.createSourceFile('database.ts',read('database'),ts.ScriptTarget.Latest,true)
const schema=ast.statements.flatMap(s=>ts.isVariableStatement(s)?[...s.declarationList.declarations]:[]).find(d=>d.name.getText(ast)==='SCHEMA').initializer.text
const db=new DatabaseSync(':memory:'); db.exec(schema)
const database={rows:async(sql,args=[])=>db.prepare(sql).all(...args),row:async(sql,args=[])=>db.prepare(sql).get(...args),run:async(sql,args=[])=>db.prepare(sql).run(...args)}
function load(name,deps){const context={exports:{},require:n=>{assert.ok(n in deps,n);return deps[n]}};vm.runInNewContext(ts.transpileModule(read(name),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports}
const contextProjection=load('../../vocabulary-context',{})
const vocab=load('vocabulary',{'./database':database,'./errors':{LocalApiError:Error},'./vocabulary-enrichment-runner':{queueVocabularyEnrichment:async()=>{}},'./study-todos':{},'./question-bank-profiles':{},'../../vocabulary-context':contextProjection})
for(let i=1;i<=250;i++)db.prepare('INSERT INTO vocabulary_entries(id,term,normalized_term,translation_status) VALUES (?,?,?,?)').run(i,'word'+i,'word'+i,i%2?'pending':'failed')
db.prepare("INSERT INTO vocabulary_entries(id,term,normalized_term,translation_status,user_edited,contextual_meaning) VALUES (251,'manual','manual','failed',1,'protected')").run()
const requested=[]
const worker=load('vocabulary-translation-runner',{'./vocabulary-enrichment-runner':{startVocabularyEnrichmentWorker:async()=>{}},'./database':database,'./vocabulary':vocab,'./ai':{translateVocabularyEntries:async ids=>{
 requested.push(...ids)
 await vocab.retryVocabulary(ids[0]); await vocab.queueTranslations(ids)
 for(const id of ids){assert.equal(db.prepare('SELECT translation_status FROM vocabulary_entries WHERE id=?').get(id).translation_status,'translating');db.prepare("UPDATE vocabulary_entries SET translation_status='ready' WHERE id=?").run(id)}
 return ids.length
}}})
await vocab.retryVocabulary(1)
await Promise.all([worker.startVocabularyTranslationWorker(),worker.startVocabularyTranslationWorker()])
assert.equal(requested.length,250);assert.equal(new Set(requested).size,250)
assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_entries WHERE translation_status='ready'").get().n,250)
assert.equal(db.prepare('SELECT contextual_meaning FROM vocabulary_entries WHERE id=251').get().contextual_meaning,'protected')
db.prepare("UPDATE vocabulary_entries SET translation_status='pending' WHERE id<251").run()
assert.equal((await vocab.queueTranslations(Array.from({length:250},(_,i)=>i+1))).queuedCount,250)
let failures=0
const failedWorker=load('vocabulary-translation-runner',{'./vocabulary-enrichment-runner':{startVocabularyEnrichmentWorker:async()=>{}},'./database':database,'./vocabulary':vocab,'./ai':{translateVocabularyEntries:async()=>{failures++;throw Error('offline')}}})
await failedWorker.startVocabularyTranslationWorker()
assert.equal(failures,1)
assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_entries WHERE translation_status IN ('queued','translating')").get().n,0)
db.close()
console.log('PASS 250-word retry, concurrent worker, no duplicate claims, manual protection, bounded provider failure')
