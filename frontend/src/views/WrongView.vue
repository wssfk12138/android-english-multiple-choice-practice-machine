<script setup lang="ts">
import {
  BookOpenText,
  Brain,
  CheckSquare,
  ChevronDown,
  Clock3,
  FileText,
  MoreHorizontal,
  Play,
  Sparkles,
  Trash2,
  X,
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { get, post } from '../api'
import { confirmDialog } from '../platform/dialogs'
import { useAndroidLandscape } from '../composables/useAndroidLandscape'
import { wrongListReturn } from '../services/wrongListReturn'

type RetryRound = {
  id: number
  round_number: number
  question_count: number
  correct_count: number
  wrong_count: number
  submitted_at: string
  accuracy: number
  remaining_question_ids: number[]
}

type WrongUnit = {
  unit_id: number
  unit_title: string
  content_revision?: string
  unit_type: string
  year: number
  current_count: number
  retry_count: number
  current_question_ids: number[]
  is_mastered: boolean
  rounds: RetryRound[]
}

type YearGroup = { year: number; units: WrongUnit[] }
type AnalysisCategory = { code: string; label: string; count: number; percentage: number }
type AnalysisAggregate = {
  question_count: number
  categories: AnalysisCategory[]
  recommended_actions: string[]
  uncertain_count: number
}
type AnalysisStatus = {
  unit_id: number
  report_id: number
  locked: boolean
  report: string
  aggregate: AnalysisAggregate | null
}

const router = useRouter()
const landscape = useAndroidLandscape()
const view = ref<'current' | 'mastered' | 'all' | 'frequent'>(useRoute().query.view === 'frequent' ? 'frequent' : 'current')
const units = ref<WrongUnit[]>([])
const error = ref('')
const loading = ref(false)
const loadFailed = ref(false)
const analysis = ref('')
const analysisTitle = ref('')
const analysisAggregate = ref<AnalysisAggregate | null>(null)
const analysisNote = ref('')
const analysisReport = ref<HTMLElement | null>(null)
const analysisStatuses = ref<Record<number, AnalysisStatus>>({})
const analyzingKey = ref('')
const startingKey = ref('')
const openYears = ref(new Set<number>())
const openUnits = ref(new Set<number>())
const selecting = ref(false)
const selected = ref(new Set<number>())
const moreMenuFor = ref<number | null>(null)
// 打开分析前记录滚动位置，收起分析后恢复，避免列表跳变。
let scrollPositionBeforeAnalysis = 0

const grouped = computed<YearGroup[]>(() => {
  const map = new Map<number, WrongUnit[]>()
  for (const unit of units.value) {
    const values = map.get(unit.year) || []
    values.push(unit)
    map.set(unit.year, values)
  }
  return [...map.entries()]
    .sort(([left], [right]) => right - left)
    .map(([year, values]) => ({ year, units: values }))
})

const currentTotal = computed(() => units.value.reduce((sum, unit) => sum + Number(unit.current_count), 0))
const retryTotal = computed(() => units.value.reduce((sum, unit) => sum + Number(unit.retry_count), 0))

async function load() {
  loading.value = true
  error.value = ''
  try {
    units.value = await get<WrongUnit[]>(`/wrong?view=${view.value}`)
    loadFailed.value = false
    const visibleIds = new Set(units.value.map(unit => unit.unit_id))
    selected.value = new Set([...selected.value].filter(id => visibleIds.has(id)))
    try {
      const statusResult: any = await get('/ai/wrong-analysis-status')
      analysisStatuses.value = Object.fromEntries(
        (statusResult?.units || []).map((item: AnalysisStatus) => [item.unit_id, item]),
      )
    } catch {
      // The wrong-book remains usable when model configuration is unavailable.
    }
    if (!wrongListReturn.pending && !openYears.value.size && grouped.value[0]) openYears.value = new Set([grouped.value[0].year])
  } catch (cause) {
    error.value = String(cause)
    loadFailed.value = true
  } finally {
    loading.value = false
  }
}

if (wrongListReturn.pending) view.value = wrongListReturn.view as typeof view.value
watch(view, load)
onMounted(async () => {
  if (wrongListReturn.pending) {
    view.value = wrongListReturn.view as typeof view.value
    openYears.value = new Set(wrongListReturn.years)
    openUnits.value = new Set(wrongListReturn.units)
  }
  await load()
  if (wrongListReturn.pending) {
    await nextTick()
    window.scrollTo({ top:wrongListReturn.scroll })
    wrongListReturn.pending = false
  }
})

function toggleSet(source: Set<number>, value: number) {
  const next = new Set(source)
  next.has(value) ? next.delete(value) : next.add(value)
  return next
}

function toggleYear(year: number) { openYears.value = toggleSet(openYears.value, year) }
function toggleUnit(unitId: number) { openUnits.value = toggleSet(openUnits.value, unitId) }
function toggleSelected(unitId: number) { selected.value = toggleSet(selected.value, unitId) }

function yearSelection(group: YearGroup) {
  const count = group.units.filter(unit => selected.value.has(unit.unit_id)).length
  return { checked: count === group.units.length, indeterminate: count > 0 && count < group.units.length }
}

function toggleYearSelection(group: YearGroup) {
  const next = new Set(selected.value)
  const shouldSelect = !group.units.every(unit => next.has(unit.unit_id))
  for (const unit of group.units) shouldSelect ? next.add(unit.unit_id) : next.delete(unit.unit_id)
  selected.value = next
}

function leaveSelection() {
  selecting.value = false
  selected.value = new Set()
}

function dateLabel(value: string) {
  const normalized = String(value || '').replace(' ', 'T')
  const date = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

async function retryUnit(unit: WrongUnit) {
  startingKey.value = `unit-${unit.unit_id}`
  error.value = ''
  try {
    const session: any = await post('/practice/sessions', {
      mode: 'wrong',
      unit_ids: [unit.unit_id],
      question_ids: unit.current_question_ids,
      count: 1,
      shuffle_options: true,
    })
    router.push(`/practice/${session.id}`)
  } catch (cause) {
    error.value = `${unit.unit_title}重做启动失败：${String(cause)}`
  } finally {
    startingKey.value = ''
  }
}

async function retryRound(unit: WrongUnit, retry: RetryRound) {
  if (!retry.remaining_question_ids.length) return
  startingKey.value = `round-${retry.id}`
  error.value = ''
  try {
    const session: any = await post('/practice/sessions', {
      mode: 'wrong_history',
      history_round_id: retry.id,
      shuffle_options: true,
    })
    router.push(`/practice/${session.id}`)
  } catch (cause) {
    error.value = `${unit.unit_title}记录打开失败：${String(cause)}`
  } finally {
    startingKey.value = ''
  }
}

async function analyzeUnit(unit: WrongUnit) {
  moreMenuFor.value = null
  if (landscape.value) {
    Object.assign(wrongListReturn, { pending:true, view:view.value, years:[...openYears.value], units:[...openUnits.value], scroll:window.scrollY })
    await router.push(`/wrong/analysis/${unit.unit_id}`)
    return
  }
  const status = analysisStatuses.value[unit.unit_id]
  const title = `${unit.year} 年${unit.unit_title}`
  if (status?.locked) {
    scrollPositionBeforeAnalysis = window.scrollY
    analysisTitle.value = title
    analysis.value = status.report
    analysisAggregate.value = status.aggregate || null
    analysisNote.value = '以上是上次分析结果的本地缓存。完成这篇错题的下一次正式重做后，才能重新分析。'
    await nextTick()
    analysisReport.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  analyzingKey.value = `unit-${unit.unit_id}`
  error.value = ''
  scrollPositionBeforeAnalysis = window.scrollY
  try {
    const result: any = await post('/ai/analyze-wrong', {
      question_ids: unit.current_question_ids,
      focus: `只分析${title}范围内的错题，概括薄弱能力、干扰项倾向和下一步练习建议。`,
      scope_title: title,
    })
    const content = String(result?.analysis || '').trim()
    if (!content) throw new Error('模型没有返回可显示的分析内容')
    analysisTitle.value = title
    analysis.value = content
    analysisAggregate.value = result.aggregate || null
    analysisNote.value = result.cached
      ? '以上是上次分析结果的本地缓存。完成下一次正式重做后才能重新分析。'
      : '分析结果已保存到本地；完成下一次正式重做后，可再次分析并对比作答。'
    analysisStatuses.value = {
      ...analysisStatuses.value,
      [unit.unit_id]: { unit_id: unit.unit_id, report_id: Number(result.report_id || 0), locked: true, report: content, aggregate: result.aggregate || null },
    }
    await nextTick()
    analysisReport.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (cause) {
    error.value = `${title}分析失败：${String(cause)}`
  } finally {
    analyzingKey.value = ''
  }
}

function closeAnalysis() {
  analysis.value = ''
  analysisAggregate.value = null
  analysisNote.value = ''
  window.scrollTo({ top: scrollPositionBeforeAnalysis, behavior: 'smooth' })
}

function analysisLabel(unit: WrongUnit) {
  const status = analysisStatuses.value[unit.unit_id]
  if (landscape.value && status?.report_id) return '查看分析'
  if (status?.locked) return '查看分析'
  return status ? '重新分析' : '分析'
}

async function archive(unitIds: number[]) {
  const ids = [...new Set(unitIds)]
  if (!ids.length) return
  moreMenuFor.value = null
  const confirmed = await confirmDialog({
    title: `删除 ${ids.length} 个篇目的错题记录？`,
    message: [
      `将删除${ids.length > 1 ? '这些篇目' : '该篇目'}的全部当前错题和重做记录。`,
      '内容将在回收站保留七天，期间可以恢复。',
    ],
    confirmLabel: '移入回收站',
    danger: true,
  })
  if (!confirmed) return
  error.value = ''
  try {
    await post('/wrong/archive-delete', { unit_ids: ids })
    leaveSelection()
    await load()
  } catch (cause) {
    error.value = `删除失败：${String(cause)}`
  }
}
</script>

<template>
  <div class="page wrong-page">
    <div class="page-head wrong-head">
      <div><h1>错题本</h1></div>
      <div class="wrong-head-actions">
        <button v-if="!selecting" class="button secondary compact" type="button" @click="selecting = true"><CheckSquare :size="16" />批量删除</button>
        <template v-else>
          <span>已选 {{ selected.size }} 篇</span>
          <button class="button danger compact" type="button" :disabled="!selected.size" @click="archive([...selected])"><Trash2 :size="15" />删除</button>
          <button class="icon-button" type="button" aria-label="退出批量删除" @click="leaveSelection"><X :size="18" /></button>
        </template>
      </div>
    </div>

    <div class="wrong-view-switch" role="group" aria-label="错题记录筛选">
      <label v-for="item in [{ key: 'current', label: '当前错题' }, { key: 'frequent', label: '高频错题' }, { key: 'mastered', label: '已掌握' }, { key: 'all', label: '全部记录' }]" :key="item.key" class="selection-option" :class="{ active: view === item.key }"><input v-model="view" type="radio" name="wrong-filter" :value="item.key"><span>{{ item.label }}</span></label>
    </div>

    <div v-if="error" class="warning">{{ error }}</div>
    <section v-if="analysis" ref="analysisReport" class="card ai-report" tabindex="-1" aria-live="polite">
      <div class="section-title wrong-report-title"><div><h3>{{ analysisTitle }}分析</h3></div><button class="button ghost compact" @click="closeAnalysis">收起</button></div>
      <div v-if="analysisAggregate" class="wrong-analysis-summary">
        <strong>{{ analysisAggregate.question_count }} 道错题参与本次匿名诊断</strong>
        <div v-for="category in analysisAggregate.categories" :key="category.code" class="wrong-analysis-category"><span>{{ category.label }}</span><span>{{ category.count }} 道 · {{ category.percentage }}%</span></div>
      </div>
      <div class="wrong-analysis-copy">{{ analysis }}</div>
      <p v-if="analysisNote" class="wrong-analysis-cache-note">{{ analysisNote }}</p>
    </section>

    <section v-if="units.length" class="wrong-overview">
      <div><strong>{{ units.length }} 篇 · 当前 {{ currentTotal }} 道错题</strong><span>已完成 {{ retryTotal }} 次正式重做</span></div>
    </section>

    <div v-if="grouped.length" class="wrong-tree">
      <section v-for="group in grouped" :key="group.year" class="wrong-year card">
        <div class="wrong-level-row wrong-year-row">
          <label v-if="selecting" class="wrong-select" @click.stop><input type="checkbox" :checked="yearSelection(group).checked" :indeterminate="yearSelection(group).indeterminate" :aria-label="`选择 ${group.year} 年全部篇目`" @change="toggleYearSelection(group)"></label>
          <button class="wrong-expand-button" type="button" :aria-expanded="openYears.has(group.year)" @click="toggleYear(group.year)">
            <span class="wrong-level-icon"><BookOpenText :size="20" /></span><span class="wrong-level-copy"><strong>{{ group.year }} 年</strong><span>{{ group.units.length }} 篇</span></span><ChevronDown :size="19" class="wrong-chevron" :class="{ open: openYears.has(group.year) }" />
          </button>
        </div>
        <div v-show="openYears.has(group.year)" class="wrong-units">
          <article v-for="unit in group.units" :key="unit.unit_id" class="wrong-unit-block">
            <div class="wrong-unit-row" :class="{ selectable: selecting }">
              <label v-if="selecting" class="wrong-select"><input type="checkbox" :checked="selected.has(unit.unit_id)" :aria-label="`选择 ${unit.unit_title}`" readonly tabindex="-1"></label>
              <button
                class="wrong-unit-expand"
                type="button"
                :aria-expanded="selecting ? undefined : openUnits.has(unit.unit_id)"
                @click="selecting ? toggleSelected(unit.unit_id) : toggleUnit(unit.unit_id)"
              >
                <span class="wrong-level-icon unit"><FileText :size="17" /></span><span class="wrong-level-copy"><strong>{{ unit.unit_title }}</strong><small v-if="unit.content_revision">题面已修正，历史作答与统计保留</small><span>重做 {{ unit.retry_count }} 次 · 剩余 {{ unit.current_count }} 道</span></span><ChevronDown v-if="!selecting" :size="18" class="wrong-chevron" :class="{ open: openUnits.has(unit.unit_id) }" />
              </button>
              <div v-if="!selecting" class="wrong-scope-actions">
                <button class="button compact wrong-retry-button" type="button" :disabled="!unit.current_count || Boolean(startingKey)" @click="retryUnit(unit)"><Play :size="14" />{{ startingKey === `unit-${unit.unit_id}` ? '启动中…' : '重做' }}</button>
                <button v-if="landscape" class="button compact wrong-analysis-button" type="button" :disabled="!unit.current_count && !analysisStatuses[unit.unit_id]?.report_id" @click="analyzeUnit(unit)"><Sparkles :size="14" /><span>{{ analysisLabel(unit) }}</span></button>
                <button class="button compact danger-text wrong-delete-button" type="button" @click="archive([unit.unit_id])"><Trash2 :size="14" />删除</button>
                <div v-if="!landscape" class="wrong-more">
                  <button class="icon-button" type="button" :aria-label="`${unit.unit_title} 更多操作`" :aria-expanded="moreMenuFor === unit.unit_id" @click="moreMenuFor = moreMenuFor === unit.unit_id ? null : unit.unit_id">
                    <MoreHorizontal :size="17" />
                  </button>
                  <div v-if="moreMenuFor === unit.unit_id" class="wrong-more-menu" role="menu">
                    <button class="wrong-more-item" role="menuitem" type="button" :disabled="!unit.current_count || Boolean(analyzingKey)" @click="analyzeUnit(unit)"><Sparkles :size="14" />{{ analyzingKey === `unit-${unit.unit_id}` ? '分析中…' : analysisLabel(unit) }}</button>
                  </div>
                </div>
              </div>
            </div>
            <div v-show="openUnits.has(unit.unit_id)" class="wrong-round-list">
              <button v-for="retry in unit.rounds" :key="retry.id" class="wrong-round-row" type="button" :disabled="!retry.remaining_question_ids.length || Boolean(startingKey)" @click="retryRound(unit, retry)">
                <Clock3 :size="15" /><span>{{ dateLabel(retry.submitted_at) }}</span><strong>正确率 {{ retry.accuracy }}%</strong><span>剩余 {{ retry.wrong_count }} 道</span><Play v-if="retry.remaining_question_ids.length" :size="14" />
              </button>
              <div v-if="!unit.rounds.length" class="wrong-round-empty">尚未进行正式重做</div>
            </div>
          </article>
        </div>
      </section>
    </div>

    <div v-else-if="loadFailed && !loading" class="card empty illustrated-empty">
      <Brain :size="26" /><strong>错题本加载失败</strong><p class="wrong-error-text">{{ error }}</p>
      <button class="button" type="button" @click="load">重新加载</button>
    </div>
    <div v-else-if="!loading && !loadFailed" class="card empty illustrated-empty"><Brain :size="26" /><strong>{{ view === 'current' ? '当前没有待重做错题' : '这里还没有对应记录' }}</strong><p>做题与正式重做结果会自动整理到这里。</p></div>
  </div>
</template>

<style scoped>
html[data-platform="android"][data-orientation="landscape"] .wrong-unit-expand { min-width:0; }
html[data-platform="android"][data-orientation="landscape"] .wrong-level-copy strong { white-space:normal; overflow-wrap:anywhere; }
html[data-platform="android"][data-orientation="landscape"] .wrong-scope-actions { flex-wrap:nowrap; flex-shrink:0; }
html[data-platform="android"][data-orientation="landscape"] .wrong-scope-actions > button { flex:0 0 68.3294px; width:68.3294px; min-height:49px; padding:4px; font-size:13px; display:flex; align-items:center; justify-content:center; gap:5px; }
html[data-platform="android"][data-orientation="landscape"] .wrong-analysis-button span { max-width:2em; white-space:normal; line-height:1.25; }
.wrong-head,.wrong-head-actions,.wrong-view-switch,.wrong-level-row,.wrong-expand-button,.wrong-unit-row,.wrong-unit-expand,.wrong-scope-actions,.wrong-round-row{display:flex;align-items:center}.wrong-head{gap:16px;justify-content:space-between}.wrong-head-actions{gap:8px;flex-wrap:wrap}.wrong-view-switch{gap:4px;width:max-content;max-width:100%;padding:4px;border:1px solid var(--border,var(--line));border-radius:8px;background:var(--surface);flex-wrap:wrap}.wrong-view-switch .selection-option{min-height:40px;flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:6px 12px;border:0;border-radius:6px;background:transparent;color:var(--muted);font:inherit;white-space:nowrap}.wrong-view-switch .selection-option.active{background:var(--primary);color:white}.wrong-tree{display:grid;gap:10px}.wrong-year{padding:0;overflow:visible}.wrong-year-row{padding:4px 10px}.wrong-expand-button,.wrong-unit-expand{flex:1;min-width:0;gap:10px;padding:10px 4px;border:0;background:transparent;color:inherit;text-align:left}.wrong-level-copy{display:grid;gap:2px;min-width:0}.wrong-level-copy strong,.wrong-level-copy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wrong-unit-row .wrong-level-copy span{white-space:normal}.wrong-level-copy span{font-size:.82rem;color:var(--muted)}.wrong-level-icon{display:grid;flex:0 0 34px;width:34px;height:34px;place-items:center;border-radius:7px;background:var(--primary-soft);color:var(--primary)}.wrong-chevron{margin-left:auto;transition:transform .2s}.wrong-chevron.open{transform:rotate(180deg)}.wrong-units{border-top:1px solid var(--border,var(--line))}.wrong-unit-block+.wrong-unit-block{border-top:1px solid var(--border,var(--line))}.wrong-unit-row{gap:8px;padding:5px 10px 5px 22px}.wrong-unit-expand{min-width:180px}.wrong-unit-row.selectable .wrong-unit-expand{min-height:48px;cursor:pointer}.wrong-scope-actions{gap:6px;flex-wrap:wrap}.wrong-select{display:grid;place-items:center;flex:0 0 32px}.wrong-select input{width:19px;height:19px}.wrong-round-list{padding:0 14px 8px 70px}.wrong-round-row{width:100%;gap:10px;min-height:38px;padding:7px 10px;border:0;border-top:1px solid var(--border,var(--line));background:transparent;color:inherit;text-align:left}.wrong-round-row strong{margin-left:auto}.wrong-round-row:disabled{opacity:.65}.wrong-round-empty{padding:10px;color:var(--muted);font-size:.86rem}.wrong-overview>div{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.wrong-analysis-copy{white-space:pre-wrap}.wrong-analysis-category{display:flex;justify-content:space-between;gap:12px}.icon-button{display:grid;width:36px;height:36px;padding:0;place-items:center;border:1px solid var(--border,var(--line));border-radius:8px;background:transparent;color:inherit}.danger{color:var(--danger)}.wrong-more{position:relative}.wrong-more-menu{position:absolute;top:40px;right:0;z-index:30;min-width:140px;padding:6px;border:1px solid var(--line);border-radius:12px;background:var(--surface-solid);box-shadow:var(--shadow);display:grid;gap:2px}.wrong-more-item{min-height:44px;padding:9px 12px;display:flex;align-items:center;gap:8px;border:0;border-radius:9px;background:transparent;color:var(--ink);font:inherit;text-align:left}.wrong-more-item:hover{background:var(--primary-faint)}.wrong-error-text{white-space:normal;overflow-wrap:anywhere}
@media(max-width:720px){.wrong-head{align-items:flex-start}.wrong-head .lead{display:none}.wrong-unit-row{align-items:flex-start;padding-left:10px;flex-wrap:wrap}.wrong-unit-expand{flex-basis:calc(100% - 40px)}.wrong-scope-actions{width:100%;justify-content:flex-start;padding-left:40px}.wrong-round-list{padding-left:48px}.wrong-round-row{display:grid;grid-template-columns:auto 1fr auto;gap:4px 8px}.wrong-round-row strong{margin-left:0}.wrong-round-row>span:last-of-type{grid-column:2}.wrong-view-switch{width:100%}.wrong-view-switch .selection-option{flex:1 1 40%;padding-inline:6px}.wrong-overview{padding:10px}.wrong-head-actions>span{font-size:.82rem}}
.wrong-scope-actions .wrong-retry-button,.wrong-scope-actions .wrong-analysis-button{min-width:0;padding-inline:7px;font-size:11px;white-space:nowrap}
.wrong-scope-actions .wrong-retry-button svg,.wrong-scope-actions .wrong-analysis-button svg{flex:0 0 auto}
.wrong-scope-actions .wrong-analysis-button{overflow:hidden;text-overflow:ellipsis}
</style>
