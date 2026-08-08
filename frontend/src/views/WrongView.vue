<script setup lang="ts">
import {
  BookOpenText,
  Brain,
  CheckSquare,
  ChevronDown,
  Clock3,
  FileText,
  Play,
  Sparkles,
  Trash2,
  X,
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { get, post } from '../api'

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
const view = ref<'current' | 'mastered' | 'all'>('current')
const units = ref<WrongUnit[]>([])
const error = ref('')
const loading = ref(false)
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
    if (!openYears.value.size && grouped.value[0]) openYears.value = new Set([grouped.value[0].year])
  } catch (cause) {
    error.value = String(cause)
  } finally {
    loading.value = false
  }
}

watch(view, load)
onMounted(load)

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
  const status = analysisStatuses.value[unit.unit_id]
  const title = `${unit.year} 年${unit.unit_title}`
  if (status?.locked) {
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

function analysisLabel(unit: WrongUnit) {
  const status = analysisStatuses.value[unit.unit_id]
  if (status?.locked) return '查看分析'
  return status ? '重新分析' : '分析'
}

async function archive(unitIds: number[]) {
  const ids = [...new Set(unitIds)]
  if (!ids.length) return
  if (!window.confirm(`删除选中的 ${ids.length} 个篇目及其全部错题记录？内容将在回收站保留七天。`)) return
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
      <div><span class="eyebrow">WRONG ANSWERS</span><h1>错题本</h1><p class="lead">正式重做会留下快照，并让当前错题只保留仍未掌握的部分。</p></div>
      <div class="wrong-head-actions">
        <button v-if="!selecting" class="button secondary compact" type="button" @click="selecting = true"><CheckSquare :size="16" />批量删除</button>
        <template v-else>
          <span>已选 {{ selected.size }} 篇</span>
          <button class="button danger compact" type="button" :disabled="!selected.size" @click="archive([...selected])"><Trash2 :size="15" />删除</button>
          <button class="icon-button" type="button" aria-label="退出批量删除" @click="leaveSelection"><X :size="18" /></button>
        </template>
      </div>
    </div>

    <div class="wrong-view-switch" role="tablist" aria-label="错题记录筛选">
      <button v-for="item in [{ key: 'current', label: '当前错题' }, { key: 'mastered', label: '已掌握' }, { key: 'all', label: '全部记录' }]" :key="item.key" type="button" :class="{ active: view === item.key }" @click="view = item.key as typeof view">{{ item.label }}</button>
    </div>

    <div v-if="error" class="warning">{{ error }}</div>
    <section v-if="analysis" ref="analysisReport" class="card ai-report" tabindex="-1" aria-live="polite">
      <div class="section-title wrong-report-title"><div><span class="eyebrow">AI REVIEW</span><h3>{{ analysisTitle }}分析</h3></div><button class="button ghost compact" @click="analysis = ''; analysisAggregate = null; analysisNote = ''">收起</button></div>
      <div v-if="analysisAggregate" class="wrong-analysis-summary">
        <strong>{{ analysisAggregate.question_count }} 道错题参与本次匿名诊断</strong>
        <div v-for="category in analysisAggregate.categories" :key="category.code" class="wrong-analysis-category"><span>{{ category.label }}</span><span>{{ category.count }} 道 · {{ category.percentage }}%</span></div>
      </div>
      <div class="wrong-analysis-copy">{{ analysis }}</div>
      <p v-if="analysisNote" class="wrong-analysis-cache-note">{{ analysisNote }}</p>
    </section>

    <section v-if="units.length" class="wrong-overview">
      <div><span class="eyebrow">REVIEW MAP</span><strong>{{ units.length }} 篇 · 当前 {{ currentTotal }} 道错题</strong><span>已完成 {{ retryTotal }} 次正式重做</span></div>
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
            <div class="wrong-unit-row">
              <label v-if="selecting" class="wrong-select"><input type="checkbox" :checked="selected.has(unit.unit_id)" :aria-label="`选择 ${unit.unit_title}`" @change="toggleSelected(unit.unit_id)"></label>
              <button class="wrong-unit-expand" type="button" :aria-expanded="openUnits.has(unit.unit_id)" @click="toggleUnit(unit.unit_id)">
                <span class="wrong-level-icon unit"><FileText :size="17" /></span><span class="wrong-level-copy"><strong>{{ unit.unit_title }}</strong><span>重做 {{ unit.retry_count }} 次 · 剩余 {{ unit.current_count }} 道</span></span><ChevronDown :size="18" class="wrong-chevron" :class="{ open: openUnits.has(unit.unit_id) }" />
              </button>
              <div v-if="!selecting" class="wrong-scope-actions">
                <button class="button secondary compact" type="button" :disabled="!unit.current_count || Boolean(analyzingKey)" @click="analyzeUnit(unit)"><Sparkles :size="14" />{{ analyzingKey === `unit-${unit.unit_id}` ? '分析中…' : analysisLabel(unit) }}</button>
                <button class="button compact" type="button" :disabled="!unit.current_count || Boolean(startingKey)" @click="retryUnit(unit)"><Play :size="14" />{{ startingKey === `unit-${unit.unit_id}` ? '启动中…' : '重做' }}</button>
                <button class="icon-button danger" type="button" :aria-label="`删除 ${unit.unit_title}`" @click="archive([unit.unit_id])"><Trash2 :size="16" /></button>
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

    <div v-else-if="!loading" class="card empty illustrated-empty"><Brain :size="26" /><strong>{{ view === 'current' ? '当前没有待重做错题' : '这里还没有对应记录' }}</strong><p>做题与正式重做结果会自动整理到这里。</p></div>
  </div>
</template>

<style scoped>
.wrong-head,.wrong-head-actions,.wrong-view-switch,.wrong-level-row,.wrong-expand-button,.wrong-unit-row,.wrong-unit-expand,.wrong-scope-actions,.wrong-round-row{display:flex;align-items:center}.wrong-head{gap:16px;justify-content:space-between}.wrong-head-actions{gap:8px;flex-wrap:wrap}.wrong-view-switch{gap:4px;width:max-content;max-width:100%;padding:4px;border:1px solid var(--border);border-radius:8px;background:var(--surface)}.wrong-view-switch button{min-height:34px;padding:6px 12px;border:0;border-radius:6px;background:transparent;color:var(--muted);font:inherit}.wrong-view-switch button.active{background:var(--accent);color:var(--accent-contrast)}.wrong-tree{display:grid;gap:10px}.wrong-year{padding:0;overflow:hidden}.wrong-year-row{padding:4px 10px}.wrong-expand-button,.wrong-unit-expand{flex:1;min-width:0;gap:10px;padding:10px 4px;border:0;background:transparent;color:inherit;text-align:left}.wrong-level-copy{display:grid;gap:2px;min-width:0}.wrong-level-copy strong,.wrong-level-copy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wrong-level-copy span{font-size:.82rem;color:var(--muted)}.wrong-level-icon{display:grid;flex:0 0 34px;width:34px;height:34px;place-items:center;border-radius:7px;background:var(--surface-strong)}.wrong-chevron{margin-left:auto;transition:transform .2s}.wrong-chevron.open{transform:rotate(180deg)}.wrong-units{border-top:1px solid var(--border)}.wrong-unit-block+.wrong-unit-block{border-top:1px solid var(--border)}.wrong-unit-row{gap:8px;padding:5px 10px 5px 22px}.wrong-unit-expand{min-width:180px}.wrong-scope-actions{gap:6px;flex-wrap:wrap}.wrong-select{display:grid;place-items:center;flex:0 0 28px}.wrong-select input{width:18px;height:18px}.wrong-round-list{padding:0 14px 8px 70px}.wrong-round-row{width:100%;gap:10px;min-height:38px;padding:7px 10px;border:0;border-top:1px solid var(--border);background:transparent;color:inherit;text-align:left}.wrong-round-row strong{margin-left:auto}.wrong-round-row:disabled{opacity:.65}.wrong-round-empty{padding:10px;color:var(--muted);font-size:.86rem}.wrong-overview>div{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.wrong-analysis-copy{white-space:pre-wrap}.wrong-analysis-category{display:flex;justify-content:space-between;gap:12px}.icon-button{display:grid;width:34px;height:34px;padding:0;place-items:center;border:1px solid var(--border);border-radius:7px;background:transparent;color:inherit}.danger{color:var(--danger)}
@media(max-width:720px){.wrong-head{align-items:flex-start}.wrong-head .lead{display:none}.wrong-unit-row{align-items:flex-start;padding-left:10px;flex-wrap:wrap}.wrong-unit-expand{flex-basis:calc(100% - 38px)}.wrong-scope-actions{width:100%;justify-content:flex-end;padding-left:38px}.wrong-round-list{padding-left:48px}.wrong-round-row{display:grid;grid-template-columns:auto 1fr auto;gap:4px 8px}.wrong-round-row strong{margin-left:0}.wrong-round-row>span:last-of-type{grid-column:2}.wrong-view-switch{width:100%}.wrong-view-switch button{flex:1;padding-inline:6px}.wrong-overview{padding:10px}.wrong-head-actions>span{font-size:.82rem}}
</style>
