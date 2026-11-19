// 留空交卷、错题投影与候选策略 v2 的行为回归（对应调查方案 F01/F03/F04/F05）。
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
db.exec("ALTER TABLE practice_sessions ADD COLUMN snapshot_accepted_revision TEXT NOT NULL DEFAULT ''; ALTER TABLE practice_sessions ADD COLUMN submission_request_id TEXT NOT NULL DEFAULT ''")
for(const table of ['wrong_retry_rounds','wrong_retry_round_questions']) {
  db.exec('ALTER TABLE '+table+' ADD COLUMN sync_id TEXT')
  db.exec('ALTER TABLE '+table+' ADD COLUMN updated_at TEXT')
}
db.exec(`CREATE TABLE IF NOT EXISTS sync_tombstones (
  table_name TEXT NOT NULL, object_key TEXT NOT NULL, profile_name TEXT NOT NULL DEFAULT '',
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (table_name, object_key, profile_name))`)
const connection={query:async(sql,args=[])=>({values:db.prepare(sql).all(...args)}),run:async(sql,args=[])=>{const r=db.prepare(sql).run(...args);return {changes:{changes:r.changes,lastId:r.lastInsertRowid}}}}
const database={row:async(sql,args=[])=>db.prepare(sql).get(...args),rows:async(sql,args=[])=>db.prepare(sql).all(...args),run:async(sql,args=[])=>{const r=db.prepare(sql).run(...args);return {changes:r.changes,lastId:r.lastInsertRowid}},dbExecutor:exec=>exec?{row:async(sql,args=[])=>(await exec.query(sql,args)).values?.[0]??null,rows:async(sql,args=[])=>(await exec.query(sql,args)).values||[],run:async(sql,args=[])=>exec.run(sql,args)}:{row:async(sql,args=[])=>db.prepare(sql).get(...args),rows:async(sql,args=[])=>db.prepare(sql).all(...args),run:async(sql,args=[])=>{const r=db.prepare(sql).run(...args);return {changes:r.changes,lastId:r.lastInsertRowid}}},transaction:async op=>{db.exec('BEGIN IMMEDIATE');try{const result=await op(connection);db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}}
class LocalApiError extends Error {constructor(status,message,detail){super(message);this.status=status;this.detail=detail}}
const incompleteSubmission=(unit,question)=>{throw new LocalApiError(409,`${unit.title}的第 ${question.number} 题还未作答`,{code:'incomplete_submission',unit_id:unit.id,unit_title:unit.title,question_id:question.id,question_number:question.number})}
const mods={}
function load(name){if(mods[name])return mods[name];const context={exports:{},structuredClone,require:key=>({'./database':database,'./errors':{LocalApiError,incompleteSubmission},'./question-bank-profiles':{activeQuestionBankProfileId:async()=>1},'./study-todos':{frequentQuestionIds:async()=>[],resumablePracticeSession:async()=>null,studyTodoCountColumns:'0 AS review_count',studyTodoCountValues:()=>[]}})[key]||(key.startsWith('@')?{}:load(key.replace('./','')))};mods[name]=context.exports;vm.runInNewContext(compile(read(name)),context);return context.exports}
const practice=load('practice')

db.exec(`INSERT INTO papers(id,profile_id,external_key,year,title) VALUES(1,1,'p',2016,'Exam')
;INSERT INTO units(id,paper_id,external_key,unit_type,title,sequence,passage) VALUES(1,1,'u1','reading','Listening Unit',1,'p')
;INSERT INTO units(id,paper_id,external_key,unit_type,title,sequence,passage) VALUES(2,1,'u2','reading','Reading Unit',2,'p')`)
for(const [unitId,base] of [[1,10],[2,20]]) {
  for(let index=0;index<3;index++) {
    db.exec(`INSERT INTO questions(id,unit_id,external_key,number,answer,score,sequence,stem) VALUES(${base+index},${unitId},'q${unitId}${index}',${index+1},'A',2,${index},'stem')`)
    for(const [label,seq] of [['A',1],['B',2]]) {
      db.exec(`INSERT INTO options(question_id,stable_key,original_label,content,sequence) VALUES(${base+index},'${label}','${label}','opt ${label}',${seq})`)
    }
  }
}

const answer=async(sessionId,questionId,answerText='A')=>{
  const order=db.prepare('SELECT stable_key FROM options WHERE question_id=? ORDER BY sequence').all(questionId).map(row=>row.stable_key)
  await practice.saveAnswer(sessionId,questionId,{answer:answerText,option_order:order})
}
const currentWrong=unitId=>new Set(db.prepare('SELECT question_id FROM wrong_current_questions WHERE unit_id=? AND deleted_at IS NULL').all(unitId).map(row=>row.question_id))
const stat=(questionId,field)=>Number(db.prepare(`SELECT ${field} AS v FROM wrong_stats WHERE question_id=?`).get(questionId)?.v || 0)
const create=options=>practice.createSession({shuffle_options:false,...options})

// F03：留空提交 —— 未答不判错、不进错题、不计统计；缺省保持严格拦截。
{
  const paper=await create({mode:'paper',paper_id:1})
  await answer(paper.id,20);await answer(paper.id,21);await answer(paper.id,22)
  await assert.rejects(()=>practice.submitSession(paper.id),error=>error.detail?.code==='incomplete_submission')
  const result=await practice.submitSession(paper.id,{allowUnanswered:true})
  assert.equal(result.status,'submitted')
  assert.equal(result.result_summary.answered_count,3)
  assert.equal(result.result_summary.unanswered_count,3)
  assert.equal(result.result_summary.completion_kind,'partial')
  assert.equal(result.score,6)
  assert.equal(result.max_score,12)
  const blankUnit=result.units.find(unit=>unit.id===1)
  assert.equal(blankUnit.submission.completion_kind,'unattempted')
  for(const question of blankUnit.questions) {
    assert.equal(question.unanswered,true)
    assert.equal(question.is_correct,undefined)
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM wrong_stats').get().n,3,'blank questions must not create stats')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM wrong_current_questions').get().n,0,'blank questions must not enter the wrong pool')
  // 全空
  const blank=await create({mode:'paper',paper_id:1,force_new:true})
  const blankResult=await practice.submitSession(blank.id,{allowUnanswered:true})
  assert.equal(blankResult.result_summary.completion_kind,'unattempted')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM practice_unit_submissions WHERE session_id=?').get(blank.id).n,0,'fully blank session creates no submission rows')
  console.log('PASS blank submission semantics')
}

// F04：整卷提交不得复活已单篇提交篇目的旧错题。
{
  const paper=await create({mode:'paper',paper_id:1,force_new:true})
  await answer(paper.id,10,'B');await answer(paper.id,11,'B');await answer(paper.id,12,'B')
  await practice.submitUnit(paper.id,1)
  assert.equal(currentWrong(1).size,3)
  const redo=await create({mode:'wrong'})
  for(const question of [10,11,12]) await answer(redo.id,question,'A')
  await practice.submitSession(redo.id)
  assert.equal(currentWrong(1).size,0)
  const readingAttemptsBefore=[20,21,22].map(question=>stat(question,'attempt_count'))
  for(const question of [20,21,22]) await answer(paper.id,question,'A')
  const result=await practice.submitSession(paper.id)
  assert.equal(currentWrong(1).size,0,'mastered wrong questions must not resurrect on paper submit')
  assert.equal(stat(10,'attempt_count'),2)
  // 整卷补交不得重复计听力已提交篇目的判定，阅读篇各新增一次判定。
  ;[20,21,22].forEach((question,index)=>{
    assert.equal(stat(question,'attempt_count'),readingAttemptsBefore[index]+1)
  })
  assert.equal(result.result_summary.question_count,6)
  console.log('PASS whole paper submit keeps mastered wrong questions mastered')
}

// F05：正式错题重做只更新本次实际作答的题。
{
  const paper=await create({mode:'paper',paper_id:1,force_new:true})
  for(const question of [20,21,22]) await answer(paper.id,question,'A')
  for(const question of [10,11,12]) await answer(paper.id,question,'B')
  await practice.submitSession(paper.id)
  assert.equal(currentWrong(1).size,3)
  const redo=await create({mode:'wrong',question_ids:[10]})
  await answer(redo.id,10,'A')
  const roundsBefore=db.prepare('SELECT COUNT(*) n FROM wrong_retry_rounds WHERE unit_id=1').get().n
  await practice.submitSession(redo.id)
  assert.deepEqual([...currentWrong(1)].sort(),[11,12],'unpracticed wrong questions must stay pending')
  const rounds=db.prepare('SELECT id FROM wrong_retry_rounds WHERE unit_id=1 ORDER BY id').all()
  assert.equal(rounds.length,roundsBefore+1)
  const latestRound=rounds[rounds.length-1]
  assert.deepEqual(db.prepare('SELECT question_id FROM wrong_retry_round_questions WHERE round_id=?').all(latestRound.id).map(row=>row.question_id),[10])
  console.log('PASS partial wrong redo keeps unpracticed questions')
}

// C15：重复提交返回已保存结果，不产生第二轮。
{
  const paper=await create({mode:'paper',paper_id:1,force_new:true})
  for(const question of [20,21,22]) await answer(paper.id,question,'A')
  for(const question of [10,11,12]) await answer(paper.id,question,'B')
  const first=await practice.submitSession(paper.id)
  const again=await practice.submitSession(paper.id)
  assert.equal(again.score,first.score)
  const roundsBefore=db.prepare('SELECT COUNT(*) n FROM wrong_retry_rounds').get().n
  const redo=await create({mode:'wrong',force_new:true})
  for(const question of [10,11,12]) await answer(redo.id,question,'A')
  await practice.submitSession(redo.id)
  await practice.submitSession(redo.id)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM wrong_retry_rounds').get().n,roundsBefore+1,'retry must not add another round')
  console.log('PASS repeated submit returns saved result')
}

// B1：策略 v2 共享候选整篇保留原标签与原顺序；v1 保持整组打乱+位置字母。
{
  db.exec(`INSERT INTO units(id,paper_id,external_key,unit_type,title,sequence,passage) VALUES(3,1,'u3','word_bank','Word Bank',3,'[A] w1 [B] w2 [C] w3')`)
  for(let index=0;index<2;index++) {
    const questionId=30+index
    db.exec(`INSERT INTO questions(id,unit_id,external_key,number,answer,score,sequence,stem) VALUES(${questionId},3,'wb${index}',${index+1},'B',2,${index},'stem')`)
    // 原标签 B/D/F/H/J 与位置字母 A-E 可区分，能同时验证“保标签”与“保顺序”。
    for(const [key,label,seq] of [['k1','B',1],['k2','D',2],['k3','F',3],['k4','H',4],['k5','J',5]]) {
      db.exec(`INSERT INTO options(question_id,stable_key,original_label,content,sequence) VALUES(${questionId},'${key}','${label}','word ${label}',${seq})`)
    }
  }
  const session=await create({mode:'unit',unit_ids:[3],shuffle_options:true})
  const unit=session.units[0]
  assert.equal(Number(db.prepare('SELECT candidate_policy_version v FROM practice_sessions WHERE id=?').get(session.id).v),2)
  const orders=unit.questions.map(question=>question.option_order.join(','))
  assert.equal(new Set(orders).size,1,'all questions share one candidate order')
  for(const question of unit.questions) {
    assert.deepEqual(question.option_order,['k1','k2','k3','k4','k5'])
    assert.deepEqual(question.options.map(option=>option.label),['B','D','F','H','J'])
  }
  // 旧会话（v1）：A 的既有行为是整组统一打乱一次、按展示位置重编字母。
  db.exec(`INSERT INTO practice_sessions(id,mode,paper_id,unit_ids,shuffle_options,candidate_policy_version,status,content_snapshot,content_revisions,snapshot_accepted_revision,started_at) VALUES(999,'unit',1,'[3]',1,1,'active','{}','{}','',CURRENT_TIMESTAMP)`)
  const legacyView=await practice.getSession(999)
  const legacyOrders=legacyView.units[0].questions.map(question=>question.option_order.join(','))
  assert.equal(new Set(legacyOrders).size,1,'v1 shared order stays unit-consistent')
  for(const question of legacyView.units[0].questions) {
    assert.deepEqual(question.options.map(option=>option.label),['A','B','C','D','E'],'v1 relabels by display position')
  }
  console.log('PASS candidate policy v2 preserves shared labels and order')
}

console.log('PASS practice submission semantics')
