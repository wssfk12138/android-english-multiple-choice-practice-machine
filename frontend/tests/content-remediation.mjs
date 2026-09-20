import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import vm from 'node:vm'
import {webcrypto} from 'node:crypto'
import ts from 'typescript'
const read=p=>readFileSync(new URL('../src/platform/android/'+p+'.ts',import.meta.url),'utf8')
const compile=code=>ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const parsed=ts.createSourceFile('database.ts',read('database'),ts.ScriptTarget.Latest,true)
let schema
for(const s of parsed.statements) if(ts.isVariableStatement(s)) for(const d of s.declarationList.declarations) if(d.name.getText(parsed)==='SCHEMA') schema=d.initializer.text
const db=new DatabaseSync(':memory:');db.exec(schema)
for(const table of ['practice_sessions','practice_answers','practice_answer_events','practice_unit_submissions','wrong_stats','wrong_current_questions']) {
  db.exec('ALTER TABLE '+table+' ADD COLUMN updated_at TEXT')
  db.exec('ALTER TABLE '+table+' ADD COLUMN sync_id TEXT')
}
db.exec("ALTER TABLE practice_sessions ADD COLUMN content_revisions TEXT NOT NULL DEFAULT '{}'; ALTER TABLE practice_sessions ADD COLUMN content_snapshot TEXT NOT NULL DEFAULT '{}'; ALTER TABLE practice_sessions ADD COLUMN candidate_policy_version INTEGER NOT NULL DEFAULT 0; ALTER TABLE wrong_stats ADD COLUMN attempt_ledger TEXT")
db.exec("ALTER TABLE practice_sessions ADD COLUMN snapshot_accepted_revision TEXT NOT NULL DEFAULT ''")
const connection={query:async(sql,args=[])=>({values:db.prepare(sql).all(...args)}),run:async(sql,args=[])=>{const r=db.prepare(sql).run(...args);return {changes:{changes:r.changes,lastId:r.lastInsertRowid}}}}
const database={androidDatabase:async()=>({isTransactionActive:async()=>({result:db.isTransaction})}),row:async(sql,args=[])=>db.prepare(sql).get(...args),rows:async(sql,args=[])=>db.prepare(sql).all(...args),run:async(sql,args=[])=>{const r=db.prepare(sql).run(...args);return {changes:r.changes,lastId:r.lastInsertRowid}},transaction:async op=>{db.exec('BEGIN IMMEDIATE');try{const result=await op(connection);db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}}
class LocalApiError extends Error {constructor(status,message){super(message);this.status=status}}
const mods={}
function load(name){if(mods[name])return mods[name];const context={exports:{},structuredClone, TextEncoder, crypto: webcrypto, require:key=>({'./database':database,'./errors':{LocalApiError},'./question-bank-profiles':{activeQuestionBankProfileId:async()=>1},'./study-todos':{}})[key]||(key.startsWith('@')?{}:load(key.replace('./','')))};mods[name]=context.exports;vm.runInNewContext(compile(read(name)),context);return context.exports}

const migration=load('content-remediation'),practice=load('practice')
const manifest=JSON.parse(readFileSync(process.env.CONTENT_MANIFEST,'utf8'))
const stable=value=>JSON.parse(JSON.stringify(value))
for(const [i,change] of manifest.units.entries()) {
 const u=change.before,pid=i+1
 db.prepare('INSERT INTO papers(id,profile_id,external_key,year,title) VALUES(?,1,?,2016,?)').run(pid,'p'+pid,'Fixture '+pid)
 const shared=Object.fromEntries(Object.entries(u).filter(([k])=>k.startsWith('shared.')).map(([k,v])=>[k.slice(7),v]))
 db.prepare('INSERT INTO units(id,paper_id,external_key,unit_type,subtype,title,sequence,passage,shared_data) VALUES(?,?,?,?,?,?,?,?,?)').run(pid,pid,change.unitKey,u.unit_type,u.subtype,u.title,u.sequence,u.passage,JSON.stringify(shared))
 for(const q of u.questions) {
  const qid=db.prepare('INSERT INTO questions(unit_id,external_key,number,stem,question_type,answer,score,sequence,metadata) VALUES(?,?,?,?,?,?,?,?,?)').run(pid,q.key,q.number,q.stem,q.question_type,q.answer,q.score,q.sequence,JSON.stringify(q.metadata)).lastInsertRowid
  for(const o of q.options)db.prepare('INSERT INTO options(question_id,stable_key,original_label,content,sequence,metadata) VALUES(?,?,?,?,?,?)').run(qid,o.key,o.original_label,o.content,o.sequence,JSON.stringify(o.metadata))
 }
}
const old=await practice.createSession({mode:'paper',paper_id:1,shuffle_options:false})
const ids=()=>['units','questions','options'].map(t=>db.prepare('SELECT id FROM '+t+' ORDER BY id').all())
const beforeIds=ids()
const originalPassage=old.units[0].passage
// Conflict anywhere prevents writes/snapshot capture everywhere.
db.prepare("UPDATE units SET passage='User edit' WHERE id=60").run()
await assert.rejects(database.transaction(()=>migration.applyContent(manifest)),/未审查差异/)
assert.equal(db.prepare('SELECT content_snapshot FROM practice_sessions').get().content_snapshot,'{}')
db.prepare('UPDATE units SET passage=? WHERE id=60').run(manifest.units[59].before.passage)
// Simulated failure after earlier unit writes must roll back the entire operation.
db.exec("CREATE TRIGGER fail_write BEFORE UPDATE ON questions WHEN NEW.unit_id=60 BEGIN SELECT RAISE(ABORT,'disk test failure'); END")
await assert.rejects(database.transaction(()=>migration.applyContent(manifest)),/disk test failure/)
assert.equal(db.prepare('SELECT content_snapshot FROM practice_sessions').get().content_snapshot,'{}')
db.exec('DROP TRIGGER fail_write')
const result=await database.transaction(()=>migration.applyContent(manifest))
assert.equal(result.units,manifest.units.length);assert.equal(result.sessions,1)
assert.deepEqual(ids(),beforeIds)
assert.equal((await practice.getSession(old.id)).units[0].passage,originalPassage)
assert.equal((await practice.getSession(old.id)).content_choice_required,true)
const records=await migration.preflightContent(manifest)
assert.ok(records.every(r=>!r.needed && !r.conflicts.length))
assert.equal((await database.transaction(()=>migration.applyContent(manifest))).units,0)
assert.equal(db.prepare('SELECT COUNT(*) n FROM content_remediation_receipts').get().n,manifest.units.length)
assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
const receipts=db.prepare('SELECT unit_id,before_hash,after_hash FROM content_remediation_receipts ORDER BY unit_id').all()
console.log(JSON.stringify({units:result.units,sessions:result.sessions,conflictRollback:true,writeFailureRollback:true,idempotent:true,receipts}))

// A second revision must retain the original historical snapshot byte-for-byte.
if (process.env.CONTENT_MANIFEST_R2) {
 const next=JSON.parse(readFileSync(process.env.CONTENT_MANIFEST_R2,'utf8'))
 const saved=db.prepare('SELECT content_snapshot FROM practice_sessions').get().content_snapshot
 const updated=await database.transaction(()=>migration.applyContent(next))
 assert.equal(updated.units,manifest.units.length)
 assert.equal(db.prepare('SELECT content_snapshot FROM practice_sessions').get().content_snapshot,saved)
 assert.ok((await migration.preflightContent(next)).every(r=>!r.needed && !r.conflicts.length))
 const invalid=structuredClone(next);invalid.units[0].reviewedBefore=[{...invalid.units[0].before,questions:[]}]
 assert.throws(()=>migration.validateContentManifest(invalid),/题目无效/)
 console.log(JSON.stringify({r1ToR2:true,immutableSnapshots:true,units:updated.units}))
}
