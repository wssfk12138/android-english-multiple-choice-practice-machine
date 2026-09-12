import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const read = p => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')
const compile = s => ts.transpileModule(s, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const queueModule = { exports:{} }; vm.runInNewContext(compile(read('vocabulary-due-queue.ts')), queueModule)
const source = read('views/VocabularyView.vue').split('<script setup lang="ts">')[1].split('</script>')[0]
const ast = ts.createSourceFile('view.ts', source, ts.ScriptTarget.Latest, true)
const names = ['persistDueQueue','reviewRevision','refreshDueQueue','loadDueQueue','refreshReviewOnForeground','rate']
const functions = ast.statements.filter(s => ts.isFunctionDeclaration(s) && names.includes(s.name?.text)).map(s => s.getText(ast)).join('\n').replaceAll('\\n','\n')
const word = id => ({id,term:'word'+id,normalized_term:'word'+id,translation_status:'ready',created_at:'2020-01-01'})
const value = v => ({value:v})
function setup() {
  const ctx = { ...queueModule.exports, exports:{}, Map, JSON, String,
    currentBankScope:false, reviewMode:value(true), reviewKind:value('scheduled'), reviewSaving:value(false), reviewIndex:value(0), reveal:value(true), error:value(''), notice:value(''), scheduledWords:value([word(1),word(2)]),
    counts:value({}), document:{visibilityState:'visible'}, localStorage:{getItem:()=>null,setItem:()=>{}}, load:async()=>{} }
  ctx.reviewItems = {get value(){return ctx.scheduledWords.value}}
  ctx.reviewWord = {get value(){return ctx.reviewItems.value[ctx.reviewIndex.value]}}
  ctx.words = [word(1),word(2)]; ctx.posts = []; ctx.getCount = 0
  ctx.get = async()=>{ ctx.getCount++; return {items:ctx.words} }
  ctx.post = async(path)=>{ctx.posts.push(path);ctx.words=ctx.words.filter(w=>path!== '/vocabulary/'+w.id+'/review')}
  vm.createContext(ctx)
  vm.runInContext(compile('let dueRefreshPromise: Promise<void>|null=null; let reviewDisposed=false; let dueQueueStorageKey="";let dueQueue=reconcileDueQueue(null,[]);\n'.replaceAll('\\n','\n')+functions+'\nthis.api={rate,refreshDueQueue,refreshReviewOnForeground,dispose:()=>{reviewDisposed=true}};'.replaceAll('\\n','\n')),ctx)
  return ctx
}
{
 const c=setup();c.words=[word(2)]; await c.api.rate('good')
 assert.equal(c.posts.length,0);assert.equal(c.reviewWord.value.id,2);assert.equal(c.reveal.value,false);assert.equal(c.reviewSaving.value,false)
}
{
 const c=setup();c.words=[{...word(1),last_reviewed_at:'2026-09-10'},word(2)];await c.api.rate('good');assert.equal(c.posts.length,0)
}
{
 const c=setup();c.post=async()=>{throw Error('save failed')};await c.api.rate('good')
 assert.equal(c.reviewWord.value.id,1);assert.match(c.error.value,/save failed/);assert.equal(c.reviewSaving.value,false)
}
{
 const c=setup();let release;c.get=()=>{c.getCount++;return new Promise(resolve=>release=resolve)}
 const a=c.api.refreshDueQueue(),b=c.api.refreshDueQueue();assert.equal(a,b);assert.equal(c.getCount,1)
 release({items:[word(2)]});await a;assert.equal(c.reveal.value,false)
}
{
 const c=setup();await Promise.all([c.api.rate('good'),c.api.rate('good')]);assert.equal(c.posts.length,1);assert.equal(c.reviewWord.value.id,2)
}
{
 const c=setup();c.document.visibilityState='hidden';await c.api.refreshReviewOnForeground();assert.equal(c.getCount,0)
 c.document.visibilityState='visible';c.words=[word(2)];await c.api.refreshReviewOnForeground();assert.equal(c.reviewWord.value.id,2)
 c.api.dispose();c.words=[word(3)];await c.api.refreshDueQueue();assert.equal(c.reviewWord.value.id,2)
}

// Backend revision is carried with the exact card; delayed responses never close another view.
{
 const c=setup();c.scheduledWords.value[0].review_revision='revision-1';c.words[0].review_revision='revision-1'
 let release;const posted=new Promise(resolve=>{c.post=async(path,body)=>{c.posts.push(path);assert.equal(body.expected_revision,'revision-1');resolve();return new Promise(done=>release=done)}})
 const saving=c.api.rate('hard');await posted;c.reviewMode.value=false;release();await saving
 assert.equal(c.reviewWord.value.id,1);assert.equal(c.reviewSaving.value,false)
}
{
 const c=setup();let release;const posted=new Promise(resolve=>{c.post=async()=>{resolve();return new Promise(done=>release=done)}})
 const saving=c.api.rate('hard');await posted;c.scheduledWords.value=[word(2)];release();await saving
 assert.equal(c.reviewWord.value.id,2);assert.equal(c.reviewMode.value,true);assert.equal(c.reviewSaving.value,false)
}
{
 const c=setup();c.scheduledWords.value[0].review_revision='old';c.words[0].review_revision='new'
 await c.api.rate('hard');assert.equal(c.posts.length,0)
}

console.log('PASS due review: deleted/synced cards, failed save, overlapping refresh, duplicate rating, foreground and disposal')
