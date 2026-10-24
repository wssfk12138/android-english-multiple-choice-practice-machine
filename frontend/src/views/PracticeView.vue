<script setup lang="ts">
import { selectedSourceSentence } from '../vocabulary-context'
import {
  AlertCircle,
  ArrowLeft,
  Award,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Coffee,
  MoreVertical,
  Pause,
  Play,
  Save,
  Send,
  X,
} from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { App as CapacitorApp } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { createTimer, elapsedTimer, checkpointTimer, pauseTimerState, resumeTimerState, finishTimerState, timerSnapshot, restoreTimer, type PracticeTimerState, type TimerPauseReason } from '../services/practiceTimer'
import { get, post, put } from '../api'
import PracticeContentChoice from '../components/PracticeContentChoice.vue'
import ContentBlocks from '../components/ContentBlocks.vue'
import PassageBlank from '../components/PassageBlank.vue'
import { splitPassageBlanks } from '../passage-blanks'
import { swipeStep, type SwipeStart } from '../practice-swipe'
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
const pendingSubmission = ref<'unit' | 'session' | null>(null)
const pendingBlank = ref(false)
const answerCardVisible = ref(false)
const portraitMoreVisible = ref(false)
const resultPanelMode = ref<'unit' | 'session'>('unit')
const resultPanelUnitId = ref<number | null>(null)
const vocabMenu = ref({ visible: false, x: 0, y: 0, term: '', sentence: '', sourceKind: 'unknown', selectionStart: -1, questionId: null as number | null })
const listeningPlayer = ref<InstanceType<typeof ListeningPlayer> | null>(null)
const currentListeningQuestionId = ref<number | null>(null)
const currentWordBankQuestionId = ref<number | null>(null)
const practiceLayout = ref<HTMLElement | null>(null)
const portraitPaneRatio = ref(50)
const portraitPaneResizing = ref(false)
type VocabularyTranslationTrigger = 'unit_submit' | 'session_submit' | 'practice_exit'
type PendingVocabularyRecord = { entryId: number, unitId: number | null }
const pendingVocabulary = ref<PendingVocabularyRecord[]>([])
let practiceExitTranslation: Promise<void> | null = null
const timerState = ref<PracticeTimerState | null>(null)
const timerPromptVisible = ref(false)
const timerNow = ref(performance.now())
const timerNotice = ref('')
const timerSaveError = ref('')
const pageForeground = ref(document.visibilityState === 'visible')
const nativeForeground = ref<boolean | null>(document.documentElement.dataset.platform === 'android' ? null : true)
const pageLeaving = ref(false)
const timerLoading = ref(true)
const submissionBusy = ref(false)
let pageAlive = true
let loadGeneration = 0
let nativeEventGeneration = 0
let loadedSessionId: number | null = null
let timerBackupBlocked = false
let timerListeners: PluginListenerHandle[] = []
let checkpointAt = performance.now()
let timerTicker: number | null = null
const timerReady = computed(() => pageAlive && !pageLeaving.value && !timerLoading.value && !submissionBusy.value
  && pageForeground.value && nativeForeground.value === true && contentChoiceSessionId.value === null
  && Number(route.params.id) === loadedSessionId && session.value?.id === loadedSessionId && session.value?.status !== 'submitted')
const activeUnit = computed(() => session.value?.units?.[activeUnitIndex.value])
const activeContentBlocks = computed(() => activeUnit.value?.content_blocks || [])
const clozeBlankNumbers = computed<number[]>(() => activeUnit.value?.unit_type === 'cloze'
  ? (activeUnit.value.questions || []).map((question: any) => Number(question.number)).filter(Number.isFinite)
  : [])
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
const isWordBank = computed(() => activeUnit.value?.unit_type === 'word_bank')
const isParagraphMatching = computed(() => activeUnit.value?.unit_type === 'paragraph_matching')
const candidateOptions = computed(() => activeUnit.value?.questions?.[0]?.options || [])
// 共享候选的真实字母范围随题库而变（如 13 段到 M），不能写死 A 到 J。
const candidateRangeLabel = computed(() => {
  const labels = (candidateOptions.value || [])
    .map((option: any) => String(option?.label || '').trim())
    .filter(Boolean)
  if (!labels.length) return ''
  return labels.length > 1 ? `${labels[0]} 到 ${labels[labels.length - 1]}` : labels[0]
})
const legacyCandidateNotice = computed(() => {
  if (!session.value || Number(session.value.candidate_policy_version ?? 2) >= 2) return ''
  const unitType = String(activeUnit.value?.unit_type || '')
  if (!['part_b', 'word_bank', 'paragraph_matching'].includes(unitType)) return ''
  return '本篇属于旧版候选映射的历史练习：当时的展示字母可能与原文标注不一致，成绩按当时的保存内容为准。'
})
const selectedWordBank = computed<Record<string, string>>(() => {
  if (!isWordBank.value) return {}
  return Object.fromEntries((activeUnit.value?.questions || []).map((question: any) => [String(question.id), String(question.user_answer || '')]))
})
const usedWordBankLetters = computed(() => new Set(Object.values(selectedWordBank.value).filter(Boolean)))
const wordBankWords = computed(() => {
  if (!isWordBank.value) return []
  return (activeUnit.value?.questions?.[0]?.options || []).map((option: any) => ({
    stableKey: option.stable_key, label: option.label, content: option.content, used: usedWordBankLetters.value.has(option.stable_key),
  }))
})
const listeningAnsweredCount = computed(() => isListening.value ? (activeUnit.value?.questions || []).filter((question: any) => String(question.user_answer || '').trim()).length : 0)
const currentListeningQuestion = computed(() => {
  if (!isListening.value) return null
  const questions = activeUnit.value?.questions || []
  return questions.find((question: any) => question.id === currentListeningQuestionId.value) || questions.find((question: any) => !String(question.user_answer || '').trim()) || questions[0] || null
})
const currentListeningQuestionNumber = computed(() => currentListeningQuestion.value?.number ?? null)
const orderingFixedSlots = computed(() => {
  const slots = activeUnit.value?.shared_data?.fixed_slots
  return Array.isArray(slots) ? slots : []
})
const timerElapsedMs = computed(() => elapsedTimer(timerState.value, timerNow.value))
const timerText = computed(() => formatDuration(timerElapsedMs.value))
const timerEnabled = computed(() =>
  Boolean(timerState.value && timerState.value.mode !== 'off'),
)
const audioSeekable = computed(() => !timerEnabled.value || timerState.value?.mode === 'finished')
const audioTracks = computed(() => activeUnit.value?.shared_data?.audio_tracks || [])
const activeUnitSubmitted = computed(() =>
  Boolean(activeUnit.value?.submission?.submitted || session.value?.status === 'submitted'),
)
const activeUnitProgress = computed(() => {
  const questions = activeUnit.value?.questions || []
  return {
    answered: questions.filter((question: any) => Boolean(question.user_answer)).length,
    total: questions.length,
  }
})
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
    answered_count: submissions.reduce(
      (sum: number, submission: any) => sum + (submission.answered_count ?? submission.question_count ?? 0),
      0,
    ),
    unanswered_count: session.value.units.reduce(
      (sum: number, unit: any) =>
        sum + (unit.questions || []).filter((question: any) => !String(question.user_answer || '').trim()).length,
      0,
    ),
  }
})
const hasPendingUnits = computed(() =>
  Boolean(session.value?.units?.some((unit: any) => !unit.submission?.submitted)),
)
type PassageSegment = {
  type: 'text' | 'blank'
  text: string
  number?: number
}
const passageSegments = computed<PassageSegment[]>(() => {
  const unit = activeUnit.value
  const passage = unit?.passage || '该题型请在右侧完成候选项匹配。'
  if (unit?.unit_type === 'cloze') return splitPassageBlanks(passage, clozeBlankNumbers.value)
  const usesInlineBlanks = unit?.unit_type === 'cloze'
    || unit?.unit_type === 'word_bank'
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

function isAndroidPortrait() {
  return document.documentElement.dataset.platform === 'android'
    && document.documentElement.dataset.orientation === 'portrait'
}

function clampPortraitPaneRatio(value: number) {
  return Math.min(75, Math.max(25, Math.round(value)))
}

function restorePortraitPaneRatio() {
  const saved = Number(localStorage.getItem('practice-portrait-pane-ratio'))
  if (Number.isFinite(saved)) portraitPaneRatio.value = clampPortraitPaneRatio(saved)
}

function updatePortraitPaneRatio(clientY: number) {
  const bounds = practiceLayout.value?.getBoundingClientRect()
  if (!bounds || bounds.height <= 0) return
  portraitPaneRatio.value = clampPortraitPaneRatio(
    ((clientY - bounds.top) / bounds.height) * 100,
  )
}

function startPortraitPaneResize(event: PointerEvent) {
  if (!isAndroidPortrait()) return
  portraitPaneResizing.value = true
  event.currentTarget instanceof HTMLElement
    && event.currentTarget.setPointerCapture(event.pointerId)
  updatePortraitPaneRatio(event.clientY)
}

function movePortraitPaneResize(event: PointerEvent) {
  if (!portraitPaneResizing.value) return
  updatePortraitPaneRatio(event.clientY)
}

function finishPortraitPaneResize(event: PointerEvent) {
  if (!portraitPaneResizing.value) return
  portraitPaneResizing.value = false
  event.currentTarget instanceof HTMLElement
    && event.currentTarget.hasPointerCapture(event.pointerId)
    && event.currentTarget.releasePointerCapture(event.pointerId)
  localStorage.setItem('practice-portrait-pane-ratio', String(portraitPaneRatio.value))
}

function adjustPortraitPaneRatio(event: KeyboardEvent) {
  let next = portraitPaneRatio.value
  if (event.key === 'ArrowUp') next -= 5
  else if (event.key === 'ArrowDown') next += 5
  else if (event.key === 'Home') next = 25
  else if (event.key === 'End') next = 75
  else return
  event.preventDefault()
  portraitPaneRatio.value = clampPortraitPaneRatio(next)
  localStorage.setItem('practice-portrait-pane-ratio', String(portraitPaneRatio.value))
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (isAndroidPortrait()) {
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}`
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
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
  if (loadedSessionId === null || session.value?.id !== loadedSessionId || !timerState.value) return
  if (timerBackupBlocked) return
  try {
    localStorage.setItem(timerStorageKey(loadedSessionId), JSON.stringify(timerSnapshot(timerState.value, performance.now())))
    timerSaveError.value = ''
  } catch {
    timerSaveError.value = '计时保存失败；异常关闭可能丢失尚未保存的用时，请保持页面打开并检查设备存储。'
  }
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
  pageForeground.value = false
  pausePracticeAutomatically()
  if (document.documentElement.dataset.platform === 'android') {
    void flushVocabularyOnPracticeExit()
    return
  }
  const entryIds = [...new Set(pendingVocabulary.value.map(item => item.entryId))]
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

function flushVocabularyOnPracticeExit(): Promise<void> {
  if (!practiceExitTranslation) {
    practiceExitTranslation = flushVocabularyTranslations('practice_exit')
  }
  return practiceExitTranslation
}

function flushVocabularyOnVisibilityChange() {
  pageForeground.value = document.visibilityState === 'visible'
  if (!pageForeground.value) {
    pausePracticeAutomatically()
    void flushVocabularyOnPracticeExit()
  } else {
    // The user may return to the same practice session and add more words.
    practiceExitTranslation = null
    resumeAutomaticTimer()
  }
}

function initializeTimer() {
  if (!session.value || loadedSessionId !== session.value.id) return
  timerNotice.value = ''
  timerSaveError.value = ''
  timerBackupBlocked = false
  let raw: string | null = null
  try { raw = localStorage.getItem(timerStorageKey(session.value.id)) }
  catch { timerSaveError.value = '计时记录读取失败，无法恢复上次用时。' }
  const saved = restoreTimer(raw, session.value.status === 'submitted')
  timerNotice.value = saved.notice
  if (saved.backup && raw !== null) {
    try {
      const key = timerStorageKey(session.value.id) + '-legacy-backup'
      if (localStorage.getItem(key) === null) localStorage.setItem(key, raw.slice(0, 16384))
    } catch { timerBackupBlocked = true; timerSaveError.value = '旧计时记录备份失败；原记录未覆盖，本次计时暂不能保存。'; timerState.value = saved.state; timerPromptVisible.value = !saved.state && session.value.status !== 'submitted'; return }
  }
  timerState.value = saved.state
  if (session.value.status === 'submitted') {
    timerPromptVisible.value = false
  } else if (saved.state) {
    timerPromptVisible.value = false
  } else if (raw === null && session.value.units?.some((unit: any) => unit.submission?.submitted)) {
    timerState.value = { ...createTimer(), mode: 'off', pauseReason: null }
    timerPromptVisible.value = false
  } else {
    timerPromptVisible.value = true
  }
  // Unknown/corrupt snapshots stay intact until the user chooses a new timer.
  if (timerState.value) persistTimer()
}

function startTimedPractice() {
  timerNow.value = performance.now()
  timerState.value = resumeTimerState(createTimer(), timerNow.value, timerReady.value, true)
  timerPromptVisible.value = false
  checkpointAt = timerNow.value
  persistTimer()
  resetPracticeScroll()
}

function startWithoutTimer() {
  timerState.value = { ...createTimer(), mode: 'off', pauseReason: null }
  timerPromptVisible.value = false
  persistTimer()
  resetPracticeScroll()
}

function resetPracticeScroll() {
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  window.scrollTo(0, 0)
  document.documentElement.scrollTop = 0
}

function pausePracticeTimer(reason: TimerPauseReason) {
  timerNow.value = performance.now()
  if (timerState.value) timerState.value = pauseTimerState(timerState.value, timerNow.value, reason)
  listeningPlayer.value?.pause(reason === 'manual')
  persistTimer()
}
function pausePracticeAutomatically() { pausePracticeTimer('automatic') }
function pauseTimer() { pausePracticeTimer('manual') }
function resumeAutomaticTimer() {
  if (!timerState.value) return
  timerNow.value = performance.now()
  const next = resumeTimerState(timerState.value, timerNow.value, timerReady.value)
  if (next !== timerState.value) { timerState.value = next; persistTimer() }
}
function resumeTimer() {
  if (!timerState.value || submissionBusy.value) return
  timerNow.value = performance.now()
  timerState.value = resumeTimerState(timerState.value, timerNow.value, timerReady.value, true)
  persistTimer()
}
function finishTimer() {
  if (timerState.value) timerState.value = finishTimerState(timerState.value, performance.now())
  persistTimer()
}

async function registerTimerLifecycle() {
  if (document.documentElement.dataset.platform !== 'android') return
  const stateChanged = (active: boolean) => {
    if (!pageAlive) return
    nativeEventGeneration++
    nativeForeground.value = active
    if (!active) {
      pausePracticeAutomatically()
      void flushVocabularyOnPracticeExit()
    } else { practiceExitTranslation = null; resumeAutomaticTimer() }
  }
  try {
    // Register before querying. A newer event always wins over an old getState result.
    for (const register of [
      () => CapacitorApp.addListener('appStateChange', ({ isActive }) => stateChanged(isActive)),
      () => CapacitorApp.addListener('pause', () => stateChanged(false)),
      () => CapacitorApp.addListener('resume', () => stateChanged(true)),
    ]) {
      const handle = await register()
      if (!pageAlive) { await handle.remove(); return }
      timerListeners.push(handle)
    }
    const generation = nativeEventGeneration
    const state = await CapacitorApp.getState()
    if (pageAlive && generation === nativeEventGeneration) stateChanged(state.isActive)
  } catch {
    if (pageAlive) { nativeForeground.value = null; pausePracticeAutomatically(); timerNotice.value = '无法确认应用前台状态，计时已暂停。请重新进入练习。' }
  }
}

const contentChoiceSessionId = ref<number | null>(null)
const contentChoiceBusy = ref(false)
const contentChoiceError = ref('')
const contentTransferNotice = ref('')
async function chooseContent(choice: 'continue' | 'restart') {
  if (contentChoiceBusy.value || contentChoiceSessionId.value === null) return
  contentChoiceBusy.value = true
  contentChoiceError.value = ''
  const generation = loadGeneration
  const sid = Number(route.params.id)
  try {
    const result: any = await post('/practice/sessions/' + contentChoiceSessionId.value + '/content-choice', {choice})
    if (!pageAlive || pageLeaving.value || generation !== loadGeneration || Number(route.params.id) !== sid) return
    contentTransferNotice.value = typeof result.carried === 'number'
      ? `已保留 ${result.carried} 题作答`
        + (result.reset ? `，${result.reset} 题因内容修正需重新作答` : '')
        + (result.carriedSubmissions ? `；${result.carriedSubmissions} 篇已提交成绩原样带入` : '')
      : ''
    if (sid !== Number(result.id)) await router.replace('/practice/' + result.id)
    else await load()
  } catch (e) { if (pageAlive && Number(route.params.id) === sid) contentChoiceError.value = String(e) }
  finally { contentChoiceBusy.value = false }
}

async function load() {
  const generation = ++loadGeneration
  const sid = Number(route.params.id)
  timerLoading.value = true
  const current = () => pageAlive && !pageLeaving.value && generation === loadGeneration && Number(route.params.id) === sid
  try {
    const loaded: any = await get('/practice/sessions/' + sid)
    if (!current()) return
    if (loaded.content_choice_required) {
      session.value = null
      contentChoiceSessionId.value = Number(loaded.id)
      return
    }
    contentChoiceSessionId.value = null
    session.value = loaded
    loadedSessionId = sid
    loadPendingVocabulary(session.value.id)
    initializeTimer()
    syncCurrentQuestionTargets()
  }
  catch (e) { if (current()) error.value = String(e) }
  finally { if (current()) { timerLoading.value = false; resumeAutomaticTimer() } }
}
watch(() => route.params.id, () => {
  pausePracticeAutomatically()
  pageLeaving.value = false
  session.value = null
  loadedSessionId = null
  timerState.value = null
  timerPromptVisible.value = false
  activeUnitIndex.value = 0
  submissionBusy.value = false
  practiceExitTranslation = null
  void load()
})
function handlePageShow() { pageForeground.value = document.visibilityState === 'visible'; resumeAutomaticTimer() }
const removeAfterNavigation = router.afterEach((_to, _from, failure) => {
  if (failure && pageAlive && Number(route.params.id) === loadedSessionId) {
    pageLeaving.value = false
    practiceExitTranslation = null
    resumeAutomaticTimer()
    if (timerLoading.value) void load()
  }
})
onMounted(() => {
  restorePortraitPaneRatio()
  timerTicker = window.setInterval(() => {
    timerNow.value = performance.now()
    if (timerState.value?.mode === 'running' && timerNow.value - checkpointAt >= 5000) {
      timerState.value = checkpointTimer(timerState.value, timerNow.value)
      persistTimer()
      checkpointAt = timerNow.value
    }
  }, 500)
  window.addEventListener('keydown', handleWindowKeydown)
  window.addEventListener('pagehide', flushVocabularyOnPageHide)
  window.addEventListener('pageshow', handlePageShow)
  document.addEventListener('visibilitychange', flushVocabularyOnVisibilityChange)
  void registerTimerLifecycle()
  void load()
})
onBeforeUnmount(() => {
  pausePracticeAutomatically()
  pageAlive = false
  loadGeneration++
  nativeEventGeneration++
  removeAfterNavigation()
  for (const handle of timerListeners) void handle.remove()
  timerListeners = []
  if (timerTicker !== null) window.clearInterval(timerTicker)
  window.removeEventListener('keydown', handleWindowKeydown)
  window.removeEventListener('pagehide', flushVocabularyOnPageHide)
  window.removeEventListener('pageshow', handlePageShow)
  document.removeEventListener('visibilitychange', flushVocabularyOnVisibilityChange)
  void flushVocabularyOnPracticeExit()
})
onBeforeRouteLeave(async () => {
  pageLeaving.value = true
  pausePracticeAutomatically()
  await flushVocabularyOnPracticeExit()
  const current = session.value
  if (current && current.mode === 'paper' && current.status === 'active') {
    const sid = Number(current.id)
    try {
      const result: any = await post(`/practice/sessions/${sid}/abandon-if-empty`, {})
      if (result && result.kept === false) localStorage.removeItem(timerStorageKey(sid))
    } catch {
      // 离开练习时的清理失败不阻塞导航；空会话由周期清扫兜底。
    }
  }
})
onBeforeRouteUpdate(async (to) => {
  // 弹层历史返回（overlay-history 的 dispose 会 history.back() 到同 URL）以及
  // 其它同会话路由更新都不是离开练习；此时暂停计时/标记离开会误伤后续交卷。
  // 只有切换到不同会话才执行离开清理。
  if (String(to?.params?.id ?? '') === String(route.params.id ?? '')) return
  pageLeaving.value = true
  pausePracticeAutomatically()
  await flushVocabularyOnPracticeExit()
})

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && resultPanelVisible.value) {
    resultPanelVisible.value = false
  }
}

async function select(question: any, key: string) {
  if (session.value.status === 'submitted' || activeUnitSubmitted.value) return false
  if (isListening.value) focusListeningQuestion(question.id, false)
  const previous = question.user_answer
  question.user_answer = key
  saving.value = question.id
  try {
    await put(`/practice/sessions/${session.value.id}/answers/${question.id}`, {
      answer: key, option_order: question.option_order,
    })
    if (isListening.value) await advanceListeningQuestion(question.id)
    return true
  } catch (e) {
    question.user_answer = previous
    error.value = String(e)
    return false
  } finally { saving.value = null }
}

function isOrderingOptionUsedByAnother(question: any, stableKey: string) {
  return (activeUnit.value?.questions || []).some((other: any) =>
    other.id !== question.id && other.user_answer === stableKey,
  )
}

function selectOrdering(question: any, stableKey: string) {
  if (!stableKey || isOrderingOptionUsedByAnother(question, stableKey)) return
  void select(question, stableKey)
}

async function selectWordBank(question: any, letter: string) {
  if (session.value.status === 'submitted' || activeUnitSubmitted.value) return
  currentWordBankQuestionId.value = question.id
  const nextAnswer = question.user_answer === letter ? '' : letter
  const saved = await select(question, nextAnswer)
  if (!saved || !nextAnswer) return
  const next = (activeUnit.value?.questions || []).find((candidate: any) => !String(candidate.user_answer || '').trim())
  currentWordBankQuestionId.value = next?.id ?? question.id
}

function selectParagraphMatch(question: any, stableKey: string) {
  const nextAnswer = question.user_answer === stableKey ? '' : stableKey
  void select(question, nextAnswer)
}

function wordBankAnswerForBlank(number?: number) {
  if (!number || !isWordBank.value) return ''
  const question = (activeUnit.value?.questions || []).find((candidate: any) => Number(candidate.number) === number)
  if (!question?.user_answer) return ''
  return question.options?.find((option: any) => option.stable_key === question.user_answer)?.content || ''
}

async function focusWordBankQuestion(number?: number, scroll = true) {
  if (!number || !isWordBank.value) return
  const question = (activeUnit.value?.questions || []).find((candidate: any) => Number(candidate.number) === number)
  if (!question) return
  currentWordBankQuestionId.value = question.id
  if (!scroll) return
  await new Promise(resolve => requestAnimationFrame(resolve))
  document.querySelector<HTMLElement>(`[data-question-id="${question.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function selectWordForCurrentBlank(letter: string) {
  if (!isWordBank.value) return
  const questions = activeUnit.value?.questions || []
  const question = questions.find((candidate: any) => candidate.id === currentWordBankQuestionId.value) || questions.find((candidate: any) => !String(candidate.user_answer || '').trim()) || questions[0]
  if (question) void selectWordBank(question, letter)
}

function syncCurrentQuestionTargets() {
  const questions = activeUnit.value?.questions || []
  if (isListening.value) {
    const target = questions.find((question: any) => !String(question.user_answer || '').trim()) || questions[0]
    currentListeningQuestionId.value = target?.id ?? null
  } else currentListeningQuestionId.value = null
  if (isWordBank.value) {
    const target = questions.find((question: any) => !String(question.user_answer || '').trim()) || questions[0]
    currentWordBankQuestionId.value = target?.id ?? null
  } else currentWordBankQuestionId.value = null
}

async function focusListeningQuestion(questionId: number, scroll = true) {
  if (!isListening.value) return
  currentListeningQuestionId.value = questionId
  if (!scroll) return
  await new Promise(resolve => requestAnimationFrame(resolve))
  document.querySelector<HTMLElement>(`[data-question-id="${questionId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function advanceListeningQuestion(answeredQuestionId: number) {
  const questions = activeUnit.value?.questions || []
  const answeredIndex = questions.findIndex((question: any) => question.id === answeredQuestionId)
  const next = questions.find((question: any, index: number) => index > answeredIndex && !String(question.user_answer || '').trim()) || questions.find((question: any) => !String(question.user_answer || '').trim())
  if (next) await focusListeningQuestion(next.id)
}

function resultClass(question: any, option: any) {
  if (session.value.status !== 'submitted' && !activeUnitSubmitted.value) {
    return { selected: question.user_answer === option.stable_key }
  }
  return {
    selected: question.user_answer === option.stable_key,
    wrong: question.user_answer === option.stable_key && question.is_correct === false,
  }
}

async function waitForPendingSaves() {
  // 交卷前等当前答案保存落地，避免“保存中交卷”丢最后一题。
  for (let attempt = 0; attempt < 50 && saving.value !== null; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

const submissionRequestId = ref('')
function nextSubmissionRequestId() {
  if (!submissionRequestId.value) {
    submissionRequestId.value = `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
  return submissionRequestId.value
}

function questionResultText(question: any) {
  const unitSubmitted = Boolean(activeUnit.value?.submission?.submitted || session.value?.status === 'submitted')
  if (unitSubmitted && !String(question.user_answer || '').trim()) return '未作答'
  return question.is_correct ? '回答正确' : '回答错误'
}

function questionResultStyle(question: any) {
  const unitSubmitted = Boolean(activeUnit.value?.submission?.submitted || session.value?.status === 'submitted')
  if (unitSubmitted && !String(question.user_answer || '').trim()) return {}
  return { color: question.is_correct ? 'var(--success)' : 'var(--danger)' }
}

const pendingBlankStats = computed(() => {
  const empty = { total: 0, answered: 0, unanswered: 0, affectedUnits: 0, allBlank: true }
  if (!session.value || !pendingSubmission.value) return empty
  if (pendingSubmission.value === 'unit') {
    const unit = session.value.units[activeUnitIndex.value]
    const questions = unit?.questions || []
    const unanswered = questions.filter((question: any) => !String(question.user_answer || '').trim()).length
    return {
      total: questions.length,
      answered: questions.length - unanswered,
      unanswered,
      affectedUnits: 1,
      allBlank: answered0(questions),
    }
  }
  const questions = session.value.units.flatMap((unit: any) => unit.questions || [])
  const unanswered = questions.filter((question: any) => !String(question.user_answer || '').trim()).length
  const affectedUnits = session.value.units.filter((unit: any) =>
    (unit.questions || []).some((question: any) => !String(question.user_answer || '').trim()),
  ).length
  return {
    total: questions.length,
    answered: questions.length - unanswered,
    unanswered,
    affectedUnits,
    allBlank: answered0(questions),
  }
})

function answered0(questions: any[]) {
  return questions.every((question: any) => !String(question.user_answer || '').trim())
}

const pendingSubmissionHeading = computed(() => {
  if (!pendingSubmission.value) return ''
  if (pendingBlank.value) {
    if (pendingSubmission.value === 'unit') return '本篇还有未作答的题目'
    return pendingBlankStats.value.allBlank ? '本次练习还没有作答' : '还有未作答的题目'
  }
  if (pendingSubmission.value === 'unit') return '确认提交本篇'
  return session.value?.mode === 'paper' ? '确认提交整卷' : '确认提交练习'
})

const pendingSubmissionMessage = computed(() => {
  if (!pendingSubmission.value) return ''
  if (pendingBlank.value) {
    const stats = pendingBlankStats.value
    if (pendingSubmission.value === 'unit') {
      return `“${activeUnit.value?.title || ''}”已答 ${stats.answered} 题，还有 ${stats.unanswered} 题未作答。留空提交后本篇不能继续修改：未作答按 0 分计，不加入错题本。`
    }
    if (stats.allBlank) {
      return `共 ${stats.total} 题未作答，涉及 ${stats.affectedUnits} 篇。结束后不会产生对错与能力分析，练习将按未作答结束。`
    }
    return `已答 ${stats.answered} / 共 ${stats.total} 题，未作答分布在 ${stats.affectedUnits} 篇。留空提交后不能继续修改：未作答按 0 分计，不加入错题本。`
  }
  return pendingSubmission.value === 'unit'
    ? `提交“${activeUnit.value?.title}”后会显示本篇对错，且本篇不能继续修改。`
    : '提交后才会显示对错，且不能继续修改。'
})

const pendingSubmissionConfirmLabel = computed(() => {
  if (!pendingBlank.value) return '确认提交'
  if (pendingSubmission.value === 'session' && pendingBlankStats.value.allBlank) return '结束本次练习'
  return '留空提交'
})

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
  const sid = loadedSessionId
  const generation = loadGeneration
  const loaded = await get(`/practice/sessions/${sid}`)
  if (!pageAlive || pageLeaving.value || generation !== loadGeneration || sid !== loadedSessionId) return true
  session.value = loaded
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
  await waitForPendingSaves()
  const missing = firstUnanswered([activeUnitIndex.value])
  pendingBlank.value = Boolean(missing)
  pendingSubmission.value = 'unit'
}

async function confirmCurrentUnitSubmission(allowUnanswered: boolean) {
  if (submissionBusy.value || !session.value || pageLeaving.value) return
  const sid = loadedSessionId
  const generation = loadGeneration
  const wasRunning = timerState.value?.mode === 'running'
  submissionBusy.value = true
  pausePracticeTimer('submitting')
  const submittedUnitId = activeUnit.value.id
  try {
    const result = await post(
      `/practice/sessions/${sid}/units/${submittedUnitId}/submit`,
      { allow_unanswered: allowUnanswered, submission_request_id: nextSubmissionRequestId() },
    )
    if (!pageAlive || pageLeaving.value || generation !== loadGeneration || sid !== loadedSessionId) return
    submissionRequestId.value = ''
    session.value = result
    unansweredNotice.value = ''
    showUnitResult(submittedUnitId)
  } catch (e) {
    if (!pageAlive || pageLeaving.value || generation !== loadGeneration || sid !== loadedSessionId) return
    if (await handleIncompleteSubmission(e)) return
    error.value = String(e)
  } finally {
    releaseSubmissionTimer(sid, generation, wasRunning)
  }
}
function releaseSubmissionTimer(sid: number | null, generation: number, wasRunning: boolean) {
  if (!pageAlive || generation !== loadGeneration || sid !== loadedSessionId) return
  submissionBusy.value = false
  if (wasRunning && timerState.value?.mode === 'paused') {
    timerState.value = pauseTimerState(timerState.value, performance.now(), 'automatic')
    resumeAutomaticTimer()
  }
  persistTimer()
}

async function submitSession() {
  await waitForPendingSaves()
  const missing = firstUnanswered(session.value.units.map((_: any, index: number) => index))
  pendingBlank.value = Boolean(missing)
  pendingSubmission.value = 'session'
}

async function confirmSessionSubmission(allowUnanswered: boolean) {
  if (submissionBusy.value || !session.value || pageLeaving.value) return
  const sid = loadedSessionId
  const generation = loadGeneration
  const wasRunning = timerState.value?.mode === 'running'
  submissionBusy.value = true
  pausePracticeTimer('submitting')
  try {
    const result = await post(`/practice/sessions/${sid}/submit`, {
      allow_unanswered: allowUnanswered,
      submission_request_id: nextSubmissionRequestId(),
    })
    if (!pageAlive || generation !== loadGeneration || sid !== loadedSessionId) return
    submissionRequestId.value = ''
    session.value = result
    finishTimer()
    showSessionResult()
  }
  catch (e) {
    if (!pageAlive || pageLeaving.value || generation !== loadGeneration || sid !== loadedSessionId) return
    if (await handleIncompleteSubmission(e)) return
    error.value = String(e)
  } finally {
    releaseSubmissionTimer(sid, generation, wasRunning)
  }
}

function switchUnit(index: number) {
  if (!session.value?.units?.[index] || saving.value !== null) return
  activeUnitIndex.value = index
  unansweredNotice.value = ''
  highlightedQuestionId.value = null
  syncCurrentQuestionTargets()
}

let swipeStart: SwipeStart | null = null
let suppressSwipeClickUntil = 0
function swipeBlocked() {
  return document.documentElement.dataset.platform !== 'android' || saving.value !== null
    || portraitPaneResizing.value || vocabMenu.value.visible || resultPanelVisible.value
    || pendingSubmission.value !== null || answerCardVisible.value || portraitMoreVisible.value
    || Boolean(window.getSelection()?.toString().trim())
}
function startPracticeSwipe(event: TouchEvent) {
  swipeStart = null
  if (event.touches.length !== 1 || swipeBlocked()) return
  const touch = event.touches[0]!
  if (touch.clientX < 28 || touch.clientX > window.innerWidth - 28) return
  let element = event.target instanceof Element ? event.target : null
  if (element?.closest('button, input, textarea, select, a, [role="button"], [role="slider"], [contenteditable="true"], .portrait-pane-splitter')) return
  while (element && element !== practiceLayout.value) {
    if (element.scrollWidth > element.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(element).overflowX)) return
    element = element.parentElement
  }
  swipeStart = { x: touch.clientX, y: touch.clientY, at: Date.now(), orientation: String(window.innerWidth > window.innerHeight) }
}
function movePracticeSwipe(event: TouchEvent) {
  if (!swipeStart) return
  if (event.touches.length !== 1 || swipeBlocked()) { swipeStart = null; return }
  const touch = event.touches[0]!
  const dx = Math.abs(touch.clientX - swipeStart.x), dy = Math.abs(touch.clientY - swipeStart.y)
  if (dy > 16 && dy >= dx) swipeStart = null
}
function finishPracticeSwipe(event: TouchEvent) {
  const start = swipeStart
  swipeStart = null
  if (!start || event.changedTouches.length !== 1 || swipeBlocked()) return
  const touch = event.changedTouches[0]!
  const step = swipeStep(start, touch.clientX, touch.clientY, Date.now(), String(window.innerWidth > window.innerHeight))
  if (!step || !session.value?.units?.[activeUnitIndex.value + step]) return
  event.preventDefault()
  suppressSwipeClickUntil = Date.now() + 400
  switchUnit(activeUnitIndex.value + step)
}
function blockSwipeClick(event: MouseEvent) {
  if (Date.now() < suppressSwipeClickUntil) { event.preventDefault(); event.stopPropagation() }
}

async function jumpToQuestion(unitIndex: number, questionId: number) {
  switchUnit(unitIndex)
  answerCardVisible.value = false
  portraitMoreVisible.value = false
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  document.querySelector<HTMLElement>(`[data-question-id="${questionId}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function questionCardState(unit: any, question: any, unitIndex: number) {
  return {
    answered: Boolean(question.user_answer),
    current: unitIndex === activeUnitIndex.value && highlightedQuestionId.value === question.id,
    submitted: Boolean(unit.submission?.submitted || session.value?.status === 'submitted'),
  }
}

async function confirmPendingSubmission() {
  const action = pendingSubmission.value
  const allowUnanswered = pendingBlank.value
  pendingSubmission.value = null
  pendingBlank.value = false
  if (action === 'unit') await confirmCurrentUnitSubmission(allowUnanswered)
  if (action === 'session') await confirmSessionSubmission(allowUnanswered)
}

function cancelPendingSubmission() {
  const action = pendingSubmission.value
  const wasBlank = pendingBlank.value
  pendingSubmission.value = null
  pendingBlank.value = false
  if (!wasBlank || !session.value) return
  // 返回继续答题：定位回第一个未作答的题。
  const indexes = action === 'unit'
    ? [activeUnitIndex.value]
    : session.value.units.map((_: any, index: number) => index)
  const missing = firstUnanswered(indexes)
  if (missing) focusUnanswered(missing.unitIndex, missing.question)
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
  const rangeRect = selection?.rangeCount
    ? selection.getRangeAt(0).getBoundingClientRect()
    : null
  const anchor = rangeRect && (rangeRect.width || rangeRect.height)
    ? rangeRect
    : new DOMRect(event.clientX, event.clientY, 1, 1)
  const menuWidth = Math.min(208, window.innerWidth - 24)
  const menuHeight = 112
  const edge = 12
  const bottomReserve = document.documentElement.dataset.platform === 'android'
    && window.matchMedia('(orientation: portrait)').matches
    ? 82 + (Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-bottom')) || 0)
    : edge
  const centeredX = anchor.left + anchor.width / 2 - menuWidth / 2
  const x = Math.max(edge, Math.min(centeredX, window.innerWidth - menuWidth - edge))
  const below = anchor.bottom + 14
  const above = anchor.top - menuHeight - 14
  const y = below + menuHeight <= window.innerHeight - bottomReserve
    ? below
    : Math.max(edge, above)
  const selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : null
  if (!selectedRange || !source.contains(selectedRange.startContainer) || !source.contains(selectedRange.endContainer)) return
  const sourceRange = selectedRange.cloneRange()
  sourceRange.selectNodeContents(source)
  const sourceText = sourceRange.toString()
  sourceRange.setEnd(selectedRange.startContainer, selectedRange.startOffset)
  const selectionStart = sourceRange.toString().length + (selectedRange.toString().length - selectedRange.toString().trimStart().length)
  vocabMenu.value = {
    visible: true,
    x,
    y,
    term,
    sentence: selectedSourceSentence(sourceText, term, selectionStart),
    sourceKind: source.closest('.option, .candidate-reference, .ordering-paragraph') ? 'option' : source.closest('.passage') ? 'passage' : 'question',
    selectionStart,
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
      source_kind: item.sourceKind,
      selection_start: item.selectionStart,
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
      : '已加入单词本，退出答题界面后将在后台翻译'
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
  <PracticeContentChoice v-if="contentChoiceSessionId !== null" :busy="contentChoiceBusy" :error="contentChoiceError" @choose="chooseContent" />
  <div v-else class="practice-page" @click="vocabMenu.visible=false">
    <header class="portrait-practice-top" v-if="session">
      <div class="portrait-practice-actions">
        <button class="portrait-icon-button" type="button" title="退出练习" aria-label="退出练习" @click="router.push('/library')">
          <X :size="20" />
        </button>
        <div v-if="timerEnabled" class="portrait-timer-pill" :class="{ paused: timerState?.mode === 'paused' }" aria-live="polite">
          <button
            v-if="timerState?.mode === 'running' && session.status === 'active'"
            type="button"
            title="暂停计时"
            aria-label="暂停计时"
            @click="pauseTimer"
          ><Pause :size="17" /></button>
          <button
            v-else-if="timerState?.mode === 'paused' && session.status === 'active'"
            type="button"
            title="继续计时"
            aria-label="继续计时"
            @click="resumeTimer"
          ><Play :size="17" /></button>
          <Clock3 v-else :size="16" />
          <strong>{{ timerText }}</strong>
        </div>
        <span v-else class="portrait-save-state">{{ saving ? '保存中' : `${activeUnitProgress.answered}/${activeUnitProgress.total}` }}</span>
        <div class="portrait-toolbar-spacer"></div>
        <button class="portrait-icon-button portrait-answer-card-trigger" type="button" title="打开答题卡" aria-label="打开答题卡" @click="answerCardVisible=true">
          <ClipboardList :size="20" />
        </button>
        <div class="portrait-more-wrap">
          <button class="portrait-icon-button" type="button" title="更多操作" aria-label="更多操作" :aria-expanded="portraitMoreVisible" @click.stop="portraitMoreVisible=!portraitMoreVisible">
            <MoreVertical :size="20" />
          </button>
          <div v-if="portraitMoreVisible" class="portrait-more-menu" @click.stop>
            <span>切换篇目</span>
            <button v-for="(unit, i) in session.units" :key="`more-${unit.id}`" type="button" :class="{active:i===activeUnitIndex}" @click="switchUnit(i);portraitMoreVisible=false">
              {{ unit.title }}<CheckCircle2 v-if="unit.submission?.submitted" :size="14" />
            </button>
          </div>
        </div>
      </div>
      <div class="portrait-practice-heading">
        <strong>{{ activeUnit?.year }} {{ activeUnit?.title }}</strong>
        <span>{{ activeUnitProgress.answered }}/{{ activeUnitProgress.total }}</span>
      </div>
    </header>
    <header class="practice-top default-practice-top">
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
          <button v-if="timerState?.mode === 'running' && session.status === 'active'" type="button" title="暂停计时" aria-label="暂停计时" @click="pauseTimer">
            <Pause class="portrait-timer-control-icon" :size="16" />
            <Coffee class="default-timer-control-content" :size="15" /><span class="default-timer-control-content">休息一下</span>
          </button>
          <button v-else-if="timerState?.mode === 'paused' && session.status === 'active'" type="button" title="继续计时" aria-label="继续计时" @click="resumeTimer">
            <Play :size="16" /><span class="default-timer-control-content">继续练习</span>
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
    <div
      v-if="contentTransferNotice"
      class="unanswered-banner"
      role="status"
      style="color:var(--success);cursor:pointer"
      title="点击关闭"
      @click="contentTransferNotice=''"
    ><CheckCircle2 :size="18" />{{ contentTransferNotice }}</div>
    <div v-if="unansweredNotice" class="unanswered-banner" role="alert">
      <AlertCircle :size="18" />{{ unansweredNotice }}
    </div>
    <div v-if="legacyCandidateNotice" class="unanswered-banner" role="note">
      <AlertCircle :size="18" />{{ legacyCandidateNotice }}
    </div>
    <div
      v-if="session && activeUnit"
      ref="practiceLayout"
      class="practice-layout"
      @touchstart.passive="startPracticeSwipe"
      @touchmove.passive="movePracticeSwipe"
      @touchend="finishPracticeSwipe"
      @touchcancel="swipeStart = null"
      @click.capture="blockSwipeClick"
      :class="{'listening-layout':isListening, 'portrait-pane-resizing':portraitPaneResizing}"
      :style="{
        '--portrait-passage-size': `${portraitPaneRatio}fr`,
        '--portrait-question-size': `${100 - portraitPaneRatio}fr`,
      }"
    >
      <section class="passage-pane" :class="{'listening-console-pane':isListening}">
        <span class="eyebrow">{{ activeUnit.year }} · {{ activeUnit.title }}</span>
        <ListeningPlayer
          v-if="isListening"
          ref="listeningPlayer"
          :tracks="audioTracks"
          :seekable="audioSeekable"
          :timer-paused="timerState?.mode === 'paused' || !pageForeground || nativeForeground !== true || pageLeaving"
          :resume-on-timer-continue="timerState?.pauseReason === 'manual'"
          :current-question-number="currentListeningQuestionNumber"
          :answered-count="listeningAnsweredCount"
          :question-count="activeUnit.questions.length"
          @locate-question="currentListeningQuestion && focusListeningQuestion(currentListeningQuestion.id)"
          @playback-start="currentListeningQuestion && focusListeningQuestion(currentListeningQuestion.id)"
        />
        <template v-else>
        <h1 v-if="!isPartB">{{ activeUnit.unit_type === 'cloze' ? 'Use of English' : activeUnit.title }}</h1>
        <p v-if="activeUnit.shared_data?.directions" class="lead" style="margin-bottom:24px">{{ activeUnit.shared_data.directions }}</p>
        <div v-if="isOrdering" class="ordering-reference-sheet" :aria-label="'候选段落 ' + candidateRangeLabel">
          <article v-for="option in candidateOptions" :key="option.stable_key" class="ordering-paragraph" data-vocab-text @contextmenu="openVocabularyMenu">
            <strong class="ordering-paragraph-label">{{ option.label }}.</strong>
            <div class="ordering-paragraph-content">
              <ContentBlocks v-if="option.content_blocks?.length" :blocks="option.content_blocks" :package-id="activeContentPackage.packageId" :content-version="activeContentPackage.contentVersion" />
              <p v-else>{{ option.content }}</p>
            </div>
          </article>
        </div>
        <div v-else class="passage" data-vocab-text @contextmenu="openVocabularyMenu">
          <ContentBlocks
            v-if="activeContentBlocks.length"
            :blocks="activeContentBlocks"
            :blank-numbers="clozeBlankNumbers"
            :package-id="activeContentPackage.packageId"
            :content-version="activeContentPackage.contentVersion"
          />
          <template v-else v-for="(segment, index) in passageSegments" :key="`${segment.type}-${index}`">
            <button v-if="segment.type === 'blank' && isWordBank" type="button" class="passage-blank word-bank-passage-blank" :class="{ selected: wordBankAnswerForBlank(segment.number) }" :disabled="activeUnitSubmitted" :aria-label="`第 ${segment.number} 空，${wordBankAnswerForBlank(segment.number) || '尚未选择词语'}`" @click="focusWordBankQuestion(segment.number)">
              <span class="word-bank-blank-number">{{ segment.number }}</span><span class="word-bank-blank-answer">{{ wordBankAnswerForBlank(segment.number) || '选择词语' }}</span>
            </button>
            <PassageBlank v-else-if="segment.type === 'blank'" :number="segment.number" />
            <template v-else>{{ segment.text }}</template>
          </template>
        </div>
        </template>
      </section>
      <div
        class="portrait-pane-divider"
        role="separator"
        aria-label="调整题目与选项区域高度"
        aria-orientation="horizontal"
        aria-valuemin="25"
        aria-valuemax="75"
        :aria-valuenow="portraitPaneRatio"
        tabindex="0"
        @pointerdown.prevent="startPortraitPaneResize"
        @pointermove.prevent="movePortraitPaneResize"
        @pointerup="finishPortraitPaneResize"
        @pointercancel="finishPortraitPaneResize"
        @keydown="adjustPortraitPaneRatio"
      >
        <span aria-hidden="true"></span>
      </div>
      <section class="question-pane">
        <div v-if="isOrdering" class="ordering-board">
          <div class="ordering-section-heading"><span>选择答案</span><small>{{ activeUnit.questions.filter((question: any) => question.user_answer).length }} / {{ activeUnit.questions.length }} 已完成</small></div>
          <div
            v-if="orderingFixedSlots.length"
            class="ordering-fixed-slots"
            aria-label="原题固定段落位置"
          >
            <span class="ordering-fixed-caption">原题固定位置</span>
            <div class="ordering-fixed-chain">
              <template v-for="(slot, index) in orderingFixedSlots" :key="`${slot.type}-${slot.number ?? slot.label}-${index}`">
                <strong v-if="slot.type === 'question'" class="ordering-fixed-question">{{ slot.number }}</strong>
                <span v-else class="ordering-fixed-label">{{ slot.label }}</span>
                <span v-if="index < orderingFixedSlots.length - 1" class="ordering-slot-arrow" aria-hidden="true">→</span>
              </template>
            </div>
          </div>
          <div class="ordering-answer-list">
            <div v-for="question in activeUnit.questions" :key="question.id" class="ordering-answer-row" :class="{'unanswered-focus': highlightedQuestionId === question.id}" :data-question-id="question.id">
              <strong>{{ question.number }}.</strong>
              <div class="ordering-choice-row" role="group" :aria-label="`${question.number}题段落选择`">
                <button
                  v-for="option in candidateOptions"
                  :key="option.stable_key"
                  type="button"
                  class="ordering-choice"
                  :class="resultClass(question, option)"
                  :disabled="activeUnitSubmitted || isOrderingOptionUsedByAnother(question, option.stable_key)"
                  @click="selectOrdering(question, option.stable_key)"
                >{{ option.label }}</button>
              </div>
              <span v-if="activeUnitSubmitted" class="order-result" :class="{correct: question.is_correct}">{{ question.is_correct ? '正确' : (String(question.user_answer || '').trim() ? '回答错误' : '未作答') }}</span>
            </div>
          </div>
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
            <div v-if="activeUnitSubmitted" class="match-result" :style="questionResultStyle(question)">
              {{ questionResultText(question) }}
            </div>
          </div>
        </div>
        <div v-else-if="isWordBank" class="word-bank-board">
          <div class="word-bank-list">
            <button v-for="word in wordBankWords" :key="word.stableKey" class="word-bank-chip" :class="{ used: word.used }" :disabled="activeUnitSubmitted || word.used" :aria-label="`将 ${word.content} 填入当前空位`" @click="selectWordForCurrentBlank(word.stableKey)">{{ word.label }}. {{ word.content }}</button>
          </div>
          <div v-for="question in activeUnit.questions" :key="question.id" class="question-card compact-match" :class="{'unanswered-focus':highlightedQuestionId===question.id,'word-bank-current':currentWordBankQuestionId===question.id}" data-vocab-text :data-question-id="question.id" @click="currentWordBankQuestionId=question.id" @focusin="currentWordBankQuestionId=question.id" @contextmenu="openVocabularyMenu">
            <div class="question-title"><strong>{{ question.number }}.</strong> <ContentBlocks v-if="question.stem_blocks?.length" :blocks="question.stem_blocks" :package-id="activeContentPackage.packageId" :content-version="activeContentPackage.contentVersion" /><template v-else>{{ question.stem }}</template></div>
            <div class="match-buttons"><button v-for="option in question.options" :key="option.stable_key" class="match-chip" :class="{ ...resultClass(question, option), used: usedWordBankLetters.has(option.stable_key) && question.user_answer !== option.stable_key }" :disabled="activeUnitSubmitted || (usedWordBankLetters.has(option.stable_key) && question.user_answer !== option.stable_key)" @click="selectWordBank(question, option.stable_key)">{{ option.label }}</button></div>
            <div v-if="activeUnitSubmitted" class="match-result" :style="questionResultStyle(question)">{{ questionResultText(question) }}</div>
          </div>
        </div>
        <div v-else-if="isParagraphMatching" class="matching-board">
          <div class="paragraph-candidate-bank" :aria-label="'候选段落 ' + candidateRangeLabel"><div class="candidate-bank-heading"><strong>候选段落</strong></div><article v-for="option in candidateOptions" :key="option.stable_key" class="candidate-reference paragraph-candidate-reference" data-vocab-text @contextmenu="openVocabularyMenu"><span class="option-letter">{{ option.label }}</span><ContentBlocks v-if="option.content_blocks?.length" :blocks="option.content_blocks" :package-id="activeContentPackage.packageId" :content-version="activeContentPackage.contentVersion" /><p v-else>{{ option.content }}</p></article></div>
          <div v-for="question in activeUnit.questions" :key="question.id" class="question-card compact-match" :class="{'unanswered-focus':highlightedQuestionId===question.id}" data-vocab-text :data-question-id="question.id" @contextmenu="openVocabularyMenu"><div class="question-title"><strong>{{ question.number }}.</strong> <ContentBlocks v-if="question.stem_blocks?.length" :blocks="question.stem_blocks" :package-id="activeContentPackage.packageId" :content-version="activeContentPackage.contentVersion" /><template v-else>{{ question.stem }}</template></div><div class="match-buttons"><button v-for="option in question.options" :key="option.stable_key" class="match-chip" :class="resultClass(question, option)" :disabled="activeUnitSubmitted" @click="selectParagraphMatch(question, option.stable_key)">{{ option.label }}</button></div><div v-if="activeUnitSubmitted" class="match-result" :style="questionResultStyle(question)">{{ questionResultText(question) }}</div></div>
        </div>
        <div v-else v-for="question in activeUnit.questions" :key="question.id" class="question-card" :class="{'unanswered-focus':highlightedQuestionId===question.id,'listening-current':isListening && currentListeningQuestionId===question.id}" :aria-current="isListening && currentListeningQuestionId===question.id ? 'true' : undefined" data-vocab-text :data-question-id="question.id" @click="isListening && focusListeningQuestion(question.id, false)" @focusin="isListening && focusListeningQuestion(question.id, false)" @contextmenu="openVocabularyMenu">
          <div v-if="isListening && currentListeningQuestionId===question.id" class="listening-current-label">当前听力题</div>
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
          <div v-if="activeUnitSubmitted" style="margin-top:10px;font-size:13px" :style="questionResultStyle(question)">
            <CheckCircle2 :size="15" style="vertical-align:-2px" /> {{ questionResultText(question) }}
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
    <aside v-if="timerNotice || timerSaveError" class="timer-status-notice" role="status">
      <span>{{ timerSaveError || timerNotice }}</span>
      <button v-if="!timerSaveError" type="button" aria-label="关闭计时提示" @click="timerNotice=''"><X :size="18" /></button>
    </aside>
    <div v-if="vocabularyToast" class="toast vocabulary-toast">{{ vocabularyToast }}</div>
    <section v-if="answerCardVisible && session" class="answer-card-overlay" role="dialog" aria-modal="true" aria-labelledby="answer-card-title">
      <div class="answer-card-drawer">
        <header class="answer-card-heading">
          <div>
            <h2 id="answer-card-title">答题卡</h2>
          </div>
          <button class="portrait-icon-button" type="button" title="关闭答题卡" aria-label="关闭答题卡" @click="answerCardVisible=false"><X :size="20" /></button>
        </header>
        <div class="answer-card-scroll">
          <section v-for="(unit, unitIndex) in session.units" :key="`answer-unit-${unit.id}`" class="answer-card-unit">
            <div class="answer-card-unit-title">
              <strong>{{ unit.title }}</strong>
              <span>{{ unit.questions.filter((question:any) => question.user_answer).length }}/{{ unit.questions.length }}</span>
            </div>
            <div class="answer-number-grid">
              <button
                v-for="question in unit.questions"
                :key="`answer-question-${question.id}`"
                type="button"
                class="answer-number"
                :class="questionCardState(unit, question, unitIndex)"
                :aria-label="`前往${unit.title}第${question.number}题`"
                @click="jumpToQuestion(unitIndex, question.id)"
              >{{ question.number }}</button>
            </div>
          </section>
        </div>
        <footer class="answer-card-actions">
          <button v-if="session.status==='active' && session.mode==='paper' && !isListening && !activeUnit.submission?.submitted" class="button secondary" type="button" @click="answerCardVisible=false;submitCurrentUnit()">
            提交本篇
          </button>
          <button v-if="session.status==='active'" class="button" type="button" @click="answerCardVisible=false;submitSession()">
            {{ session.mode === 'paper' ? '提交整卷' : '提交练习' }}
          </button>
          <button v-else class="button" type="button" @click="answerCardVisible=false;router.push('/wrong')">查看错题</button>
        </footer>
      </div>
    </section>
    <section v-if="pendingSubmission" class="result-overlay" role="dialog" aria-modal="true" aria-labelledby="submission-confirm-title" @click.self="cancelPendingSubmission">
      <div class="result-dialog submission-confirm-dialog card">
        <div class="result-dialog-heading">
          <span class="result-icon"><AlertCircle :size="27" /></span>
          <div>
            <h2 id="submission-confirm-title">{{ pendingSubmissionHeading }}</h2>
            <p>{{ pendingSubmissionMessage }}</p>
          </div>
        </div>
        <div class="result-dialog-actions">
          <button class="button secondary" type="button" @click="cancelPendingSubmission">{{ pendingBlank ? '返回继续答题' : '取消' }}</button>
          <button class="button" type="button" @click="confirmPendingSubmission">{{ pendingSubmissionConfirmLabel }}</button>
        </div>
      </div>
    </section>
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
              <h2 id="practice-result-title">{{ resultUnit.title }}已提交</h2>
              <p v-if="resultUnit.submission.unanswered_count">本篇成绩已保存：有 {{ resultUnit.submission.unanswered_count }} 题未作答，按 0 分计、未计入对错。</p>
              <p v-else>本篇成绩已保存，其他篇目仍可继续作答。</p>
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
              <h2 id="practice-result-title">{{ session.units[0]?.year || '' }} 年整卷成绩</h2>
              <p v-if="overallResult.unanswered_count">本次为部分作答成绩：未作答按 0 分计、不加入错题本。</p>
              <p v-else>所有客观题已判分，各篇成绩如下。</p>
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
              <span v-if="overallResult.unanswered_count"><b>{{ overallResult.unanswered_count }}</b> 题未作答</span>
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
                <small v-if="unit.submission.unanswered_count">未答 {{ unit.submission.unanswered_count }} 题</small>
                <small v-else>错 {{ unit.submission.wrong_count ?? 0 }} 题</small>
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
    <section v-if="timerPromptVisible" class="timer-overlay" role="dialog" aria-modal="true" aria-labelledby="timer-choice-title" @click.self.prevent>
      <div class="timer-dialog card" @click.stop>
        <span class="timer-dialog-icon"><Clock3 :size="30" /></span>
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
    <section v-if="timerState?.mode === 'paused' && timerState.pauseReason === 'manual' && session?.status === 'active'" class="timer-overlay timer-pause-overlay" role="dialog" aria-modal="true" aria-labelledby="timer-pause-title" @click.self.prevent>
      <div class="timer-dialog pause-dialog card" @click.stop>
        <span class="timer-dialog-icon rest"><Coffee :size="30" /></span>
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

<style scoped>
.timer-status-notice {
  position: fixed;
  bottom: calc(88px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 35;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: min(560px, calc(100vw - 32px));
  max-height: 30vh;
  overflow-y: auto;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface-solid);
  color: var(--text);
  box-shadow: var(--shadow);
  font-size: 14px;
  line-height: 1.6;
}
.timer-status-notice span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.timer-status-notice button {
  flex: 0 0 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.timer-status-notice button:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
</style>
