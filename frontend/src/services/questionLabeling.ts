import { reactive } from 'vue'
import { get, post } from '../api'

export type LabelStatus = {
  year: number | null
  paper_ids: number[]
  years: number[]
  total: number
  labeled: number
  locked: number
  review_pending: number
  remaining: number
  percentage: number
}

export type LabelScope = {
  kind: 'all' | 'year' | 'papers'
  title: string
  year: number | null
  paperIds: number[]
}

export const questionLabelingState = reactive<{
  isRunning: boolean
  isPausing: boolean
  runId: string
  scope: LabelScope | null
  status: LabelStatus | null
  message: string
  error: string
}>({
  isRunning: false,
  isPausing: false,
  runId: '',
  scope: null,
  status: null,
  message: '',
  error: '',
})

let activeLoop = 0

function normalized(scope: LabelScope): LabelScope {
  return {
    ...scope,
    paperIds: [...new Set(scope.paperIds.filter(value => value > 0))].sort((a, b) => a - b),
  }
}

function query(scope: LabelScope) {
  const params = new URLSearchParams()
  if (scope.year !== null) params.set('year', String(scope.year))
  if (scope.paperIds.length) params.set('paper_ids', scope.paperIds.join(','))
  return params.toString() ? `?${params}` : ''
}

export async function loadQuestionLabelingStatus(scope: LabelScope) {
  const next = normalized(scope)
  const status = await get<LabelStatus>(`/ai/question-labels/status${query(next)}`)
  questionLabelingState.scope = next
  questionLabelingState.status = status
  return status
}

export async function startQuestionLabeling(scope: LabelScope, overwriteUnlocked = false) {
  if (questionLabelingState.isRunning || questionLabelingState.isPausing) return
  const next = normalized(scope)
  questionLabelingState.scope = next
  questionLabelingState.runId = crypto.randomUUID()
  questionLabelingState.isRunning = true
  questionLabelingState.isPausing = false
  questionLabelingState.error = ''
  questionLabelingState.message = '正在读取下一篇题目…'
  const loopId = ++activeLoop
  try {
    while (questionLabelingState.isRunning && loopId === activeLoop) {
      const result = await post<any>('/ai/question-labels/next', {
        year: next.year,
        paper_ids: next.paperIds,
        overwrite_unlocked: overwriteUnlocked,
        run_id: questionLabelingState.runId,
      })
      if (loopId !== activeLoop) return
      questionLabelingState.status = result
      questionLabelingState.runId = result.run_id || questionLabelingState.runId
      if (questionLabelingState.isPausing) {
        questionLabelingState.isRunning = false
        questionLabelingState.isPausing = false
        questionLabelingState.message = '已暂停，下次从下一篇未完成材料继续。'
        return
      }
      if (result.done) {
        questionLabelingState.isRunning = false
        questionLabelingState.runId = ''
        questionLabelingState.message = `${next.title}已完成智能标注`
        return
      }
      questionLabelingState.message = `已完成：${result.unit_title}，本篇标注 ${result.processed} 道`
      await new Promise(resolve => window.setTimeout(resolve, 120))
    }
  } catch (cause) {
    questionLabelingState.error = String(cause)
    questionLabelingState.message = ''
    questionLabelingState.isRunning = false
    questionLabelingState.isPausing = false
  }
}

export function pauseQuestionLabeling() {
  if (!questionLabelingState.isRunning || questionLabelingState.isPausing) return
  questionLabelingState.isPausing = true
  questionLabelingState.message = '正在完成当前篇目，随后暂停…'
}
