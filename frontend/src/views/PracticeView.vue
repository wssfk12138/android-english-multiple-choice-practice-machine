<script setup lang="ts">
import {
  AlertCircle,
  ArrowLeft,
  Award,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Coffee,
  GripVertical,
  Play,
  Save,
  Send,
  X,
} from 'lucide-vue-next'
import { VueDraggableNext } from 'vue-draggable-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { get, post, put } from '../api'
import ContentBlocks from '../components/ContentBlocks.vue'
import ListeningPlayer from '../components/ListeningPlayer.vue'

const route = useRoute()
const router = useRouter()
const session = ref<any>(null)
const activeUnitIndex = ref(0)
const error = ref('')
const saving = ref<number | null>(null)
const vocabularyToast = ref('')
const unansweredNotice = ref('')
const highlightedQuestionId = ref<number | null>(null)
const resultPanelVisible = ref(false)
const resultPanelMode = ref<'unit' | 'session'>('unit')
const resultPanelUnitId = ref<number | null>(null)
const vocabMenu = ref({ visible: false, x: 0, y: 0, term: '', sentence: '', questionId: null as number | null })
const listeningPlayer = ref<InstanceType<typeof ListeningPlayer> | null>(null)
type VocabularyTranslationTrigger = 'unit_submit' | 'session_submit' | 'practice_exit'
type PendingVocabularyRecord = { entryId: number, unitId: number | null }
const pendingVocabulary = ref<PendingVocabularyRecord[]>([])
type TimerMode = 'off' | 'running' | 'paused' | 'finished'
type PracticeTimerState = {
  mode: TimerMode
  elapsedMs: number
  startedAt: number | null
}
const timerState = ref<PracticeTimerState | null>(null)
const timerPromptVisible = ref(false)
const timerNow = ref(Date.now())
let timerTicker: number | null = null
const activeUnit = computed(() => session.value?.units?.[activeUnitIndex.value])
const activeContentBlocks = computed(() => activeUnit.value?.content_blocks || [])
const activeContentPackage = computed(() => ({
  packageId: activeUnit.value?.shared_data?.content_package_id || '',
  contentVersion: activeUnit.value?.shared_data?.content_version || '',
}))
const progress = computed(() => {
  if (!session.value) return { answered: 0, total: 0 }
  let answered = 0
  let total = 0
  for (const unit of session.value.units) {
    for (const question of unit.questions) {
      total++
      if (question.user_answer) answered++
    }
  }
  return { answered, total }
})
const isPartB = computed(() => activeUnit.value?.unit_type === 'part_b')
const isMatchingPartB = computed(() => isPartB.value && activeUnit.value?.subtype !== 'true_false')
const isOrdering = computed(() => activeUnit.value?.subtype === 'paragraph_reordering')
const isListening = computed(() => activeUnit.value?.unit_type === 'listening')
const orderingItems = ref<any[]>([])
const candidateOptions = computed(() => activeUnit.value?.questions?.[0]?.options || [])
const timerElapsedMs = computed(() => {
  const state = timerState.value
  if (!state) return 0
  if (state.mode === 'running' && state.startedAt) {
    return state.elapsedMs + Math.max(0, timerNow.value - state.startedAt)
  }
  return state.elapsedMs
})
const timerText = computed(() => formatDuration(timerElapsedMs.value))
const timerEnabled = computed(() =>
  Boolean(timerState.value && timerState.value.mode !== 'off'),
)
const audioSeekable = computed(() => !timerEnabled.value || timerState.value?.mode === 'finished')
const audioTracks = computed(() => activeUnit.value?.shared_data?.audio_tracks || [])
const activeUnitSubmitted = computed(() =>
  Boolean(activeUnit.value?.submission?.submitted || session.value?.status === 'submitted'),
)
const resultUnit = computed(() =>
  session.value?.units?.find((unit: any) => unit.id === resultPanelUnitId.value)
  || activeUnit.value,
)
const overallResult = computed(() => {
  if (!session.value || session.value.status !== 'submitted') return null
  if (session.value.result_summary) return session.value.result_summary
  const submissions = session.value.units
    .map((unit: any) => unit.submission)
    .filter((submission: any) => submission?.submitted)
  return {
    score: session.value.score,
    max_score: session.value.max_score,
    wrong_count: submissions.reduce(
      (sum: number, submission: any) => sum + (submission.wrong_count || 0),
      0,
    ),
    correct_count: submissions.reduce(
      (sum: number, submission: any) => sum + (submission.correct_count || 0),
      0,
    ),
    question_count: submissions.reduce(
      (sum: number, submission: any) => sum + (submission.question_count || 0),
      0,
    ),
  }
})
const hasPendingUnits = computed(() =>
  Boolean(session.value?.units?.some((unit: any) => !unit.submission?.submitted)),
)
const orderingAnswers = computed(() => {
  const result: Record<number, string> = {}
  for (let index = 0; index < orderingItems.value.length; index++) {
    const question = activeUnit.value?.questions?.[index]
    if (question) result[question.id] = orderingItems.value[index].stable_key
  }
  return result
})
type PassageSegment = {
  type: 'text' | 'blank'
  text: string
  number?: number
}
const passageSegments = computed<PassageSegment[]>(() => {
  const unit = activeUnit.value
  const passage = unit?.passage || '该题型请在右侧完成候选项匹配。'
  const usesInlineBlanks = unit?.unit_type === 'cloze'
    || (unit?.unit_type === 'part_b' && unit?.subtype !== 'true_false')
  if (!unit || !usesInlineBlanks) {
    return [{ type: 'text', text: passage }]
  }

  const numbers: number[] = [...new Set<number>(
    unit.questions.map((question: any) => Number(question.number)),
  )]
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  const candidates = [...passage.matchAll(/(?<!\d)(?:\(\s*)?([1-4]?\d)(?:\s*\))?(?:\s*_{2,})?(?!\d)/g)]
  const selected: { start: number, end: number, number: number }[] = []
  let after = -1

  for (const number of numbers) {
    const candidate = candidates.find(match =>
      Number(match[1]) === number
      && (match.index ?? -1) > after
      && /^\s*(?:[.,;:!?，。；：！？]|$)/.test(
        passage.slice((match.index ?? 0) + match[0].length),
      )
        === false
    ) || candidates.find(match =>
      Number(match[1]) === number && (match.index ?? -1) > after
    )
    if (!candidate || candidate.index === undefined) continue
    selected.push({
      start: candidate.index,
      end: candidate.index + candidate[0].length,
      number,
    })
    after = candidate.index
  }

  if (!selected.length) return [{ type: 'text', text: passage }]
  const result: PassageSegment[] = []
  let cursor = 0
  for (const blank of selected) {
    if (blank.start > cursor) {
      result.push({ type: 'text', text: passage.slice(cursor, blank.start) })
    }
    result.push({ type: 'blank', text: String(blank.number), number: blank.number })
    cursor = blank.end
  }
  if (cursor < passage.length) result.push({ type: 'text', text: passage.slice(cursor) })
  return result
})

function timerStorageKey(sessionId: number) {
  return `linjian-practice-timer-${sessionId}`
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds]
    .map(value => String(value).padStart(2, '0'))
    .join(':')
}

function formatScore(value: unknown) {
  const score = Number(value)
  if (!Number.isFinite(score)) return '0'
  return score.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function persistTimer() {
  if (!session.value?.id || !timerState.value) return
  localStorage.setItem(
    timerStorageKey(session.value.id),
    JSON.stringify(timerState.value),
  )
}

function vocabularyQueueKey(sessionId: number) {
  return `linjian:vocabulary-queue:${sessionId}`
}

function loadPendingVocabulary(sessionId: number) {
  try {
    const raw = localStorage.getItem(vocabularyQueueKey(sessionId))
    if (!raw) {
      pendingVocabulary.value = []
      return
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('invalid vocabulary queue')
    pendingVocabulary.value = parsed
      .filter(item => Number.isInteger(item?.entryId) && item.entryId > 0)
      .slice(0, 200)
      .map(item => ({
        entryId: Number(item.entryId),
        unitId: Number.isInteger(item.unitId) ? Number(item.unitId) : null,
      }))
  } catch {
    pendingVocabulary.value = []
  }
}

function persistPendingVocabulary() {
  if (!session.value?.id) return
  localStorage.setItem(
    vocabularyQueueKey(session.value.id),
    JSON.stringify(pendingVocabulary.value),
  )
}

function rememberVocabulary(entryId: number, unitId: number | null) {
  if (
    pendingVocabulary.value.some(
      item => item.entryId === entryId && item.unitId === unitId,
    )
  ) return
  pendingVocabulary.value.push({ entryId, unitId })
  persistPendingVocabulary()
}

function translationRecords(unitId?: number) {
  return unitId === undefined
    ? pendingVocabulary.value
    : pendingVocabulary.value.filter(item => item.unitId === unitId)
}

async function flushVocabularyTranslations(
  trigger: VocabularyTranslationTrigger,
  unitId?: number,
) {
  const records = [...translationRecords(unitId)]
  const entryIds = [...new Set(records.map(item => item.entryId))]
  // On Android the database is authoritative. Even when the component-local
  // queue is empty, an earlier interrupted exit may have left pending rows.
  if (!entryIds.length && document.documentElement.dataset.platform !== 'android') return
  try {
    const result: any = await post('/vocabulary/translation-runs', {
      entry_ids: entryIds,
      trigger,
    })
    const recordKeys = new Set(records.map(item => `${item.entryId}:${item.unitId ?? ''}`))
    pendingVocabulary.value = pendingVocabulary.value.filter(
      item => !recordKeys.has(`${item.entryId}:${item.unitId ?? ''}`),
    )
    persistPendingVocabulary()
    if (result.queuedCount > 0 && trigger !== 'practice_exit') {
      vocabularyToast.value = `已将 ${result.queuedCount} 个单词提交后台翻译`
      window.setTimeout(() => { vocabularyToast.value = '' }, 2600)
    }
  } catch {
    // 单词已经保存在本地。保留队列，下一次退出答题界面时继续尝试。
  }
}

function flushVocabularyOnPageHide() {
  const entryIds = [...new Set(pendingVocabulary.value.map(item => item.entryId))]
  if (document.documentElement.dataset.platform === 'android') {
    void post('/vocabulary/translation-runs', {
      entry_ids: entryIds,
      trigger: 'practice_exit',
    }).catch(() => undefined)
    return
  }
  if (!entryIds.length) return
  void fetch('/api/vocabulary/translation-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entry_ids: entryIds,
      trigger: 'practice_exit',
    }),
    keepalive: true,
  }).catch(() => undefined)
}

function readTimer(sessionId: number): PracticeTimerState | null {
  try {
    const raw = localStorage.getItem(timerStorageKey(sessionId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!['off', 'running', 'paused', 'finished'].includes(parsed.mode)) return null
    return {
      mode: parsed.mode,
      elapsedMs: Math.max(0, Number(parsed.elapsedMs) || 0),
      startedAt: Number.isFinite(Number(parsed.startedAt))
        ? Number(parsed.startedAt)
        : null,
    }
  } catch {
    return null
  }
}

function initializeTimer() {
  if (!session.value) return
  const saved = readTimer(session.value.id)
  if (session.value.status === 'submitted') {
    timerPromptVisible.value = false
    if (!saved) return
    if (saved.mode === 'running' && saved.startedAt) {
      const submittedAt = session.value.submitted_at
        ? Date.parse(`${String(session.value.submitted_at).replace(' ', 'T')}Z`)
        : Date.now()
      saved.elapsedMs += Math.max(0, submittedAt - saved.startedAt)
      saved.startedAt = null
      saved.mode = 'finished'
      timerState.value = saved
      persistTimer()
      return
    }
    timerState.value = saved
    return
  }
  if (saved) {
    timerState.value = saved
    timerPromptVisible.value = false
  } else if (session.value.units?.some((unit: any) => unit.submission?.submitted)) {
    timerState.value = { mode: 'off', elapsedMs: 0, startedAt: null }
    timerPromptVisible.value = false
    persistTimer()
  } else {
    timerState.value = null
    timerPromptVisible.value = true
  }
}

function startTimedPractice() {
  timerNow.value = Date.now()
  timerState.value = {
    mode: 'running',
    elapsedMs: 0,
    startedAt: timerNow.value,
  }
  timerPromptVisible.value = false
  persistTimer()
}

function startWithoutTimer() {
  timerState.value = { mode: 'off', elapsedMs: 0, startedAt: null }
  timerPromptVisible.value = false
  persistTimer()
}

function pauseTimer() {
  const state = timerState.value
  if (!state || state.mode !== 'running' || !state.startedAt) return
  const now = Date.now()
  state.elapsedMs += Math.max(0, now - state.startedAt)
  state.startedAt = null
  state.mode = 'paused'
  timerNow.value = now
  listeningPlayer.value?.pause()
  persistTimer()
}

function resumeTimer() {
  const state = timerState.value
  if (!state || state.mode !== 'paused') return
  const now = Date.now()
  state.startedAt = now
  state.mode = 'running'
  timerNow.value = now
  persistTimer()
}

function finishTimer() {
  const state = timerState.value
  if (!state || state.mode === 'off' || state.mode === 'finished') return
  if (state.mode === 'running' && state.startedAt) {
    const now = Date.now()
    state.elapsedMs += Math.max(0, now - state.startedAt)
    timerNow.value = now
  }
  state.startedAt = null
  state.mode = 'finished'
  persistTimer()
}

async function load() {
  try {
    session.value = await get(`/practice/sessions/${route.params.id}`)
    loadPendingVocabulary(session.value.id)
    syncOrdering()
    initializeTimer()
  }
  catch (e) { error.value = String(e) }
}
onMounted(() => {
  timerTicker = window.setInterval(() => {
    timerNow.value = Date.now()
  }, 500)
  window.addEventListener('keydown', handleWindowKeydown)
  window.addEventListener('pagehide', flushVocabularyOnPageHide)
  load()
})
onBeforeUnmount(() => {
  if (timerTicker !== null) window.clearInterval(timerTicker)
  window.removeEventListener('keydown', handleWindowKeydown)
  window.removeEventListener('pagehide', flushVocabularyOnPageHide)
})
onBeforeRouteLeave(async () => {
  await flushVocabularyTranslations('practice_exit')
})

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && resultPanelVisible.value) {
    resultPanelVisible.value = false
  }
}

async function select(question: any, key: string) {
  if (session.value.status === 'submitted' || activeUnitSubmitted.value) return
  const previous = question.user_answer
  question.user_answer = key
  saving.value = question.id
  try {
    await put(`/practice/sessions/${session.value.id}/answers/${question.id}`, {
      answer: key, option_order: question.option_order,
    })
  } catch (e) {
    question.user_answer = previous
    error.value = String(e)
  }
  finally { saving.value = null }
}

function syncOrdering() {
  if (!isOrdering.value || !activeUnit.value?.questions?.length) {
    orderingItems.value = []
    return
  }
  const options = activeUnit.value.questions[0].options || []
  const saved = activeUnit.value.questions.map((question: any) => question.user_answer).filter(Boolean)
  const savedSet = new Set(saved)
  orderingItems.value = [
    ...saved.map((key: string) => options.find((option: any) => option.stable_key === key)).filter(Boolean),
    ...options.filter((option: any) => !savedSet.has(option.stable_key)),
  ]
}

async function saveOrdering() {
  if (!isOrdering.value || session.value.status === 'submitted' || activeUnitSubmitted.value) return
  const questions = activeUnit.value.questions
  const activeItems = orderingItems.value.slice(0, questions.length)
  try {
    for (let index = 0; index < questions.length; index++) {
      const item = activeItems[index]
      if (!item) continue
      questions[index].user_answer = item.stable_key
      await put(`/practice/sessions/${session.value.id}/answers/${questions[index].id}`, {
        answer: item.stable_key,
        option_order: questions[index].option_order,
      })
    }
  } catch (e) {
    error.value = String(e)
    session.value = await get(`/practice/sessions/${session.value.id}`)
    syncOrdering()
  }
}

function resultClass(question: any, option: any) {
  if (session.value.status !== 'submitted' && !activeUnitSubmitted.value) {
    return { selected: question.user_answer === option.stable_key }
  }
  return {
    selected: question.user_answer === option.stable_key,
    correct: question.answer === option.stable_key,
    wrong: question.user_answer === option.stable_key && question.answer !== option.stable_key,
  }
}

function displayedAnswer(question: any) {
  return question.options.find((option: any) => option.stable_key === question.answer)?.label || question.answer
}

function firstUnanswered(unitIndexes: number[]) {
  for (const unitIndex of unitIndexes) {
    const unit = session.value.units[unitIndex]
    for (const question of unit.questions) {
      if (!String(question.user_answer || '').trim()) {
        return { unitIndex, question }
      }
    }
  }
  return null
}

async function focusUnanswered(unitIndex: number, question: any) {
  activeUnitIndex.value = unitIndex
  syncOrdering()
  highlightedQuestionId.value = question.id
  unansweredNotice.value = `${session.value.units[unitIndex].title}的第 ${question.number} 题还未作答，已为你定位。`
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const target = document.querySelector<HTMLElement>(`[data-question-id="${question.id}"]`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  window.setTimeout(() => {
    if (highlightedQuestionId.value === question.id) highlightedQuestionId.value = null
  }, 3200)
}

async function handleIncompleteSubmission(errorValue: any) {
  const detail = errorValue?.detail
  if (detail?.code !== 'incomplete_submission') return false
  session.value = await get(`/practice/sessions/${session.value.id}`)
  const unitIndex = session.value.units.findIndex((unit: any) => unit.id === detail.unit_id)
  if (unitIndex < 0) return false
  const question = session.value.units[unitIndex].questions.find(
    (item: any) => item.id === detail.question_id,
  )
  if (!question) return false
  await focusUnanswered(unitIndex, question)
  return true
}

async function submitCurrentUnit() {
  const missing = firstUnanswered([activeUnitIndex.value])
  if (missing) {
    await focusUnanswered(missing.unitIndex, missing.question)
    return
  }
  if (!confirm(`确定提交“${activeUnit.value.title}”吗？提交后会显示本篇对错，且本篇不能继续修改。`)) return
  const submittedUnitId = activeUnit.value.id
  try {
    session.value = await post(
      `/practice/sessions/${session.value.id}/units/${submittedUnitId}/submit`,
    )
    syncOrdering()
    unansweredNotice.value = ''
    showUnitResult(submittedUnitId)
  } catch (e) {
    if (await handleIncompleteSubmission(e)) return
    error.value = String(e)
  }
}

async function submitSession() {
  const missing = firstUnanswered(session.value.units.map((_: any, index: number) => index))
  if (missing) {
    await focusUnanswered(missing.unitIndex, missing.question)
    return
  }
  const label = session.value.mode === 'paper' ? '整年试卷' : '本次练习'
  if (!confirm(`确定提交${label}吗？提交后才会显示对错，且不能继续修改。`)) return
  try {
    session.value = await post(`/practice/sessions/${session.value.id}/submit`)
    finishTimer()
    showSessionResult()
  }
  catch (e) {
    if (await handleIncompleteSubmission(e)) return
    error.value = String(e)
  }
}

function switchUnit(index: number) {
  activeUnitIndex.value = index
  unansweredNotice.value = ''
  highlightedQuestionId.value = null
  syncOrdering()
}

function showUnitResult(unitId = activeUnit.value?.id) {
  if (!unitId) return
  resultPanelMode.value = 'unit'
  resultPanelUnitId.value = unitId
  resultPanelVisible.value = true
}

function showSessionResult() {
  resultPanelMode.value = 'session'
  resultPanelUnitId.value = null
  resultPanelVisible.value = true
}

function continueToPendingUnit(fromUnitId?: number) {
  const fromIndex = fromUnitId
    ? session.value?.units?.findIndex((unit: any) => unit.id === fromUnitId) ?? -1
    : activeUnitIndex.value
  const units = session.value?.units || []
  const laterIndex = units.findIndex(
    (unit: any, index: number) => index > fromIndex && !unit.submission?.submitted,
  )
  const fallbackIndex = units.findIndex((unit: any) => !unit.submission?.submitted)
  const targetIndex = laterIndex >= 0 ? laterIndex : fallbackIndex
  if (targetIndex >= 0) switchUnit(targetIndex)
  resultPanelVisible.value = false
}

function openUnitFromResult(unitId: number) {
  const index = session.value?.units?.findIndex((unit: any) => unit.id === unitId) ?? -1
  if (index >= 0) switchUnit(index)
  resultPanelVisible.value = false
}

function sentenceAround(text: string, term: string) {
  const compact = text.replace(/\s+/g, ' ').trim()
  const index = compact.toLowerCase().indexOf(term.toLowerCase())
  if (index < 0) return compact.slice(0, 1200)
  const left = Math.max(
    compact.lastIndexOf('.', index - 1),
    compact.lastIndexOf('!', index - 1),
    compact.lastIndexOf('?', index - 1),
  )
  const endings = [
    compact.indexOf('.', index + term.length),
    compact.indexOf('!', index + term.length),
    compact.indexOf('?', index + term.length),
  ].filter(value => value >= 0)
  const right = endings.length ? Math.min(...endings) + 1 : compact.length
  return compact.slice(left + 1, right).trim().slice(0, 1500)
}

function openVocabularyMenu(event: MouseEvent) {
  const selection = window.getSelection()
  const term = selection?.toString().trim().replace(/\s+/g, ' ') || ''
  if (!term || !/^[A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,4}$/.test(term)) {
    vocabMenu.value.visible = false
    return
  }
  const target = event.target as HTMLElement
  const source = target.closest<HTMLElement>('[data-vocab-text]')
  if (!source) return
  event.preventDefault()
  const question = target.closest<HTMLElement>('[data-question-id]')
  vocabMenu.value = {
    visible: true,
    x: Math.min(event.clientX, window.innerWidth - 220),
    y: Math.min(event.clientY, window.innerHeight - 120),
    term,
    sentence: sentenceAround(source.innerText || source.textContent || '', term),
    questionId: question?.dataset.questionId ? Number(question.dataset.questionId) : null,
  }
}

async function addSelectedVocabulary() {
  const item = vocabMenu.value
  vocabMenu.value.visible = false
  try {
    const result: any = await post('/vocabulary', {
      term: item.term,
      context_sentence: item.sentence,
      unit_id: activeUnit.value.id,
      question_id: item.questionId,
      year: activeUnit.value.year,
      unit_title: activeUnit.value.title,
      unit_type: activeUnit.value.unit_type,
    })
    if (result.translation_status !== 'ready') {
      rememberVocabulary(result.entry_id, activeUnit.value.id)
    }
    vocabularyToast.value = result.is_frequent
      ? `已记录第 ${result.encounter_count} 次，已标记为 🌟 高频词`
      : '已加入单词本，退出答题界面后统一翻译'
    window.setTimeout(() => { vocabularyToast.value = '' }, 2600)
    window.getSelection()?.removeAllRanges()
  } catch (e) {
    error.value = String(e)
  }
}

async function copySelectedTerm() {
  await window.navigator.clipboard.writeText(vocabMenu.value.term)
  vocabMenu.value.visible = false
}
</script>

<template>
  <div class="practice-page" @click="vocabMenu.visible=false">
    <header class="practice-top">
      <div style="display:flex;align-items:center;gap:18px">
        <button class="button ghost" @click="router.push('/library')"><ArrowLeft :size="18" />退出</button>
        <div class="unit-tabs" v-if="session">
          <button v-for="(unit, i) in session.units" :key="unit.id" class="unit-tab" :class="{active:i===activeUnitIndex,submitted:unit.submission?.submitted}" @click="switchUnit(i)">
            {{ unit.title }}<CheckCircle2 v-if="unit.submission?.submitted" :size="13" />
          </button>
        </div>
      </div>
      <div v-if="session" class="practice-status">
        <span v-if="saving"><Save :size="15" />正在保存</span><span v-else>已完成 {{ progress.answered }}/{{ progress.total }}</span>
        <div v-if="timerEnabled" class="practice-timer" :class="{ paused: timerState?.mode === 'paused', finished: timerState?.mode === 'finished' }" aria-live="polite">
          <Clock3 :size="16" />
          <span v-if="timerState?.mode === 'finished'" class="timer-label">本次用时</span>
          <strong>{{ timerText }}</strong>
          <button v-if="timerState?.mode === 'running' && session.status === 'active'" type="button" @click="pauseTimer">
            <Coffee :size="15" />休息一下
          </button>
          <button v-else-if="timerState?.mode === 'paused' && session.status === 'active'" type="button" @click="resumeTimer">
            <Play :size="14" />继续练习
          </button>
        </div>
        <button
          v-if="session.status==='submitted'"
          class="result-banner"
          type="button"
          aria-label="查看整卷成绩"
          @click="showSessionResult"
        >
          <Award :size="16" />整卷 {{ formatScore(session.score) }} / {{ formatScore(session.max_score) }}
        </button>
      </div>
    </header>
    <div v-if="error" class="warning" style="margin:15px">{{ error }}</div>
    <div v-if="unansweredNotice" class="unanswered-banner" role="alert">
      <AlertCircle :size="18" />{{ unansweredNotice }}
    </div>
    <div v-if="session && activeUnit" class="practice-layout" :class="{'listening-layout':isListening}">
      <section class="passage-pane" :class="{'listening-console-pane':isListening}">
        <span class="eyebrow">{{ activeUnit.year }} · {{ activeUnit.title }}</span>
        <ListeningPlayer
          v-if="isListening"
          ref="listeningPlayer"
          :tracks="audioTracks"
          :seekable="audioSeekable"
          :timer-paused="timerState?.mode === 'paused'"
        />
        <template v-else>
        <h1>{{ activeUnit.unit_type === 'cloze' ? 'Use of English' : activeUnit.title }}</h1>
        <p v-if="activeUnit.shared_data?.directions" class="lead" style="margin-bottom:24px">{{ activeUnit.shared_data.directions }}</p>
        <div class="passage" data-vocab-text @contextmenu="openVocabularyMenu">
          <ContentBlocks
            v-if="activeContentBlocks.length"
            :blocks="activeContentBlocks"
            :package-id="activeContentPackage.packageId"
            :content-version="activeContentPackage.contentVersion"
          />
          <template v-else v-for="(segment, index) in passageSegments" :key="`${segment.type}-${index}`">
            <span v-if="segment.type === 'blank'" class="passage-blank" :aria-label="`第 ${segment.number} 空`">
              <span class="blank-number">{{ segment.number }}</span>
            </span>
            <template v-else>{{ segment.text }}</template>
          </template>
        </div>
        </template>
      </section>
      <section class="question-pane">
        <div v-if="isOrdering" class="ordering-board">
          <div class="ordering-note">拖动候选段落调整顺序。前 5 项依次作为第 41–45 题答案，系统会自动保存。</div>
          <VueDraggableNext
            v-model="orderingItems"
            item-key="stable_key"
            handle=".drag-handle"
            ghost-class="drag-ghost"
            :disabled="activeUnitSubmitted"
            @change="saveOrdering"
          >
            <article v-for="(item, index) in orderingItems" :key="item.stable_key" class="candidate-card" data-vocab-text :data-question-id="activeUnit.questions[index]?.id" :class="{ extra: index >= activeUnit.questions.length, 'unanswered-focus': highlightedQuestionId === activeUnit.questions[index]?.id }" @contextmenu="openVocabularyMenu">
              <span class="drag-handle"><GripVertical :size="19" /></span>
              <span class="candidate-position">{{ index < activeUnit.questions.length ? 41 + index : '备选' }}</span>
              <span class="option-letter">{{ item.label }}</span>
              <ContentBlocks v-if="item.content_blocks?.length" :blocks="item.content_blocks" :package-id="activeContentPackage.packageId" :content-version="activeContentPackage.contentVersion" />
              <p v-else>{{ item.content }}</p>
              <span v-if="activeUnitSubmitted && index < activeUnit.questions.length" class="order-result" :class="{correct: orderingAnswers[activeUnit.questions[index].id] === activeUnit.questions[index].answer}">
                {{ orderingAnswers[activeUnit.questions[index].id] === activeUnit.questions[index].answer ? '正确' : `答案 ${displayedAnswer(activeUnit.questions[index])}` }}
              </span>
            </article>
          </VueDraggableNext>
        </div>
        <div v-else-if="isMatchingPartB" class="matching-board">
          <div class="candidate-bank">
            <article v-for="option in candidateOptions" :key="option.stable_key" class="candidate-reference" data-vocab-text @contextmenu="openVocabularyMenu">
              <span class="option-letter">{{ option.label }}</span><ContentBlocks v-if="option.content_blocks?.length" :blocks="option.content_blocks" :package-id="activeContentPackage.packageId" :content-version="activeContentPackage.contentVersion" /><p v-else>{{ option.content }}</p>
            </article>
          </div>
          <div v-for="question in activeUnit.questions" :key="question.id" class="question-card compact-match" :class="{'unanswered-focus':highlightedQuestionId===question.id}" data-vocab-text :data-question-id="question.id" @contextmenu="openVocabularyMenu">
            <div class="question-title"><strong>{{ question.number }}.</strong> <ContentBlocks v-if="question.stem_blocks?.length" :blocks="question.stem_blocks" :package-id="activeContentPackage.packageId" :content-version="activeContentPackage.contentVersion" /><template v-else>{{ question.stem }}</template></div>
            <div class="match-buttons">
              <button v-for="option in question.options" :key="option.stable_key" class="match-chip" :class="resultClass(question, option)" :disabled="activeUnitSubmitted" @click="select(question, option.stable_key)">{{ option.label }}</button>
            </div>
            <div v-if="activeUnitSubmitted" class="match-result" :style="{color:question.is_correct?'var(--success)':'var(--danger)'}">
              {{ question.is_correct ? '回答正确' : `正确答案：${displayedAnswer(question)}` }}
            </div>
          </div>
        </div>
        <div v-else v-for="question in activeUnit.questions" :key="question.id" class="question-card" :class="{'unanswered-focus':highlightedQuestionId===question.id}" data-vocab-text :data-question-id="question.id" @contextmenu="openVocabularyMenu">
          <div class="question-title"><strong>{{ question.number }}.</strong> <ContentBlocks v-if="question.stem_blocks?.length" :blocks="question.stem_blocks" :package-id="activeContentPackage.packageId" :content-version="activeContentPackage.contentVersion" /><template v-else>{{ question.stem }}</template></div>
          <button
            v-for="option in question.options"
            :key="option.stable_key"
            class="option"
            :class="resultClass(question, option)"
            :disabled="activeUnitSubmitted"
            @click="select(question, option.stable_key)"
            @contextmenu.stop="openVocabularyMenu"
          >
            <span class="option-letter">{{ option.label }}</span>
            <span class="option-content" data-vocab-text><ContentBlocks v-if="option.content_blocks?.length" :blocks="option.content_blocks" :package-id="activeContentPackage.packageId" :content-version="activeContentPackage.contentVersion" /><template v-else>{{ option.content }}</template></span>
          </button>
          <div v-if="activeUnitSubmitted" style="margin-top:10px;font-size:13px" :style="{color:question.is_correct?'var(--success)':'var(--danger)'}">
            <CheckCircle2 :size="15" style="vertical-align:-2px" /> {{ question.is_correct ? '回答正确' : `正确答案：${displayedAnswer(question)}` }}
          </div>
        </div>
      </section>
      <footer class="practice-footer" :class="{'listening-footer':isListening}">
        <div class="practice-footer-summary">
          <span>{{ activeUnitIndex + 1 }} / {{ session.units.length }} 篇</span>
          <button
            v-if="activeUnit.submission?.submitted"
            class="unit-result-link"
            type="button"
            @click="showUnitResult(activeUnit.id)"
          >
            本篇 {{ formatScore(activeUnit.submission.score) }} / {{ formatScore(activeUnit.submission.max_score) }}
            · 错 {{ activeUnit.submission.wrong_count ?? 0 }} 题
            <ChevronRight :size="15" />
          </button>
        </div>
        <div v-if="session.status==='active'" class="practice-submit-actions">
          <button v-if="session.mode==='paper' && !activeUnit.submission?.submitted" class="button secondary" @click="submitCurrentUnit">
            <CheckCircle2 :size="16" />提交本篇
          </button>
          <button class="button" @click="submitSession"><Send :size="16" />{{ session.mode === 'paper' ? '整卷交卷' : '提交练习' }}</button>
        </div>
        <button v-else class="button secondary" @click="router.push('/wrong')">查看错题</button>
      </footer>
    </div>
    <div v-else class="loading">正在展开试卷…</div>
    <div v-if="vocabMenu.visible" class="vocab-context-menu" :style="{left:`${vocabMenu.x}px`,top:`${vocabMenu.y}px`}" @click.stop>
      <button @click="addSelectedVocabulary">加入单词本</button>
      <button @click="copySelectedTerm">复制所选内容</button>
    </div>
    <div v-if="vocabularyToast" class="toast vocabulary-toast">{{ vocabularyToast }}</div>
    <section
      v-if="resultPanelVisible && session"
      class="result-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="practice-result-title"
      @click.self="resultPanelVisible=false"
    >
      <div class="result-dialog card">
        <button
          class="result-dialog-close"
          type="button"
          aria-label="关闭成绩面板"
          @click="resultPanelVisible=false"
        >
          <X :size="19" />
        </button>

        <template v-if="resultPanelMode === 'unit' && resultUnit?.submission?.submitted">
          <div class="result-dialog-heading">
            <span class="result-icon"><CheckCircle2 :size="27" /></span>
            <div>
              <span class="eyebrow">UNIT COMPLETE</span>
              <h2 id="practice-result-title">{{ resultUnit.title }}已提交</h2>
              <p>本篇成绩已保存，其他篇目仍可继续作答。</p>
            </div>
          </div>
          <div class="result-score-hero">
            <span>本篇得分</span>
            <strong>
              {{ formatScore(resultUnit.submission.score) }}
              <small>/ {{ formatScore(resultUnit.submission.max_score) }}</small>
            </strong>
          </div>
          <div class="result-stat-grid">
            <div class="result-stat correct">
              <span>答对</span>
              <strong>{{ resultUnit.submission.correct_count ?? 0 }}</strong>
              <small>共 {{ resultUnit.submission.question_count ?? resultUnit.questions.length }} 题</small>
            </div>
            <div class="result-stat wrong">
              <span>答错</span>
              <strong>{{ resultUnit.submission.wrong_count ?? 0 }}</strong>
              <small>{{ resultUnit.submission.wrong_count ? '已自动加入错题本' : '本篇全部答对' }}</small>
            </div>
          </div>
          <div class="result-dialog-actions">
            <button class="button secondary" type="button" @click="resultPanelVisible=false">
              查看本篇对错
            </button>
            <button
              v-if="hasPendingUnits"
              class="button"
              type="button"
              @click="continueToPendingUnit(resultUnit.id)"
            >
              继续下一篇<ChevronRight :size="16" />
            </button>
            <button v-else class="button" type="button" @click="resultPanelVisible=false">
              完成
            </button>
          </div>
        </template>

        <template v-else-if="overallResult">
          <div class="result-dialog-heading">
            <span class="result-icon paper"><Award :size="29" /></span>
            <div>
              <span class="eyebrow">PAPER COMPLETE</span>
              <h2 id="practice-result-title">{{ session.units[0]?.year || '' }} 年整卷成绩</h2>
              <p>所有客观题已判分，各篇成绩如下。</p>
            </div>
          </div>
          <div class="paper-result-overview">
            <div class="result-score-hero paper">
              <span>整卷总分</span>
              <strong>
                {{ formatScore(overallResult.score) }}
                <small>/ {{ formatScore(overallResult.max_score) }}</small>
              </strong>
            </div>
            <div class="paper-result-counts">
              <span><b>{{ overallResult.correct_count }}</b> 题答对</span>
              <span><b>{{ overallResult.wrong_count }}</b> 题答错</span>
              <span>共 {{ overallResult.question_count }} 题</span>
            </div>
          </div>
          <div class="unit-result-list" aria-label="各篇成绩">
            <button
              v-for="unit in session.units"
              :key="unit.id"
              type="button"
              class="unit-result-row"
              @click="openUnitFromResult(unit.id)"
            >
              <span class="unit-result-title">
                <small>第 {{ unit.sequence }} 篇</small>
                <strong>{{ unit.title }}</strong>
              </span>
              <span class="unit-result-numbers">
                <strong>{{ formatScore(unit.submission.score) }} / {{ formatScore(unit.submission.max_score) }}</strong>
                <small>错 {{ unit.submission.wrong_count ?? 0 }} 题</small>
              </span>
              <ChevronRight :size="17" />
            </button>
          </div>
          <div class="result-dialog-actions">
            <button class="button secondary" type="button" @click="router.push('/wrong')">
              查看错题本
            </button>
            <button class="button" type="button" @click="resultPanelVisible=false">
              返回试卷
            </button>
          </div>
        </template>
      </div>
    </section>
    <section v-if="timerPromptVisible" class="timer-overlay" role="dialog" aria-modal="true" aria-labelledby="timer-choice-title">
      <div class="timer-dialog card">
        <span class="timer-dialog-icon"><Clock3 :size="30" /></span>
        <span class="eyebrow">FOCUS TIMER</span>
        <h2 id="timer-choice-title">这次练习要计时吗？</h2>
        <p class="lead">计时能帮助你了解自己的答题节奏。中途可以点击“休息一下”，暂停期间不会计入用时。</p>
        <div class="timer-dialog-actions">
          <button class="button" type="button" @click="startTimedPractice">
            <Clock3 :size="17" />开始计时
          </button>
          <button class="button secondary" type="button" @click="startWithoutTimer">暂不计时</button>
        </div>
        <small>本次选择只对当前练习生效。</small>
      </div>
    </section>
    <section v-if="timerState?.mode === 'paused' && session?.status === 'active'" class="timer-overlay timer-pause-overlay" role="dialog" aria-modal="true" aria-labelledby="timer-pause-title">
      <div class="timer-dialog pause-dialog card">
        <span class="timer-dialog-icon rest"><Coffee :size="30" /></span>
        <span class="eyebrow">TAKE A BREATH</span>
        <h2 id="timer-pause-title">计时已暂停</h2>
        <div class="paused-time">{{ timerText }}</div>
        <p class="lead">活动一下肩颈、喝口水。准备好后再继续，休息时间不会计入练习用时。</p>
        <div class="timer-dialog-actions">
          <button class="button" type="button" @click="resumeTimer"><Play :size="17" />继续练习</button>
          <button class="button secondary" type="button" @click="router.push('/library')">退出练习</button>
        </div>
      </div>
    </section>
  </div>
</template>
