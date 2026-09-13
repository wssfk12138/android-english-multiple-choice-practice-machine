<script setup lang="ts">
import VocabularyEnrichment from '../components/VocabularyEnrichment.vue'
import { BookOpen, Check, ChevronDown, RefreshCw, Search, Star, Trash2 } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { del, get, post, put } from '../api'
import { confirmDialog } from '../platform/dialogs'
import { loadVocabDisplayConfig } from '../services/vocabularyDisplayConfig'
import { reconcileDueQueue, orderedDueKeys, completeDueWord, wordKey, type DueQueue } from '../vocabulary-due-queue'

const route = useRoute()
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
const reviewKind = ref<'scheduled' | 'reinforcement'>('scheduled')
const reinforcementSize = ref(10)
const reveal = ref(false)
const reviewIndex = ref(0)
const scheduledWords = ref<any[]>([])
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
  return word?.review_revision || (word ? JSON.stringify([wordKey(word), word.last_reviewed_at, word.next_review_at, word.review_count, word.updated_at]) : '')
}
function refreshDueQueue(): Promise<void> {
  if (dueRefreshPromise) return dueRefreshPromise
  dueRefreshPromise = loadDueQueue().finally(() => { dueRefreshPromise = null })
  return dueRefreshPromise
}
async function loadDueQueue() {
  const previous = reviewRevision(reviewWord.value)
  // Review needs the complete due set; paging applies only to the browsing list.
  const result: any = await get(`/vocabulary?status=review${currentBankScope ? '&scope=current' : ''}&limit=all`)
  if (reviewDisposed) return
  counts.value = result.counts || counts.value
  dueQueueStorageKey = `vocab-due-queue:v1:${result.scope_key || (currentBankScope ? 'current' : 'all')}`
  let saved = null
  try { saved = JSON.parse(localStorage.getItem(dueQueueStorageKey) || 'null') } catch { /* Rebuild from durable reviews. */ }
  dueQueue = reconcileDueQueue(saved, result.items || [])
  persistDueQueue()
  const words = new Map<string, any>((result.items || []).map((word: any) => [wordKey(word), word]))
  scheduledWords.value = orderedDueKeys(dueQueue).map(key => words.get(key)).filter(Boolean)
  if (previous !== reviewRevision(reviewWord.value)) reveal.value = false
}
const reviewItems = computed(() => {
  if (reviewKind.value === 'scheduled') return scheduledWords.value
  const ready = items.value.filter(item => item.translation_status === 'ready')
  return reviewKind.value === 'reinforcement' ? ready.slice(0, reinforcementSize.value) : scheduledWords.value
})
// The browsing list pages (PAGE_SIZE rows per step); review flows fetch the
// complete due set through limit=all so paging never truncates a queue.
const PAGE_SIZE = 100
const hasMore = ref(false)
const loadingMore = ref(false)
const listSentinel = ref<HTMLElement | null>(null)
let listObserver: IntersectionObserver | null = null
function listUrl(limitClause: string) {
  return `/vocabulary?status=${filter.value}&search=${encodeURIComponent(search.value)}${currentBankScope ? '&scope=current' : ''}&${limitClause}`
}
function applyLoadedPage(result: any) {
  const rows = result.items || []
  const more = rows.length > PAGE_SIZE
  items.value = more ? rows.slice(0, PAGE_SIZE) : rows
  counts.value = result.counts || counts.value
  hasMore.value = more
}
const reviewWord = computed(() => reviewItems.value[reviewIndex.value])
const displayConfig = ref(loadVocabDisplayConfig())
const expandedAll = ref(false)
const enrichmentPending = ref(false)
async function enrichSelected() {
  if (!selected.value || enrichmentPending.value) return
  enrichmentPending.value = true
  const id = selected.value.id
  try {
    const result = await post(`/vocabulary/${id}/enrichment`)
    if (selected.value?.id === id) selected.value = result
    notice.value = (result as any).enrichment_status === 'ready' ? '词形和例句已补全，手动释义已保留' : '补全任务已保存，稍后可查看结果'
  } catch (cause) { error.value = String(cause) }
  finally {
    enrichmentPending.value = false
    startTranslationRefresh()
  }
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
  if (translationRefreshBusy || reviewDisposed || reviewMode.value) return
  if (document.visibilityState === 'hidden') return
  translationRefreshTick += 1
  if (translationRefreshTick % translationRefreshStride() !== 0) return
  translationRefreshBusy = true
  try {
    const next: any = await get('/vocabulary/translation-status')
    const previous = translationProgress.value
    translationProgress.value = next
    if (!(next.queued > 0 || next.translating > 0 || next.enrichment_queued > 0 || next.enrichment_inflight > 0)) {
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
  try {
    const result: any = await post('/vocabulary/translation-runs', {
      entry_ids: [],
      trigger: 'vocabulary_open',
    })
    await load()
    startTranslationRefresh()
  } catch (cause) {
    error.value = String(cause)
    await load()
  }
}

async function load(preferredId?: number, options: { all?: boolean } = {}) {
  try {
    const result: any = await get(listUrl(options.all ? 'limit=all' : `limit=${PAGE_SIZE + 1}&offset=0`))
    error.value = ''
    if (options.all) {
      items.value = result.items || []
      counts.value = result.counts || counts.value
      hasMore.value = false
    } else {
      applyLoadedPage(result)
    }
    const requested = preferredId ?? Number(route.query.word)
    const target = items.value.find(item => item.id === requested)
    if (target) await select(target.id, false)
    else if (!selected.value && !isNarrowListContext() && items.value[0]) await select(items.value[0].id, false)
  } catch (e) { error.value = String(e) }
}

async function loadMore() {
  if (loadingMore.value || reviewMode.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const result: any = await get(listUrl(`limit=${PAGE_SIZE + 1}&offset=${items.value.length}`))
    const rows = result.items || []
    const more = rows.length > PAGE_SIZE
    items.value = [...items.value, ...(more ? rows.slice(0, PAGE_SIZE) : rows)]
    counts.value = result.counts || counts.value
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
    expandedAll.value = false
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
    // Reconcile the durable queue before submitting a scheduled review so a
    // card removed or changed by another device cannot receive a stale rating.
    if (targetMode === 'scheduled') await refreshDueQueue()
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
    await post(`/vocabulary/${target.id}/review`, { rating, mode: targetMode, expected_revision: target.review_revision })
    if (reviewDisposed || !reviewMode.value || revision !== reviewRevision(reviewWord.value) || targetMode !== reviewKind.value) return
    if (targetMode === 'scheduled') {
      dueQueue = completeDueWord(dueQueue, completedKey)
      persistDueQueue()
      scheduledWords.value = scheduledWords.value.filter(word => wordKey(word) !== completedKey)
      reveal.value = false
    }
    reveal.value = false
    if (targetMode === 'reinforcement') {
      await load()
      reviewIndex.value += 1
    }
    if (!reviewItems.value.length || reviewIndex.value >= reviewItems.value.length) {
      reviewMode.value = false
      reviewIndex.value = 0
      notice.value = targetMode === 'scheduled' ? '今日到期复习已完成' : '本轮额外巩固已完成'
      await load()
    }
  } catch (cause) { error.value = String(cause) }
  finally { reviewSaving.value = false }
}

async function startReview() {
  if (reviewSaving.value) return
  reviewKind.value = 'scheduled'
  reveal.value = false
  reviewIndex.value = 0
  // 先进入复习视图并渲染等高骨架卡，到期队列在后台落地后再替换内容，
  // 这样点击反馈不再等待 limit=all 的整表查询。
  reviewMode.value = true
  reviewLoading.value = true
  const token = reviewLoadToken + 1
  reviewLoadToken = token
  try {
    await refreshDueQueue()
  } catch (cause) {
    error.value = String(cause)
  } finally {
    if (token === reviewLoadToken) reviewLoading.value = false
  }
}

async function closeReview() {
  if (reviewSaving.value) return
  reviewMode.value = false
  reviewIndex.value = 0
  await load(selected.value?.id)
}

async function startReinforcement(size: number) {
  if (reviewSaving.value) return
  reinforcementSize.value = size
  reviewKind.value = 'reinforcement'
  reveal.value = false
  reviewIndex.value = 0
  filter.value = 'all'
  await load(undefined, { all: true })
  reviewMode.value = true
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
})
onBeforeUnmount(stopTranslationRefresh)

const statChips = computed(() => [
  { key: 'all', label: '全部', count: counts.value.total || 0 },
  { key: 'frequent', label: '高频词', count: counts.value.frequent || 0 },
  { key: 'review', label: '今日到期', count: counts.value.review || 0 },
  { key: 'mastered', label: '已掌握', count: counts.value.mastered || 0 },
  { key: 'pending', label: '等待翻译', count: counts.value.pending || 0 },
])

const listFilters = [
  ['all', '全部单词'],
  ['review', '今日复习'],
  ['frequent', '高频词'],
  ['learning', '学习中'],
  ['mastered', '已掌握'],
  ['pending', '等待翻译'],
] as const
</script>

<template>
  <div class="page vocabulary-page">
    <div class="page-head">
      <div><h1>我的单词本</h1><span v-if="currentBankScope" class="muted">当前题库</span></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="button" @click="startReview"><BookOpen :size="17" />今日到期 {{ counts.review || 0 }}</button>
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
        :class="{ active: filter === chip.key }"
        type="button"
        @click="filter = chip.key"
      >
        {{ chip.label }} <strong>{{ chip.count }}</strong>
      </button>
    </div>

    <section v-if="!reviewMode" class="vocab-reinforcement card">
      <div><strong>额外巩固</strong><span>不改变正式复习计划，可反复练习</span></div>
      <div class="vocab-reinforcement-actions">
        <button v-for="size in [5, 10, 20]" :key="size" class="button secondary compact" type="button" @click="startReinforcement(size)">{{ size }} 词</button>
      </div>
    </section>

    <section v-if="reviewMode" class="review-overlay vocabulary-review-overlay">
      <div v-if="reviewLoading" class="review-card vocabulary-review-card" data-review-fullscreen aria-busy="true">
        <header class="review-header">
          <strong>{{ reviewKind === 'scheduled' ? '到期复习' : '额外巩固' }} <span>{{ String(reviewIndex + 1).padStart(2, '0') }} / --</span></strong>
          <button class="review-close" type="button" title="退出复习" aria-label="退出复习" :disabled="reviewSaving" @click="closeReview">×</button>
        </header>
        <div class="review-content">
          <div class="review-term">…</div>
          <div class="review-phonetic"></div>
          <button class="button secondary reveal-button" type="button" disabled>显示释义和原句</button>
        </div>
      </div>
      <div v-else-if="reviewWord" class="review-card vocabulary-review-card" data-review-fullscreen>
        <header class="review-header">
          <strong>{{ reviewKind === 'scheduled' ? '到期复习' : '额外巩固' }} <span>{{ String(reviewIndex + 1).padStart(2, '0') }} / {{ String(reviewItems.length).padStart(2, '0') }}</span></strong>
          <button class="review-close" type="button" title="退出复习" aria-label="退出复习" :disabled="reviewSaving" @click="closeReview">×</button>
        </header>
        <div class="review-content">
          <div class="review-term"><Star v-if="reviewWord.is_frequent" class="review-star" :size="22" aria-label="高频词" />{{ reviewWord.term }}</div>
          <div class="review-phonetic">{{ reviewWord.phonetic }}</div>
          <button v-if="!reveal" class="button secondary reveal-button" @click="reveal=true">显示释义和原句</button>
          <div v-else class="review-answer">
            <VocabularyEnrichment :entry="reviewWord" :show-morphology="displayConfig.morphology" :show-sentence="displayConfig.sentence" />
            <section class="review-meaning-block">
              <small>常用释义</small>
              <strong>{{ reviewWord.common_meaning || reviewWord.contextual_meaning }}</strong>
            </section>
            <section v-if="displayConfig.contextual && reviewWord.contextual_meaning && reviewWord.contextual_meaning !== reviewWord.common_meaning" class="review-meaning-block">
              <small>本句语境</small>
              <p>{{ reviewWord.contextual_meaning }}</p>
            </section>
            <section v-if="reviewWord.latest_sentence && displayConfig.sentence" class="review-sentence-block">
              <small>真题原句</small>
              <blockquote>{{ reviewWord.latest_sentence }}</blockquote>
            </section>
          </div>
        </div>
        <footer v-if="reveal" class="review-actions">
          <button class="button secondary" @click="rate('hard')">困难</button>
          <button class="button secondary" @click="rate('know')">认识</button>
          <button class="button" @click="rate('fluent')">熟练</button>
        </footer>
      </div>
      <div v-else class="card empty vocab-review-empty">
        <p>今天没有待复习的单词。</p>
        <button class="button secondary" type="button" :disabled="reviewSaving" @click="closeReview">退出复习</button>
      </div>
    </section>

    <div v-else class="vocabulary-layout">
      <div class="vocab-list-column">
        <aside class="vocab-filters card">
          <div class="search-field"><Search :size="16" /><input v-model="search" placeholder="搜索单词或释义"></div>
          <button v-for="item in listFilters" :key="item[0]" :class="{active:filter===item[0]}" @click="filter=item[0]">{{ item[1] }}</button>
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
                <div><span v-if="selected.is_frequent" class="eyebrow">高频词</span><h2>{{ selected.lemma || selected.term }}</h2><p>{{ selected.phonetic }}<span v-if="selected.part_of_speech">{{ selected.phonetic ? ' · ' : '' }}{{ selected.part_of_speech }}</span></p></div>
                <div class="vocab-tools"><button class="button ghost" @click="expandedAll=!expandedAll">{{ expandedAll ? '收起' : '展开全部' }}</button><button class="button ghost" @click="editing=!editing">编辑</button><button class="button ghost danger-text" aria-label="删除单词" @click="removeEntry"><Trash2 :size="17" /></button></div>
              </div>
              <div v-if="!editing && selected.translation_status!=='ready'" class="vocab-pending-panel">
                <RefreshCw :size="22" /><strong>{{ translationStatusText(selected.translation_status, true) }}</strong>
                <p>单词和真题原句已经安全保存。</p>
                <button v-if="selected.translation_status==='failed' || selected.translation_status==='pending'" class="button secondary" @click="retryTranslation">重试全部待翻译</button>
              </div>
              <template v-if="!editing && hasSelectedContent">
                <VocabularyEnrichment :entry="selected" :show-morphology="displayConfig.morphology" :show-sentence="displayConfig.sentence || expandedAll" />
                <div v-if="displayConfig.common_meaning || expandedAll" class="detail-section"><label>常用释义</label><strong>{{ selected.common_meaning || selected.contextual_meaning }}</strong></div>
                <div v-if="selected.contextual_meaning && selected.contextual_meaning !== selected.common_meaning && (displayConfig.contextual || expandedAll)" class="detail-section"><label>本句语境</label><p>{{ selected.contextual_meaning }}</p></div>
                <div v-if="selected.latest_sentence && (displayConfig.sentence || expandedAll)" class="detail-section"><label>真题原句</label><blockquote class="detail-sentence">{{ selected.latest_sentence }}</blockquote><small>{{ selected.occurrences?.length ? `${selected.occurrences[0].year || '未知年份'} · ${selected.occurrences[0].unit_title || selected.occurrences[0].unit_type || ''}` : '' }}</small></div>
                <div v-if="selected.synonyms?.length && (displayConfig.synonyms || expandedAll)" class="detail-section discrimination-section"><label>同义词辨析</label><ul class="discrimination-list"><li v-for="item in selected.synonyms" :key="`ps-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}</span></li></ul></div>
                <div v-if="selected.antonyms?.length && (displayConfig.antonyms || expandedAll)" class="detail-section discrimination-section"><label>反义词辨析</label><ul class="discrimination-list"><li v-for="item in selected.antonyms" :key="`pa-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}</span></li></ul></div>
                <div v-if="(selected.local_similar?.length || selected.similar_forms?.length) && (displayConfig.similar_forms || expandedAll)" class="detail-section discrimination-section"><label>形近词辨析</label><ul class="discrimination-list"><li v-for="item in selected.local_similar" :key="`pl-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}<em class="source-tag">本地</em></span></li><li v-for="item in selected.similar_forms" :key="`pm-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}</span></li></ul></div>
                <div v-if="selected.memory_hint && (displayConfig.memory_hint || expandedAll)" class="detail-section memory-hint"><label>记忆提示</label><p>{{ selected.memory_hint }}</p></div>
                <div v-if="selected.note" class="detail-section"><label>我的笔记</label><p>{{ selected.note }}</p></div>
                <p v-if="selected.enrichment_status === 'failed'" class="error vocab-enrich-error">补全失败：{{ selected.enrichment_error }}，可点击下方按钮重试。</p>
                <p v-else-if="['queued','inflight'].includes(selected.enrichment_status)">词形与例句补全任务已保存，正在排队或处理中。</p>
                <button class="button secondary" :disabled="enrichmentPending" @click="enrichSelected">{{ enrichmentPending ? '正在补全…' : '补全词形与例句' }}</button>
                <div class="detail-actions"><button class="button secondary" @click="put(`/vocabulary/${selected.id}`,{manually_frequent:!selected.manually_frequent}).then(()=>load())"><Star :size="16" />{{ selected.manually_frequent ? '取消重点' : '标记重点' }}</button><button class="button" @click="put(`/vocabulary/${selected.id}`,{study_status:selected.study_status==='mastered'?'learning':'mastered'}).then(()=>load())"><Check :size="16" />{{ selected.study_status === 'mastered' ? '恢复学习' : '标记已掌握' }}</button></div>
              </template>
              <div v-else-if="editing" class="vocab-edit"><label>音标<input v-model="editForm.phonetic"></label><label>词性<input v-model="editForm.part_of_speech"></label><label>当前语境释义<textarea rows="3" v-model="editForm.contextual_meaning"></textarea></label><label>常用释义<textarea rows="3" v-model="editForm.common_meaning"></textarea></label><label>我的笔记<textarea rows="4" v-model="editForm.note"></textarea></label><div><button class="button" @click="saveEdit">保存修改</button><button class="button ghost" @click="editing=false">取消</button></div></div>
            </section>
          </template>
          <div v-if="!items.length" class="empty">这里还没有符合条件的单词。</div>
          <div ref="listSentinel" aria-hidden="true"></div>
        </section>
      </div>

      <section class="vocab-detail desktop-vocab-detail card" v-if="selected">
        <div class="vocab-detail-head">
          <div><span v-if="selected.is_frequent" class="eyebrow">高频词</span><h2>{{ selected.lemma || selected.term }}</h2><p>{{ selected.phonetic }}<span v-if="selected.part_of_speech">{{ selected.phonetic ? ' · ' : '' }}{{ selected.part_of_speech }}</span></p></div>
          <div class="vocab-tools"><button class="button ghost" @click="expandedAll=!expandedAll">{{ expandedAll ? '收起全部' : '展开全部' }}</button><button class="button ghost" @click="editing=!editing">编辑</button><button class="button ghost danger-text" @click="removeEntry"><Trash2 :size="17" /></button></div>
        </div>
        <div v-if="!editing && selected.translation_status!=='ready'" class="vocab-pending-panel">
          <RefreshCw :size="22" /><strong>{{ translationStatusText(selected.translation_status, true) }}</strong>
          <p>单词和真题原句已经安全保存。</p>
          <button v-if="selected.translation_status==='failed' || selected.translation_status==='pending'" class="button secondary" @click="retryTranslation">重试全部待翻译</button>
        </div>
        <template v-if="!editing && hasSelectedContent">
          <VocabularyEnrichment :entry="selected" :show-morphology="displayConfig.morphology" :show-sentence="displayConfig.sentence || expandedAll" />
          <div v-if="displayConfig.common_meaning || expandedAll" class="detail-section"><label>常用释义</label><strong>{{ selected.common_meaning || selected.contextual_meaning }}</strong></div>
          <div v-if="selected.contextual_meaning && selected.contextual_meaning !== selected.common_meaning && (displayConfig.contextual || expandedAll)" class="detail-section"><label>本句语境</label><p>{{ selected.contextual_meaning }}</p></div>
          <div v-if="selected.latest_sentence && (displayConfig.sentence || expandedAll)" class="detail-section"><label>真题原句</label><blockquote class="detail-sentence">{{ selected.latest_sentence }}</blockquote><small>{{ selected.occurrences?.length ? `${selected.occurrences[0].year || '未知年份'} · ${selected.occurrences[0].unit_title || selected.occurrences[0].unit_type || ''}` : '' }}</small></div>
          <div v-if="selected.synonyms?.length && (displayConfig.synonyms || expandedAll)" class="detail-section discrimination-section">
            <label>同义词辨析</label>
            <ul class="discrimination-list">
              <li v-for="item in selected.synonyms" :key="`s-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}</span></li>
            </ul>
          </div>
          <div v-if="selected.antonyms?.length && (displayConfig.antonyms || expandedAll)" class="detail-section discrimination-section">
            <label>反义词辨析</label>
            <ul class="discrimination-list">
              <li v-for="item in selected.antonyms" :key="`a-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}</span></li>
            </ul>
          </div>
          <div v-if="(selected.local_similar?.length || selected.similar_forms?.length) && (displayConfig.similar_forms || expandedAll)" class="detail-section discrimination-section">
            <label>形近词辨析</label>
            <ul class="discrimination-list">
              <li v-for="item in selected.local_similar" :key="`l-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}<em class="source-tag">本地</em></span></li>
              <li v-for="item in selected.similar_forms" :key="`m-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}</span></li>
            </ul>
          </div>
          <div v-if="selected.memory_hint && (displayConfig.memory_hint || expandedAll)" class="detail-section memory-hint"><label>记忆提示</label><p>{{ selected.memory_hint }}</p></div>
          <div v-if="selected.note" class="detail-section"><label>我的笔记</label><p>{{ selected.note }}</p></div>
          <p v-if="selected.enrichment_status === 'failed'" class="error vocab-enrich-error">补全失败：{{ selected.enrichment_error }}，可点击下方按钮重试。</p>
          <p v-else-if="['queued','inflight'].includes(selected.enrichment_status)">词形与例句补全任务已保存，正在排队或处理中。</p>
          <button class="button secondary" :disabled="enrichmentPending" @click="enrichSelected">{{ enrichmentPending ? '正在补全…' : '补全词形与例句' }}</button>
          <div class="detail-actions">
            <button class="button secondary" @click="put(`/vocabulary/${selected.id}`,{manually_frequent:!selected.manually_frequent}).then(()=>load())"><Star :size="16" />{{ selected.manually_frequent ? '取消重点' : '标记重点' }}</button>
            <button class="button" @click="put(`/vocabulary/${selected.id}`,{study_status:selected.study_status==='mastered'?'learning':'mastered'}).then(()=>load())"><Check :size="16" />{{ selected.study_status === 'mastered' ? '恢复学习' : '标记已掌握' }}</button>
          </div>
        </template>
        <div v-else-if="editing" class="vocab-edit">
          <label>音标<input v-model="editForm.phonetic"></label>
          <label>词性<input v-model="editForm.part_of_speech"></label>
          <label>当前语境释义<textarea rows="3" v-model="editForm.contextual_meaning"></textarea></label>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

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
.review-star { color: #c08a3e; }
.detail-sentence { margin: 0; font-family: Cambria, Georgia, serif; font-size: 16px; line-height: 1.68; overflow-wrap: anywhere; white-space: normal; }
.vocab-enrich-error { white-space: normal; overflow-wrap: anywhere; line-height: 1.7; }

@media (max-width: 720px) {
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
