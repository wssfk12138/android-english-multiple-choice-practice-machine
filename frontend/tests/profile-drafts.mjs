import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const compile=name=>ts.transpileModule(readFileSync(new URL('../src/services/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const autosave={};vm.runInNewContext(compile('configAutosave'),{exports:autosave,structuredClone,setTimeout,clearTimeout})
const exports={},writes=[],persisted=new Map();let unblock,failVisibility=false
const put=async(path,value)=>{if(path.includes('/models')&&failVisibility)throw Error('offline');writes.push({path,value});if(writes.length===1)await new Promise(r=>unblock=r);if(value.is_default)for(const [id,p] of persisted)p.is_default=false;persisted.set(+path.split('/').at(-1),{...value})}
vm.runInNewContext(compile('profileDrafts'),{exports,window:{dispatchEvent(){}},CustomEvent:class{},require:id=>({'vue':{reactive:v=>v},'../api':{put},'../platform/model-keys':{baseIdentity:v=>new URL(v)},'./configAutosave':autosave,'./keyDrafts':{forgetKeyDraft(){}}})[id]})
const value=id=>({name:'p'+id,base_url:'https://test.invalid',is_default:true})
exports.preferDefaultProfile(1);exports.saveProfileDraft(1,value(1),true)
await new Promise(r=>setTimeout(r,0))
exports.preferDefaultProfile(2);exports.saveProfileDraft(1,{...value(1),is_default:false},true);exports.saveProfileDraft(2,value(2),true)
exports.preferDefaultProfile(1);exports.saveProfileDraft(2,{...value(2),is_default:false},true);exports.saveProfileDraft(1,value(1),true)
unblock();await Promise.all([exports.flushProfileDraft(1),exports.flushProfileDraft(2)])
assert.equal(persisted.get(1).is_default,true);assert.equal(persisted.get(2).is_default,false)
assert.equal(exports.profileHasDraft(1),false)
exports.forgetProfileDraft(1)
exports.saveProfileDraft(2,value(2),true)
await exports.flushProfileDraft(2)
assert.equal(persisted.get(2).is_default,true, "deleted preferred profile must not override the replacement default")
exports.profileDrafts[2]={models:[{model_id:'a',is_visible:true},{model_id:'b',is_visible:true}]}
failVisibility=true;await exports.saveModelVisibility(2,false,'a')
assert.match(exports.visibilitySaveStates[2].message,/失败/)
assert.equal(exports.profileDrafts[2].models[0].is_visible,true)
// A remounted page loads fresh model objects; the session-owned retry must update those.
exports.profileDrafts[2].models=[{model_id:'a',is_visible:true},{model_id:'b',is_visible:true}]
failVisibility=false;await exports.retryModelVisibility(2)
assert.equal(exports.profileDrafts[2].models[0].is_visible,false)
assert.equal(exports.profileDrafts[2].models[1].is_visible,true)
assert.match(exports.visibilitySaveStates[2].message,/已保存/)
await exports.saveModelVisibility(2,false)
assert.ok(exports.profileDrafts[2].models.every(m=>!m.is_visible))
exports.forgetProfileDraft(2);assert.equal(exports.visibilitySaveStates[2],undefined)
exports.profileDrafts[3]={models:[{model_id:'a',is_visible:true},{model_id:'b',is_visible:true}]}
let releaseVisibility
const held = exports.serializeProfileOperation(()=>new Promise(resolve=>{releaseVisibility=resolve}))
await new Promise(resolve=>setTimeout(resolve,0))
const firstVisibility=exports.saveModelVisibility(3,false,'a')
assert.equal(exports.intendedModelVisibility(3,exports.profileDrafts[3].models[0]),false)
await exports.saveModelVisibility(3,false,'b')
await exports.saveModelVisibility(3,true,'a')
releaseVisibility();await held;await firstVisibility
assert.equal(exports.profileDrafts[3].models[0].is_visible,true)
assert.equal(exports.profileDrafts[3].models[1].is_visible,false)
assert.equal(exports.visibilitySaveStates[3].busy,false)
exports.forgetProfileDraft(3)
console.log('PASS latest default intent and model visibility failure/reattach/retry/bulk cleanup')
