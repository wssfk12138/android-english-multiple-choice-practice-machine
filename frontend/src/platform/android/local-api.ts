import { agentTurn, saveAgentExchange, conversation } from './ai'
import { wrongAnalysisHistory } from './wrong-analysis-history'
import { studyTodos } from './study-todos'
import { analyzeWrongQuestions, analyzeWrongStatus, createProfile, createConversation, deleteConversation, deleteProfile, listConversations, listProfiles, selectorModels, sendChat, setAllModelVisibility, setModelVisibility, syncModels, testProfile, updateProfile } from './ai'
import { LocalApiError } from './errors'
import { chooseSnapshot } from './practice-snapshots'
import { abandonIfEmpty, archiveWrongUnits, createSession, dashboard, getSession, listWrong, saveAnswer, submitSession, submitUnit } from './practice'
import { createEsqImport, listEsqImports, listPapers, publishEsqImport, readEsqImport, sweepEmptyPaperSessions } from './question-bank'
import { addVocabulary, deleteVocabulary, homeVocabulary, listVocabulary, reviewVocabulary, retryVocabulary, serializeEntry, updateVocabulary, vocabularyRevision } from './vocabulary'
import { checkAppUpdate, checkQuestionBankCatalog, downloadQuestionBankPackage, installAppUpdate, readUpdateSettings, updateSettings } from './app-update'
import {
  createDocumentImport,
  listDocumentImports,
  publishDocumentImport,
  readDocumentImport,
  retryDocumentModelAssist,
  updateDocumentAnswers,
  updateDocumentImport,
} from './document-import'
import {
  labelingStatus,
  labelNextUnit,
  listQuestionLabels,
  failLabelRun,
  pauseLabelRun,
  updateQuestionLabel,
} from './question-labeling'
import { queueAndStartVocabularyTranslations } from './vocabulary-translation-runner'
import { lanSyncStatus, pushAuthoritativeModelConfiguration, tombstoneVocabularyEntry, tombstoneWrongUnit, updateLanSyncSettings } from './lan-sync'
import { notifyLocalChange, refreshSyncState, syncNow } from './sync-scheduler'
import {
  activateQuestionBankProfile,
  createQuestionBankProfile,
  deleteImportDraft,
  deletePaper,
  deleteQuestionBankProfile,
  listQuestionBankProfiles,
  listTrash,
  movePapers,
  purgeTrash,
  restoreTrash,
  updateQuestionBankProfile,
} from './question-bank-profiles'

type JsonRecord = Record<string, any>

function bodyJson(options: RequestInit): JsonRecord {
  if (options.body == null) return {}
  if (typeof options.body !== 'string') throw new LocalApiError(400, '本地接口请求格式无效')
  try {
    return JSON.parse(options.body)
  } catch {
    throw new LocalApiError(400, '本地接口 JSON 格式无效')
  }
}

function match(pathname: string, pattern: RegExp): RegExpMatchArray | null {
  return pathname.match(pattern)
}

let emptyPaperSweepStarted = false
function scheduleEmptyPaperSweep() {
  if (emptyPaperSweepStarted) return
  emptyPaperSweepStarted = true
  const run = () => void sweepEmptyPaperSessions().catch(() => {
    // A failed cleanup is safe to retry on the next app process. It must not
    // turn a foreground read into a visible error or a retry storm.
  })
  const idle = (globalThis as any).requestIdleCallback as ((callback: () => void, options?: { timeout: number }) => number) | undefined
  const delay = (globalThis as any).setTimeout as ((callback: () => void, timeout: number) => number) | undefined
  if (typeof idle === 'function') idle(run, { timeout: 1500 })
  else if (typeof delay === 'function') delay(run, 1000)
  else run()
}

export async function androidLocalApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase()
  const url = new URL(path, 'https://local.english-practice.invalid')
  const pathname = url.pathname
  const body = options.body instanceof FormData ? null : bodyJson(options)

  // The startup coordinator owns one-time content repair. Reads must not start
  // that repair on every request: the first home/review screen and the repair
  // would otherwise contend for the same SQLite connection. Mutation paths that
  // create practice snapshots or publish imported content still await the gate.
  const contentSensitiveWrite = method !== 'GET'
    && /^\/(?:question-banks|imports|practice\/sessions)(?:[/?]|$)/.test(pathname)
  if (contentSensitiveWrite) {
    const { ensureContentRemediation } = await import('./content-remediation')
    await ensureContentRemediation()
  }

  // Empty-session cleanup is process-wide maintenance. Re-triggering it from
  // every local API call created needless bridge traffic during first screen.
  scheduleEmptyPaperSweep()
  let params: RegExpMatchArray | null

  if (method === 'GET' && pathname === '/study-todos') return await studyTodos() as T
  if (method === 'GET' && pathname === '/startup') return await dashboard() as T
  if (method === 'GET' && pathname === '/papers') return await listPapers() as T
  if (method === 'GET' && pathname === '/wrong') return await listWrong(url.searchParams.get('view') || 'current') as T
  if (method === 'POST' && pathname === '/wrong/archive-delete') {
    const unitIds = (body?.unit_ids || []).map(Number).filter(Boolean)
    for (const unitId of unitIds) await tombstoneWrongUnit(unitId)
    const result = await archiveWrongUnits(unitIds)
    notifyLocalChange()
    return result as T
  }
  if (method === 'GET' && pathname === '/question-bank-profiles') {
    return await listQuestionBankProfiles() as T
  }
  if (method === 'POST' && pathname === '/question-bank-profiles') {
    return await createQuestionBankProfile(body || {}) as T
  }
  params = match(pathname, /^\/question-bank-profiles\/(\d+)$/)
  if (params && method === 'PATCH') return await updateQuestionBankProfile(Number(params[1]), body || {}) as T
  if (params && method === 'DELETE') return await deleteQuestionBankProfile(Number(params[1])) as T
  params = match(pathname, /^\/question-bank-profiles\/(\d+)\/activate$/)
  if (params && method === 'POST') return await activateQuestionBankProfile(Number(params[1])) as T
  if (method === 'POST' && pathname === '/papers/batch-move') return await movePapers(body || {}) as T
  params = match(pathname, /^\/papers\/(\d+)$/)
  if (params && method === 'DELETE') return await deletePaper(Number(params[1])) as T
  if (method === 'GET' && pathname === '/trash') return await listTrash() as T
  params = match(pathname, /^\/trash\/(\d+)\/restore$/)
  if (params && method === 'POST') return await restoreTrash(Number(params[1]), body || {}) as T
  params = match(pathname, /^\/trash\/(\d+)$/)
  if (params && method === 'DELETE') return await purgeTrash(Number(params[1])) as T

  if (method === 'POST' && pathname === '/practice/sessions') {
    const result = await createSession(body!)
    notifyLocalChange()
    return result as T
  }
  params = match(pathname, /^\/practice\/sessions\/(\d+)\/content-choice$/)
  if (params && method === 'POST') {
    const result = await chooseSnapshot(Number(params[1]), String(body?.choice || ''))
    notifyLocalChange()
    return result as T
  }
  params = match(pathname, /^\/practice\/sessions\/(\d+)$/)
  if (params && method === 'GET') return await getSession(Number(params[1])) as T
  params = match(pathname, /^\/practice\/sessions\/(\d+)\/answers\/(\d+)$/)
  if (params && method === 'PUT') {
    const result = await saveAnswer(Number(params[1]), Number(params[2]), body!)
    notifyLocalChange()
    return result as T
  }
  params = match(pathname, /^\/practice\/sessions\/(\d+)\/units\/(\d+)\/submit$/)
  if (params && method === 'POST') {
    const result = await submitUnit(Number(params[1]), Number(params[2]))
    notifyLocalChange()
    return result as T
  }
  params = match(pathname, /^\/practice\/sessions\/(\d+)\/abandon-if-empty$/)
  if (params && method === 'POST') return await abandonIfEmpty(Number(params[1])) as T
  params = match(pathname, /^\/practice\/sessions\/(\d+)\/submit$/)
  if (params && method === 'POST') {
    const result = await submitSession(Number(params[1]))
    notifyLocalChange()
    return result as T
  }

  if (pathname === '/question-banks/imports' && method === 'GET') {
    return await listEsqImports() as T
  }
  if (pathname === '/question-banks/imports' && method === 'POST') {
    if (!(options.body instanceof FormData)) throw new LocalApiError(400, '请选择 ESQ 文件')
    const file = options.body.get('file')
    if (!(file instanceof File)) throw new LocalApiError(400, '请选择 ESQ 文件')
    const newName = options.body.get('new_profile_name')
    return await createEsqImport(
      file, Number(options.body.get('profile_id') || 0) || undefined,
      newName === null ? undefined : String(newName),
    ) as T
  }
  params = match(pathname, /^\/question-banks\/imports\/(\d+)$/)
  if (params && method === 'GET') return await readEsqImport(Number(params[1])) as T
  if (params && method === 'DELETE') return await deleteImportDraft('esq_import', Number(params[1])) as T
  params = match(pathname, /^\/question-banks\/imports\/(\d+)\/publish$/)
  if (params && method === 'POST') {
    return await publishEsqImport(Number(params[1]), body || {}) as T
  }
  if (pathname === '/imports' && method === 'GET') return await listDocumentImports() as T
  if (pathname === '/imports' && method === 'POST') {
    if (!(options.body instanceof FormData)) throw new LocalApiError(400, '请选择 Word 文件')
    return await createDocumentImport(options.body) as T
  }
  params = match(pathname, /^\/imports\/(\d+)$/)
  if (params && method === 'GET') return await readDocumentImport(Number(params[1])) as T
  if (params && method === 'PUT') return await updateDocumentImport(Number(params[1]), body || {}) as T
  if (params && method === 'DELETE') return await deleteImportDraft('document_import', Number(params[1])) as T
  params = match(pathname, /^\/imports\/(\d+)\/model-assist$/)
  if (params && method === 'POST') return await retryDocumentModelAssist(Number(params[1]), body || {}) as T
  params = match(pathname, /^\/imports\/(\d+)\/answers$/)
  if (params && method === 'PATCH') return await updateDocumentAnswers(Number(params[1]), body || {}) as T
  params = match(pathname, /^\/imports\/(\d+)\/publish$/)
  if (params && method === 'POST') return await publishDocumentImport(Number(params[1])) as T

  if (pathname === '/vocabulary' && method === 'GET') {
    return await listVocabulary(url.searchParams) as T
  }
  if (pathname === '/vocabulary/revision' && method === 'GET') {
    return await vocabularyRevision(url.searchParams) as T
  }
  if (pathname === '/vocabulary' && method === 'POST') {
    const result = await addVocabulary(body!)
    notifyLocalChange()
    return result as T
  }
  if (pathname === '/vocabulary/home' && method === 'GET') {
    return await homeVocabulary(Number(url.searchParams.get('limit') || 20)) as T
  }
  if (pathname === '/vocabulary/enrichment-status' && method === 'GET') {
    const jobs = await import('./vocabulary-enrichment-runner')
    return { ...await jobs.vocabularyEnrichmentProgress(), error: jobs.vocabularyEnrichmentError } as T
  }
  if (pathname === '/vocabulary/enrichment-runs' && method === 'POST') {
    const jobs = await import('./vocabulary-enrichment-runner')
    if (body?.action === 'inventory') await jobs.inventoryVocabularyEnrichment()
    else if (body?.action === 'pause') await jobs.pauseVocabularyEnrichment()
    else if (body?.action === 'resume') await jobs.resumeVocabularyEnrichment()
    else if (body?.action === 'retry') {
      await jobs.resumeVocabularyEnrichment()
      void jobs.retryPendingVocabularyEnrichments().catch(jobs.reportVocabularyEnrichmentError)
    }
    if (body?.action === 'start' || body?.action === 'resume') void jobs.startVocabularyEnrichmentWorker().catch(jobs.reportVocabularyEnrichmentError)
    return await jobs.vocabularyEnrichmentProgress() as T
  }
  if (pathname === '/vocabulary/translation-status' && method === 'GET') {
    const { rows } = await import('./database')
    const groups = await rows<{ status: string; count: number }>(
      `SELECT translation_status AS status, COUNT(*) AS count FROM vocabulary_entries
       WHERE user_edited = 0 GROUP BY translation_status`,
    )
    const enrichment = await rows<{status:string;count:number}>(
      "SELECT state AS status,COUNT(*) AS count FROM vocabulary_enrichment_jobs GROUP BY state",
    )
    return Object.fromEntries([...groups.map(group => [group.status, Number(group.count)]),
      ...enrichment.map(group => ['enrichment_' + group.status, Number(group.count)])]) as T
  }
  if (pathname === '/vocabulary/translation-runs' && method === 'POST') {
    let ids = (body?.entry_ids || []).map(Number).filter(Boolean)
    const trigger = String(body?.trigger || '')
    if (trigger === 'practice_exit' || trigger === 'vocabulary_open') {
      const { rows } = await import('./database')
      const pending = await rows<{ id: number }>(
        `SELECT id FROM vocabulary_entries
         WHERE user_edited = 0 AND translation_status IN ('pending', 'queued')
         ORDER BY updated_at, id`,
      )
      ids = [...new Set([...ids, ...pending.map(item => Number(item.id))])]
    }
    const queued = await queueAndStartVocabularyTranslations(ids)
    return queued as T
  }
  params = match(pathname, /^\/vocabulary\/(\d+)$/)
  if (params && method === 'GET') return await serializeEntry(Number(params[1])) as T
  if (params && method === 'PUT') {
    const result = await updateVocabulary(Number(params[1]), body!)
    notifyLocalChange()
    return result as T
  }
  if (params && method === 'DELETE') {
    const id = Number(params[1])
    await tombstoneVocabularyEntry(id)
    const result = await deleteVocabulary(id)
    notifyLocalChange()
    return result as T
  }
  if (pathname === '/vocabulary/retry-pending' && method === 'POST') {
    await retryVocabulary(0)
    const result = await queueAndStartVocabularyTranslations([])
    const { retryPendingVocabularyEnrichments } = await import('./vocabulary-enrichment-runner')
    void retryPendingVocabularyEnrichments().catch(() => { /* Durable job status is shown by polling. */ })
    notifyLocalChange()
    return result as T
  }
  params = match(pathname, /^\/vocabulary\/(\d+)\/enrichment$/)
  if (params && method === 'POST') {
    const { requestVocabularyEnrichment } = await import('./vocabulary-enrichment-runner')
    await requestVocabularyEnrichment(Number(params[1]))
    notifyLocalChange()
    return await serializeEntry(Number(params[1])) as T
  }
  params = match(pathname, /^\/vocabulary\/(\d+)\/retry$/)
  if (params && method === 'POST') {
    const id = Number(params[1])
    await retryVocabulary(id)
    const result = await queueAndStartVocabularyTranslations([id])
    const { retryPendingVocabularyEnrichments } = await import('./vocabulary-enrichment-runner')
    void retryPendingVocabularyEnrichments().catch(() => { /* Durable job status is shown by polling. */ })
    notifyLocalChange()
    return result as T
  }
  params = match(pathname, /^\/vocabulary\/(\d+)\/review$/)
  if (params && method === 'POST') {
    const result = await reviewVocabulary(Number(params[1]), body?.rating, body?.mode, body?.expected_revision, body?.command_id)
    notifyLocalChange()
    return result as T
  }

  if (pathname === '/android/lan-sync/status' && method === 'GET') {
    return { ...(await lanSyncStatus()), runtime: await refreshSyncState() } as T
  }
  if (pathname === '/android/lan-sync/settings' && method === 'PUT') {
    const result = await updateLanSyncSettings({
      ...(body?.host !== undefined ? { lan_sync_host: body.host } : {}),
      ...(body?.passcode !== undefined ? { lan_sync_passcode: body.passcode } : {}),
      pairing: body?.pairing,
      categories: body?.categories,
      ...(body?.auto !== undefined ? { lan_sync_auto: body.auto ? '1' : '0' } : {}),
    })
    return { ...result, runtime: await refreshSyncState() } as T
  }
  if (pathname === '/android/lan-sync/run' && method === 'POST') {
    return await syncNow() as T
  }
  if (pathname === '/android/lan-sync/models/authoritative' && method === 'POST') {
    if (body?.confirm !== true) throw new LocalApiError(400, '请先确认以本机模型配置发送到电脑')
    return await pushAuthoritativeModelConfiguration() as T
  }

  if (pathname === '/ai/profiles' && method === 'GET') return await listProfiles() as T
  if (pathname === '/ai/profiles' && method === 'POST') return await createProfile(body!) as T
  const keyRoute = /^\/ai\/profiles\/(\d+)\/keys$/.exec(pathname)
  if (keyRoute && method === 'POST') return await editNamedKey(Number(keyRoute[1]), body!) as T
  params = match(pathname, /^\/ai\/profiles\/(\d+)$/)
  if (params && method === 'PUT') return await updateProfile(Number(params[1]), body!) as T
  if (params && method === 'DELETE') return await deleteProfile(Number(params[1])) as T
  params = match(pathname, /^\/ai\/profiles\/(\d+)\/models\/sync$/)
  if (params && method === 'POST') return await syncModels(Number(params[1])) as T
  params = match(pathname, /^\/ai\/profiles\/(\d+)\/models$/)
  if (params && method === 'PUT') return await setModelVisibility(Number(params[1]), body!) as T
  params = match(pathname, /^\/ai\/profiles\/(\d+)\/models\/visibility$/)
  if (params && method === 'PUT') return await setAllModelVisibility(Number(params[1]), body!) as T
  params = match(pathname, /^\/ai\/profiles\/(\d+)\/test$/)
  if (params && method === 'POST') return await testProfile(Number(params[1]), body!) as T
  if (pathname === '/ai/selector-models' && method === 'GET') return await selectorModels() as T
  if (pathname === '/ai/conversations' && method === 'GET') return await listConversations() as T
  if (pathname === '/ai/conversations' && method === 'POST') return await createConversation() as T
  params = match(pathname, /^\/ai\/conversations\/(\d+)$/)
  if (params && method === 'GET') return await conversation(Number(params[1])) as T
  if (params && method === 'DELETE') return await deleteConversation(Number(params[1])) as T
  if (pathname === '/ai/agent-turn' && method === 'POST') return await agentTurn(body!) as T
  if (pathname === '/ai/agent-exchange' && method === 'POST') return await saveAgentExchange(body!) as T
  if (pathname === '/ai/chat' && method === 'POST') return await sendChat(body!) as T
  if (pathname === '/ai/wrong-analysis-status' && method === 'GET') {
    return await analyzeWrongStatus() as T
  }
  if (pathname === '/ai/wrong-analysis-history' && method === 'GET') return await wrongAnalysisHistory(Number(url.searchParams.get('unit_id'))) as T
  if (pathname === '/ai/analyze-wrong' && method === 'POST') {
    return await analyzeWrongQuestions(
      (body?.question_ids || []).map(Number).filter(Boolean),
      String(body?.scope_title || body?.focus || '错题分析'),
    ) as T
  }

  if (pathname.startsWith('/ai/question-labels')) {
    if (pathname === '/ai/question-labels/status' && method === 'GET') {
      return await labelingStatus(url.searchParams) as T
    }
    if (pathname === '/ai/question-labels' && method === 'GET') {
      return await listQuestionLabels(url.searchParams) as T
    }
    if (pathname === '/ai/question-labels/next' && method === 'POST') {
      try {
        return await labelNextUnit(body || {}) as T
      } catch (error) {
        try { await failLabelRun(String(body?.run_id || ''), error) } catch { /* 状态记录失败时保留原始模型错误 */ }
        throw error
      }
    }
    params = match(pathname, /^\/ai\/question-labels\/runs\/([^/]+)\/pause$/)
    if (params && method === 'POST') return await pauseLabelRun(decodeURIComponent(params[1])) as T
    params = match(pathname, /^\/ai\/question-labels\/(\d+)$/)
    if (params && method === 'PUT') return await updateQuestionLabel(Number(params[1]), body || {}) as T
  }

  if (pathname === '/android/updates/settings' && method === 'GET') {
    return await readUpdateSettings() as T
  }
  if (pathname === '/android/updates/settings' && method === 'PUT') {
    return await updateSettings(body || {}) as T
  }
  if (pathname === '/android/updates/app/check' && method === 'POST') {
    return await checkAppUpdate() as T
  }
  if (pathname === '/android/updates/app/install' && method === 'POST') {
    return await installAppUpdate(body || {}) as T
  }
  if (pathname === '/android/updates/question-banks/check' && method === 'POST') {
    return await checkQuestionBankCatalog() as T
  }
  if (pathname === '/android/updates/question-banks/download' && method === 'POST') {
    return await downloadQuestionBankPackage(body || {}) as T
  }
  throw new LocalApiError(501, `Android 本地接口尚未实现：${method} ${pathname}`)
}
import { editNamedKey } from './model-key-store'
