import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'
const read=p=>readFileSync(new URL('../src/'+p,import.meta.url),'utf8')
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const schemaAst=ts.createSourceFile('db.ts',read('platform/android/database.ts'),ts.ScriptTarget.Latest,true)
const schema=schemaAst.statements.flatMap(s=>ts.isVariableStatement(s)?[...s.declarationList.declarations]:[]).find(d=>d.name.getText(schemaAst)==='SCHEMA').initializer.text
const db=new DatabaseSync(':memory:');db.exec(schema)
// Runtime migration adds the LAN occurrence metadata to the base schema.
db.exec('ALTER TABLE vocabulary_occurrences ADD COLUMN sync_id TEXT; ALTER TABLE vocabulary_occurrences ADD COLUMN updated_at TEXT')
const ast=ts.createSourceFile('vocab.ts',read('platform/android/vocabulary.ts'),ts.ScriptTarget.Latest,true)
// The pool cache block grew with the 2026-09 performance repair: capture every
// module-level declaration that belongs to it (cache, version counters and the
// local similar-match result cache) instead of one fixed statement.
const cacheDecl=ast.statements.filter(s=>ts.isVariableStatement(s)&&/vocabularyTermPool(Cache|Version)|localSimilarCache/.test(s.getText(ast))).map(s=>s.getText(ast)).join('\n')
const funcs=ast.statements.filter(s=>ts.isFunctionDeclaration(s)&&['normalizeTerm','vocabularyKey','validateTerm','bumpVocabularyTermPool','addVocabulary'].includes(s.name?.text)).map(s=>s.getText(ast)).join('\n').replaceAll('\\n','\n')
const context={exports:{},LocalApiError:Error,row:async(sql,args=[])=>db.prepare(sql).get(...args),run:async(sql,args=[])=>{const r=db.prepare(sql).run(...args);return {...r,lastId:Number(r.lastInsertRowid)}},serializeEntry:async(id)=>db.prepare('SELECT * FROM vocabulary_entries WHERE id=?').get(id)}
vm.runInNewContext(compile(cacheDecl+'\n'+funcs),context)
db.exec("INSERT INTO vocabulary_entries(id,term,normalized_term,encounter_count,common_meaning) VALUES(1,'Claims','claim',4,'legacy manual')")
const original=context.exports.addVocabulary
const existing=await original({term:'claims'});assert.equal(existing.entry_id,1);assert.equal(existing.is_new,false)
const base=await original({term:'claim'});assert.notEqual(base.entry_id,1)
for(const term of ['claimed','claiming','went','go']) { const a=await original({term});const b=await original({term:term.toUpperCase()});assert.equal(a.entry_id,b.entry_id);assert.equal(a.is_new,true);assert.equal(b.is_new,false) }
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vocabulary_entries').get().n,6)
assert.equal(db.prepare('SELECT normalized_term FROM vocabulary_entries WHERE id=?').get(base.entry_id).normalized_term,'surface:v1:claim')
assert.equal(db.prepare('SELECT common_meaning FROM vocabulary_entries WHERE id=1').get().common_meaning,'legacy manual')
db.close();console.log('PASS distinct morphology identities, legacy-key collision, case-insensitive reuse and preserved manual data')
