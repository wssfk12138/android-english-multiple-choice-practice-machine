<script setup lang="ts">
import VocabularyTerm from '../components/VocabularyTerm.vue'
import VocabularyMemoryContent from '../components/VocabularyMemoryContent.vue'
import { BookOpen, Check, ChevronDown, RefreshCw, Search, Star, Trash2 } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { del, get, post, put } from '../api'
import { confirmDialog } from '../platform/dialogs'
import { loadVocabDisplayConfig } from '../services/vocabularyDisplayConfig'
import { reconcileDueQueue, orderedDueKeys, completeDueWord, wordKey, type DueQueue } from '../vocabulary-due-queue'
import { nextTick } from 'vue'
import { platformRuntime } from '../platform/runtime'
import { useAndroidLandscape } from '../composables/useAndroidLandscape'

const route = useRoute()
const landscape = useAndroidLandscape()
const items = ref<any[]>([])
const counts = ref<any>({ total:0, frequent:0, mastered:0, pending:0, review:0 })
const selected = ref<any>(null)
const filter = ref(route.query.review === 'scheduled' ? 'review' : 'all')
const currentBankScope = route.query.scope === 'current'
const search = ref('')
const error = ref('')
const notice = ref('')
const editing = ref(false)
const editForm = reactive<any>({})
const hasSelectedContent = computed(() => selected.value?.translation_status === 'ready'
  || ['phonetic', 'part_of_speech', 'contextual_meaning', 'common_meaning', 'note']
    .some(field => String(selected.value?.[field] || '').trim()))
const reviewMode = ref(false)
// 进入复习时先渲染卡片外壳，再让到期队列在后台落地，避免卡片出现前的加载页。
const reviewLoading = ref(false)
let reviewLoadToken = 0
// 每一轮复习都是一个独立会话：上一轮的详情缓存与在途读取都不得污染新会话。
let reviewSessionToken = 0
const reviewKind = ref<'scheduled' | 'reinforcement'>('scheduled')
const reinforcementSize = ref(10)
const reveal = ref(false)
const reviewIndex = ref(0)
const scheduledWords = ref<any[]>([])
const reinforcementWords = ref<any[]>([])
// 到期队列与巩固候选只带回清单列，卡片成为当前卡时再按需读取该词的完整详情。
const reviewDetails = ref<Record<string, any>>({})
const reviewDetailError = ref('')
const reviewDetailPending = new Set<number>()
let dueQueue: DueQueue = reconcileDueQueue(null, [])
let dueQueueStorageKey = ''
const reviewSaving = ref(false)
function persistDueQueue() {
  try { localStorage.setItem(dueQueueStorageKey, JSON.stringify(dueQueue)) }
  catch { error.value = '无法保存复习进度，请检查设备存储空间' }
}
let dueRefreshPromise: Promise<void> | null = null
let reviewDisposed = false
function reviewRevision(word: any) {
  // 原生下发的 review_revision 才是乐观并发身份，兜底值只用于本地比较
  // “当前卡相对刷新前是否已变”。兜底值因此必须同时带上卡片身份（wordKey）：
  // 只比到期字段时，刷新后换了一张卡也会被当成同一张，揭示状态会留在新卡上。
  // 到期字段与 Android 的 reviewRevision 保持一致，updated_at 不进身份：
  // 到期队列为省桥载荷不回传它，带上它会让清单与评分前的状态读取算出两个值，
  // 评分被静默判成过期。摘要投影（浏览列表）不带这些字段，它不会成为复习卡：
  // 复习卡只来自 projection=queue 的到期队列与巩固候选，评分前会刷到真实版本。
  if (!word) return ''
  return word.review_revision
    || `${wordKey(word)}|${word.review_count || 0}|${word.last_reviewed_at || ''}|${word.next_review_at || ''}`
}
function refreshDueQueue(): Promise<void> {
  if (dueRefreshPromise) return dueRefreshPromise
  dueRefreshPromise = loadDueQueue().finally(() => { dueRefreshPromise = null })
  return dueRefreshPromise
}
// 到期队列分块读取。整队一次过桥的代价有实测：903 行到期队列要回传 298 KB，
// 平板单次读取 1034 ms（其中桥传输 950 ms），而同一条 SQL 在 PC 上只要 3.6–7.6 ms
// ——瓶颈是跨桥回传的字节数，不是查询本身。
// 因此队列分两段读：首屏只取够立刻显示卡片的一小页，其余分块在后台补齐，每块到手
// 都重排一次队列；用户一开始评分或离开复习，后台补全立刻让出通道，不和评分抢同一条
// 本地数据库连接。
const DUE_FIRST_PAGE = 12
const DUE_PAGE = 150
type DueFill = 'complete' | 'stopped' | 'failed'
let dueQueueWords = new Map<string, any>()
let dueQueueOffset = 0
let dueQueueComplete = false
let dueQueueSaved: Partial<DueQueue> | null = null
let dueLoadToken = 0
let dueFillPromise: Promise<DueFill> | null = null
// 队首签名与到期计数用于前台恢复时的复用判断：两者都没变就没必要把已经涨到
// 上百条的队列缩回第一页。
let dueHeadSignature = ''
let dueHeadReview = -1

function dueQueueUrl(limit: number | 'all', offset: number) {
  return `/vocabulary?status=review${currentBankScope ? '&scope=current' : ''}&limit=${limit}&offset=${offset}&projection=queue`
}
function duePageSignature(rows: any[]) {
  return rows.slice(0, DUE_FIRST_PAGE)
    .map(word => `${wordKey(word)}\u0000${reviewRevision(word)}`).join('\n')
}
// 卡片身份变了就把揭示状态收回：否则新卡会带着上一张的答案出现。
function setScheduledWords(ordered: string[], words: Map<string, any>) {
  if (reviewDisposed) return
  const identity = (word: any) => word ? `${wordKey(word)}\u0000${reviewRevision(word)}` : ''
  const previous = identity(reviewWord.value)
  scheduledWords.value = ordered.map(key => words.get(key)).filter(Boolean)
  if (previous !== identity(reviewWord.value)) reveal.value = false
}
// pending 为真表示队列还没读完：只有取满之后才把顺序落成权威版本，否则每取一页
// 都会先把没取到的词按本地旧顺序排到前面去。
function applyDueQueue(pending: boolean) {
  dueQueue = reconcileDueQueue(dueQueueSaved, [...dueQueueWords.values()], Date.now(), pending)
  persistDueQueue()
  setScheduledWords(orderedDueKeys(dueQueue), dueQueueWords)
}
// 补全只在「正在复习、且没有在评分」时进行：评分一旦开始就把通道让回去。
function dueFillWanted(token: number, force: boolean) {
  return !reviewDisposed && token === dueLoadToken && (force || !reviewSaving.value)
    && reviewMode.value && reviewKind.value === 'scheduled'
}
function finishFill(token: number, force: boolean): DueFill {
  if (!dueFillWanted(token, force)) return 'stopped'
  applyDueQueue(false)
  return 'complete'
}
// 远端分页不受支持时的兜底：按老办法一次读完整队。这条路只服务旧远端，它在
// 本机进程里，字节数不像 Capacitor 桥那样昂贵。
async function readWholeDueQueue(token: number, force: boolean): Promise<DueFill> {
  let result: any
  try { result = await get(dueQueueUrl('all', 0)) } catch { return 'failed' }
  if (!dueFillWanted(token, force)) return 'stopped'
  const rows: any[] = Array.isArray(result.items) ? result.items : []
  dueQueueWords = new Map(rows.map((word: any) => [wordKey(word), word]))
  dueQueueOffset = rows.length
  dueQueueComplete = true
  applyDueQueue(false)
  return 'complete'
}
async function fillDueQueue(token: number, force: boolean): Promise<DueFill> {
  while (!dueQueueComplete) {
    if (!dueFillWanted(token, force)) return 'stopped'
    let result: any
    try { result = await get(dueQueueUrl(DUE_PAGE, dueQueueOffset)) } catch { return 'failed' }
    if (!dueFillWanted(token, force)) return 'stopped'
    const rows: any[] = Array.isArray(result.items) ? result.items : []
    // 服务器忽略了 limit：回来的就是整队，按整队收尾。
    if (rows.length > DUE_PAGE) {
      for (const word of rows) dueQueueWords.set(wordKey(word), word)
      break
    }
    const added = rows.filter(word => !dueQueueWords.has(wordKey(word)))
    for (const word of added) dueQueueWords.set(wordKey(word), word)
    dueQueueOffset += rows.length
    if (!added.length) {
      // 整页都是读过的行：服务器忽略了 offset。整页重复说明它还在从头返回，
      // 改用一次整队读取兜底；短页重复则说明队尾已到。
      return rows.length >= DUE_PAGE ? await readWholeDueQueue(token, force) : finishFill(token, force)
    }
    // 每块到手立刻重排一次：补全期间下一张卡要能按队列顺序接上，等的不能只有
    // 首屏那 12 条。只有当队列读满（循环外的 finishFill）才落成权威顺序。
    applyDueQueue(true)
    dueQueueComplete = rows.length < DUE_PAGE
  }
  return finishFill(token, force)
}
// 首屏之后的补全：不阻塞首屏，但必须在队列被评完之前取满，否则会把「还没读到」
// 当成「今天复习完了」。force 供评分流程使用：此时 reviewSaving 为真但那正是评分
// 自己在等这份补齐，不算和用户抢通道。
async function topUpDueQueue(force = false): Promise<void> {
  if (dueQueueComplete || reviewDisposed) return
  if (force) return fillDueQueueForRating()
  if (dueFillPromise) { await dueFillPromise; return }
  const token = dueLoadToken
  dueFillPromise = fillDueQueue(token, false).finally(() => { dueFillPromise = null })
  await dueFillPromise
}
// 评分流程等的是「队列确实取满」这个结论：后台补全可能因为评分让出通道而中途
// 停下，别的补全也可能刚好在起步，所以要一直补到自己这一轮真正跑完；只在确实
// 推进不了（退出复习、换会话、读取失败）时才收手，把结论交回调用方。
async function fillDueQueueForRating(): Promise<void> {
  for (let round = 0; round < 8 && !dueQueueComplete && !reviewDisposed; round += 1) {
    if (dueFillPromise) { await dueFillPromise; continue }
    const before = dueQueueOffset
    const token = dueLoadToken
    dueFillPromise = fillDueQueue(token, true).finally(() => { dueFillPromise = null })
    await dueFillPromise
    if (dueQueueOffset === before) return
  }
}
async function loadDueQueue() {
  const token = dueLoadToken + 1
  dueLoadToken = token
  const result: any = await get(dueQueueUrl(DUE_FIRST_PAGE, 0))
  if (reviewDisposed || token !== dueLoadToken) return
  applyCounts(result.counts)
  dueQueueStorageKey = `vocab-due-queue:v1:${result.scope_key || (currentBankScope ? 'current' : 'all')}`
  dueQueueSaved = null
  try { dueQueueSaved = JSON.parse(localStorage.getItem(dueQueueStorageKey) || 'null') } catch { /* Rebuild from durable reviews. */ }
  const rows: any[] = Array.isArray(result.items) ? result.items : []
  const signature = duePageSignature(rows)
  const review = Number(result.counts?.review ?? -1)
  // 前台恢复会重读队首：队首逐条一致、到期计数也没变时沿用已经累计的整队，
  // 既不把列表缩回第一页，也不打断当前卡片。上一轮补全被中途停下（退出复习、
  // 让位给评分）的情况同样走这里：直接从上次的偏移接着补，而不是把已经涨到
  // 上百条的队列扔掉、从第 13 条重新读一遍。
  if (signature === dueHeadSignature && review === dueHeadReview && dueQueueWords.size >= rows.length) {
    for (const word of rows) dueQueueWords.set(wordKey(word), word)
    if (!dueQueueComplete) void topUpDueQueue()
    return
  }
  dueHeadSignature = signature
  dueHeadReview = review
  dueQueueWords = new Map(rows.map((word: any) => [wordKey(word), word]))
  dueQueueOffset = rows.length
  // 短页说明整队都在首屏里；只有确实还有剩余时才继续分块，计数也只按首块落地。
  dueQueueComplete = rows.length < DUE_FIRST_PAGE
  // 分页只带回队首，刷新后原来的位置可能已经不存在：回到队首，不能让界面把
  // 「位置越界」渲染成「今天没有待复习的单词」。
  if (reviewMode.value && reviewKind.value === 'scheduled' && reviewIndex.value >= rows.length) {
    reviewIndex.value = 0
    reveal.value = false
  }
  applyDueQueue(!dueQueueComplete)
  if (!dueQueueComplete) void topUpDueQueue()
}
const reviewItems = computed(() => reviewKind.value === 'reinforcement' ? reinforcementWords.value : scheduledWords.value)
// 浏览列表按页读取：首屏只取够填满视口的行数，再由滚动哨兵继续取下一页；
// 复习与巩固走清单投影，不受分页影响。
const PAGE_SIZE = 31
const hasMore = ref(false)
const loadingMore = ref(false)
const listSentinel = ref<HTMLElement | null>(null)
let listObserver: IntersectionObserver | null = null
// 首屏读到数据之前不得渲染终态：“正在读取”与“确实没有单词”必须可区分。
// 否则一次慢响应或瞬时失败会被直接读成“0 个单词”，与数据是否完整无关。
const countsLoaded = ref(false)
const listLoaded = ref(false)
const listLoading = ref(false)
let listToken = 0
// 计数只在这一个入口落地：读到之前界面显示占位符，不显示 0。
function applyCounts(next: any) {
  if (!next) return
  counts.value = next
  countsLoaded.value = true
}
function displayCount(value: unknown) {
  return countsLoaded.value ? Number(value || 0) : '—'
}
function listUrl(limitClause: string) {
  const projection = platformRuntime.isAndroid ? '&projection=summary' : ''
  return `/vocabulary?status=${filter.value}&search=${encodeURIComponent(search.value)}${currentBankScope ? '&scope=current' : ''}&${limitClause}${projection}`
}
function applyLoadedPage(result: any) {
  const rows = result.items || []
  const more = rows.length > PAGE_SIZE
  items.value = more ? rows.slice(0, PAGE_SIZE) : rows
  applyCounts(result.counts)
  hasMore.value = more
}
const reviewWord = computed(() => reviewItems.value[reviewIndex.value])
// Keep one displayed answer stable while background enrichment refreshes the list.
const reviewSnapshot = ref<any>(null)
// 清单 + 已读到的详情合成当前卡片；详情尚未返回时只显示抬头字段。
function snapshotOf(word: any) {
  if (!word) return null
  const detail = reviewDetails.value[String(word.id)]
  return JSON.parse(JSON.stringify(detail ? { ...word, ...detail } : word))
}
function refreshReviewSnapshot() {
  reviewSnapshot.value = snapshotOf(reviewWord.value)
}
function reviewDetailOf(word: any) {
  return word ? reviewDetails.value[String(word.id)] || null : null
}
function cacheReviewDetail(id: number, detail: any) {
  reviewDetails.value = { ...reviewDetails.value, [String(id)]: detail }
  refreshReviewSnapshot()
}
async function loadReviewDetail(word: any, force = false) {
  const id = Number(word?.id)
  if (!Number.isInteger(id) || id <= 0 || reviewDetailPending.has(id)) return
  if (!force && reviewDetailOf(word)) return
  const session = reviewSessionToken
  reviewDetailPending.add(id)
  try {
    const detail: any = await get(`/vocabulary/${id}`)
    if (reviewDisposed || session !== reviewSessionToken) return
    reviewDetailError.value = ''
    cacheReviewDetail(id, detail)
  } catch (cause) {
    // 详情读取失败只提示错误：队列与评分仍然可用，不做整队重读。
    if (!reviewDisposed && session === reviewSessionToken) reviewDetailError.value = `单词详情读取失败：${String(cause)}`
  } finally {
    if (session === reviewSessionToken) reviewDetailPending.delete(id)
  }
}
// 当前卡片优先，紧随其后预取下一张；翻卡不再付出整队读取的代价。
async function ensureReviewDetails() {
  if (!reviewMode.value) return
  const list = reviewItems.value
  const current = list[reviewIndex.value]
  if (current) await loadReviewDetail(current)
  const next = list[reviewIndex.value + 1]
  if (next && !reviewDisposed && reviewMode.value) await loadReviewDetail(next)
}
watch(() => [reviewMode.value, reviewWord.value ? wordKey(reviewWord.value) : '', reviewWord.value?.last_reviewed_at], () => {
  refreshReviewSnapshot()
}, { immediate:true, flush:'sync' })
watch(() => [reviewMode.value, reviewWord.value?.id || 0], () => { void ensureReviewDetails() })
const displayConfig = ref(loadVocabDisplayConfig())
const reviewDisplayConfig = computed(() => landscape.value
  ? { ...displayConfig.value, phonetic: false, morphology: false, note: false } : displayConfig.value)
const expandedAll = ref(true)
const expansionToken = ref(0)
const enrichment = ref<any>(null)
async function enrichmentAction(action: string) {
  if (!platformRuntime.isAndroid) return
  try {
    enrichment.value = await post('/vocabulary/enrichment-runs', { action })
    startTranslationRefresh()
  } catch (cause) { error.value = String(cause) }
}
async function initializeEnrichment() {
  if (!platformRuntime.isAndroid) return
  await enrichmentAction('inventory')
  await nextTick()
  if (!reviewDisposed) await enrichmentAction('start')
}
function isAndroidPortrait() {
  return document.documentElement.dataset.platform === 'android'
    && document.documentElement.dataset.orientation === 'portrait'
}

// 窄屏（含平板竖屏的紧凑信息架构）下首次进入不自动展开第一个词条，
// 由用户从列表主动选择；宽屏双栏保留默认选中以填满详情栏。
function isNarrowListContext() {
  return isAndroidPortrait() || window.innerWidth < 720
}

function translationStatusText(status: string, detail = false) {
  if (status === 'translating') return detail ? '模型正在后台翻译' : '正在后台翻译…'
  if (status === 'queued') return detail ? '已提交后台翻译' : '正在等待后台翻译…'
  if (status === 'failed') return detail ? '翻译失败，可重新尝试' : '翻译失败，可重试'
  return detail ? '退出答题界面后开始后台翻译' : '等待后台翻译…'
}

let translationRefreshTimer = 0
let translationRefreshBusy = false
let translationRefreshTick = 0
const translationProgress = ref<any>({})

// 后台翻译可能持续很久；轮询在首个 30 秒后降到 10 秒、再降到 30 秒，
// 页面不可见时直接跳过，避免长时间反复查询数据库。
function translationRefreshStride() {
  if (translationRefreshTick <= 6) return 1
  if (translationRefreshTick <= 18) return 2
  return 6
}

function startTranslationRefresh() {
  if (translationRefreshTimer) return
  translationRefreshTick = 0
  translationRefreshTimer = window.setInterval(refreshTranslationStatuses, 5000)
}

function stopTranslationRefresh() {
  if (translationRefreshTimer) window.clearInterval(translationRefreshTimer)
  translationRefreshTimer = 0
  translationRefreshTick = 0
}

async function refreshTranslationStatuses() {
  if (translationRefreshBusy || reviewDisposed) return
  if (document.visibilityState === 'hidden') return
  translationRefreshTick += 1
  if (translationRefreshTick % translationRefreshStride() !== 0) return
  translationRefreshBusy = true
  try {
    const next: any = await get('/vocabulary/translation-status')
    if (platformRuntime.isAndroid) {
      const wasWaiting = enrichment.value?.waiting_configuration
      enrichment.value = await get('/vocabulary/enrichment-status')
      if (wasWaiting && !enrichment.value.waiting_configuration && !enrichment.value.paused) await enrichmentAction('start')
    }
    const previous = translationProgress.value
    translationProgress.value = next
    if (!(next.queued > 0 || next.translating > 0 || next.enrichment_queued > 0 || next.enrichment_inflight > 0 || enrichment.value?.waiting_configuration)) {
      stopTranslationRefresh()
    }
    if (editing.value || reviewMode.value) return
    const countsChanged = JSON.stringify(previous || {}) !== JSON.stringify(next)
    const selectedPending = selected.value
      && (selected.value.translation_status !== 'ready' || ['queued','inflight'].includes(selected.value.enrichment_status))
    if (!countsChanged && !selectedPending) return
    if (countsChanged) {
      // Refresh only the already-loaded window (plus one probe row) so the
      // list does not jump: replacing rows in place keeps the scroll position.
      const result: any = await get(listUrl(`limit=${items.value.length + 1}&offset=0`))
      const rows = result.items || []
      hasMore.value = rows.length > items.value.length
      items.value = hasMore.value ? rows.slice(0, items.value.length) : rows
      counts.value = result.counts || counts.value
    }
    if (selected.value && selectedPending) {
      selected.value = await get(`/vocabulary/${selected.value.id}`)
      Object.assign(editForm, selected.value)
    }
  } catch {
    stopTranslationRefresh()
  } finally { translationRefreshBusy = false }
}

async function startPendingTranslations() {
  await load()
  await nextTick()
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  if (reviewDisposed) return
  try {
    const result: any = await post('/vocabulary/translation-runs', {
      entry_ids: [],
      trigger: 'vocabulary_open',
    })
    startTranslationRefresh()
  } catch (cause) {
    error.value = String(cause)
  }
}

async function load(preferredId?: number) {
  const token = ++listToken
  listLoading.value = true
  try {
    let result: any
    try {
      result = await get(listUrl(`limit=${PAGE_SIZE + 1}&offset=0`))
    } catch (cause) {
      // 升级或导入后的首次进入常与后台整理争抢同一条原生连接；读到数据之前
      // 的瞬时失败重试一次，避免界面停在“0 个单词”的终态。
      if (listLoaded.value) throw cause
      await new Promise(resolve => setTimeout(resolve, 250))
      result = await get(listUrl(`limit=${PAGE_SIZE + 1}&offset=0`))
    }
    // 搜索与筛选会连续触发读取，迟到的旧响应不得覆盖新结果。
    if (token !== listToken) return
    error.value = ''
    applyLoadedPage(result)
    listLoaded.value = true
    const requested = preferredId ?? Number(route.query.word)
    const target = items.value.find(item => item.id === requested)
    if (target) await select(target.id, false)
    else if (!selected.value && !isNarrowListContext() && items.value[0]) await select(items.value[0].id, false)
  } catch (e) {
    if (token === listToken) error.value = String(e)
  } finally {
    if (token === listToken) listLoading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || reviewMode.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const result: any = await get(listUrl(`limit=${PAGE_SIZE + 1}&offset=${items.value.length}`))
    const rows = result.items || []
    const more = rows.length > PAGE_SIZE
    items.value = [...items.value, ...(more ? rows.slice(0, PAGE_SIZE) : rows)]
    applyCounts(result.counts)
    hasMore.value = more
  } catch (cause) { error.value = String(cause) }
  finally { loadingMore.value = false }
}

async function select(id: number, toggle = true) {
  if (toggle && selected.value?.id === id && isAndroidPortrait()) {
    selected.value = null
    editing.value = false
    return
  }
  try {
    selected.value = await get(`/vocabulary/${id}`)
    error.value = ''
    Object.assign(editForm, selected.value)
    editing.value = false
    expandedAll.value = true
  } catch (e) {
    error.value = String(e)
  }
}

async function saveEdit() {
  selected.value = await put(`/vocabulary/${selected.value.id}`, {
    contextual_meaning: editForm.contextual_meaning,
    common_meaning: editForm.common_meaning,
    phonetic: editForm.phonetic,
    part_of_speech: editForm.part_of_speech,
    note: editForm.note,
    study_status: editForm.study_status,
    manually_frequent: Boolean(editForm.manually_frequent),
  })
  editing.value = false
  notice.value = '词条已保存'
  await load(selected.value.id)
}

async function removeEntry() {
  if (!selected.value) return
  const confirmed = await confirmDialog({
    title: `删除单词“${selected.value.term}”？`,
    message: [
      '该词条的释义、笔记和真题遇见记录会一并移除。',
      '删除内容将在回收站保留七天，期间可以恢复。',
    ],
    confirmLabel: '删除单词',
    danger: true,
  })
  if (!confirmed) return
  await del(`/vocabulary/${selected.value.id}`)
  selected.value = null
  await load()
}

async function retryTranslation() {
  const result: any = await post('/vocabulary/retry-pending')
  notice.value = '已将整个单词本中等待及失败的词条加入翻译队列'
  await load()
  startTranslationRefresh()
}

async function rate(rating: string) {
  if (!reviewWord.value || reviewSaving.value) return
  const initialTarget = reviewWord.value
  const initialKey = wordKey(initialTarget)
  const initialRevision = reviewRevision(initialTarget)
  const targetMode = reviewKind.value
  reviewSaving.value = true
  try {
    // Revision-aware storage rejects stale cards atomically. Older backends
    // still need the preflight refresh; Android must not reload every due word.
    if (targetMode === 'scheduled' && !initialTarget.review_revision) await refreshDueQueue()
    const target = reviewWord.value
    if (!target || reviewDisposed || !reviewMode.value || targetMode !== reviewKind.value
      || wordKey(target) !== initialKey || reviewRevision(target) !== initialRevision) {
      reveal.value = false
      notice.value = '复习列表已更新，请查看当前单词后重新评分'
      return
    }
    const completedKey = wordKey(target)
    const revision = reviewRevision(target)
    if (targetMode === 'scheduled' && revision !== reviewRevision(reviewWord.value)) {
      reveal.value = false
      notice.value = '复习列表已更新，请查看当前单词后重新评分'
      return
    }
    try {
      await post(`/vocabulary/${target.id}/review`, { rating, mode: targetMode, expected_revision: target.review_revision })
    } catch (cause) {
      const status = (cause as { status?: number })?.status
      if (targetMode !== 'scheduled' || ![404, 409].includes(status || 0)) throw cause
      if (reviewDisposed || !reviewMode.value || targetMode !== reviewKind.value
        || initialRevision !== reviewRevision(reviewWord.value)) return
      reveal.value = false
      await refreshDueQueue()
      notice.value = '复习列表已更新，请查看当前单词后重新评分'
      return
    }
    if (reviewDisposed || !reviewMode.value || revision !== reviewRevision(reviewWord.value) || targetMode !== reviewKind.value) return
    if (targetMode === 'scheduled') {
      dueQueue = completeDueWord(dueQueue, completedKey)
      persistDueQueue()
      scheduledWords.value = scheduledWords.value.filter(word => wordKey(word) !== completedKey)
      // 评掉一个词会让它后面所有行整体前移一位：不把偏移收回来，后台补全就会
      // 跳过紧跟在它后面的那一行（该词留到下一轮才再出现）。
      dueQueueOffset = Math.max(0, dueQueueOffset - 1)
      reveal.value = false
    }
    reveal.value = false
    if (targetMode === 'reinforcement') {
      // 巩固评分只新增一条复习记录，词条与列表字段不变，不需要重读列表。
      reviewIndex.value += 1
    }
    if (targetMode === 'scheduled' && !dueQueueComplete
      && (!reviewItems.value.length || reviewIndex.value >= reviewItems.value.length)) {
      // 队列还没取满时先补齐再判定「今天复习完」：分页只把队首带回界面，
      // 不能把「后台还没读到」当成「没有到期单词」。补齐期间显示骨架卡，
      // 不让空态那行「今天没有待复习的单词。」错误地闪一下。
      const loadToken = reviewLoadToken
      reviewLoading.value = true
      try { await topUpDueQueue(true) } finally { if (loadToken === reviewLoadToken) reviewLoading.value = false }
      // 补齐期间用户可能退出复习或直接开新一轮：这份过期的评分不得改动新会话的
      // 状态（否则新会话刚开就会被判成「已复习完」而立刻关闭）。
      if (reviewDisposed || loadToken !== reviewLoadToken || !reviewMode.value || reviewKind.value !== 'scheduled') return
    }
    if (!reviewItems.value.length || reviewIndex.value >= reviewItems.value.length) {
      reviewMode.value = false
      reviewIndex.value = 0
      notice.value = targetMode === 'scheduled' ? '今天的复习已完成，可继续额外巩固' : '本轮额外巩固已完成'
      await load()
    }
  } catch (cause) { error.value = String(cause) }
  finally { reviewSaving.value = false }
}

// 复习与巩固共用入口：先进入复习视图并渲染等高骨架卡，清单在后台落地后替换
// 内容，点击反馈不再等待队列读取。
async function beginReview(kind: 'scheduled' | 'reinforcement', loader: () => Promise<void>) {
  reviewKind.value = kind
  reveal.value = false
  reviewIndex.value = 0
  reviewDetailError.value = ''
  // 新会话从空缓存开始：词条内容可能已被后台补全改写，沿用上一轮的快照会显示旧释义。
  reviewSessionToken += 1
  reviewDetails.value = {}
  reviewDetailPending.clear()
  reviewMode.value = true
  reviewLoading.value = true
  const token = reviewLoadToken + 1
  reviewLoadToken = token
  try {
    await loader()
  } catch (cause) {
    error.value = String(cause)
  } finally {
    if (token === reviewLoadToken) reviewLoading.value = false
  }
}

async function startReview() {
  if (reviewSaving.value) return
  await beginReview('scheduled', refreshDueQueue)
}

async function closeReview() {
  if (reviewSaving.value) return
  reviewMode.value = false
  reviewIndex.value = 0
  await load(selected.value?.id)
}

// 巩固候选只取本轮需要的清单行（不再是整本词库整行读取），候选顺序与浏览
// 列表一致：近期遇到的、高频的词优先。
async function loadReinforcement() {
  reinforcementWords.value = []
  const wanted = Math.max(1, reinforcementSize.value)
  // 非 ready 的候选会被过滤，因此多取一些再截断，保证轮次条数稳定。
  const probe = Math.min(60, wanted * 3)
  const result: any = await get(`/vocabulary?status=all&limit=${probe}&projection=queue`)
  if (reviewDisposed) return
  applyCounts(result.counts)
  reinforcementWords.value = (result.items || [])
    .filter((item: any) => item.translation_status === 'ready').slice(0, wanted)
}

async function startReinforcement(size: number) {
  if (reviewSaving.value) return
  reinforcementSize.value = size
  filter.value = 'all'
  await beginReview('reinforcement', loadReinforcement)
}

let searchTimer = 0
watch(search, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(load, 250)
})
watch(filter, () => load())
watch(displayConfig, () => {}, { deep: true })
function onDisplayConfigChanged() {
  displayConfig.value = loadVocabDisplayConfig()
}
async function refreshReviewOnForeground() {
  if (document.visibilityState === 'hidden' || !reviewMode.value || reviewSaving.value || !(reviewKind.value === 'scheduled')) return
  try { await refreshDueQueue() } catch (cause) { error.value = String(cause) }
}
onMounted(() => {
  document.addEventListener('visibilitychange', refreshReviewOnForeground)
  window.addEventListener('focus', refreshReviewOnForeground)
  window.addEventListener('storage', refreshReviewOnForeground)
  window.addEventListener('vocab-display-change', onDisplayConfigChanged)
  if (typeof IntersectionObserver === 'function') {
    listObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore()
    }, { rootMargin: '400px' })
    if (listSentinel.value) listObserver.observe(listSentinel.value)
  }
})
onBeforeUnmount(() => {
  reviewDisposed = true
  document.removeEventListener('visibilitychange', refreshReviewOnForeground)
  window.removeEventListener('focus', refreshReviewOnForeground)
  window.removeEventListener('storage', refreshReviewOnForeground)
  window.removeEventListener('vocab-display-change', onDisplayConfigChanged)
  window.clearTimeout(searchTimer)
  listObserver?.disconnect()
  listObserver = null
})
onMounted(async () => {
  if (route.query.review === 'scheduled') await startReview()
  else await startPendingTranslations()
  void initializeEnrichment()
})
onBeforeUnmount(stopTranslationRefresh)

const statChips = computed(() => [
  { key: 'all', label: '全部', count: displayCount(counts.value.total) },
  { key: 'frequent', label: '高频词', count: displayCount(counts.value.frequent) },
  { key: 'review', label: '每日一背', count: displayCount(counts.value.review) },
  { key: 'mastered', label: '已掌握', count: displayCount(counts.value.mastered) },
  { key: 'pending', label: '等待翻译', count: displayCount(counts.value.pending) },
])

const listFilters = [
  ['all', '全部单词'],
  ['review', '每日一背'],
  ['frequent', '高频词'],
  ['learning', '学习中'],
  ['mastered', '已掌握'],
  ['pending', '等待翻译'],
] as const

const activeFilterLabel = computed(() => listFilters.find(item => item[0] === filter.value)?.[1] || '全部单词')
const filtersExpanded = ref(false)
function filterCount(key: string) {
  if (!countsLoaded.value) return '—'
  if (key === 'all') return counts.value.total || 0
  if (key === 'learning') return counts.value.learning ?? Math.max(0, (counts.value.total || 0) - (counts.value.mastered || 0))
  return counts.value[key] || 0
}
</script>

<template>
  <div class="page vocabulary-page">
    <section v-if="enrichment && (enrichment.queued || enrichment.inflight || enrichment.failed || enrichment.error)" class="vocab-enrichment-status" aria-live="polite">
      <span>历史词条补缺 · 已完成 {{ enrichment.ready }} · 待补 {{ enrichment.queued + enrichment.inflight }} · 失败 {{ enrichment.failed }}</span>
      <small>{{ enrichment.waiting_configuration ? '等待配置默认模型' : enrichment.profile }} · {{ enrichment.paused ? '已暂停（当前请求完成后停止）' : '后台小批量补缺' }}</small>
      <button class="button ghost" @click="enrichmentAction(enrichment.paused ? 'resume' : 'pause')">{{ enrichment.paused ? '继续补缺' : '暂停补缺' }}</button>
      <button v-if="enrichment.failed" class="button ghost" @click="enrichmentAction('retry')">重试失败词条</button>
      <p v-if="enrichment.error" class="error" role="alert">补缺已停止：{{ enrichment.error }}</p>
      <button v-if="enrichment.error && !enrichment.failed" class="button ghost" @click="enrichmentAction('start')">重试补缺队列</button>
    </section>
    <div class="page-head">
      <div><h1>我的单词本</h1><span v-if="currentBankScope" class="muted">当前题库</span></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="button" @click="startReview"><BookOpen :size="17" />每日一背 · 待背 {{ displayCount(counts.review) }} 词</button>
      </div>
    </div>
    <div v-if="error" class="warning">{{ error }}</div>
    <div v-if="notice" class="card vocab-notice">{{ notice }}</div>
    <div v-if="translationProgress.queued || translationProgress.translating || translationProgress.failed" class="card vocab-notice" role="status">翻译进度：排队 {{ translationProgress.queued || 0 }} · 正在翻译 {{ translationProgress.translating || 0 }} · 失败 {{ translationProgress.failed || 0 }}</div>

    <div class="vocab-stats-summary" role="group" aria-label="单词本统计摘要">
      <button
        v-for="chip in statChips"
        :key="chip.key"
        class="vocab-stat-chip"
        :class="{ active: filter === chip.key }" :aria-pressed="filter === chip.key"
        type="button"
        @click="filter = chip.key"
      >
        <Check v-if="filter === chip.key" :size="14" aria-hidden="true" />{{ chip.label }} <strong>{{ chip.count }}</strong>
      </button>
    </div>

    <section v-if="!reviewMode" class="vocab-reinforcement card">
      <div class="vocab-tool-row"><div class="search-field"><Search :size="16" /><input v-model="search" placeholder="搜索单词或释义"></div><button class="vocab-filter-toggle" type="button" :aria-expanded="filtersExpanded" @click="filtersExpanded = !filtersExpanded"><span>筛选：<strong>{{ activeFilterLabel }}</strong> · {{ filterCount(filter) }}</span><ChevronDown :size="16" :class="{ rotated: filtersExpanded }" /></button></div>
      <div><strong>额外巩固</strong><span>不改变正式复习计划，可反复练习</span></div>
      <div class="vocab-reinforcement-actions">
        <button v-for="size in [5, 10, 20]" :key="size" class="button secondary compact" type="button" @click="startReinforcement(size)">{{ size }} 词</button>
      </div>
    </section>

    <section v-if="reviewMode" class="review-overlay vocabulary-review-overlay">
      <div v-if="reviewLoading" class="review-card vocabulary-review-card" data-review-fullscreen aria-busy="true">
        <header class="review-header">
          <strong>{{ reviewKind === 'scheduled' ? '每日一背' : '额外巩固' }} <span>{{ String(reviewIndex + 1).padStart(2, '0') }} / --</span></strong>
          <button class="review-close" type="button" title="退出复习" aria-label="退出复习" :disabled="reviewSaving" @click="closeReview">{{ landscape ? '退出复习' : '×' }}</button>
        </header>
        <div class="review-content">
          <div class="review-term">…</div>
          <div class="review-phonetic"></div>
          <button class="button secondary reveal-button" type="button" disabled>显示释义和原句</button>
        </div>
      </div>
      <div v-else-if="reviewWord" class="review-card vocabulary-review-card" data-review-fullscreen>
        <header class="review-header">
          <!-- 进度分母：正式复习读整队到期计数（分页只带回队首，用已取到的行数当分母会从 12 一路跳到真实总数）；额外巩固读本轮选中的条数。 -->
          <strong>{{ reviewKind === 'scheduled' ? '每日一背' : '额外巩固' }} <span>{{ String(reviewIndex + 1).padStart(2, '0') }} / {{ String(reviewKind === 'scheduled' ? displayCount(counts.review) : reviewItems.length).padStart(2, '0') }}</span></strong>
          <button class="review-close" type="button" title="退出复习" aria-label="退出复习" :disabled="reviewSaving" @click="closeReview">{{ landscape ? '退出复习' : '×' }}</button>
        </header>
        <div class="review-content">
          <div class="review-term"><VocabularyTerm :term="reviewSnapshot.term" :frequent="reviewSnapshot.is_frequent" /></div>
          <div class="review-phonetic">{{ reviewSnapshot.phonetic }}</div>
          <button v-if="landscape || !reveal" :class="{ 'answer-reserved': reveal }" :inert="reveal" :aria-hidden="reveal" class="button secondary reveal-button" @click="reveal=true">显示释义和原句</button>
          <div v-if="landscape || reveal" class="review-answer" :class="{ 'answer-reserved': !reveal }" :inert="!reveal" :aria-hidden="!reveal">
            <p v-if="!reviewDetailOf(reviewWord)" class="muted" aria-live="polite">正在读取释义与原句…</p>
            <VocabularyMemoryContent v-else :entry="reviewSnapshot" :config="reviewDisplayConfig" />
            <p v-if="reviewDetailError" class="error" role="alert">{{ reviewDetailError }}<button class="button ghost compact" type="button" @click="loadReviewDetail(reviewWord, true)">重试</button></p>
          </div>
        </div>
        <footer v-if="landscape || reveal" class="review-actions" :class="{ 'answer-reserved': !reveal }" :inert="!reveal" :aria-hidden="!reveal" :aria-busy="reviewSaving">
          <button class="button secondary" :disabled="reviewSaving" @click="rate('hard')">不认识</button>
          <button class="button secondary" :disabled="reviewSaving" @click="rate('know')">认识</button>
          <button class="button" :disabled="reviewSaving" @click="rate('fluent')">熟练</button>
        </footer>
      </div>
      <div v-else class="card empty vocab-review-empty">
        <p>今天没有待复习的单词。</p>
        <button class="button secondary" type="button" :disabled="reviewSaving" @click="closeReview">退出复习</button>
      </div>
    </section>

    <div v-else class="vocabulary-layout">
      <div class="vocab-list-column">
        <aside class="vocab-filters-inline">
          <div v-if="filtersExpanded" id="vocabulary-filter-options" class="vocab-filter-options" role="group" aria-label="单词本筛选项">
            <label v-for="item in listFilters" :key="item[0]" class="selection-option" :class="{ active: filter === item[0] }">
              <input v-model="filter" type="radio" name="vocabulary-filter" :value="item[0]"><span>{{ item[1] }} · {{ filterCount(item[0]) }}</span>
            </label>
          </div>
        </aside>

        <section class="vocab-list card">
          <template v-for="word in items" :key="word.id">
            <button class="vocab-list-item" :class="{active:selected?.id===word.id}" :aria-expanded="selected?.id===word.id" @click="select(word.id)">
              <div class="vocab-list-head"><strong><Star v-if="word.is_frequent" class="vocab-star" :size="15" aria-label="高频词" />{{ word.lemma || word.term }}</strong><small>遇到 {{ word.encounter_count }} 次</small></div>
              <p v-if="word.translation_status==='ready' || word.common_meaning || word.contextual_meaning">{{ word.common_meaning || word.contextual_meaning }}</p>
              <p v-else class="pending-text">{{ translationStatusText(word.translation_status) }}</p>
              <div class="vocab-list-meta"><span>{{ word.part_of_speech }}</span><span>{{ word.study_status === 'mastered' ? '已掌握' : '学习中' }}</span><ChevronDown class="vocab-expand-icon" :size="17" /></div>
            </button>
            <section v-if="selected?.id===word.id" class="portrait-vocab-detail" aria-label="单词详情">
              <div class="vocab-detail-head">
                <div><span v-if="selected.is_frequent" class="eyebrow">高频词</span><h2><VocabularyTerm :term="selected.lemma || selected.term" /></h2><p>{{ selected.phonetic }}<span v-if="selected.part_of_speech">{{ selected.phonetic ? ' · ' : '' }}{{ selected.part_of_speech }}</span></p></div>
                <div class="vocab-tools"><button class="button ghost" @click="expandedAll=true; expansionToken++">展开已启用栏目</button><button class="button ghost" @click="editing=!editing">编辑</button><button class="button ghost danger-text" aria-label="删除单词" @click="removeEntry"><Trash2 :size="17" /></button></div>
              </div>
              <div v-if="!editing && selected.translation_status!=='ready'" class="vocab-pending-panel">
                <RefreshCw :size="22" /><strong>{{ translationStatusText(selected.translation_status, true) }}</strong>
                <p>单词和真题原句已经安全保存。</p>
                <button v-if="selected.translation_status==='failed' || selected.translation_status==='pending'" class="button secondary" @click="retryTranslation">重试全部待翻译</button>
              </div>
              <template v-if="!editing && hasSelectedContent">
                <VocabularyMemoryContent :entry="selected" :config="displayConfig" :expanded="expandedAll" :expansion-token="expansionToken" />
                <p v-if="selected.enrichment_status === 'failed'" class="error vocab-enrich-error">补全失败：{{ selected.enrichment_error }}</p>
                <button v-if="selected.enrichment_status === 'failed'" class="button secondary" @click="retryTranslation">重试失败任务</button>
                <div class="detail-actions"><button class="button secondary" @click="put(`/vocabulary/${selected.id}`,{manually_frequent:!selected.manually_frequent}).then(()=>load())"><Star :size="16" />{{ selected.manually_frequent ? '取消重点' : '标记重点' }}</button><button class="button" @click="put(`/vocabulary/${selected.id}`,{study_status:selected.study_status==='mastered'?'learning':'mastered'}).then(()=>load())"><Check :size="16" />{{ selected.study_status === 'mastered' ? '恢复学习' : '标记已掌握' }}</button></div>
              </template>
              <div v-else-if="editing" class="vocab-edit"><label>音标<input v-model="editForm.phonetic"></label><label>词性<input v-model="editForm.part_of_speech"></label><label>常用释义<textarea rows="3" v-model="editForm.common_meaning"></textarea></label><label>我的笔记<textarea rows="4" v-model="editForm.note"></textarea></label><div><button class="button" @click="saveEdit">保存修改</button><button class="button ghost" @click="editing=false">取消</button></div></div>
            </section>
          </template>
          <div v-if="!items.length && !listLoaded" class="empty vocab-list-state" role="status" aria-live="polite" :aria-busy="listLoading ? 'true' : 'false'">
            <template v-if="listLoading">正在读取单词…</template>
            <template v-else>单词列表读取失败。<button class="button ghost compact" type="button" @click="load()">重试</button></template>
          </div>
          <div v-else-if="!items.length" class="empty">这里还没有符合条件的单词。</div>
          <div ref="listSentinel" aria-hidden="true"></div>
        </section>
      </div>

      <section class="vocab-detail desktop-vocab-detail card" v-if="selected">
        <div class="vocab-detail-head">
          <div><span v-if="selected.is_frequent" class="eyebrow">高频词</span><h2><VocabularyTerm :term="selected.lemma || selected.term" /></h2><p>{{ selected.phonetic }}<span v-if="selected.part_of_speech">{{ selected.phonetic ? ' · ' : '' }}{{ selected.part_of_speech }}</span></p></div>
          <div class="vocab-tools"><button class="button ghost" @click="expandedAll=true; expansionToken++">展开已启用栏目</button><button class="button ghost" @click="editing=!editing">编辑</button><button class="button ghost danger-text" @click="removeEntry"><Trash2 :size="17" /></button></div>
        </div>
        <div v-if="!editing && selected.translation_status!=='ready'" class="vocab-pending-panel">
          <RefreshCw :size="22" /><strong>{{ translationStatusText(selected.translation_status, true) }}</strong>
          <p>单词和真题原句已经安全保存。</p>
          <button v-if="selected.translation_status==='failed' || selected.translation_status==='pending'" class="button secondary" @click="retryTranslation">重试全部待翻译</button>
        </div>
        <template v-if="!editing && hasSelectedContent">
                <VocabularyMemoryContent :entry="selected" :config="displayConfig" :expanded="expandedAll" :expansion-token="expansionToken" />
                <p v-if="selected.enrichment_status === 'failed'" class="error vocab-enrich-error">补全失败：{{ selected.enrichment_error }}</p>
                <button v-if="selected.enrichment_status === 'failed'" class="button secondary" @click="retryTranslation">重试失败任务</button>
          <div class="detail-actions">
            <button class="button secondary" @click="put(`/vocabulary/${selected.id}`,{manually_frequent:!selected.manually_frequent}).then(()=>load())"><Star :size="16" />{{ selected.manually_frequent ? '取消重点' : '标记重点' }}</button>
            <button class="button" @click="put(`/vocabulary/${selected.id}`,{study_status:selected.study_status==='mastered'?'learning':'mastered'}).then(()=>load())"><Check :size="16" />{{ selected.study_status === 'mastered' ? '恢复学习' : '标记已掌握' }}</button>
          </div>
        </template>
        <div v-else-if="editing" class="vocab-edit">
          <label>音标<input v-model="editForm.phonetic"></label>
          <label>词性<input v-model="editForm.part_of_speech"></label>

          <label>常用释义<textarea rows="3" v-model="editForm.common_meaning"></textarea></label>
          <label>我的笔记<textarea rows="4" v-model="editForm.note"></textarea></label>
          <div><button class="button" @click="saveEdit">保存修改</button><button class="button ghost" @click="editing=false">取消</button></div>
        </div>
      </section>
      <section v-else class="vocab-detail desktop-vocab-detail card empty">选择一个单词查看详细释义与真题语境。</section>
    </div>
  </div>
</template>

<style scoped>
.vocab-reinforcement {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.vocab-tool-row { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.vocab-tool-row .search-field { margin: 0; min-width: 0; }
.vocab-filters-inline { display: contents; }

.vocab-reinforcement > div:first-child {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.vocab-reinforcement span {
  color: var(--muted);
  font-size: .84rem;
}

.vocab-reinforcement-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 统计改为紧凑摘要：一行小芯片，不再占用五张卡片的纵向空间。 */
.vocab-stats-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 15px;
}

.vocab-stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 44px;
  padding: 8px 15px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  font-size: 14px;
}

.vocab-stat-chip strong { color: var(--ink); font-weight: 650; }
.vocab-stat-chip.active { border-color: color-mix(in srgb, var(--primary) 45%, var(--line)); background: var(--primary-soft); color: var(--ink); }
.vocab-star { color: #c08a3e; flex: none; }
.vocab-detail-head > div:first-child { min-width: 0; }
.vocab-detail-head h2 { overflow-wrap: anywhere; }
.review-star { color: #c08a3e; }
.review-meaning-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
.review-part-of-speech { padding: 2px 8px; border-radius: 6px; background: var(--primary-soft); color: var(--ink); font-size: 13px; line-height: 1.5; }
.review-answer .review-meaning-block > strong { display: block; line-height: 1.65; overflow-wrap: anywhere; }
.detail-sentence { margin: 0; font-family: Cambria, Georgia, serif; font-size: 16px; line-height: 1.68; overflow-wrap: anywhere; white-space: normal; }
.vocab-enrich-error { white-space: normal; overflow-wrap: anywhere; line-height: 1.7; }

@media (max-width: 720px) {
  .vocab-reinforcement { grid-template-columns: 1fr; align-items: stretch; }
  .vocab-tool-row { grid-template-columns: 1fr; }
  .vocab-reinforcement {
    align-items: flex-start;
    flex-direction: column;
  }

  .vocab-reinforcement-actions,
  .vocab-reinforcement-actions .button {
    width: 100%;
  }

  .vocab-reinforcement-actions .button {
    flex: 1 1 72px;
  }
}
</style>
