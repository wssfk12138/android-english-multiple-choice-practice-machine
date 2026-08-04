<script setup lang="ts">
import { BookOpen, Check, RefreshCw, Search, Settings, Star, Trash2 } from 'lucide-vue-next'
import { computed, onMounted, reactive, ref, watch } from 'vue'
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
const reveal = ref(false)
const reviewIndex = ref(0)
const reviewItems = computed(() => items.value.filter(item => item.translation_status === 'ready' && item.study_status !== 'mastered'))
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
const displayOptions: Record<string, string> = {
  common_meaning: '常用释义',
  contextual: '语境释义',
  sentence: '真题例句',
  memory_hint: '记忆提示',
  synonyms: '同义词辨析',
  antonyms: '反义词辨析',
  similar_forms: '形近词辨析',
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
const showDisplayDialog = ref(false)
const expandedAll = ref(false)
function saveDisplayConfig() {
  localStorage.setItem('vocab-display-config', JSON.stringify(displayConfig.value))
}

function translationStatusText(status: string, detail = false) {
  if (status === 'translating') return detail ? '模型正在后台翻译' : '正在后台翻译…'
  if (status === 'failed') return detail ? '翻译暂未完成' : '等待重新翻译'
  return detail ? '等待练习提交或退出后翻译' : '等待练习结束后翻译'
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
  await post(`/vocabulary/${selected.value.id}/retry`)
  notice.value = '已重新提交翻译，请稍后刷新'
  await load()
}

async function rate(rating: string) {
  if (!reviewWord.value) return
  await post(`/vocabulary/${reviewWord.value.id}/review`, { rating })
  reveal.value = false
  await load()
  if (reviewIndex.value >= reviewItems.value.length) reviewIndex.value = 0
}

function startReview() {
  filter.value = 'review'
  reviewMode.value = true
  reveal.value = false
  reviewIndex.value = 0
  load()
}

let searchTimer = 0
watch(search, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(load, 250)
})
watch(filter, load)
onMounted(load)
</script>

<template>
  <div class="page vocabulary-page">
    <div class="page-head">
      <div><span class="eyebrow">VOCABULARY BOOK</span><h1>我的单词本</h1><p class="lead">从真题语境中收集、理解并复习真正困扰你的词。</p></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="button ghost" @click="showDisplayDialog=true"><Settings :size="17" />显示设置</button>
        <button class="button" @click="startReview"><BookOpen :size="17" />开始今日复习</button>
      </div>
    </div>
    <div v-if="error" class="warning">{{ error }}</div>
    <div v-if="notice" class="card vocab-notice">{{ notice }}</div>
    <div class="vocab-stats">
      <button class="card" @click="filter='all'"><span>全部单词</span><strong>{{ counts.total || 0 }}</strong></button>
      <button class="card amber" @click="filter='frequent'"><span>🌟 高频生词</span><strong>{{ counts.frequent || 0 }}</strong></button>
      <button class="card" @click="filter='review'"><span>今日待复习</span><strong>{{ counts.review || 0 }}</strong></button>
      <button class="card" @click="filter='mastered'"><span>已掌握</span><strong>{{ counts.mastered || 0 }}</strong></button>
      <button class="card" @click="filter='pending'"><span>等待翻译</span><strong>{{ counts.pending || 0 }}</strong></button>
    </div>

    <section v-if="reviewMode" class="review-overlay">
      <div class="review-card" v-if="reviewWord">
        <button class="button ghost review-close" @click="reviewMode=false">退出复习</button>
        <span class="eyebrow">今日 {{ reviewIndex + 1 }} / {{ reviewItems.length }}</span>
        <div class="review-term"><span v-if="reviewWord.is_frequent">🌟</span>{{ reviewWord.lemma || reviewWord.term }}</div>
        <div class="review-phonetic">{{ reviewWord.phonetic }}</div>
        <button v-if="!reveal" class="button secondary reveal-button" @click="reveal=true">显示释义和原句</button>
        <div v-else class="review-answer">
          <strong>{{ reviewWord.common_meaning || reviewWord.contextual_meaning }}</strong>
          <p v-if="reviewWord.contextual_meaning && reviewWord.contextual_meaning !== reviewWord.common_meaning">
            本句语境：{{ reviewWord.contextual_meaning }}
          </p>
          <blockquote>{{ reviewWord.latest_sentence }}</blockquote>
          <div class="review-actions">
            <button class="button danger" @click="rate('again')">不认识</button>
            <button class="button secondary" @click="rate('hard')">有点印象</button>
            <button class="button" @click="rate('mastered')">已掌握</button>
          </div>
        </div>
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
        <button v-for="word in items" :key="word.id" class="vocab-list-item" :class="{active:selected?.id===word.id}" @click="select(word.id)">
          <div class="vocab-list-head"><strong><span v-if="word.is_frequent">🌟 </span>{{ word.lemma || word.term }}</strong><small>遇到 {{ word.encounter_count }} 次</small></div>
          <p v-if="word.translation_status==='ready'">{{ word.common_meaning || word.contextual_meaning }}</p>
          <p v-else class="pending-text">{{ translationStatusText(word.translation_status) }}</p>
          <div class="vocab-list-meta"><span>{{ word.part_of_speech }}</span><span>{{ word.study_status === 'mastered' ? '已掌握' : '学习中' }}</span></div>
        </button>
        <div v-if="!items.length" class="empty">这里还没有符合条件的单词。</div>
      </section>

      <section class="vocab-detail card" v-if="selected">
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
          <div v-if="displayConfig.common_meaning || expandedAll" class="detail-section"><label>常用释义</label><strong>{{ selected.common_meaning || selected.contextual_meaning }}</strong></div>
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
          <div v-if="(displayConfig.contextual || expandedAll) || (displayConfig.sentence || expandedAll)" class="detail-section"><label>真题中的遇见</label>
            <div v-if="selected.contextual_meaning && (displayConfig.contextual || expandedAll)" class="occurrence-context-meaning">
              <small>语境释义</small>
              <strong>{{ selected.contextual_meaning }}</strong>
            </div>
            <template v-if="displayConfig.sentence || expandedAll">
              <article v-for="occurrence in selected.occurrences" :key="occurrence.id" class="occurrence">
                <p>{{ occurrence.context_sentence }}</p>
                <small>{{ occurrence.year || '未知年份' }} · {{ occurrence.unit_title || occurrence.unit_type }}</small>
              </article>
            </template>
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
      <section v-else class="vocab-detail card empty">选择一个单词查看详细释义与真题语境。</section>
    </div>
    <div v-if="showDisplayDialog" class="review-overlay" role="dialog" aria-modal="true" aria-label="单词本显示设置">
      <div class="review-card vocab-display-dialog">
        <h3 style="margin-bottom:10px">单词本显示设置</h3>
        <p class="lead" style="font-size:12px;line-height:1.7;margin-bottom:16px">全局默认显示哪些内容，对所有单词一致生效；查看单个单词时仍可点“展开全部”临时查看。</p>
        <div class="vocab-display-options">
          <label v-for="(label, key) in displayOptions" :key="key">
            <input v-model="displayConfig[key]" type="checkbox" @change="saveDisplayConfig">
            <span>{{ label }}</span>
          </label>
        </div>
        <div style="display:flex;justify-content:center;margin-top:22px">
          <button class="button" @click="showDisplayDialog=false">完成</button>
        </div>
      </div>
    </div>
  </div>
</template>
