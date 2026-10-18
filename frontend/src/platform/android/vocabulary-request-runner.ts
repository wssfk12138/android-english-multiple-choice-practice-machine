import { translateVocabularyEntries, enrichVocabularyEntry } from './ai'
import { vocabularyConfiguration } from './vocabulary-request-config'
import { vocabularyBatchResult, type VocabularyExecution, type VocabularyTask } from './vocabulary-request-result'
import { LocalApiError } from './errors'
import { claimVocabularyBatch, markVocabularySent, currentVocabularyAttempt, commitVocabularyResult,
  failVocabularyAttempt, abortVocabularyBeforeSend, VocabularyPreSendAbort, createVocabularyRun, VOCABULARY_REQUEST_MS, cleanVocabularyRequestDiagnostics } from './vocabulary-request-store'

// One physical transmission slot for both task types. Logical deadlines never release it.
let worker: Promise<void> | null = null
let wakeRequested = false
let transmissionActive = false
let localFailure = false
export function vocabularyTransmissionActive() { return transmissionActive }
export function vocabularyWorkerFailed() { return localFailure }
async function work() {
  if (localFailure) return
  while (true) {
    let config
    try { config = await vocabularyConfiguration() } catch { return }
    const claim = await claimVocabularyBatch(config)
    if (!claim) return
    let sent = false
    let responding = false
    let committing = false
    let metadata: ReturnType<typeof vocabularyBatchResult>['metadata'] = {}
    let observedResult = vocabularyBatchResult(claim.ids)
    let timer: ReturnType<typeof setTimeout> | undefined
    let deadlineWrite: Promise<void> | undefined
    const execution: VocabularyExecution = {
      result: result => { observedResult = result },
      saving: () => { committing = true },
      beforeSend: async actualHash => {
        if (actualHash !== claim.configHash) throw new VocabularyPreSendAbort('configuration', '模型配置已变化')
        await markVocabularySent(claim, await vocabularyConfiguration())
        sent = true
        transmissionActive = true
        timer = setTimeout(() => {
          const result = vocabularyBatchResult(claim.ids)
          result.failure = 'unknown'; result.metadata = metadata
          deadlineWrite = failVocabularyAttempt(claim, result).catch(() => { localFailure = true })
        }, VOCABULARY_REQUEST_MS)
      },
      response: next => { responding = true; metadata = { ...metadata, ...next } },
      current: db => currentVocabularyAttempt(db, claim),
      commit: async (db, result) => {
        committing = true
        result.metadata = metadata
        await commitVocabularyResult(db, claim, result)
      },
    }
    try {
      if (claim.task === 'translation') await translateVocabularyEntries(claim.ids, execution)
      else await enrichVocabularyEntry(claim.ids[0]!, execution)
    } catch (cause) {
      if (!sent) {
        try { await abortVocabularyBeforeSend(claim, cause instanceof VocabularyPreSendAbort ? cause.reason : 'configuration') }
        catch { localFailure = true }
        return // A local abort never resumes automatically or becomes a provider failure.
      }
      const result = observedResult
      result.writtenIds = [] // A rejected exclusive write transaction rolled back its content.
      const detail = cause instanceof LocalApiError && typeof cause.detail === 'object'
        ? cause.detail as { httpStatus?: number; code?: string } | null : undefined
      const status = detail?.httpStatus
      result.metadata = { ...metadata, ...(status ? { httpStatus: status } : {}) }
      result.failure = status && status >= 300 ? 'http'
        : !responding ? 'unknown' : committing && !(cause instanceof LocalApiError) ? 'save'
          : cause instanceof LocalApiError && cause.status === 502
            ? detail?.code === 'vocabulary_response_truncated' ? 'truncated' : 'validation' : 'parse'
      // Persist only a controlled category, never a provider's exception/body/URL.
      for (const id of claim.ids) result.invalid[id] = {
        configuration: '配置变化或发送前停止', http: `供应商返回 HTTP ${status}`, unknown: '请求结果未知',
        save: '有效响应保存失败', truncated: '模型响应被截断或未完整生成',
        validation: '模型缺少必需字段或词条不匹配', parse: '模型响应解析失败',
      }[result.failure]
      try { await failVocabularyAttempt(claim, result) } catch { localFailure = true }
    } finally {
      clearTimeout(timer)
      if (deadlineWrite) await deadlineWrite
      transmissionActive = false
    }
    if (localFailure) return
    await cleanVocabularyRequestDiagnostics()
  }
}
export function startVocabularyRequestWorker(): Promise<void> {
  wakeRequested = true
  if (!worker) worker = (async () => {
    do {
      wakeRequested = false
      await work()
    } while (wakeRequested && !localFailure)
  })().catch(() => { localFailure = true }).finally(() => {
    worker = null
    // A wake can also arrive between the loop's last check and this finally.
    if (wakeRequested && !localFailure) void startVocabularyRequestWorker()
  })
  return worker
}
export async function requestVocabularyRun(task: VocabularyTask, ids?: number[], options: {
  explicit?: boolean; retry?: boolean; commandId?: string; source?: string
} = {}) {
  if (localFailure) throw new LocalApiError(409, '任务记录保存失败，请重启应用核查后继续')
  const runId = await createVocabularyRun(task, ids, await vocabularyConfiguration(), options.source || 'automatic',
    Boolean(options.explicit), Boolean(options.retry), options.commandId, transmissionActive)
  if (runId) void startVocabularyRequestWorker()
  return { accepted: true, runId, workerStarted: Boolean(runId) }
}
