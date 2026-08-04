<script setup lang="ts">
import {
  BookOpenText,
  Brain,
  ChevronDown,
  FileText,
  Play,
  Sparkles,
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { get, post } from '../api'

type WrongRow = {
  question_id: number
  number: number
  unit_id: number
  unit_title: string
  unit_type: string
  year: number
  wrong_count: number
  is_frequent: boolean
}

type UnitGroup = {
  unitId: number
  title: string
  unitType: string
  questionIds: number[]
  questionCount: number
  wrongAttempts: number
  frequentCount: number
}

type YearGroup = {
  year: number
  units: UnitGroup[]
  questionIds: number[]
  questionCount: number
  wrongAttempts: number
  frequentCount: number
}

type AnalysisCategory = {
  code: string
  label: string
  count: number
  percentage: number
  average_confidence: number
}

type AnalysisAggregate = {
  question_count: number
  categories: AnalysisCategory[]
  recommended_actions: string[]
  uncertain_count: number
}

const router = useRouter()
const rows = ref<WrongRow[]>([])
const frequentOnly = ref(false)
const error = ref('')
const analysis = ref('')
const analysisTitle = ref('')
const analysisAggregate = ref<AnalysisAggregate | null>(null)
const analyzingKey = ref('')
const startingKey = ref('')
const openYears = ref(new Set<number>())
const analysisReport = ref<HTMLElement | null>(null)

const visible = computed(() =>
  frequentOnly.value ? rows.value.filter(row => row.is_frequent) : rows.value,
)

const grouped = computed<YearGroup[]>(() => {
  const yearMap = new Map<number, Map<number, UnitGroup>>()
  for (const row of visible.value) {
    if (!yearMap.has(row.year)) yearMap.set(row.year, new Map())
    const unitMap = yearMap.get(row.year)!
    if (!unitMap.has(row.unit_id)) {
      unitMap.set(row.unit_id, {
        unitId: row.unit_id,
        title: row.unit_title,
        unitType: row.unit_type,
        questionIds: [],
        questionCount: 0,
        wrongAttempts: 0,
        frequentCount: 0,
      })
    }
    const unit = unitMap.get(row.unit_id)!
    unit.questionIds.push(row.question_id)
    unit.questionCount++
    unit.wrongAttempts += row.wrong_count
    if (row.is_frequent) unit.frequentCount++
  }

  return [...yearMap.entries()]
    .sort(([left], [right]) => right - left)
    .map(([year, unitMap]) => {
      const units = [...unitMap.values()]
      return {
        year,
        units,
        questionIds: units.flatMap(unit => unit.questionIds),
        questionCount: units.reduce((sum, unit) => sum + unit.questionCount, 0),
        wrongAttempts: units.reduce((sum, unit) => sum + unit.wrongAttempts, 0),
        frequentCount: units.reduce((sum, unit) => sum + unit.frequentCount, 0),
      }
    })
})

const totalWrongAttempts = computed(() =>
  visible.value.reduce((sum, row) => sum + row.wrong_count, 0),
)
const totalFrequent = computed(() =>
  visible.value.filter(row => row.is_frequent).length,
)

function ensureDefaultOpen() {
  if (!openYears.value.size && grouped.value[0]) {
    openYears.value = new Set([grouped.value[0].year])
  }
}

watch(grouped, ensureDefaultOpen)

async function load() {
  try {
    rows.value = await get<WrongRow[]>('/wrong')
    ensureDefaultOpen()
  } catch (e) {
    error.value = String(e)
  }
}

onMounted(load)

function toggleYear(year: number) {
  const next = new Set(openYears.value)
  next.has(year) ? next.delete(year) : next.add(year)
  openYears.value = next
}

async function retryScope(
  key: string,
  unitIds: number[],
  questionIds: number[],
  title: string,
) {
  startingKey.value = key
  error.value = ''
  try {
    const session: any = await post('/practice/sessions', {
      mode: 'wrong',
      unit_ids: unitIds,
      question_ids: questionIds,
      count: unitIds.length,
      shuffle_options: true,
    })
    router.push(`/practice/${session.id}`)
  } catch (e) {
    error.value = `${title}重做启动失败：${String(e)}`
  } finally {
    startingKey.value = ''
  }
}

async function analyzeScope(
  key: string,
  questionIds: number[],
  title: string,
) {
  analyzingKey.value = key
  error.value = ''
  analysis.value = ''
  analysisAggregate.value = null
  analysisTitle.value = title
  try {
    const result: any = await post('/ai/analyze-wrong', {
      question_ids: questionIds,
      focus: `只分析${title}范围内的错题，概括薄弱能力、干扰项倾向和下一步练习建议。`,
      scope_title: title,
    })
    const content = typeof result?.analysis === 'string'
      ? result.analysis.trim()
      : ''
    if (!content) throw new Error('模型没有返回可显示的分析内容')
    analysis.value = content
    analysisAggregate.value = result.aggregate || null
    await nextTick()
    analysisReport.value?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
    analysisReport.value?.focus({ preventScroll: true })
  } catch (e) {
    error.value = `${title}分析失败：${String(e)}`
  } finally {
    analyzingKey.value = ''
  }
}
</script>

<template>
  <div class="page wrong-page">
    <div class="page-head">
      <div>
        <span class="eyebrow">WRONG ANSWERS</span>
        <h1>错题本</h1>
        <p class="lead">按年份与篇目整理，可直接对指定范围进行分析或重做。</p>
      </div>
    </div>

    <div v-if="error" class="warning">{{ error }}</div>
    <div
      v-if="analysis"
      ref="analysisReport"
      class="card ai-report"
      tabindex="-1"
      role="region"
      aria-live="polite"
      :aria-label="`${analysisTitle}错题分析结果`"
    >
      <div class="section-title wrong-report-title">
        <div>
          <span class="eyebrow">AI REVIEW</span>
          <h3>{{ analysisTitle }}分析</h3>
        </div>
        <button class="button ghost" @click="analysis='';analysisAggregate=null">收起</button>
      </div>
      <div v-if="analysisAggregate" class="wrong-analysis-summary">
        <div class="wrong-analysis-total">
          <strong>{{ analysisAggregate.question_count }}</strong>
          <span>道错题参与本次匿名诊断</span>
        </div>
        <div class="wrong-analysis-categories" aria-label="错误原因占比">
          <div
            v-for="category in analysisAggregate.categories"
            :key="category.code"
            class="wrong-analysis-category"
          >
            <div>
              <strong>{{ category.label }}</strong>
              <span>{{ category.count }} 道 · {{ category.percentage }}%</span>
            </div>
            <div class="wrong-analysis-bar" aria-hidden="true">
              <span :style="{ width: `${category.percentage}%` }" />
            </div>
          </div>
        </div>
        <p v-if="analysisAggregate.uncertain_count" class="wrong-analysis-uncertain">
          其中 {{ analysisAggregate.uncertain_count }} 道暂时证据不足，已保留为“不确定”，不会强行归因。
        </p>
      </div>
      <div>{{ analysis }}</div>
    </div>

    <section v-if="visible.length" class="wrong-overview" aria-label="错题概览">
      <div class="wrong-overview-copy">
        <span class="eyebrow">REVIEW MAP</span>
        <strong>{{ visible.length }} 道错题，分布在 {{ grouped.length }} 个年份</strong>
        <span>累计答错 {{ totalWrongAttempts }} 次，其中 {{ totalFrequent }} 道为高频错题。</span>
      </div>
      <label class="wrong-filter">
        <input v-model="frequentOnly" type="checkbox">
        <span>只看高频错题</span>
      </label>
    </section>

    <div v-if="grouped.length" class="wrong-tree">
      <section
        v-for="yearGroup in grouped"
        :key="yearGroup.year"
        class="wrong-year card"
      >
        <div class="wrong-level-row wrong-year-row">
          <button
            class="wrong-expand-button"
            type="button"
            :aria-expanded="openYears.has(yearGroup.year)"
            :aria-controls="`wrong-year-${yearGroup.year}`"
            @click="toggleYear(yearGroup.year)"
          >
            <span class="wrong-level-icon"><BookOpenText :size="21" /></span>
            <span class="wrong-level-copy">
              <span class="wrong-level-kicker">年份</span>
              <strong>{{ yearGroup.year }} 年</strong>
            </span>
            <span class="wrong-level-stats">
              <span><b>{{ yearGroup.questionCount }}</b> 道错题</span>
              <span>{{ yearGroup.units.length }} 篇</span>
              <span v-if="yearGroup.frequentCount">{{ yearGroup.frequentCount }} 道高频</span>
            </span>
            <ChevronDown
              :size="20"
              class="wrong-chevron"
              :class="{ open: openYears.has(yearGroup.year) }"
            />
          </button>
          <div class="wrong-scope-actions">
            <button
              class="button secondary compact"
              type="button"
              :disabled="Boolean(analyzingKey)"
              @click="analyzeScope(`year-${yearGroup.year}`, yearGroup.questionIds, `${yearGroup.year} 年`)"
            >
              <Sparkles :size="15" />
              {{ analyzingKey === `year-${yearGroup.year}` ? '分析中…' : '分析错题' }}
            </button>
            <button
              class="button compact"
              type="button"
              :disabled="Boolean(startingKey)"
              @click="retryScope(`year-${yearGroup.year}`, yearGroup.units.map(unit => unit.unitId), yearGroup.questionIds, `${yearGroup.year} 年`)"
            >
              <Play :size="15" />
              {{ startingKey === `year-${yearGroup.year}` ? '正在启动…' : '开始重做' }}
            </button>
          </div>
        </div>

        <div
          v-show="openYears.has(yearGroup.year)"
          :id="`wrong-year-${yearGroup.year}`"
          class="wrong-units"
        >
          <article
            v-for="unit in yearGroup.units"
            :key="unit.unitId"
            class="wrong-unit-row"
          >
            <span class="wrong-level-icon unit"><FileText :size="18" /></span>
            <span class="wrong-level-copy">
              <span class="wrong-level-kicker">篇目</span>
              <strong>{{ unit.title }}</strong>
            </span>
            <span class="wrong-level-stats">
              <span><b>{{ unit.questionCount }}</b> 道错题</span>
              <span>累计错误 {{ unit.wrongAttempts }} 次</span>
            </span>
            <div class="wrong-scope-actions">
              <button
                class="button secondary compact"
                type="button"
                :disabled="Boolean(analyzingKey)"
                @click="analyzeScope(`unit-${unit.unitId}`, unit.questionIds, `${yearGroup.year} 年${unit.title}`)"
              >
                <Sparkles :size="15" />
                {{ analyzingKey === `unit-${unit.unitId}` ? '分析中…' : '分析错题' }}
              </button>
              <button
                class="button compact"
                type="button"
                :disabled="Boolean(startingKey)"
                @click="retryScope(`unit-${unit.unitId}`, [unit.unitId], unit.questionIds, `${yearGroup.year} 年${unit.title}`)"
              >
                <Play :size="15" />
                {{ startingKey === `unit-${unit.unitId}` ? '正在启动…' : '开始重做' }}
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <div v-else class="card empty illustrated-empty">
      <img src="/assets/quiet-study-empty.webp" alt="">
      <div><Brain :size="25" /><strong>这里还没有错题</strong></div>
      <p>{{ frequentOnly ? '当前没有高频错题，可以切换为查看全部错题。' : '保持这个状态很不错，继续按自己的节奏练习。' }}</p>
    </div>
  </div>
</template>
