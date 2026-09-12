import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'
const read=p=>readFileSync(new URL('../src/'+p,import.meta.url),'utf8')
const compile=code=>ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const parsed=ts.createSourceFile('database.ts',read('platform/android/database.ts'),ts.ScriptTarget.Latest,true)
let schema
for(const s of parsed.statements) if(ts.isVariableStatement(s)) for(const d of s.declarationList.declarations) if(d.name.getText(parsed)==='SCHEMA') schema=d.initializer.text
const db=new DatabaseSync(':memory:');db.exec(schema)
db.exec('ALTER TABLE practice_sessions ADD COLUMN updated_at TEXT')
const database={row:async(sql,args=[])=>db.prepare(sql).get(...args),rows:async(sql,args=[])=>db.prepare(sql).all(...args)}
const title={exports:{}};vm.runInNewContext(compile(read('resume-title.ts')),title)
const mod={exports:{},require:name=>({'./database':database,'./question-bank-profiles':{activeQuestionBankProfileId:async()=>1},'../../resume-title':title.exports})[name]||{}}
vm.runInNewContext(compile(read('platform/android/study-todos.ts')),mod)
db.exec("INSERT INTO question_bank_profiles(id,name) VALUES(2,'Other'); INSERT INTO papers(id,profile_id,external_key,year,title) VALUES(1,1,'p1',2016,'2016年考研英语一真题'),(2,2,'p2',2016,'2016年考研英语二真题'); INSERT INTO units(id,paper_id,external_key,unit_type,title,sequence) VALUES(1,1,'u1','reading','2016 年 · 阅读理解 Text 1',1),(2,2,'u2','reading','Text 1',1); INSERT INTO practice_sessions(id,mode,unit_ids,started_at) VALUES(1,'paper','[1]','2026-01-01'),(2,'random','[2]','2099-01-01'),(3,'random','[999]','2099-01-02')")
let result=await mod.exports.resumablePracticeSession()
assert.equal(result.id,1);assert.equal(result.title,'2016 年 · 考研英语一真题')
assert.equal((await mod.exports.studyTodos()).resume_session.title,result.title)
db.exec("UPDATE practice_sessions SET mode='random' WHERE id=1")
result=await mod.exports.resumablePracticeSession()
assert.equal(result.title,'2016 年 · 考研英语一真题 · 阅读理解 Text 1')
assert.equal(result.title.match(/2016/g).length,1)
db.exec("UPDATE papers SET deleted_at='2026' WHERE id=1")
assert.equal(await mod.exports.resumablePracticeSession(),null)
db.close()
console.log('PASS production resume query: year once, paper/unit identity, cross-profile and deleted/orphan exclusion')
