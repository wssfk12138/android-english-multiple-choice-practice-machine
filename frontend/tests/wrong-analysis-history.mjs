import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE units(id INTEGER PRIMARY KEY,paper_id INTEGER);CREATE TABLE papers(id INTEGER,profile_id INTEGER,deleted_at TEXT);CREATE TABLE question_bank_profiles(id INTEGER,deleted_at TEXT);
CREATE TABLE wrong_current_questions(unit_id INTEGER,deleted_at TEXT);CREATE TABLE wrong_retry_rounds(unit_id INTEGER,deleted_at TEXT);CREATE TABLE wrong_analysis_states(unit_id INTEGER,report_id INTEGER);
CREATE TABLE wrong_analysis_reports(id INTEGER PRIMARY KEY AUTOINCREMENT,scope_key TEXT,unit_ids TEXT,input_snapshot TEXT,scope_title TEXT,question_count INTEGER,aggregate_data TEXT,report TEXT,model_name TEXT,created_at TEXT);
CREATE TABLE trash_entries(id INTEGER,resource_id INTEGER,resource_type TEXT,metadata TEXT,restored_at TEXT,deleted_at TEXT);
INSERT INTO question_bank_profiles VALUES(1,NULL);INSERT INTO papers VALUES(1,1,NULL);INSERT INTO units VALUES(1,1),(2,1),(3,1);INSERT INTO wrong_current_questions VALUES(1,NULL),(2,NULL),(3,NULL);`)
const queryLog=[]
const rows=async(sql,args=[])=>{ queryLog.push(sql); return db.prepare(sql).all(...args) }
const connection={query:async(...args)=>({values:await rows(...args)}),run:async(sql,args=[])=>db.prepare(sql).run(...args)}
const exports={}
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/platform/android/wrong-analysis-history.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({rows})})
function report(id,members){db.prepare("INSERT INTO wrong_analysis_reports VALUES(?,?,?,?,?,2,?, ?,?,?)").run(id,'1,2',JSON.stringify(members),'{}','shared','{}','full durable report '+id,'offline','2026-09-16 00:00:00')}
report(1,[1,2]);report(2,[1,2]);db.exec('INSERT INTO wrong_analysis_states VALUES(1,2),(2,2)')
assert.equal((await exports.wrongAnalysisHistory(1)).length,2)
assert.ok(queryLog.some(sql=>sql.includes('SELECT id, unit_ids, scope_title, model_name, aggregate_data, created_at FROM wrong_analysis_reports')))
assert.ok(queryLog.some(sql=>sql.includes('SELECT id, scope_title, report, model_name, aggregate_data, created_at FROM wrong_analysis_reports WHERE id IN')))
assert.ok(!queryLog.some(sql=>sql === 'SELECT * FROM wrong_analysis_reports ORDER BY created_at DESC, id DESC'))
const one=await exports.archiveAnalysis(connection,1);db.exec('DELETE FROM wrong_analysis_states WHERE unit_id=1;DELETE FROM wrong_current_questions WHERE unit_id=1')
assert.equal((await exports.wrongAnalysisHistory(1)).length,0);assert.equal((await exports.wrongAnalysisHistory(2)).length,2)
const two=await exports.archiveAnalysis(connection,2);db.exec('DELETE FROM wrong_analysis_states WHERE unit_id=2;DELETE FROM wrong_current_questions WHERE unit_id=2')
assert.equal((await rows('SELECT * FROM wrong_analysis_reports')).length,0)
await exports.restoreAnalysis(connection,two);await exports.restoreAnalysis(connection,one);db.exec('INSERT INTO wrong_current_questions VALUES(1,NULL),(2,NULL)')
assert.equal((await exports.wrongAnalysisHistory(1)).length,2);assert.equal((await exports.wrongAnalysisHistory(2)).length,2)
report(3,[]);db.prepare("INSERT INTO trash_entries VALUES(1,3,'wrong_archive',?,NULL,'2026-09-16 00:00:00')").run(JSON.stringify({state:{unit_id:3,report_id:3}}))
report(4,[3]);db.exec("UPDATE wrong_analysis_reports SET created_at='2026-09-17 00:00:00' WHERE id=4");
await exports.reconcileArchivedAnalysis(connection);await exports.reconcileArchivedAnalysis(connection)
const metadata=JSON.parse((await rows('SELECT metadata FROM trash_entries'))[0].metadata);assert.equal(metadata.reports.length,1);assert.equal(metadata.reports[0].id,3)
assert.equal((await rows('SELECT * FROM wrong_analysis_reports WHERE id=3')).length,0)
await exports.restoreAnalysis(connection,metadata.reports);assert.equal((await exports.wrongAnalysisHistory(3)).length,2)
db.exec('DELETE FROM units WHERE id IN (1,3)');await exports.pruneAnalysis(connection)
assert.equal((await exports.wrongAnalysisHistory(2)).length,2);assert.equal((await rows('SELECT * FROM wrong_analysis_reports WHERE id=3')).length,0)
db.close();console.log('PASS offline history, shared batch archive/restore, idempotent legacy migration and orphan purge')
