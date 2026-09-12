import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'
const read = name => readFileSync(new URL('../src/platform/android/'+name+'.ts',import.meta.url),'utf8')
const ast = ts.createSourceFile('db.ts',read('database'),ts.ScriptTarget.Latest,true)
const schema = ast.statements.flatMap(s=>ts.isVariableStatement(s)?[...s.declarationList.declarations]:[]).find(d=>d.name.getText(ast)==='SCHEMA').initializer.text
const db = new DatabaseSync(':memory:'); db.exec(schema)
// Runtime adds LAN identity columns after the base schema.
db.exec('ALTER TABLE vocabulary_reviews ADD COLUMN sync_id TEXT; ALTER TABLE vocabulary_reviews ADD COLUMN updated_at TEXT')
db.exec("INSERT INTO vocabulary_entries(id,term,normalized_term,translation_status) VALUES(1,'went','went','ready')")
const database = {
  row:async(sql,args=[])=>db.prepare(sql).get(...args),
  rows:async(sql,args=[])=>db.prepare(sql).all(...args),
  run:async(sql,args=[])=>db.prepare(sql).run(...args),
  transaction:async op=>{db.exec('BEGIN IMMEDIATE');try{const result=await op();db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}},
}
class LocalApiError extends Error {constructor(status,message){super(message);this.status=status}}
const context={exports:{},require:name=>({'./database':database,'./errors':{LocalApiError},'../../vocabulary-context':{projectVocabulary:(entry,occurrences)=>({...entry,occurrences})}})[name] || {}}
vm.runInNewContext(ts.transpileModule(read('vocabulary'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
const api=context.exports
const old=(await api.serializeEntry(1)).review_revision
const listed=await api.listVocabulary(new URLSearchParams('status=review'))
assert.equal(listed.items[0].review_revision,old)
await api.reviewVocabulary(1,'hard','scheduled',old)
const state=db.prepare('SELECT * FROM vocabulary_entries').get()
await assert.rejects(api.reviewVocabulary(1,'again','scheduled',old),error=>error.status===409)
assert.deepEqual(db.prepare('SELECT * FROM vocabulary_entries').get(),state)
assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_reviews').get().n,1)
const fresh=(await api.serializeEntry(1)).review_revision
assert.notEqual(old,fresh)
db.exec("CREATE TRIGGER reject_review BEFORE INSERT ON vocabulary_reviews BEGIN SELECT RAISE(ABORT,'ledger unavailable'); END;")
await assert.rejects(api.reviewVocabulary(1,'again','scheduled',fresh),/ledger unavailable/)
assert.equal((await api.serializeEntry(1)).review_revision,fresh)
db.exec('DROP TRIGGER reject_review')
db.exec("UPDATE vocabulary_entries SET next_review_at='2030-01-01' WHERE id=1")
await assert.rejects(api.reviewVocabulary(1,'again','scheduled',fresh),error=>error.status===409)
assert.equal(db.prepare('SELECT next_review_at FROM vocabulary_entries').get().next_review_at,'2030-01-01')
db.close()
console.log('PASS review revision: stale submit, external change, ledger rollback')
