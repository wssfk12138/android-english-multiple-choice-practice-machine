import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'
const read = name => readFileSync(new URL('../src/platform/android/'+name+'.ts',import.meta.url),'utf8')
const ast = ts.createSourceFile('db.ts',read('database'),ts.ScriptTarget.Latest,true)
const schema = ast.statements.flatMap(s=>ts.isVariableStatement(s)?[...s.declarationList.declarations]:[]).find(d=>d.name.getText(ast)==='SCHEMA').initializer.text
const db = new DatabaseSync(':memory:'); db.exec(schema)
// Runtime adds LAN identity and sync bookkeeping columns after the base schema
// (database.ts migrations plus ensureSyncVersions). Mirrored here so a
// projection that trims columns is actually exercised.
db.exec(`ALTER TABLE vocabulary_entries ADD COLUMN sync_id TEXT;
  ALTER TABLE vocabulary_entries ADD COLUMN _sync_seq INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE vocabulary_entries ADD COLUMN _sync_rev INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE vocabulary_entries ADD COLUMN _sync_origin TEXT NOT NULL DEFAULT ''`)
for (const table of ['vocabulary_occurrences','vocabulary_reviews']) {
  db.exec(`ALTER TABLE ${table} ADD COLUMN sync_id TEXT;
    ALTER TABLE ${table} ADD COLUMN updated_at TEXT;
    ALTER TABLE ${table} ADD COLUMN _sync_seq INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ${table} ADD COLUMN _sync_rev INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ${table} ADD COLUMN _sync_origin TEXT NOT NULL DEFAULT ''`)
}
db.exec("INSERT INTO vocabulary_entries(id,term,normalized_term,translation_status) VALUES(1,'went','went','ready')")
db.exec("INSERT INTO vocabulary_occurrences(entry_id,surface_form,source_kind,context_sentence,year,unit_title,sync_id,created_at) VALUES(1,'went','passage','He went home yesterday.',2026,'Unit 1','occ-sync-1','2026-09-10')")
db.exec("UPDATE vocabulary_entries SET contextual_meaning='He went home.', contextual_occurrence_key='occ-sync-1' WHERE id=1")
let handleCalls=0
let transactionCalls=0
const setStatements=[]
const database = {
  row:async(sql,args=[])=>{handleCalls++;return db.prepare(sql).get(...args)},
  rows:async(sql,args=[])=>{handleCalls++;return db.prepare(sql).all(...args)},
  run:async(sql,args=[])=>{handleCalls++;return db.prepare(sql).run(...args)},
  // 评分把两条写语句合并成一次原生 executeSet：一次桥调用、一个原生事务。
  // 原生插件在 set 内不取 SELECT 结果（oneRowStatement 只走 executeInsert/
  // executeUpdateDelete），所以桩同样只按顺序执行语句、不读回执。
  executeSet:async(set,transaction=true,returnMode='no')=>{
    handleCalls++
    assert.equal(transaction,true,'评分写入必须由原生事务包住')
    assert.equal(returnMode,'no','executeSet 不得要求回执列')
    assert.equal(set.filter(item=>/^\s*SELECT/i.test(item.statement)).length,0,'executeSet 内不得读回执')
    db.exec('BEGIN IMMEDIATE')
    try{
      for(const item of set){setStatements.push(item.statement);db.prepare(item.statement).run(...(item.values||[]))}
      db.exec('COMMIT')
    }catch(error){db.exec('ROLLBACK');throw error}
  },
  // 其余模块仍可能走事务外壳；评分链路必须一次都不走。
  transaction:async op=>{
    transactionCalls++
    db.exec('BEGIN IMMEDIATE')
    const handle={
      query:async(sql,args=[])=>{handleCalls++;return {values:db.prepare(sql).all(...args)}},
      run:async(sql,args=[])=>{handleCalls++;db.prepare(sql).run(...args)},
    }
    try{const result=await op(handle);db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}},
}
class LocalApiError extends Error {constructor(status,message){super(message);this.status=status}}
function loadModule(source) {
  const module={exports:{},require:()=>({})}
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,module)
  return module.exports
}
const projection=loadModule(readFileSync(new URL('../src/vocabulary-context.ts',import.meta.url),'utf8'))
const studyTodos=loadModule(read('study-todos'))
let profileReads=0
const context={exports:{},require:name=>({'./database':database,'./errors':{LocalApiError},'../../vocabulary-context':projection,
  './study-todos':studyTodos,'./question-bank-profiles':{activeQuestionBankProfileId:async()=>{profileReads++;return 1}}})[name] || {}}
vm.runInNewContext(ts.transpileModule(read('vocabulary'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
const api=context.exports
const old=(await api.serializeEntry(1)).review_revision
const listed=await api.listVocabulary(new URLSearchParams('status=review'))
assert.equal(listed.items[0].review_revision,old)
db.exec("UPDATE vocabulary_entries SET common_meaning='meaning', memory_hint='large private detail' WHERE id=1")
const summary=await api.listVocabulary(new URLSearchParams('projection=summary&limit=101'))
assert.equal(summary.items[0].common_meaning,'meaning')
assert.equal(summary.items[0].memory_hint,undefined)
assert.equal(summary.items[0].review_revision,undefined)
assert.equal(summary.counts.total,1)
const complete=await api.listVocabulary(new URLSearchParams('projection=summary&limit=all'))
assert.equal(complete.items[0].memory_hint,'large private detail')
assert.equal(complete.items[0].review_revision,old)
db.exec(`SAVEPOINT summary_cases;
  INSERT INTO papers(id,external_key,year,title) VALUES(1,'fixture',2026,'Fixture');
  INSERT INTO units(id,paper_id,external_key,unit_type,title,sequence) VALUES(1,1,'unit','reading','Unit',1);
  INSERT INTO vocabulary_entries(id,term,normalized_term,contextual_meaning,encounter_count) VALUES
    (2,'valid','valid','Valid contextual meaning',4),
    (3,'stale','stale','Outdated contextual meaning',3),
    (4,'outside','outside','Other scope',2);
  INSERT INTO vocabulary_occurrences(entry_id,surface_form,source_kind,context_sentence,unit_id,created_at) VALUES
    (2,'valid','passage','This is valid.',1,'2026-09-01'),
    (3,'stale','passage','This is stale.',1,'2026-09-01');`)
const source=db.prepare('SELECT * FROM vocabulary_occurrences WHERE entry_id=2').get()
db.prepare('UPDATE vocabulary_entries SET contextual_occurrence_key=? WHERE id=2').run(projection.occurrenceKey(source))
db.prepare('UPDATE vocabulary_entries SET contextual_occurrence_key=? WHERE id=3').run('old-source')
const scoped=await api.listVocabulary(new URLSearchParams('projection=summary&scope=current&limit=1'))
assert.equal(profileReads,1,'list and counts share one captured active profile')
assert.equal(scoped.scope_key,'profile:1')
assert.equal(scoped.counts.total,2)
assert.equal(scoped.items.length,1)
assert.equal(scoped.items[0].id,2)
assert.equal(scoped.items[0].contextual_meaning,'Valid contextual meaning')
assert.equal(scoped.items[0].is_frequent,true)
const nextPage=await api.listVocabulary(new URLSearchParams('projection=summary&scope=current&limit=1&offset=1'))
assert.equal(nextPage.items[0].id,3)
assert.equal(nextPage.items[0].contextual_meaning,'','stale source must not appear as fallback meaning')
const search=await api.listVocabulary(new URLSearchParams('projection=summary&scope=current&search=valid'))
assert.deepEqual(Array.from(search.items,item=>item.id),[2])
db.exec('ROLLBACK TO summary_cases; RELEASE summary_cases')
const handlesBefore=handleCalls
const transactionsBefore=transactionCalls
const ack=await api.reviewVocabulary(1,'hard','scheduled',old)
// 评分跨两次桥调用：读状态（乐观并发校验）→ 一次 executeSet 写入。
// 旧的 transaction() 外壳还要额外付两次 isTransactionActive 与 BEGIN/COMMIT。
assert.equal(handleCalls-handlesBefore,2,'评分只允许读状态、一次 executeSet 两次桥调用')
assert.equal(transactionCalls-transactionsBefore,0,'评分不得再包 transaction() 外壳')
assert.deepEqual(setStatements.map(sql=>sql.trim().split(/\s+/)[0]),['UPDATE','INSERT'],'评分写入顺序：先改词条（顺位/到期）再记账')
assert.equal(ack.id,1)
assert.equal(ack.memory_hint,undefined,'评分回执不回传展开字段')
assert.equal(ack.synonyms,undefined)
assert.equal(ack.contextual_meaning,undefined)
const state=db.prepare('SELECT * FROM vocabulary_entries').get()
const setsBefore=setStatements.length
await assert.rejects(api.reviewVocabulary(1,'again','scheduled',old),error=>error.status===409)
assert.equal(setStatements.length,setsBefore,'409 必须在任何写入之前拒绝')
assert.deepEqual(db.prepare('SELECT * FROM vocabulary_entries').get(),state)
assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_reviews').get().n,1)
const fresh=(await api.serializeEntry(1)).review_revision
assert.notEqual(old,fresh)
assert.equal(ack.review_revision,fresh,'回执版本与随后读到的版本一致')
db.exec("CREATE TRIGGER reject_review BEFORE INSERT ON vocabulary_reviews BEGIN SELECT RAISE(ABORT,'ledger unavailable'); END;")
await assert.rejects(api.reviewVocabulary(1,'again','scheduled',fresh),/ledger unavailable/)
// executeSet 整组回滚：记账失败时词条更新与复习记录都不得留下。
assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_reviews').get().n,1,'记账失败后复习记录必须整组回滚')
assert.equal((await api.serializeEntry(1)).review_revision,fresh)
db.exec('DROP TRIGGER reject_review')
db.exec("UPDATE vocabulary_entries SET next_review_at='2030-01-01' WHERE id=1")
await assert.rejects(api.reviewVocabulary(1,'again','scheduled',fresh),error=>error.status===409)
assert.equal(db.prepare('SELECT next_review_at FROM vocabulary_entries').get().next_review_at,'2030-01-01')
db.exec("UPDATE vocabulary_entries SET review_stage=3 WHERE id=1")
const beforeRetry=(await api.serializeEntry(1)).review_revision
const command='0123456789abcdef0123456789abcdef'
const first=await api.reviewVocabulary(1,'again','scheduled',beforeRetry,command)
assert.equal(first.review_stage,0,'stage zero is preserved in acknowledgment')
assert.equal(first.review_revision,(await api.serializeEntry(1)).review_revision)
const writes=setStatements.length
await api.reviewVocabulary(1,'again','scheduled',beforeRetry,command)
assert.equal(setStatements.length,writes,'retry after lost acknowledgment must not write twice')
await assert.rejects(api.reviewVocabulary(1,'hard','scheduled',beforeRetry,command),e=>e.status===409)
await assert.rejects(api.reviewVocabulary(1,'again','scheduled',beforeRetry,'invalid'),e=>e.status===400)
db.close()
console.log('PASS review revision: stale submit, external change, ledger rollback')
