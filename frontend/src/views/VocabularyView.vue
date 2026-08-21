<script setup lang="ts">
import { BookOpen, Check, ChevronDown, RefreshCw, Search, Star, Trash2 } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { del, get, post, put } from '../api'

const route = useRoute()
const items = ref<any[]>([])
const counts = ref<any>({ total:0, frequent:0, mastered:0, pending:0, review:0 })
const selected = ref<any>(null)
const filter = ref('all')
const search = ref('')
const error = ref('')
const notice = ref('')
const editing = ref(false)
const editForm = reactive<any>({})
const reviewMode = ref(false)
const reviewKind = ref<'scheduled' | 'reinforcement'>('scheduled')
const reinforcementSize = ref(10)
const reveal = ref(false)
const reviewIndex = ref(0)
const reviewItems = computed(() => {
  const ready = items.value.filter(item => item.translation_status === 'ready')
  return reviewKind.value === 'reinforcement' ? ready.slice(0, reinforcementSize.value) : ready
})
const reviewWord = computed(() => reviewItems.value[reviewIndex.value])
const DISPLAY_DEFAULTS: Record<string, boolean> = {
  common_meaning: true,
  contextual: true,
  sentence: true,
  memory_hint: false,
  synonyms: false,
  antonyms: false,
  similar_forms: false,
}
function loadDisplayConfig(): Record<string, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem('vocab-display-config') || '{}')
    return { ...DISPLAY_DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) }
  } catch {
    return { ...DISPLAY_DEFAULTS }
  }
}
const displayConfig = ref<Record<string, boolean>>(loadDisplayConfig())
const expandedAll = ref(false)

function isAndroidPortrait() {
  return document.documentElement.dataset.platform === 'android'
    && document.documentElement.dataset.orientation === 'portrait'
}

function translationStatusText(status: string, detail = false) {
  if (status === 'translating') return detail ? '模型正在后台翻译' : '正在后台翻译…'
  if (status === 'queued') return detail ? '已提交后台翻译' : '正在等待后台翻译…'
  if (status === 'failed') return detail ? '翻译失败，可重新尝试' : '翻译失败，可重试'
  return detail ? '退出答题界面后开始后台翻译' : '等待后台翻译…'
}

let translationRefreshTimer = 0
let translationRefreshAttempts = 0

async function refreshTranslationStatuses() {
  if (editing.value || reviewMode.value) return
  try {
    const result: any = await get(`/vocabulary?status=${filter.value}&search=${encodeURIComponent(search.value)}`)
    items.value = result.items || []
    counts.value = result.counts || counts.value
    if (selected.value && selected.value.translation_status !== 'ready') {
      selected.value = await get(`/vocabulary/${selected.value.id}`)
      Object.assign(editForm, selected.value)
    }
    translationRefreshAttempts += 1
    if (!(counts.value.pending > 0) || translationRefreshAttempts >= 24) {
      window.clearInterval(translationRefreshTimer)
      translationRefreshTimer = 0
    }
  } catch {
    window.clearInterval(translationRefreshTimer)
    translationRefreshTimer = 0
  }
}

async function startPendingTranslations() {
  try {
    const result: any = await post('/vocabulary/translation-runs', {
      entry_ids: [],
      trigger: 'vocabulary_open',
    })
    await load()
    if (result.workerStarted && counts.value.pending > 0 && !translationRefreshTimer) {
      translationRefreshAttempts = 0
      translationRefreshTimer = window.setInterval(refreshTranslationStatuses, 2500)
    }
  } catch (cause) {
    error.value = String(cause)
    await load()
  }
}

async function load() {
  try {
    const result: any = await get(`/vocabulary?status=${filter.value}&search=${encodeURIComponent(search.value)}`)
    error.value = ''
    items.value = result.items || []
    counts.value = result.counts || counts.value
    const requested = Number(route.query.word)
    const target = items.value.find(item => item.id === requested) || items.value[0]
    if (target) await select(target.id)
    else selected.value = null
  } catch (e) { error.value = String(e) }
}

async function select(id: number) {
  if (selected.value?.id === id && isAndroidPortrait()) {
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
  await load()
}

async function removeEntry() {
  if (!selected.value || !confirm(`删除 ${selected.value.term} 吗？`)) return
  await del(`/vocabulary/${selected.value.id}`)
  selected.value = null
  await load()
}

async function retryTranslation() {
  const result: any = await post(`/vocabulary/${selected.value.id}/retry`)
  notice.value = result.workerStarted ? '已重新提交后台翻译' : '已重新提交翻译'
  await load()
  if (!translationRefreshTimer) {
    translationRefreshAttempts = 0
    translationRefreshTimer = window.setInterval(refreshTranslationStatuses, 2500)
  }
}

async function rate(rating: string) {
  if (!reviewWord.value) return
  await post(`/vocabulary/${reviewWord.value.id}/review`, { rating, mode: reviewKind.value })
  reveal.value = false
  await load()
  if (reviewKind.value === 'reinforcement') reviewIndex.value += 1
  if (!reviewItems.value.length || reviewIndex.value >= reviewItems.value.length) {
    reviewMode.value = false
    reviewIndex.value = 0
    notice.value = reviewKind.value === 'scheduled' ? '今日到期复习已完成' : '本轮额外巩固已完成'
  }
}

async function startReview() {
  filter.value = 'review'
  reviewKind.value = 'scheduled'
  reveal.value = false
  reviewIndex.value = 0
  await load()
  reviewMode.value = true
}

async function startReinforcement(size: number) {
  reinforcementSize.value = size
  reviewKind.value = 'reinforcement'
  reveal.value = false
  reviewIndex.value = 0
  filter.value = 'all'
  await load()
  reviewMode.value = true
}

let searchTimer = 0
watch(search, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(load, 250)
})
watch(filter, load)
onMounted(startPendingTranslations)
onBeforeUnmount(() => window.clearInterval(translationRefreshTimer))
</script>

<template>
  <div class="page vocabulary-page">
    <div class="page-head">
      <div><span class="eyebrow">VOCABULARY BOOK</span><h1>我的单词本</h1><p class="lead">从真题语境中收集、理解并复习真正困扰你的词。</p></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="button" @click="startReview"><BookOpen :size="17" />今日到期 {{ counts.review || 0 }}</button>
      </div>
    </div>
    <div v-if="error" class="warning">{{ error }}</div>
    <div v-if="notice" class="card vocab-notice">{{ notice }}</div>
    <div class="vocab-stats">
      <button class="card" @click="filter='all'"><span>全部单词</span><strong>{{ counts.total || 0 }}</strong></button>
      <button class="card amber" @click="filter='frequent'"><span>🌟 高频生词</span><strong>{{ counts.frequent || 0 }}</strong></button>
      <button class="card" @click="filter='review'"><span>今日到期</span><strong>{{ counts.review || 0 }}</strong></button>
      <button class="card" @click="filter='mastered'"><span>已掌握</span><strong>{{ counts.mastered || 0 }}</strong></button>
      <button class="card" @click="filter='pending'"><span>等待翻译</span><strong>{{ counts.pending || 0 }}</strong></button>
    </div>

    <section v-if="!reviewMode" class="vocab-reinforcement card">
      <div><strong>额外巩固</strong><span>不改变正式复习计划，可反复练习</span></div>
      <div class="vocab-reinforcement-actions">
        <button v-for="size in [5, 10, 20]" :key="size" class="button secondary compact" type="button" @click="startReinforcement(size)">{{ size }} 词</button>
      </div>
    </section>

    <section v-if="reviewMode" class="review-overlay">
      <div class="review-card" v-if="reviewWord">
        <header class="review-header">
          <strong>{{ reviewKind === 'scheduled' ? '到期复习' : '额外巩固' }} <span>{{ String(reviewIndex + 1).padStart(2, '0') }} / {{ String(reviewItems.length).padStart(2, '0') }}</span></strong>
          <button class="review-close" type="button" title="退出复习" aria-label="退出复习" @click="reviewMode=false">×</button>
        </header>
        <div class="review-content">
          <div class="review-term"><span v-if="reviewWord.is_frequent">🌟</span>{{ reviewWord.lemma || reviewWord.term }}</div>
          <div class="review-phonetic">{{ reviewWord.phonetic }}</div>
          <button v-if="!reveal" class="button secondary reveal-button" @click="reveal=true">显示释义和原句</button>
          <div v-else class="review-answer">
            <section class="review-meaning-block">
              <small>普通释义</small>
              <strong>{{ reviewWord.common_meaning || reviewWord.contextual_meaning }}</strong>
            </section>
            <section v-if="reviewWord.contextual_meaning && reviewWord.contextual_meaning !== reviewWord.common_meaning" class="review-meaning-block">
              <small>本句语境</small>
              <p>{{ reviewWord.contextual_meaning }}</p>
            </section>
            <section v-if="reviewWord.latest_sentence" class="review-sentence-block">
              <small>真题原句</small>
              <blockquote>{{ reviewWord.latest_sentence }}</blockquote>
            </section>
          </div>
        </div>
        <footer v-if="reveal" class="review-actions">
          <button class="button danger" @click="rate('again')">再来一次</button>
          <button class="button secondary" @click="rate('hard')">困难</button>
          <button class="button secondary" @click="rate('know')">认识</button>
          <button class="button" @click="rate('fluent')">熟练</button>
        </footer>
      </div>
      <div v-else class="card empty">今天没有待复习的单词。</div>
    </section>

    <div v-else class="vocabulary-layout">
      <aside class="vocab-filters card">
        <div class="search-field"><Search :size="16" /><input v-model="search" placeholder="搜索单词或释义"></div>
        <button v-for="item in [
          ['all','全部单词'],['review','今日复习'],['frequent','🌟 高频词'],
          ['learning','学习中'],['mastered','已掌握'],['pending','等待翻译']
        ]" :key="item[0]" :class="{active:filter===item[0]}" @click="filter=item[0]">{{ item[1] }}</button>
      </aside>

      <section class="vocab-list card">
        <template v-for="word in items" :key="word.id">
          <button class="vocab-list-item" :class="{active:selected?.id===word.id}" :aria-expanded="selected?.id===word.id" @click="select(word.id)">
            <div class="vocab-list-head"><strong><span v-if="word.is_frequent">🌟 </span>{{ word.lemma || word.term }}</strong><small>遇到 {{ word.encounter_count }} 次</small></div>
            <p v-if="word.translation_status==='ready'">{{ word.common_meaning || word.contextual_meaning }}</p>
            <p v-else class="pending-text">{{ translationStatusText(word.translation_status) }}</p>
            <div class="vocab-list-meta"><span>{{ word.part_of_speech }}</span><span>{{ word.study_status === 'mastered' ? '已掌握' : '学习中' }}</span><ChevronDown class="vocab-expand-icon" :size="17" /></div>
          </button>
          <section v-if="selected?.id===word.id" class="portrait-vocab-detail" aria-label="单词详情">
            <div class="vocab-detail-head">
              <div><span class="eyebrow">{{ selected.is_frequent ? '🌟 HIGH FREQUENCY' : 'VOCABULARY' }}</span><h2>{{ selected.lemma || selected.term }}</h2><p>{{ selected.phonetic }} <span v-if="selected.part_of_speech">· {{ selected.part_of_speech }}</span></p></div>
              <div class="vocab-tools"><button class="button ghost" @click="expandedAll=!expandedAll">{{ expandedAll ? '收起' : '展开全部' }}</button><button class="button ghost" @click="editing=!editing">编辑</button><button class="button ghost danger-text" aria-label="删除单词" @click="removeEntry"><Trash2 :size="17" /></button></div>
            </div>
            <div v-if="selected.translation_status!=='ready'" class="vocab-pending-panel">
              <RefreshCw :size="22" /><strong>{{ translationStatusText(selected.translation_status, true) }}</strong>
              <p>单词和真题原句已经安全保存。</p>
              <button v-if="selected.translation_status==='failed'" class="button secondary" @click="retryTranslation">重新翻译</button>
            </div>
            <template v-else-if="!editing">
              <div v-if="displayConfig.common_meaning || expandedAll" class="detail-section"><label>常用释义</label><strong>{{ selected.common_meaning || selected.contextual_meaning }}</strong></div>
              <div v-if="selected.synonyms?.length && (displayConfig.synonyms || expandedAll)" class="detail-section discrimination-section"><label>同义词辨析</label><ul class="discrimination-list"><li v-for="item in selected.synonyms" :key="`ps-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}</span></li></ul></div>
              <div v-if="selected.antonyms?.length && (displayConfig.antonyms || expandedAll)" class="detail-section discrimination-section"><label>反义词辨析</label><ul class="discrimination-list"><li v-for="item in selected.antonyms" :key="`pa-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}</span></li></ul></div>
              <div v-if="(selected.local_similar?.length || selected.similar_forms?.length) && (displayConfig.similar_forms || expandedAll)" class="detail-section discrimination-section"><label>形近词辨析</label><ul class="discrimination-list"><li v-for="item in selected.local_similar" :key="`pl-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}<em class="source-tag">本地</em></span></li><li v-for="item in selected.similar_forms" :key="`pm-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}</span></li></ul></div>
              <div v-if="selected.memory_hint && (displayConfig.memory_hint || expandedAll)" class="detail-section memory-hint"><label>记忆提示</label><p>{{ selected.memory_hint }}</p></div>
              <div v-if="selected.note" class="detail-section"><label>我的笔记</label><p>{{ selected.note }}</p></div>
              <div v-if="(displayConfig.contextual || expandedAll) || (displayConfig.sentence || expandedAll)" class="detail-section"><label>真题中的遇见</label><div v-if="selected.contextual_meaning && (displayConfig.contextual || expandedAll)" class="occurrence-context-meaning"><small>语境释义</small><strong>{{ selected.contextual_meaning }}</strong></div><template v-if="displayConfig.sentence || expandedAll"><article v-for="occurrence in selected.occurrences" :key="`p-${occurrence.id}`" class="occurrence"><p>{{ occurrence.context_sentence }}</p><small>{{ occurrence.year || '未知年份' }} · {{ occurrence.unit_title || occurrence.unit_type }}</small></article></template></div>
              <div class="detail-actions"><button class="button secondary" @click="put(`/vocabulary/${selected.id}`,{manually_frequent:!selected.manually_frequent}).then(()=>load())"><Star :size="16" />{{ selected.manually_frequent ? '取消重点' : '标记重点' }}</button><button class="button" @click="put(`/vocabulary/${selected.id}`,{study_status:selected.study_status==='mastered'?'learning':'mastered'}).then(()=>load())"><Check :size="16" />{{ selected.study_status === 'mastered' ? '恢复学习' : '标记已掌握' }}</button></div>
            </template>
            <div v-else class="vocab-edit"><label>音标<input v-model="editForm.phonetic"></label><label>词性<input v-model="editForm.part_of_speech"></label><label>当前语境释义<textarea rows="3" v-model="editForm.contextual_meaning"></textarea></label><label>常用释义<textarea rows="3" v-model="editForm.common_meaning"></textarea></label><label>我的笔记<textarea rows="4" v-model="editForm.note"></textarea></label><div><button class="button" @click="saveEdit">保存修改</button><button class="button ghost" @click="editing=false">取消</button></div></div>
          </section>
        </template>
        <div v-if="!items.length" class="empty">这里还没有符合条件的单词。</div>
      </section>

      <section class="vocab-detail desktop-vocab-detail card" v-if="selected">
        <div class="vocab-detail-head">
          <div><span class="eyebrow">{{ selected.is_frequent ? '🌟 HIGH FREQUENCY' : 'VOCABULARY' }}</span><h2>{{ selected.lemma || selected.term }}</h2><p>{{ selected.phonetic }} <span v-if="selected.part_of_speech">· {{ selected.part_of_speech }}</span></p></div>
          <div class="vocab-tools"><button class="button ghost" @click="expandedAll=!expandedAll">{{ expandedAll ? '收起全部' : '展开全部' }}</button><button class="button ghost" @click="editing=!editing">编辑</button><button class="button ghost danger-text" @click="removeEntry"><Trash2 :size="17" /></button></div>
        </div>
        <div v-if="selected.translation_status!=='ready'" class="vocab-pending-panel">
          <RefreshCw :size="22" /><strong>{{ translationStatusText(selected.translation_status, true) }}</strong>
          <p>单词和真题原句已经安全保存。</p>
          <button v-if="selected.translation_status==='failed'" class="button secondary" @click="retryTranslation">重新翻译</button>
        </div>
        <template v-else-if="!editing">
          <div class="detail-section"><label>常用释义</label><strong>{{ selected.common_meaning || selected.contextual_meaning }}</strong></div>
          <div v-if="selected.synonyms?.length" class="detail-section discrimination-section">
            <label>同义词辨析</label>
            <ul class="discrimination-list">
              <li v-for="item in selected.synonyms" :key="`s-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}</span></li>
            </ul>
          </div>
          <div v-if="selected.antonyms?.length" class="detail-section discrimination-section">
            <label>反义词辨析</label>
            <ul class="discrimination-list">
              <li v-for="item in selected.antonyms" :key="`a-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}</span></li>
            </ul>
          </div>
          <div v-if="selected.local_similar?.length || selected.similar_forms?.length" class="detail-section discrimination-section">
            <label>形近词辨析</label>
            <ul class="discrimination-list">
              <li v-for="item in selected.local_similar" :key="`l-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}<em class="source-tag">本地</em></span></li>
              <li v-for="item in selected.similar_forms" :key="`m-${item.word}`"><strong>{{ item.word }}</strong><span>{{ item.note }}</span></li>
            </ul>
          </div>
          <div v-if="selected.memory_hint" class="detail-section memory-hint"><label>记忆提示</label><p>{{ selected.memory_hint }}</p></div>
          <div v-if="selected.note" class="detail-section"><label>我的笔记</label><p>{{ selected.note }}</p></div>
          <div class="detail-section"><label>真题中的遇见</label>
            <div v-if="selected.contextual_meaning" class="occurrence-context-meaning">
              <small>语境释义</small>
              <strong>{{ selected.contextual_meaning }}</strong>
            </div>
            <article v-for="occurrence in selected.occurrences" :key="occurrence.id" class="occurrence">
              <p>{{ occurrence.context_sentence }}</p>
              <small>{{ occurrence.year || '未知年份' }} · {{ occurrence.unit_title || occurrence.unit_type }}</small>
            </article>
          </div>
          <div class="detail-actions">
            <button class="button secondary" @click="put(`/vocabulary/${selected.id}`,{manually_frequent:!selected.manually_frequent}).then(()=>load())"><Star :size="16" />{{ selected.manually_frequent ? '取消重点' : '标记重点' }}</button>
            <button class="button" @click="put(`/vocabulary/${selected.id}`,{study_status:selected.study_status==='mastered'?'learning':'mastered'}).then(()=>load())"><Check :size="16" />{{ selected.study_status === 'mastered' ? '恢复学习' : '标记已掌握' }}</button>
          </div>
        </template>
        <div v-else class="vocab-edit">
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
