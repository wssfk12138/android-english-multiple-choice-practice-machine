import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const code=ts.transpileModule(readFileSync(new URL('../src/platform/android/content-remediation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
for(const scenario of ['unchanged','new-digest','missing-revision','missing-header','changed-unit']) {
  let fetches=0
  const exports={}
  const row=async(sql,args)=>{
    if(sql.includes('app_migrations'))return args[0].startsWith('content-remediation-bundle:')?(scenario==='new-digest'?undefined:{}):(scenario==='missing-revision'?undefined:{})
    return {total:scenario==='changed-unit'&&sql.includes('json_extract')?0:1}
  }
  vm.runInNewContext(code,{exports,__CONTENT_REMEDIATION_HEADER__:scenario==='missing-header'?null:{revision:'r1',digest:'digest',units:[{unitKey:'one'}]},fetch:async()=>{fetches++;return {ok:false,status:404}},require:()=>({androidDatabase:async()=>{},row,isMigrationApplied:async marker=>Boolean(await row("SELECT 1 FROM app_migrations",[marker]))})})
  const [a,b]=await Promise.all([exports.ensureContentRemediation(),exports.ensureContentRemediation()])
  assert.equal(a,false);assert.equal(b,false)
  assert.equal(fetches,scenario==='unchanged'?0:1,scenario)
}
console.log('PASS unchanged bundle skips manifest; changed digest/revision/unit and missing header require one shared probe')
