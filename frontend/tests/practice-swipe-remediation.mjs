import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const read = p => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')
const compile = s => ts.transpileModule(s, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const mod = {exports:{}}
vm.runInNewContext(compile(read('practice-swipe.ts')), mod)
const src = read('views/PracticeView.vue').split('<script setup lang="ts">')[1].split('</script>')[0]
const ast = ts.createSourceFile('view.ts', src, ts.ScriptTarget.Latest, true)
const names = ['swipeBlocked','startPracticeSwipe','movePracticeSwipe','finishPracticeSwipe','blockSwipeClick','switchUnit']
const funcs = ast.statements.filter(s => ts.isFunctionDeclaration(s) && names.includes(s.name?.text)).map(s=>s.getText(ast)).join(String.fromCharCode(10))
const value = value => ({value})
class Element {
  constructor({interactive=false,scroll=false}={}) {Object.assign(this,{interactive,scroll,scrollWidth:scroll?600:300,clientWidth:300,parentElement:null})}
  closest(){return this.interactive ? this : null}
}
function setup(portrait=true) {
  const c = {...mod.exports, exports:{}, Element, Date:{now:()=>c.time}, time:1000,
    document:{documentElement:{dataset:{platform:'android'}}},
    window:{innerWidth:portrait?400:1000,innerHeight:portrait?800:600,getSelection:()=>({toString:()=>c.selection})},
    getComputedStyle:e=>({overflowX:e.scroll?'auto':'visible'}),selection:'',
    saving:value(null),portraitPaneResizing:value(false),vocabMenu:value({visible:false}),
    resultPanelVisible:value(false),pendingSubmission:value(null),answerCardVisible:value(false),portraitMoreVisible:value(false),
    session:value({units:[{},{},{}]}),activeUnitIndex:value(1),practiceLayout:value(null),
    unansweredNotice:value(''),highlightedQuestionId:value(null),syncCurrentQuestionTargets:()=>{},syncCurrentListeningQuestion:()=>{},syncCurrentWordBankQuestion:()=>{}}
  vm.createContext(c)
  vm.runInContext(compile('let swipeStart=null; let suppressSwipeClickUntil=0;'+funcs+';this.api={startPracticeSwipe,movePracticeSwipe,finishPracticeSwipe,blockSwipeClick};'),c)
  c.event=(x,y=100,n=1,target=new Element())=>({target,touches:Array.from({length:n},()=>({clientX:x,clientY:y})),changedTouches:[{clientX:x,clientY:y}],preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true}})
  c.start=(x=200,target)=>c.api.startPracticeSwipe(c.event(x,100,1,target))
  c.end=(x=100,y=100,delay=100)=>{c.time+=delay; const e=c.event(x,y);c.api.finishPracticeSwipe(e);return e}
  return c
}
for (const portrait of [true,false]) {
  let c=setup(portrait);c.start();assert.equal(c.end().prevented,true);assert.equal(c.activeUnitIndex.value,2)
  const click=c.event(100);c.api.blockSwipeClick(click);assert.equal(click.stopped,true)
  c.time+=401;const later=c.event(100);c.api.blockSwipeClick(later);assert.equal(later.stopped,undefined)
  c.start(100);c.end(220);assert.equal(c.activeUnitIndex.value,1)
  for (const key of ['portraitPaneResizing','resultPanelVisible','answerCardVisible','portraitMoreVisible']) {
    c=setup(portrait);c[key].value=true;c.start();c.end();assert.equal(c.activeUnitIndex.value,1,key)
  }
  c=setup(portrait);c.start();c.saving.value=1;c.end();assert.equal(c.activeUnitIndex.value,1)
  c=setup(portrait);c.start();c.selection='word';c.end();assert.equal(c.activeUnitIndex.value,1)
  for (const target of [new Element({interactive:true}),new Element({scroll:true})]) {c=setup(portrait);c.start(200,target);c.end();assert.equal(c.activeUnitIndex.value,1)}
  c=setup(portrait);c.start(10);c.end(100);assert.equal(c.activeUnitIndex.value,1)
  c=setup(portrait);c.start();c.api.movePracticeSwipe(c.event(210,140));c.end();assert.equal(c.activeUnitIndex.value,1)
  c=setup(portrait);c.start();c.api.movePracticeSwipe(c.event(210,100,2));c.end();assert.equal(c.activeUnitIndex.value,1)
  c=setup(portrait);c.start();[c.window.innerWidth,c.window.innerHeight]=[c.window.innerHeight,c.window.innerWidth];c.end();assert.equal(c.activeUnitIndex.value,1)
  for (const [x,y,delay] of [[150,100,100],[100,190,100],[100,100,700],[100,100,10]]) {c=setup(portrait);c.start();c.end(x,y,delay);assert.equal(c.activeUnitIndex.value,1)}
  c=setup(portrait);c.activeUnitIndex.value=2;c.start();assert.equal(c.end().prevented,undefined);assert.equal(c.activeUnitIndex.value,2)
}
console.log('PASS actual swipe handlers: portrait/landscape, direction, bounds, scroll/selection/save guards, rotation, multitouch, click suppression')
