import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createRouter, createMemoryHistory } from 'vue-router'
const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const routing = {exports:{}, require:id => id === 'vue-router' ? {createRouter,createWebHistory:createMemoryHistory} : {default:{render:()=>null}}}
vm.runInNewContext(compile(read('router.ts')),routing)
const router=routing.exports.default
for(const [input,expected] of [
 ['/android-updates?section=sync','/android-sync'],
 ['/android-updates?section=diagnostics','/android-diagnostics'],
 ['/android-updates?section=catalog','/android-updates'],
 ['/android-updates?section=update','/android-updates'],
 // Same route, query-only navigation must still redirect.
 ['/android-updates?section=sync','/android-sync'],
 ['/android-updates#device-sync','/android-sync'],
 ['/android-updates#diagnostics','/android-diagnostics'],
 ['/wrong/analysis/7','/wrong/analysis/7'],
 ['/mobile-settings','/mobile-settings'],
]) {await router.push(input);assert.equal(router.currentRoute.value.fullPath,expected)}
let saved
const api={exports:{},URL,FormData,require:id=>{
 if(id==='./content-remediation')return {ensureContentRemediation:async()=>{}}
 if(id==='./lan-sync')return {updateLanSyncSettings:async body=>{saved=body;return {configured:true}}}
 if(id==='./sync-scheduler')return {refreshSyncState:async()=>({})}
 // local-api 在每个请求边界触发一次空会话清扫并自行兜底失败。
 if(id==='./question-bank')return {sweepEmptyPaperSessions:async()=>{}}
 return {}
}}
vm.runInNewContext(compile(read('platform/android/local-api.ts')),api)
await api.exports.androidLocalApi('/android/lan-sync/settings',{method:'PUT',body:JSON.stringify({auto:false})})
assert.equal(saved.lan_sync_auto,'0')
assert.equal(Object.hasOwn(saved,'lan_sync_host'),false)
assert.equal(Object.hasOwn(saved,'lan_sync_passcode'),false)
await api.exports.androidLocalApi('/android/lan-sync/settings',{method:'PUT',body:JSON.stringify({host:'http://fixture.test',passcode:'fixture',auto:true})})
assert.equal(saved.lan_sync_host,'http://fixture.test');assert.equal(saved.lan_sync_passcode,'fixture');assert.equal(saved.lan_sync_auto,'1')
console.log('PASS real router legacy/query-only links and local API auto-only pairing preservation')
