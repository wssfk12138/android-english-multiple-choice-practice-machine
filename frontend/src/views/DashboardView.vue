<script setup lang="ts">
import { ArrowRight, BookOpen, ChevronRight, Sparkles, Star } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { get, post } from '../api'
import QuestionBankSwitcher from '../components/QuestionBankSwitcher.vue'

const router = useRouter()
const data = ref<any>(null)
const papers = ref<any[]>([])
const error = ref('')
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
const hasListening = computed(() => Number(data.value?.paper_type_counts?.listening || 0) > 0)
const hasPracticeType = (type: string) => Number(data.value?.unit_type_counts?.[type] || 0) > 0
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

function reloadAfterAndroidStartup() {
  void loadHome()
}

async function loadHome() {
  error.value = ''
  const embedded = (window as any).__LINJIAN_STARTUP__
  if (embedded) delete (window as any).__LINJIAN_STARTUP__

  let dashboardResult: PromiseSettledResult<any> | null = null
  let wordsResult: PromiseSettledResult<any> | null = null
  let papersResult: PromiseSettledResult<any> | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    [dashboardResult, wordsResult, papersResult] = await Promise.allSettled([
      embedded && !data.value ? Promise.resolve(embedded) : get('/startup'),
      get('/vocabulary/home?limit=20'),
      get('/papers'),
    ])
    if (dashboardResult.status === 'fulfilled') break
    if (attempt === 0) await wait(500)
  }
  if (dashboardResult?.status === 'fulfilled') data.value = dashboardResult.value
  else error.value = '首页数据暂时没有加载成功，请刷新页面重试。'
  if (wordsResult?.status === 'fulfilled') vocabulary.value = wordsResult.value.items || []
  if (papersResult?.status === 'fulfilled') papers.value = papersResult.value || []
  vocabularyPage.value = 0
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
</script>

<template>
  <div class="page dashboard-page">
    <div class="desktop-dashboard">
      <div class="page-head study-hero">
        <div class="study-hero-copy">
          <span class="eyebrow">YOUR QUIET STUDY SPACE</span>
          <h1>今天想练些什么？</h1>
          <p class="lead">选一篇文章，留一点安静的时间给自己。</p>
          <RouterLink class="button" to="/library"><BookOpen :size="17" />查看全部题库<ArrowRight :size="16" /></RouterLink>
        </div>
      </div>
      <QuestionBankSwitcher @changed="loadHome" />
      <div v-if="error" class="warning">{{ error }}</div>
      <section v-if="vocabulary.length" class="vocabulary-ticker card" @mouseenter="tickerPaused=true" @mouseleave="tickerPaused=false">
        <div class="ticker-heading"><div><span class="eyebrow">VOCABULARY REVIEW</span><h3>词汇回顾</h3></div><RouterLink to="/vocabulary">查看单词本 →</RouterLink></div>
        <div class="ticker-window"><Transition name="vocabulary-flip" mode="out-in"><div :key="vocabularyPage" class="ticker-group">
          <RouterLink v-for="word in visibleWords" :key="word.id" :to="`/vocabulary?word=${word.id}`" class="ticker-word">
            <Star v-if="word.is_frequent" class="vocab-star" :size="15" fill="currentColor" aria-label="高频词" />
            <span class="ticker-word-copy"><strong>{{ word.lemma || word.term }}</strong><small :title="wordMeaning(word)">{{ wordMeaning(word) }}</small></span>
          </RouterLink>
        </div></Transition></div>
      </section>
      <div v-if="hasAnyPractice" class="grid practice-actions" :class="practiceGridClass">
        <button v-if="hasPracticeType('cloze')" class="card action-card" type="button" @click="randomPractice('cloze')"><span class="feature-icon orange"><img src="/assets/icons/cloze.png" alt="" /></span><span class="action-copy"><small>整篇提交</small><h3>完型填空</h3><p>随机抽取一整篇，在完整语境中完成练习。</p></span><ArrowRight class="action-arrow" :size="19" /></button>
        <button v-if="hasPracticeType('reading')" class="card action-card" type="button" @click="randomPractice('reading')"><span class="feature-icon sage"><img src="/assets/icons/reading.png" alt="" /></span><span class="action-copy"><small>一篇文章</small><h3>阅读理解</h3><p>按文章完整练习，专注理解论证与细节。</p></span><ArrowRight class="action-arrow" :size="19" /></button>
        <button v-if="hasPracticeType('part_b')" class="card action-card" type="button" @click="randomPractice('part_b')"><span class="feature-icon blue"><img src="/assets/icons/part-b.png" alt="" /></span><span class="action-copy"><small>排序 · 填入 · 匹配</small><h3>阅读 Part B</h3><p>辨认结构、衔接与观点。</p></span><ArrowRight class="action-arrow" :size="19" /></button>
        <button v-if="hasListening" class="card action-card" type="button" @click="randomPractice('listening')"><span class="feature-icon purple"><img src="/assets/icons/listening.png" alt="" /></span><span class="action-copy"><small>随机一套</small><h3>听力单刷</h3><p>完成一套试卷的完整听力部分。</p></span><ArrowRight class="action-arrow" :size="19" /></button>
      </div>
      <div class="section-title"><h2>学习概览</h2></div>
      <div v-if="data" class="grid grid-4">
        <div class="card"><span class="stat-label">已收录试卷</span><div class="stat-value">{{ data.paper_count }}</div></div>
        <div class="card"><span class="stat-label">练习篇目</span><div class="stat-value">{{ data.unit_count }}</div></div>
        <div class="card"><span class="stat-label">客观题</span><div class="stat-value">{{ data.question_count }}</div></div>
        <RouterLink to="/wrong" class="card stat-card linked"><span class="stat-label">高频错题</span><div class="stat-value">{{ data.frequent_count }}</div></RouterLink>
      </div>
      <div class="section-title"><h2>温柔提醒</h2></div>
      <div class="card gentle-reminder"><span class="icon blue" style="margin:0"><Sparkles /></span><div><h3>理解文章，比记住答案更重要。</h3><p class="lead">选项可以每次打乱，但文章中的逻辑不会改变。</p></div></div>
    </div>

    <div class="portrait-dashboard">
      <QuestionBankSwitcher @changed="loadHome" />
      <div v-if="error" class="warning">{{ error }}</div>

      <section v-if="data" class="portrait-overview" aria-label="学习概览">
        <div><strong>{{ data.paper_count }}</strong><span>试卷</span></div>
        <div><strong>{{ data.unit_count }}</strong><span>篇目</span></div>
        <div><strong>{{ data.question_count }}</strong><span>客观题</span></div>
        <RouterLink to="/wrong"><strong>{{ data.frequent_count }}</strong><span>高频错题</span></RouterLink>
      </section>

      <section v-if="hasAnyPractice" class="portrait-practice-grid" :class="{ 'has-listening': hasListening, 'without-listening': !hasListening }" aria-label="题型练习">
        <button v-if="hasListening" class="portrait-practice-card listening" type="button" @click="randomPractice('listening')"><img src="/assets/icons/listening.png" alt="" /><span><strong>听力</strong><small>整套练习</small></span><ChevronRight :size="18" /></button>
        <button v-if="hasPracticeType('cloze')" class="portrait-practice-card cloze" type="button" @click="randomPractice('cloze')"><img src="/assets/icons/cloze.png" alt="" /><span><strong>完型填空</strong><small>随机一篇</small></span><ChevronRight :size="18" /></button>
        <button v-if="hasPracticeType('reading')" class="portrait-practice-card reading" type="button" @click="randomPractice('reading')"><img src="/assets/icons/reading.png" alt="" /><span><strong>阅读理解</strong><small>随机一篇</small></span><ChevronRight :size="18" /></button>
        <button v-if="hasPracticeType('part_b')" class="portrait-practice-card part-b" type="button" @click="randomPractice('part_b')"><img src="/assets/icons/part-b.png" alt="" /><span><strong>阅读 Part B</strong><small>随机一篇</small></span><ChevronRight :size="18" /></button>
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
          <button v-for="paper in publishedPapers" :key="paper.id" type="button" @click="startPaper(paper.id)"><strong>{{ paper.title }}</strong></button>
        </div>
        <div v-else class="card empty">当前题库还没有可练习试卷。</div>
      </section>
    </div>
  </div>
</template>
