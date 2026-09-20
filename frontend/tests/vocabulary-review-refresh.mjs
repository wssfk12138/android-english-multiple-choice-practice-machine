import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const read = p => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')
const compile = s => ts.transpileModule(s, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const queueModule = { exports:{} }; vm.runInNewContext(compile(read('vocabulary-due-queue.ts')), queueModule)
const source = read('views/VocabularyView.vue').split('<script setup lang="ts">')[1].split('</script>')[0]
assert.doesNotMatch(source.match(/async function startPendingTranslations\(\)[\s\S]*?\n}/)?.[0] || '', /await load\(/,
  '后台翻译不得负责单词本首屏读取')
assert.match(source, /else \{\s*await load\(\)\s*if \(!reviewDisposed && !reviewMode\.value\) void startVocabularyMaintenance\(\)/,
  '普通进入单词本必须先完成首屏读取，再安排后台维护')
const ast = ts.createSourceFile('view.ts', source, ts.ScriptTarget.Latest, true)
const names = ['persistDueQueue','reviewRevision','refreshDueQueue','loadDueQueue','refreshReviewOnForeground','rate',
  'beginReview','startReview','startReinforcement','loadReinforcement','snapshotOf','refreshReviewSnapshot','persistReviewSnapshot','schedulePersistReviewSnapshot','cacheReviewDetail','reviewDetailOf','loadReviewDetail','ensureReviewDetails','applyCounts','displayCount']
const queueNames = ['dueQueueUrl','duePageSignature','setScheduledWords','applyDueQueue','dueFillWanted','finishFill',
  'extractReviewRows','readWholeDueQueue','fillDueQueue','topUpDueQueue','fillDueQueueForRating']
// 直接取源码文本：早期版本在这里做了一次 '\\n' -> 换行的二次反转义，会把函数体里
// 合法的字面量 '\\n'（例如 duePageSignature 的 join 分隔符）也拆成真换行而语法错误。
const functions = ast.statements.filter(s => ts.isFunctionDeclaration(s) && [...names,...queueNames].includes(s.name?.text)).map(s => s.getText(ast)).join('\n')
const word = id => ({id,term:'word'+id,normalized_term:'word'+id,translation_status:'ready',created_at:'2020-01-01'})
const value = v => ({value:v})
function setup() {
  const ctx = { ...queueModule.exports, exports:{}, Map, JSON, String, setTimeout, clearTimeout,
    currentBankScope:false, reviewMode:value(true), reviewKind:value('scheduled'), reviewSaving:value(false), reviewIndex:value(0), reveal:value(true), error:value(''), notice:value(''), scheduledWords:value([word(1),word(2)]),
    reinforcementWords:value([]), reinforcementSize:value(10), filter:value('all'), reviewLoading:value(false),
    reviewDetails:value({}), reviewDetailError:value(''), reviewSnapshot:value(null),
    countsLoaded:value(false), listLoaded:value(false), listLoading:value(false), listRevision:value('v2:1'),
    counts:value({}), document:{visibilityState:'visible'}, localStorage:{getItem:()=>null,setItem:()=>{}}, load:async()=>{ctx.loadCalls++} }
  ctx.savedReviewSnapshots=[]
  ctx.reviewSnapshotToLoad=null
  ctx.loadVocabularyReviewSnapshot=()=>ctx.reviewSnapshotToLoad
  ctx.saveVocabularyReviewSnapshot=snapshot=>{ctx.savedReviewSnapshots.push(structuredClone(snapshot));return true}
  ctx.listScopeKey=()=> 'all';ctx.resolveSnapshotScope=async()=>{}
  ctx.reviewItems = {get value(){return ctx.reviewKind.value==='reinforcement'?ctx.reinforcementWords.value:ctx.scheduledWords.value}}
  ctx.reviewWord = {get value(){return ctx.reviewItems.value[ctx.reviewIndex.value]}}
  ctx.words = [word(1),word(2)]; ctx.posts = []; ctx.getCount = 0; ctx.getArgs = []; ctx.loadCalls = 0; ctx.revision='v2:1'
  ctx.counts = {}
  ctx.details = {1:{id:1,common_meaning:'释义-1',latest_sentence:'原句-1'},2:{id:2,common_meaning:'释义-2',latest_sentence:'原句-2'}}
  // 列表读必须按 limit/offset 切片：分页是本次改动的前提，桩要是仍整队回包，
  // 测试就永远走不进「分块补全」那条路。
  ctx.get = async path=>{ ctx.getCount++; ctx.getArgs.push(path)
    const detail = /^\/vocabulary\/(\d+)$/.exec(path)
    if (detail) return { ...ctx.details[Number(detail[1])] }
    const query = new URLSearchParams(path.split('?')[1] || '')
    const limit = query.get('limit') || 'all'
    const offset = Number(query.get('offset') || 0)
    const rows = limit === 'all' ? [...ctx.words] : ctx.words.slice(offset, offset + Number(limit))
    const items = query.get('projection') === 'review'
      ? rows.map(item => ({ ...item, review_detail: { ...ctx.details[item.id] } }))
      : rows
    return { items,
      counts:{...ctx.counts}, scope_key:'all', revision:ctx.revision } }
  ctx.post = async(path)=>{ctx.posts.push(path);ctx.words=ctx.words.filter(w=>path!== '/vocabulary/'+w.id+'/review')}
  vm.createContext(ctx)
  vm.runInContext(compile('let dueRefreshPromise: Promise<void>|null=null; let reviewDisposed=false; let reviewCommandId=""; function newReviewCommandId(){return "0123456789abcdef0123456789abcdef"}; let dueQueueStorageKey="";let dueQueueTimer=null;let reviewSnapshotTimer=null;let dueQueue=reconcileDueQueue(null,[]);let reviewLoadToken=0;let reviewSessionToken=0;let reviewDetailPending=new Set();const DUE_FIRST_PAGE=12;const DUE_PAGE=48;let dueQueueWords=new Map();let dueSeenKeys=new Set();let dueQueueOffset=0;let dueQueueComplete=false;let dueQueueSaved=null;let dueLoadToken=0;let dueFillPromise=null;let dueHeadSignature="";let dueHeadReview=-1;let reviewSnapshotRevision="";function scheduleDueQueueTopUp(){}\n'.replaceAll('\\n','\n')+functions+'\nthis.api={rate,beginReview,refreshDueQueue,refreshReviewOnForeground,startReinforcement,loadReviewDetail,ensureReviewDetails,snapshotOf,refreshReviewSnapshot,cacheReviewDetail,loadDueQueue,applyCounts,displayCount,topUpDueQueue,dispose:()=>{reviewDisposed=true}};'.replaceAll('\\n','\n')),ctx)
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
 c.post=async()=>{throw Object.assign(Error('stale'),{status:409})}
 await c.api.rate('hard');assert.equal(c.reviewWord.value.review_revision,'new');assert.equal(c.reveal.value,false)
 assert.match(c.notice.value,/重新评分/);assert.equal(c.reviewSaving.value,false)
}
// Android revisions make the transaction authoritative without a full due-set read.
{
 const c=setup();c.scheduledWords.value[0].review_revision='current'
 await c.api.rate('know');assert.equal(c.getCount,0);assert.equal(c.posts.length,1);assert.equal(c.reviewWord.value.id,2)
}
{
 const c=setup();c.scheduledWords.value[0].review_revision='current';c.words=[word(2)]
 c.post=async()=>{throw Object.assign(Error('deleted'),{status:404})}
 await c.api.rate('hard');assert.equal(c.reviewWord.value.id,2);assert.equal(c.reveal.value,false);assert.equal(c.getCount,1)
}
{
 const c=setup();c.scheduledWords.value[0].review_revision='current'
 c.post=async()=>{throw Error('disk full')}
 await c.api.rate('fluent');assert.equal(c.getCount,0);assert.equal(c.reviewWord.value.id,1);assert.match(c.error.value,/disk full/)
}
{
 const c=setup();c.scheduledWords.value[0].review_revision='current'
 c.post=async()=>{throw Object.assign(Error('stale'),{status:409})};c.get=async()=>{throw Error('refresh failed')}
 await c.api.rate('hard');assert.equal(c.reviewWord.value.id,1);assert.equal(c.reviewSaving.value,false);assert.match(c.error.value,/refresh failed/)
}

// 首屏小页直接内嵌轻量卡片详情；队列对象本身仍保持精简。
{
 const c=setup();await c.api.loadDueQueue()
 assert.equal(c.getArgs[0],'/vocabulary?status=review&limit=12&offset=0&projection=review')
 assert.equal(c.getCount,1);assert.equal(c.scheduledWords.value.length,2)
 const snap=c.api.snapshotOf(c.scheduledWords.value[0])
 assert.equal(snap.term,'word1');assert.equal(snap.common_meaning,'释义-1');assert.equal(snap.latest_sentence,'原句-1')
 assert.equal('review_detail' in c.scheduledWords.value[0],false)
 assert.equal(c.reviewSnapshot.value.common_meaning,'释义-1')
}
// 首屏外加页：13 条到期队列不能停在首屏 12 条，也不能把整队一次过桥。
{
 const c=setup();c.words=[...Array(13)].map((_,i)=>word(i+1));c.counts={review:13}
 // 评分期间后台补全让出通道，这条断言正是「不和评分抢同一条连接」。
 c.reviewSaving.value=true
 await c.api.loadDueQueue()
 assert.equal(c.getArgs.length,1)
 assert.equal(c.scheduledWords.value.length,12)
 assert.equal(c.counts.value.review,13)
 await c.api.topUpDueQueue(true)
 assert.equal(c.getArgs[1],'/vocabulary?status=review&limit=48&offset=12&projection=queue')
 assert.equal(c.scheduledWords.value.length,13)
 assert.ok(c.scheduledWords.value.some(w=>w.id===13))
 // 分块补全不能漏行也不能重复：首屏 12 条 + 后一页 1 条正好是 1..13 的一份排列。
 const ids=c.scheduledWords.value.map(w=>w.id)
 assert.deepEqual([...ids].sort((a,b)=>a-b),[...Array(13)].map((_,i)=>i+1))
 assert.equal(new Set(ids).size,13)
}
// 大队列每次后台只补一页；不能在首卡出现后立刻把整队搬过桥。
{
 const c=setup();c.words=[...Array(120)].map((_,i)=>word(i+1));c.counts={review:120}
 await c.api.loadDueQueue()
 assert.equal(c.getCount,1);assert.equal(c.scheduledWords.value.length,12)
 await c.api.topUpDueQueue()
 assert.equal(c.getCount,2);assert.equal(c.scheduledWords.value.length,60)
 assert.equal(c.getArgs[1],'/vocabulary?status=review&limit=48&offset=12&projection=queue')
}
// 旧后端忽略分页并直接返回整队时，一次接收后必须停止补页。
{
 const c=setup();c.words=[...Array(120)].map((_,i)=>word(i+1));c.counts={review:120}
 await c.api.loadDueQueue()
 c.get=async path=>{c.getCount++;c.getArgs.push(path);return {items:[...c.words],counts:{...c.counts},scope_key:'all'}}
 await c.api.topUpDueQueue()
 assert.equal(c.scheduledWords.value.length,120)
 const completedAt=c.getCount
 await c.api.topUpDueQueue()
 assert.equal(c.getCount,completedAt)
}
// 前台恢复与重进复习不会把已经补满的队列缩回首屏：队首与到期计数没变就沿用整队。
{
 const c=setup();c.words=[...Array(13)].map((_,i)=>word(i+1));c.counts={review:13}
 await c.api.loadDueQueue();await c.api.topUpDueQueue()
 assert.equal(c.scheduledWords.value.length,13)
 c.getCount=0;c.getArgs=[]
 await c.api.loadDueQueue();await c.api.topUpDueQueue()
 assert.equal(c.getArgs[0],'/vocabulary?status=review&limit=12&offset=0&projection=review')
 assert.equal(c.getCount,1)
 assert.equal(c.scheduledWords.value.length,13)
 assert.equal(c.reviewMode.value,true)
}
// 首批详情已经预热：当前卡与下一张都不再发起逐卡读取。
{
 const c=setup();await c.api.loadDueQueue()
 await c.api.ensureReviewDetails()
 assert.deepEqual(c.getArgs.slice(1),[])
 assert.equal(c.getCount,1)
 c.api.refreshReviewSnapshot()
 assert.equal(c.reviewSnapshot.value.term,'word1')
 assert.equal(c.reviewSnapshot.value.common_meaning,'释义-1')
 assert.equal(c.reviewSnapshot.value.latest_sentence,'原句-1')
 assert.equal(c.reviewDetailError.value,'')
}
// 详情已缓存时不再重复读取；巩固模式不触发队列详情读取。
{
 const c=setup();await c.api.loadDueQueue();await c.api.ensureReviewDetails()
 await c.api.ensureReviewDetails();assert.equal(c.getCount,1)
 c.reviewKind.value='reinforcement';c.reinforcementWords.value=[word(7)]
 await c.api.ensureReviewDetails()
 assert.equal(c.getCount,2);assert.equal(c.getArgs[1],'/vocabulary/7')
 assert.equal(c.getArgs.filter(p=>p.startsWith('/vocabulary?')).length,1)
}
// 详情读取失败只置错误、保留队列与评分能力，不做整队重读。
{
 const c=setup();await c.api.loadDueQueue()
 const before=c.scheduledWords.value
 c.reviewDetails.value={}
 c.get=async path=>{c.getCount++;c.getArgs.push(path);throw Error('detail down')}
 c.getCount=0;c.getArgs=[]
 await c.api.loadReviewDetail(c.scheduledWords.value[0])
 assert.equal(c.getCount,1);assert.match(c.reviewDetailError.value,/detail down/)
 assert.equal(c.scheduledWords.value,before);assert.equal(c.scheduledWords.value.length,2)
 assert.equal(c.reviewMode.value,true);assert.equal(c.reviewLoading.value,false)
}
// 巩固候选按清单投影批量取（limit=probe），只保留 ready 项且截断到本轮条数。
{
 const c=setup()
 const pool=[...Array(6)].map((_,i)=>({...word(i+1),translation_status:'ready'}))
 pool.push({...word(99),translation_status:'translating'})
 c.words=pool
 await c.api.startReinforcement(5)
 assert.equal(c.getArgs[0],'/vocabulary?status=all&limit=15&projection=queue')
 assert.deepEqual(c.getArgs.slice(1),['/vocabulary/1','/vocabulary/2'])
 assert.equal(c.getCount,3)
 await c.api.ensureReviewDetails()
 assert.equal(c.getCount,3,'当前卡和下一张详情预热后不得重复读取')
 assert.equal(c.reinforcementWords.value.length,5)
 assert.ok(c.reinforcementWords.value.every(w=>w.translation_status==='ready'))
 assert.equal(c.reviewKind.value,'reinforcement');assert.equal(c.reviewMode.value,true)
 assert.equal(c.reviewLoading.value,false);assert.equal(c.reviewIndex.value,0)
}
// 巩固评分不重读浏览列表，直接推进到下一张。
{
 const c=setup();await c.api.startReinforcement(2)
 assert.equal(c.reinforcementWords.value.length,2)
 const postsBefore=c.posts.length
 await c.api.rate('good')
 assert.equal(c.posts.length,postsBefore+1)
 assert.equal(c.reviewIndex.value,1);assert.equal(c.loadCalls,0)
 assert.equal(c.reviewWord.value.id,2)
}

// 新一轮复习从空缓存开始：词条内容被后台补全改写后，不会沿用上一轮的旧释义。
{
 const c=setup();await c.api.loadDueQueue();await c.api.ensureReviewDetails()
 assert.equal(c.getCount,1)
 c.details[1]={id:1,common_meaning:'改写后的释义',latest_sentence:'改写后的原句'}
 c.words=[{...word(1)}]
 c.getCount=0;c.getArgs=[]
 await c.api.startReinforcement(1)
 assert.equal(c.getArgs[0],'/vocabulary?status=all&limit=3&projection=queue')
 await c.api.ensureReviewDetails()
 assert.deepEqual(c.getArgs.slice(1),['/vocabulary/1'])
 c.api.refreshReviewSnapshot()
 assert.equal(c.reviewSnapshot.value.common_meaning,'改写后的释义')
 assert.equal(c.reviewSnapshot.value.latest_sentence,'改写后的原句')
}

// App 重启后先恢复持久化快照：首屏刷新只能合并队首，不能把已经缓存的完整队列缩回 12 条。
{
 const c=setup()
 c.words=[...Array(20)].map((_,i)=>word(i+1));c.counts={review:20}
 c.reviewSnapshotToLoad={revision:'v2:1',scope:'all',kind:'scheduled',items:c.words.map(w=>({...w})),reviewIndex:12,reviewDetails:{},counts:{review:20},
  dueQueue:{version:1,main:c.words.map(w=>w.normalized_term),relearning:[],ordinarySinceRelearning:0}}
 await c.api.beginReview('scheduled',c.api.refreshDueQueue)
 assert.equal(c.reviewLoading.value,false)
 assert.equal(c.scheduledWords.value.length,20)
 assert.equal(c.reviewIndex.value,12)
 assert.equal(c.reviewWord.value.id,13)
 await new Promise(resolve => setTimeout(resolve, 0))
 assert.ok(c.savedReviewSnapshots.length>=1)
 assert.deepEqual(c.savedReviewSnapshots.at(-1).dueQueue.main,c.words.map(w=>w.normalized_term))
}

// 后台补页发现尚未加载的新到期单词时，自动加入当前队列且不重复、不丢失。
{
 const c=setup();c.words=[...Array(13)].map((_,i)=>word(i+1));c.counts={review:13}
 c.reviewSnapshotToLoad={revision:'v2:1',scope:'all',kind:'scheduled',items:c.words.slice(0,12),reviewIndex:4,reviewDetails:{},counts:{review:13},
  dueQueue:{version:1,main:c.words.slice(0,12).map(w=>w.normalized_term),relearning:[],ordinarySinceRelearning:0}}
 await c.api.beginReview('scheduled',c.api.refreshDueQueue)
 assert.equal(c.scheduledWords.value.length,12)
 await c.api.topUpDueQueue(true)
 const ids=c.scheduledWords.value.map(w=>w.id)
 assert.equal(ids.length,13);assert.equal(new Set(ids).size,13);assert.ok(ids.includes(13))
 assert.equal(c.reviewWord.value.id,5)
}

// 新到期词插入队首时，当前卡按单词身份恢复位置，用户不会跳到另一张卡。
{
 const c=setup();c.words=[...Array(12)].map((_,i)=>word(i+1));c.counts={review:12}
 c.reviewSnapshotToLoad={revision:'v2:1',scope:'all',kind:'scheduled',items:c.words,reviewIndex:4,reviewDetails:{},counts:{review:12}}
 await c.api.beginReview('scheduled',c.api.refreshDueQueue)
 assert.equal(c.reviewWord.value.id,5)
 c.words=[word(0),...c.words];c.counts={review:13};c.getCount=0;c.getArgs=[]
 await c.api.refreshDueQueue()
 assert.ok(c.scheduledWords.value.some(w=>w.id===0))
 assert.equal(c.reviewWord.value.id,5)
 assert.equal(c.scheduledWords.value.findIndex(w=>w.id===5),c.reviewIndex.value)
}

// 计数读到之前显示占位符：界面不得把“还没读到”渲染成 0 个单词。
{
 const c=setup()
 assert.equal(c.api.displayCount(0),'—')
 assert.equal(c.api.displayCount(undefined),'—')
 c.api.applyCounts({total:3,frequent:0,mastered:0,pending:0,review:3})
 assert.equal(c.countsLoaded.value,true)
 assert.equal(c.counts.value.total,3)
 assert.equal(c.api.displayCount(c.counts.value.total),3)
 assert.equal(c.api.displayCount(0),0)
}

// A stale cached card outside page one must not survive conflict recovery.
for (const status of [404,409]) {
 const c=setup();const cached=Array.from({length:80},(_,i)=>({...word(i+1),review_revision:'r1'}))
 c.words=cached.filter(w=>w.id!==69);c.counts={review:79}
 c.reviewSnapshotToLoad={revision:'v2:1',scope:'all',kind:'scheduled',items:cached,reviewIndex:68,reviewDetails:{},counts:{review:80}}
 await c.api.beginReview('scheduled',c.api.refreshDueQueue)
 assert.equal(c.reviewWord.value.id,69)
 c.post=async()=>{throw Object.assign(Error('stale'),{status})}
 await c.api.rate('hard')
 assert.notEqual(c.reviewWord.value?.id,69)
 assert.ok(!c.scheduledWords.value.some(w=>w.id===69))
 await c.api.topUpDueQueue(true)
 assert.ok(!c.scheduledWords.value.some(w=>w.id===69))
}
// Successful grading must also remove the backing cache row before page merges.
{
 const c=setup();c.words=Array.from({length:70},(_,i)=>({...word(i+1),review_revision:'r1'}));c.counts={review:70}
 await c.api.beginReview('scheduled',c.api.refreshDueQueue)
 const completed=c.reviewWord.value.id
 await c.api.rate('hard');await c.api.topUpDueQueue(true)
 assert.ok(!c.scheduledWords.value.some(w=>w.id===completed))
}
{
 const c=setup();c.words=Array.from({length:20},(_,i)=>({...word(i+1),review_revision:'r1'}));c.counts={review:20}
 c.reviewSnapshotToLoad={revision:'v2:1',scope:'all',kind:'scheduled',items:c.words,reviewIndex:19,reviewDetails:{},counts:{review:20}}
 await c.api.beginReview('scheduled',c.api.refreshDueQueue)
 assert.equal(c.reviewWord.value.id,20)
 await c.api.rate('hard')
 assert.equal(c.reviewMode.value,true);assert.ok(c.reviewWord.value);assert.notEqual(c.reviewWord.value.id,20)
}
console.log('PASS stale cached card recovery beyond first page and completed row eviction')
console.log('PASS due review: deleted/synced cards, failed save, overlapping refresh, duplicate rating, foreground and disposal')
console.log('PASS counts placeholder: unknown counts never render as zero')
console.log('PASS queue contract: list-only payload, on-demand detail, detail failure isolation, reinforcement probe')
console.log('PASS due queue paging: first page only, chunked top-up without losing rows, foreground reuse')
