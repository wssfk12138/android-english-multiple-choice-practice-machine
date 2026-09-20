import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import vm from 'node:vm'
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
const database={row:async(sql,args=[])=>db.prepare(sql).get(...args),rows:async(sql,args=[])=>db.prepare(sql).all(...args),run:async(sql,args=[])=>{const r=db.prepare(sql).run(...args);return {changes:r.changes,lastId:r.lastInsertRowid}},transaction:async op=>{db.exec('BEGIN IMMEDIATE');try{const result=await op(connection);db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}}
class LocalApiError extends Error {constructor(status,message){super(message);this.status=status}}
const mods={}
function load(name){if(mods[name])return mods[name];const context={exports:{},structuredClone,require:key=>({'./database':database,'./errors':{LocalApiError},'./question-bank-profiles':{activeQuestionBankProfileId:async()=>1},'./study-todos':{}})[key]||(key.startsWith('@')?{}:load(key.replace('./','')))};mods[name]=context.exports;vm.runInNewContext(compile(read(name)),context);return context.exports}
const practice=load('practice'),snapshots=load('practice-snapshots')
db.exec("INSERT INTO papers(id,profile_id,external_key,year,title) VALUES(1,1,'p',2016,'Exam');INSERT INTO units(id,paper_id,external_key,unit_type,title,sequence,passage) VALUES(1,1,'u','reading','Text',1,'Old passage');INSERT INTO questions(id,unit_id,external_key,number,answer,score,sequence,stem) VALUES(1,1,'q',1,'A',2,1,'Old stem');INSERT INTO options(question_id,stable_key,original_label,content,sequence) VALUES(1,'A','A','Old A',1),(1,'B','B','Old B',2)")
const session=await practice.createSession({mode:'paper',paper_id:1,shuffle_options:false})
await database.transaction(async()=>{await snapshots.captureSession(session.id,'rollback');throw new Error('rollback')}).catch(e=>assert.equal(e.message,'rollback'))
assert.equal(db.prepare('SELECT content_snapshot FROM practice_sessions').get().content_snapshot,'{}')
await snapshots.captureSession(session.id,'test')
const frozen=db.prepare('SELECT content_snapshot FROM practice_sessions').get().content_snapshot
db.exec("UPDATE units SET passage='New passage';UPDATE questions SET stem='New stem',answer='B',score=8;UPDATE options SET content='New option'")
await snapshots.captureSession(session.id,'later')
assert.equal(db.prepare('SELECT content_snapshot FROM practice_sessions').get().content_snapshot,frozen)
const old=await practice.getSession(session.id)
assert.equal(old.units[0].passage,'Old passage');assert.equal(old.units[0].questions[0].stem,'Old stem')
assert.equal(old.units[0].questions[0].options[0].content,'Old A');assert.equal(old.units[0].questions[0].answer,undefined)
assert.equal(old.content_choice_required,true)
await assert.rejects(practice.saveAnswer(session.id,1,{answer:'A',option_order:['A','B']}),/先选择/)
await assert.rejects(practice.submitSession(session.id),/先选择/)
await assert.rejects(practice.submitUnit(session.id,1),/先选择/)
await snapshots.chooseSnapshot(session.id,'continue')
assert.equal((await practice.getSession(session.id)).content_choice_required,false)
await practice.saveAnswer(session.id,1,{answer:'A',option_order:['A','B']})
const result=await practice.submitSession(session.id)
assert.equal(result.score,2);assert.equal(result.max_score,2);assert.equal(result.units[0].submission.score,2)
assert.equal(result.units[0].questions[0].answer,undefined)
assert.equal(db.prepare('SELECT COUNT(*) n FROM wrong_stats').get().n,0,'historical score must not update current statistics')
assert.equal(db.prepare('SELECT COUNT(*) n FROM wrong_current_questions').get().n,0,'historical score must not update current wrong queue')
const fresh=await practice.createSession({mode:'paper',paper_id:1,shuffle_options:false,force_new:true})
assert.equal(fresh.units[0].passage,'New passage')
await practice.saveAnswer(fresh.id,1,{answer:'B',option_order:['A','B']})
await snapshots.captureSession(fresh.id,'second')
db.exec("UPDATE units SET passage='Latest passage'")
const restarted=await snapshots.chooseSnapshot(fresh.id,'restart')
assert.notEqual(restarted.id,fresh.id)
assert.equal((await practice.getSession(fresh.id)).units[0].questions[0].user_answer,'B')
const current=await practice.getSession(restarted.id)
assert.equal(current.units[0].passage,'Latest passage')
assert.equal(current.units[0].questions[0].user_answer,'')
await assert.rejects(snapshots.chooseSnapshot(fresh.id,'restart'),/已结束/)
await assert.rejects(practice.submitSession(fresh.id),/已结束/)
assert.equal(db.prepare('SELECT COUNT(*) n FROM practice_sessions').get().n,3)
// Replaying a historical round must retain its old subset/order and grading.
db.exec('INSERT INTO wrong_retry_rounds(id,unit_id,session_id,round_number) VALUES(1,1,'+session.id+',1);INSERT INTO wrong_retry_round_questions(round_id,question_id,is_correct) VALUES(1,1,0)')
const retry=await practice.createSession({mode:'wrong_history',history_round_id:1,shuffle_options:true})
assert.equal(retry.content_choice_required,true)
assert.equal(retry.units[0].passage,'Old passage')
assert.equal(retry.units[0].questions.length,1)
assert.deepEqual(Array.from(retry.units[0].questions[0].option_order),['A','B'])
await snapshots.chooseSnapshot(retry.id,'continue')
await practice.saveAnswer(retry.id,1,{answer:'B',option_order:['A','B']})
const failed=await practice.submitSession(retry.id)
assert.equal(failed.score,0);assert.equal(failed.max_score,2)
assert.equal(db.prepare('SELECT COUNT(*) n FROM wrong_stats').get().n,0)
assert.equal(db.prepare('SELECT COUNT(*) n FROM wrong_current_questions').get().n,0)
assert.equal(db.prepare('SELECT COUNT(*) n FROM wrong_retry_rounds').get().n,1)
// A correct old-content retry must not clear a current wrong question.
db.exec('INSERT INTO wrong_current_questions(unit_id,question_id) VALUES(1,1)')
const retry2=await practice.createSession({mode:'wrong_history',history_round_id:1,shuffle_options:false})
await snapshots.chooseSnapshot(retry2.id,'continue')
await practice.saveAnswer(retry2.id,1,{answer:'A',option_order:['A','B']})
assert.equal((await practice.submitSession(retry2.id)).score,2)
assert.equal(db.prepare('SELECT COUNT(*) n FROM wrong_current_questions WHERE deleted_at IS NULL').get().n,1)

db.exec("UPDATE questions SET external_key='changed'")
await assert.rejects(practice.getSession(session.id),/映射/)
// Only package identity and root revision may drift; material and JSON types stay strict.
const originalSnapshot=JSON.parse(frozen)
const equivalent=structuredClone(originalSnapshot)
equivalent.revision='other-package-revision'
Object.assign(equivalent.units[0].payload.shared_data,{content_package_id:'other',content_version:'r3'})
assert.equal(snapshots.snapshotsEquivalent(originalSnapshot,equivalent),true)
for(const mutate of [
  s=>{s.units[0].payload.passage='Changed'},
  s=>{s.units[0].questions[0].answer='B'},
  s=>{s.units[0].questions[0].payload.score=3},
  s=>{s.units[0].questions[0].payload.score=true},
  s=>{s.units[0].questions[0].payload.option_order.reverse()},
  s=>{s.units[0].payload.shared_data.candidates=['new']},
]) {
  const changed=structuredClone(originalSnapshot)
  mutate(changed)
  assert.equal(snapshots.snapshotsEquivalent(originalSnapshot,changed),false)
}
db.close()
console.log('PASS actual Android SQLite snapshot: capture rollback, immutable content/order, old grading, fresh content, missing mapping rejects')
