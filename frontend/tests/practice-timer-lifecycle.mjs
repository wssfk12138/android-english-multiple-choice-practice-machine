import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import * as timer from '../src/services/practiceTimer.ts'
const source = readFileSync(new URL('../src/views/PracticeView.vue',import.meta.url),'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
const exports = 'timerState,timerNow,timerNotice,timerSaveError,timerReady,session,listeningPlayer,load,startTimedPractice,startWithoutTimer,pauseTimer,resumeTimer,flushVocabularyOnVisibilityChange,flushVocabularyOnPageHide,registerTimerLifecycle,confirmSessionSubmission,confirmCurrentUnitSubmission'
const code = ts.transpileModule(source + '\nexport {'+exports+'}', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const deferred = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject} }
const settle = async () => { for(let i=0;i<8;i++) await new Promise(r=>setImmediate(r)); await vue.nextTick() }
function fixture() {
  const state={now:0,failSave:false,reads:[],posts:[],removed:0}
  const storage=new Map();const native=new Map();const hooks={};const events={};const scope=vue.effectScope()
  const route=vue.reactive({params:{id:'1'}})
  const session=id=>({id:Number(id),mode:'custom',status:'active',units:[{id:1,unit_type:'reading',questions:[]}]})
  const api={get:async path=>session(path.split('/').at(-1)),post:async path=>path.endsWith('submit')?session(1):{},put:async()=>{}}
  const router={afterEach:fn=>{hooks.after=fn;return ()=>{}},replace:async path=>{route.params.id=path.split('/').at(-1)}}
  const win={addEventListener:(n,fn)=>events[n]=fn,removeEventListener:n=>delete events[n],setInterval:fn=>{hooks.tick=fn;return 1},clearInterval:()=>{},setTimeout:()=>0,scrollTo:()=>{}}
  const doc={visibilityState:'visible',documentElement:{dataset:{platform:'android'},scrollTop:0},activeElement:null,addEventListener:win.addEventListener,removeEventListener:win.removeEventListener}
  const nativeState=deferred()
  const app={addListener:async(n,fn)=>{native.set(n,fn);return {remove:async()=>{native.delete(n);state.removed++}}},getState:()=>nativeState.promise}
  const context={exports:{},performance:{now:()=>state.now},window:win,document:doc,console,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{if(state.failSave)throw Error('full');storage.set(k,v)},removeItem:k=>storage.delete(k)},
    require:name=>name==='vue'?{...vue,onMounted:fn=>hooks.mount=fn,onBeforeUnmount:fn=>hooks.unmount=fn}
      :name==='vue-router'?{useRoute:()=>route,useRouter:()=>router,onBeforeRouteLeave:fn=>hooks.leave=fn,onBeforeRouteUpdate:fn=>hooks.update=fn}
      :name==='@capacitor/app'?{App:app}:name.endsWith('/practiceTimer')?timer
      :name==='../api'?{get:async(...args)=>{state.reads.push(args[0]);return api.get(...args)},post:async(...args)=>{state.posts.push({path:args[0],timer:storage.get('linjian-practice-timer-1')});return api.post(...args)},put:api.put}:{} }
  scope.run(()=>vm.runInNewContext(code,context))
  return {a:context.exports,state,storage,native,hooks,route,api,doc,events,nativeState,session,
    async mount(){hooks.mount();await settle();nativeState.resolve({isActive:true});await settle()},close(){hooks.unmount?.();scope.stop()}}
}
test('production lifecycle settles before queueing; dual foreground signals and duplicate events',async()=>{
  const f=fixture();await f.mount();const a=f.a;const audio=[];a.listeningPlayer.value={pause:flag=>audio.push(flag)}
  a.startTimedPractice();f.state.now=600000;f.doc.visibilityState='hidden';a.flushVocabularyOnVisibilityChange();await settle()
  assert.equal(JSON.parse(f.state.posts.at(-1).timer).elapsedMs,600000)
  f.native.get('pause')();f.native.get('appStateChange')({isActive:false});a.flushVocabularyOnPageHide()
  f.state.now+=86400000;f.doc.visibilityState='visible';a.flushVocabularyOnVisibilityChange();assert.equal(a.timerState.value.mode,'paused')
  f.native.get('resume')();assert.equal(a.timerState.value.mode,'running')
  f.state.now+=300000;f.hooks.tick();assert.equal(a.timerState.value.elapsedMs,900000);assert.ok(audio.every(flag=>flag===false))
  a.pauseTimer();f.native.get('pause')();f.native.get('resume')();assert.equal(a.timerState.value.pauseReason,'manual');f.close()
})
test('unknown native state, stale initial query, registration finishing after unmount',async()=>{
  const f=fixture();f.hooks.mount();await settle();f.a.startTimedPractice();assert.equal(f.a.timerState.value.mode,'paused')
  f.native.get('pause')();f.nativeState.resolve({isActive:true});await settle();assert.equal(f.a.timerState.value.mode,'paused')
  f.close();await settle();assert.equal(f.native.size,0)
  const g=fixture();g.hooks.mount();g.close();g.nativeState.resolve({isActive:true});await settle();assert.equal(g.native.size,0)
})
test('old load cannot replace a new route session; canceled route restores only automatic pause',async()=>{
  const f=fixture();await f.mount();f.a.startTimedPractice();f.state.now=1000
  await f.hooks.leave();assert.equal(f.a.timerState.value.mode,'paused');f.hooks.after(null,null,Error('cancelled'));assert.equal(f.a.timerState.value.mode,'running')
  const old=deferred();f.api.get=path=>path.endsWith('/1')?old.promise:Promise.resolve(f.session(2))
  const pending=f.a.load();await f.hooks.update();f.route.params.id='2';await settle();old.resolve(f.session(1));await pending
  assert.equal(f.a.session.value.id,2);assert.equal(f.a.timerState.value,null);f.close()
})
test('submit freezes accumulated time, foreground-gated failure and success, unit submit continues',async()=>{
  const f=fixture();await f.mount();f.a.startTimedPractice();f.state.now=1000
  const req=deferred();f.api.post=()=>req.promise;const pending=f.a.confirmSessionSubmission();f.state.now=90000
  assert.equal(f.a.timerState.value.elapsedMs,1000);f.native.get('pause')();req.reject(Error('synthetic'));await pending
  assert.equal(f.a.timerState.value.mode,'paused');f.native.get('resume')();assert.equal(f.a.timerState.value.mode,'running')
  f.state.now=91000;f.api.post=async()=>f.session(1);await f.a.confirmCurrentUnitSubmission();assert.equal(f.a.timerState.value.mode,'running');assert.equal(f.a.timerState.value.elapsedMs,2000)
  f.api.post=async()=>({...f.session(1),status:'submitted'});await f.a.confirmSessionSubmission();f.state.now+=99999;f.hooks.tick();assert.equal(f.a.timerState.value.mode,'finished');assert.equal(f.a.timerState.value.elapsedMs,2000);f.close()
})
test('checkpoint storage failure is visible and original invalid record survives backup failure',async()=>{
  const f=fixture();await f.mount();f.a.startTimedPractice();f.state.failSave=true;f.state.now=5000;f.hooks.tick();assert.match(f.a.timerSaveError.value,/保存失败/);f.close()
  const g=fixture();g.storage.set('linjian-practice-timer-1','invalid');g.state.failSave=true;await g.mount();g.a.startTimedPractice();g.state.now=5000;g.hooks.tick()
  assert.equal(g.storage.get('linjian-practice-timer-1'),'invalid');assert.match(g.a.timerSaveError.value,/备份失败/);g.close()
})
