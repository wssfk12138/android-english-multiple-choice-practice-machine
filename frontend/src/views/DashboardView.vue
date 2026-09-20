<script setup lang="ts">
import { Files, ListChecks, ArrowRight, BookOpen, ChevronRight, Sparkles, Star, TextCursorInput, ListOrdered, Headphones } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { get, post } from '../api'
import QuestionBankSwitcher from '../components/QuestionBankSwitcher.vue'
import StudyTodos from '../components/StudyTodos.vue'
import '../dashboard-glass.css'
import { useAndroidLandscape } from '../composables/useAndroidLandscape'

const router = useRouter()
const landscape = useAndroidLandscape()
const data = ref<any>(null)
const papers = ref<any[]>([])
const error = ref('')
const studyTodosFailed = ref(false)
const vocabulary = ref<any[]>([])
const tickerPaused = ref(false)
const vocabularyPage = ref(0)
const wordsPerPage = 4
let vocabularyTimer: number | null = null

const vocabularyPages = computed(() => {
  const pages: any[][] = []
  for (let index = 0; index < vocabulary.value.length; index += wordsPerPage) {
    pages.push(vocabulary.value.slice(index, index + wordsPerPage))
  }
  return pages
})
const visibleWords = computed(() =>
  vocabularyPages.value[vocabularyPage.value] || vocabularyPages.value[0] || [],
)
const publishedPapers = computed(() => papers.value.filter(
  paper => paper.status === 'published' && Number(paper.question_count || 0) > 0,
))
const resumeSession = computed(() => data.value?.resume_session || null)
const studyTodos = computed(() => data.value ? {
  profile_id: Number(data.value.profile_id || 0),
  resume_session: data.value.resume_session || null,
  review_count: Number(data.value.review_count || 0),
  frequent_count: Number(data.value.frequent_count || 0),
} : null)
const practiceTypeCount = (type: string) => Number(
  type === 'listening'
    ? data.value?.paper_type_counts?.listening || 0
    : data.value?.unit_type_counts?.[type] || 0,
)
const hasPracticeType = (type: string) => practiceTypeCount(type) > 0
const hasListening = computed(() => hasPracticeType('listening'))
const hasAnyPractice = computed(() => ['cloze', 'reading', 'part_b', 'listening'].some(hasPracticeType))
const practiceGridClass = computed(() => {
  const count = ['cloze', 'reading', 'part_b', 'listening'].filter(hasPracticeType).length
  if (count >= 4) return 'grid-4'
  if (count === 3) return 'grid-3'
  if (count === 2) return 'grid-2'
  return ''
})

function wordMeaning(word: any) {
  return word.common_meaning || word.contextual_meaning || '等待整理中'
}

function advanceVocabulary() {
  if (tickerPaused.value || vocabularyPages.value.length <= 1) return
  vocabularyPage.value = (vocabularyPage.value + 1) % vocabularyPages.value.length
}

function startVocabularyRotation() {
  if (vocabularyTimer !== null) window.clearInterval(vocabularyTimer)
  vocabularyTimer = window.setInterval(advanceVocabulary, 5000)
}

function wait(milliseconds: number) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds))
}

function reloadAfterAndroidStartup(event: Event) {
  if ((event as CustomEvent).detail?.needsHomeRefresh === true) void loadHome()
}

// 挂载时的首次加载和 Android 启动准备完成事件会同时触发首页刷新。用一个在途
// Promise 合并这两条路径，避免同一屏重复发出 /startup、/vocabulary/home 和
// /papers；加载期间再次请求只排队一次补跑，题库切换引起的刷新不会被丢掉。
let homeLoad: Promise<void> | null = null
let homeReloadQueued = false

let papersLoad: Promise<void> | null = null

function loadSecondaryHomeData() {
  papersLoad ||= (async () => {
    await new Promise<void>(resolve => {
      const run = () => resolve()
      const idle = (window as any).requestIdleCallback as ((callback: () => void, options?: { timeout: number }) => number) | undefined
      if (typeof idle === 'function') idle(run, { timeout: 1200 })
      else window.setTimeout(run, 500)
    })
    try { papers.value = await get('/papers') || [] } catch { /* Core home remains usable. */ }
  })().finally(() => { papersLoad = null })
}

function loadHome(): Promise<void> {
  homeReloadQueued = true
  homeLoad ||= (async () => {
    try {
      while (homeReloadQueued) {
        homeReloadQueued = false
        await refreshHome()
      }
    } finally {
      homeLoad = null
    }
  })()
  return homeLoad
}

async function refreshHome() {
  error.value = ''
  studyTodosFailed.value = false
  const embedded = (window as any).__LINJIAN_STARTUP__
  if (embedded) delete (window as any).__LINJIAN_STARTUP__

  let dashboardResult: PromiseSettledResult<any> | null = null
  let wordsResult: PromiseSettledResult<any> | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    [dashboardResult, wordsResult] = await Promise.allSettled([
      embedded && !data.value ? Promise.resolve(embedded) : get('/startup'),
      get('/vocabulary/home?limit=20'),
    ])
    if (dashboardResult.status === 'fulfilled') break
    if (attempt === 0) await wait(500)
  }
  if (dashboardResult?.status === 'fulfilled') data.value = dashboardResult.value
  else {
    studyTodosFailed.value = true
    error.value = '首页数据暂时没有加载成功，请刷新页面重试。'
  }
  if (wordsResult?.status === 'fulfilled') vocabulary.value = wordsResult.value.items || []
  vocabularyPage.value = 0
  loadSecondaryHomeData()
}

onMounted(async () => {
  window.addEventListener('android-startup-prepared', reloadAfterAndroidStartup)
  await loadHome()
  startVocabularyRotation()
})
onBeforeUnmount(() => {
  window.removeEventListener('android-startup-prepared', reloadAfterAndroidStartup)
  if (vocabularyTimer !== null) window.clearInterval(vocabularyTimer)
})

async function randomPractice(type: string) {
  if (!hasPracticeType(type)) {
    error.value = '当前题库配置中没有可练习的该题型，请先切换题库配置或导入题目。'
    return
  }
  try {
    const session: any = await post('/practice/sessions', {
      mode: 'random',
      unit_type: type,
      selection_scope: type === 'listening' ? 'paper_unit_type' : 'unit',
      count: 1,
      shuffle_options: true,
    })
    router.push(`/practice/${session.id}`)
  } catch (cause) { error.value = String(cause) }
}

async function startPaper(paperId: number) {
  try {
    const session: any = await post('/practice/sessions', {
      mode: 'paper', paper_id: paperId, shuffle_options: true,
    })
    router.push(`/practice/${session.id}`)
  } catch (cause) { error.value = String(cause) }
}

function scoreText(paper: any) {
  const fmt = (value: number) => (Number.isFinite(value) && Number.isInteger(value) ? String(value) : value.toFixed(1))
  return `${fmt(Number(paper.last_score) || 0)}/${fmt(Number(paper.last_max_score) || 0)}`
}

function resumePractice() {
  const session = resumeSession.value
  if (session?.id) router.push(`/practice/${session.id}`)
}
</script>

<template>
  <div class="page dashboard-page">
    <div class="desktop-dashboard glass-dashboard">
      <div class="dashboard-bank-row"><QuestionBankSwitcher :show-library-link="true" @changed="loadHome" /></div>
      <StudyTodos :tasks="studyTodos" :failed="studyTodosFailed" @retry="loadHome" />
      <div v-if="error" class="warning">{{ error }}</div>
      <section v-if="vocabulary.length" class="vocabulary-ticker card" @mouseenter="tickerPaused=true" @mouseleave="tickerPaused=false">
        <div class="ticker-heading"><div><h3>词汇回顾</h3></div><RouterLink to="/vocabulary">查看单词本 →</RouterLink></div>
        <div class="ticker-window"><Transition name="vocabulary-flip" mode="out-in"><div :key="vocabularyPage" class="ticker-group">
          <RouterLink v-for="word in visibleWords" :key="word.id" :to="`/vocabulary?word=${word.id}`" class="ticker-word">
            <Star v-if="word.is_frequent" class="vocab-star" :size="15" fill="currentColor" aria-label="高频词" />
            <span class="ticker-word-copy"><strong>{{ word.lemma || word.term }}</strong><small :title="wordMeaning(word)">{{ wordMeaning(word) }}</small></span>
          </RouterLink>
        </div></Transition></div>
      </section>
      <div v-if="hasAnyPractice" class="section-title"><h2>题型练习</h2></div>
      <div v-if="hasAnyPractice" class="grid practice-actions" :class="practiceGridClass">
        <button v-if="hasPracticeType('cloze')" class="card action-card" type="button" @click="randomPractice('cloze')"><span class="feature-icon orange"><TextCursorInput v-if="landscape" :size="27" :stroke-width="1.7" /><img v-else src="/assets/icons/cloze.png" alt="" /></span><span class="action-copy"><h3>完形填空</h3></span><ArrowRight class="action-arrow" :size="19" /></button>
        <button v-if="hasPracticeType('reading')" class="card action-card" type="button" @click="randomPractice('reading')"><span class="feature-icon sage"><BookOpen v-if="landscape" :size="27" :stroke-width="1.7" /><img v-else src="/assets/icons/reading.png" alt="" /></span><span class="action-copy"><h3>阅读理解</h3></span><ArrowRight class="action-arrow" :size="19" /></button>
        <button v-if="hasPracticeType('part_b')" class="card action-card" type="button" @click="randomPractice('part_b')"><span class="feature-icon blue"><ListOrdered v-if="landscape" :size="27" :stroke-width="1.7" /><img v-else src="/assets/icons/part-b.png" alt="" /></span><span class="action-copy"><h3>阅读 Part B</h3></span><ArrowRight class="action-arrow" :size="19" /></button>
        <button v-if="hasListening" class="card action-card listening-action" type="button" @click="randomPractice('listening')"><span class="feature-icon purple"><Headphones v-if="landscape" :size="27" :stroke-width="1.7" /><img v-else src="/assets/icons/listening.png" alt="" /></span><span class="action-copy"><h3>听力练习</h3></span><ArrowRight class="action-arrow" :size="19" /></button>
      </div>
      <section v-if="data" class="dashboard-bank-summary" aria-label="题库概览">
        <h2>题库概览</h2>
        <dl class="overview-grid">
          <div class="overview-stat"><dt><span>试卷</span><Files aria-hidden="true" /></dt><dd>{{ data.paper_count }}<small>套</small></dd></div>
          <div class="overview-stat"><dt><span>篇目</span><BookOpen aria-hidden="true" /></dt><dd>{{ data.unit_count }}<small>篇</small></dd></div>
          <div class="overview-stat"><dt><span>客观题</span><ListChecks aria-hidden="true" /></dt><dd>{{ data.question_count }}<small>道</small></dd></div>
        </dl>
      </section>
    </div>

    <div class="portrait-dashboard">
      <QuestionBankSwitcher :show-library-link="true" @changed="loadHome" />
      <div v-if="error" class="warning">{{ error }}</div>

      <button v-if="resumeSession" class="resume-practice card" type="button" @click="resumePractice">
        <span class="resume-icon"><ChevronRight :size="18" /></span>
        <span class="resume-copy">
          <small>继续上次未完成练习</small>
          <strong>{{ resumeSession.title || '未完成练习' }}</strong>
        </span>
      </button>

      <section v-if="data" class="portrait-overview" aria-label="学习概览">
        <div><strong>{{ data.paper_count }}</strong><span>试卷</span></div>
        <div><strong>{{ data.unit_count }}</strong><span>篇目</span></div>
        <div><strong>{{ data.question_count }}</strong><span>客观题</span></div>
        <RouterLink to="/wrong"><strong>{{ data.frequent_count }}</strong><span>高频错题</span></RouterLink>
      </section>

      <section v-if="hasAnyPractice" class="portrait-practice-grid" :class="{ 'has-listening': hasListening, 'without-listening': !hasListening }" aria-label="题型练习">
        <button v-if="hasListening" class="portrait-practice-card listening" type="button" @click="randomPractice('listening')"><img src="/assets/icons/listening.png" alt="" /><span><strong>听力</strong></span><ChevronRight :size="18" /></button>
        <button v-if="hasPracticeType('cloze')" class="portrait-practice-card cloze" type="button" @click="randomPractice('cloze')"><img src="/assets/icons/cloze.png" alt="" /><span><strong>完型填空</strong></span><ChevronRight :size="18" /></button>
        <button v-if="hasPracticeType('reading')" class="portrait-practice-card reading" type="button" @click="randomPractice('reading')"><img src="/assets/icons/reading.png" alt="" /><span><strong>阅读理解</strong></span><ChevronRight :size="18" /></button>
        <button v-if="hasPracticeType('part_b')" class="portrait-practice-card part-b" type="button" @click="randomPractice('part_b')"><img src="/assets/icons/part-b.png" alt="" /><span><strong>阅读 Part B</strong></span><ChevronRight :size="18" /></button>
      </section>
      <div v-else-if="data" class="card empty portrait-empty">当前题库还没有可练习题目，请在设置中导入或切换题库。</div>

      <section v-if="vocabulary.length" class="portrait-vocabulary card" @mouseenter="tickerPaused=true" @mouseleave="tickerPaused=false">
        <div class="portrait-section-head"><h2>词汇回顾</h2><RouterLink to="/vocabulary">单词本 <ChevronRight :size="15" /></RouterLink></div>
        <Transition name="vocabulary-flip" mode="out-in"><div :key="vocabularyPage" class="portrait-word-grid">
          <RouterLink v-for="word in visibleWords" :key="word.id" :to="`/vocabulary?word=${word.id}`"><span><strong>{{ word.lemma || word.term }}</strong><Star v-if="word.is_frequent" :size="13" fill="currentColor" /></span><small>{{ wordMeaning(word) }}</small></RouterLink>
        </div></Transition>
      </section>

      <section class="portrait-paper-section">
        <div class="portrait-section-head"><h2>真题试卷</h2><span>{{ publishedPapers.length }} 套</span></div>
        <div v-if="publishedPapers.length" class="portrait-paper-list">
          <button v-for="paper in publishedPapers" :key="paper.id" type="button" @click="startPaper(paper.id)"><strong>{{ paper.title }}</strong><span v-if="paper.active_session_id" class="pill">已做 {{ paper.active_done }}/{{ paper.unit_count }} 篇</span><span v-else-if="paper.last_score != null" class="pill">{{ scoreText(paper) }}</span></button>
        </div>
        <div v-else class="card empty">当前题库还没有可练习试卷。</div>
      </section>
    </div>
  </div>
</template>


<style scoped>
html:root[data-platform="android"][data-orientation="landscape"] body #app .glass-dashboard .practice-actions .feature-icon { display:grid; place-items:center; border-radius:14px; background:var(--primary-soft); color:var(--primary); }
html:root[data-platform="android"][data-orientation="landscape"] body #app .glass-dashboard .practice-actions .feature-icon.orange { background:var(--apricot); color:var(--ink); }
html:root[data-platform="android"][data-orientation="landscape"] body #app .glass-dashboard .practice-actions .feature-icon.purple { background:var(--lavender); color:var(--ink); }
html:root[data-platform="android"][data-orientation="landscape"] body #app .glass-dashboard .practice-actions .feature-icon.sage { background:color-mix(in srgb, var(--success) 14%, transparent); color:var(--success); }
.dashboard-bank-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.dashboard-bank-row :deep(.bank-switcher){flex:1;min-width:0;margin:0}.dashboard-bank-row>.button{flex-shrink:0}.dashboard-bank-summary{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px 20px;padding:14px 0;border-top:1px solid var(--line);color:var(--muted)}.dashboard-bank-summary h2{margin:0;font-size:.95rem;color:var(--ink)}.dashboard-bank-summary span{font-size:.88rem}.section-title h2{font-size:1.1rem;letter-spacing:0}
</style>
