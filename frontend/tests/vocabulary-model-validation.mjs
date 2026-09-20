import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'
const read = path => readFileSync(new URL('../src/'+path,import.meta.url),'utf8')
const compile = source => ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const schemaAst=ts.createSourceFile('db.ts',read('platform/android/database.ts'),ts.ScriptTarget.Latest,true)
const schema=schemaAst.statements.flatMap(s=>ts.isVariableStatement(s)?[...s.declarationList.declarations]:[]).find(d=>d.name.getText(schemaAst)==='SCHEMA').initializer.text
const db=new DatabaseSync(':memory:');db.exec(schema);db.exec("ALTER TABLE vocabulary_entries ADD COLUMN sync_id TEXT; ALTER TABLE vocabulary_occurrences ADD COLUMN sync_id TEXT; ALTER TABLE vocabulary_occurrences ADD COLUMN updated_at TEXT")
const helper={exports:{}};vm.runInNewContext(compile(read('vocabulary-context.ts')),helper)
const mergeContext={exports:{},require:()=>helper.exports};vm.runInNewContext(compile(read('platform/android/vocabulary-enrichment-fields.ts')),mergeContext)
const ast=ts.createSourceFile('ai.ts',read('platform/android/ai.ts'),ts.ScriptTarget.Latest,true)
const functions=ast.statements.filter(s=>ts.isFunctionDeclaration(s)&&['translateVocabularyEntries','enrichVocabularyEntry'].includes(s.name?.text)).map(s=>s.getText(ast)).join('\n')
let response;let duringRequest=()=>{};let enrichment=true;let messages
const context={exports:{},loadVocabularyEnrichment:()=>enrichment,...helper.exports,...mergeContext.exports,Set,LocalApiError:class extends Error{constructor(status,message){super(message);this.status=status}},
 row:async(sql,args=[])=>sql.includes('ai_profiles')?{id:1,default_model:'synthetic'}:db.prepare(sql).get(...args),
 rows:async(sql,args=[])=>db.prepare(sql).all(...args),run:async(sql,args=[])=>db.prepare(sql).run(...args),
 chatCompletion:async(_profile,_model,input)=>{messages=input;duringRequest();return JSON.stringify(response)},extractJsonObject:JSON.parse,discriminationList:()=>[]}
vm.runInNewContext(compile('const enrichingVocabulary=new Set<number>();\n'+functions),context)
const api=context.exports
function reset(){db.exec('DELETE FROM vocabulary_entries');db.prepare("INSERT INTO vocabulary_entries(id,term,normalized_term,translation_status) VALUES(1,'went','went','translating')").run();duringRequest=()=>{}}
const valid={entryId:1,phonetic:'/went/',partOfSpeech:'verb',memoryHint:'',synonyms:[],antonyms:[],similarForms:[],commonMeaning:'去',lemma:'go',morphology:{lemma:'go',currentForm:'过去式',ambiguous:false,note:'',forms:[{label:'原形',word:'go'}]},generatedExample:{sentence:'She went home after school.',translation:'她放学后回家了。'}}
reset();response={translations:[{entryId:1,commonMeaning:'去'},valid,valid,{...valid,entryId:2}]}
assert.equal(await api.translateVocabularyEntries([1]),1)
assert.equal(db.prepare('SELECT translation_status FROM vocabulary_entries').get().translation_status,'ready')
for(const bad of [{...valid,morphology:{...valid.morphology,forms:undefined}},{...valid,morphology:{...valid.morphology,ambiguous:undefined}},{...valid,morphology:{...valid.morphology,note:undefined}},{...valid,morphology:{...valid.morphology,forms:[{label:'',word:'go'}]}},{...valid,morphology:{}},{...valid,generatedExample:{sentence:'She went home after school.'}},{...valid,generatedExample:{sentence:'She stayed home after school.',translation:'她待在家里。'}}]){
 reset();response={translations:[bad]};assert.equal(await api.translateVocabularyEntries([1]),0)
}
reset();response={translations:[valid]};duringRequest=()=>db.exec("UPDATE vocabulary_entries SET common_meaning='new edit'")
assert.equal(await api.translateVocabularyEntries([1]),0)
assert.equal(db.prepare('SELECT common_meaning FROM vocabulary_entries').get().common_meaning,'new edit')
reset();db.exec("UPDATE vocabulary_entries SET user_edited=1, common_meaning='manual', translation_status='ready'");response=valid
await api.enrichVocabularyEntry(1)
assert.equal(db.prepare('SELECT common_meaning FROM vocabulary_entries').get().common_meaning,'manual')
reset();response=valid;duringRequest=()=>db.exec("UPDATE vocabulary_entries SET user_edited=1,common_meaning='same second edit'")
await assert.rejects(api.enrichVocabularyEntry(1),/词条已修改/)
assert.equal(db.prepare('SELECT morphology FROM vocabulary_entries').get().morphology,'{}')
reset();enrichment=false;response={translations:[valid]}
assert.equal(await api.translateVocabularyEntries([1]),1)
assert.equal(JSON.parse(messages[1].content).includeEnrichment,undefined)
assert.match(messages[0].content,/无论是否有真题原句/)
reset();db.prepare('UPDATE vocabulary_entries SET morphology=?,generated_example=?').run(JSON.stringify(valid.morphology),JSON.stringify(valid.generatedExample))
const stored=db.prepare('SELECT morphology,generated_example FROM vocabulary_entries').get()
response=valid
await api.enrichVocabularyEntry(1)
assert.equal(db.prepare('SELECT generated_example FROM vocabulary_entries').get().generated_example, stored.generated_example)
assert.match(db.prepare('SELECT morphology FROM vocabulary_entries').get().morphology,/rawCurrentForm/)
reset();response={translations:[{entryId:1,commonMeaning:'去'}]};duringRequest=()=>db.exec("UPDATE vocabulary_entries SET user_edited=1,common_meaning='manual during translation'")
assert.equal(await api.translateVocabularyEntries([1]),0)
assert.equal(db.prepare('SELECT common_meaning FROM vocabulary_entries').get().common_meaning,'manual during translation')
reset();enrichment=true;response={translations:[valid]};duringRequest=()=>{enrichment=false}
assert.equal(await api.translateVocabularyEntries([1]),1)
assert.equal(JSON.parse(messages[1].content).includeEnrichment,undefined)
assert.match(messages[0].content,/使用中文标签/)
db.close();console.log('PASS partial/duplicate/wrong-ID responses, missing morphology/example, exact term, same-second edits and manual enrichment')
