import { analyzeWrongQuestions, analyzeWrongStatus, createProfile, createConversation, deleteConversation, deleteProfile, listConversations, listProfiles, selectorModels, sendChat, setAllModelVisibility, setModelVisibility, syncModels, testProfile, updateProfile } from './ai'
import { LocalApiError } from './errors'
import { archiveWrongUnits, createSession, dashboard, getSession, listWrong, saveAnswer, submitSession, submitUnit } from './practice'
import { createEsqImport, listEsqImports, listPapers, publishEsqImport, readEsqImport } from './question-bank'
import { addVocabulary, deleteVocabulary, homeVocabulary, listVocabulary, reviewVocabulary, retryVocabulary, serializeEntry, updateVocabulary } from './vocabulary'
import { checkAppUpdate, checkQuestionBankCatalog, downloadQuestionBankPackage, installAppUpdate, readUpdateSettings, updateSettings } from './app-update'
import { lanSyncStatus, runLanSync, updateLanSyncSettings } from './lan-sync'
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
  updateQuestionLabel,
} from './question-labeling'
import { queueAndStartVocabularyTranslations } from './vocabulary-translation-runner'
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

export async function androidLocalApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase()
  const url = new URL(path, 'https://local.english-practice.invalid')
  const pathname = url.pathname
  const body = options.body instanceof FormData ? null : bodyJson(options)
  let params: RegExpMatchArray | null

  if (method === 'GET' && pathname === '/startup') return await dashboard() as T
  if (method === 'GET' && pathname === '/papers') return await listPapers() as T
  if (method === 'GET' && pathname === '/wrong') return await listWrong(url.searchParams.get('view') || 'current') as T
  if (method === 'POST' && pathname === '/wrong/archive-delete') return await archiveWrongUnits(body?.unit_ids || []) as T
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
    return await createSession(body!) as T
  }
  params = match(pathname, /^\/practice\/sessions\/(\d+)$/)
  if (params && method === 'GET') return await getSession(Number(params[1])) as T
  params = match(pathname, /^\/practice\/sessions\/(\d+)\/answers\/(\d+)$/)
  if (params && method === 'PUT') {
    return await saveAnswer(Number(params[1]), Number(params[2]), body!) as T
  }
  params = match(pathname, /^\/practice\/sessions\/(\d+)\/units\/(\d+)\/submit$/)
  if (params && method === 'POST') {
    return await submitUnit(Number(params[1]), Number(params[2])) as T
  }
  params = match(pathname, /^\/practice\/sessions\/(\d+)\/submit$/)
  if (params && method === 'POST') return await submitSession(Number(params[1])) as T

  if (pathname === '/question-banks/imports' && method === 'GET') {
    return await listEsqImports() as T
  }
  if (pathname === '/question-banks/imports' && method === 'POST') {
    if (!(options.body instanceof FormData)) throw new LocalApiError(400, '请选择 ESQ 文件')
    const file = options.body.get('file')
    if (!(file instanceof File)) throw new LocalApiError(400, '请选择 ESQ 文件')
    return await createEsqImport(file, Number(options.body.get('profile_id') || 0) || undefined) as T
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
  if (pathname === '/vocabulary' && method === 'POST') return await addVocabulary(body!) as T
  if (pathname === '/vocabulary/home' && method === 'GET') {
    return await homeVocabulary(Number(url.searchParams.get('limit') || 20)) as T
  }
  if (pathname === '/vocabulary/translation-runs' && method === 'POST') {
    let ids = (body?.entry_ids || []).map(Number).filter(Boolean)
    const trigger = String(body?.trigger || '')
    if (trigger === 'practice_exit' || trigger === 'vocabulary_open') {
      const { rows } = await import('./database')
      const pending = await rows<{ id: number }>(
        `SELECT id FROM vocabulary_entries
         WHERE user_edited = 0 AND translation_status IN ('pending', 'queued')
         ORDER BY updated_at, id LIMIT 100`,
      )
      ids = [...new Set([...ids, ...pending.map(item => Number(item.id))])].slice(0, 100)
    }
    const queued = await queueAndStartVocabularyTranslations(ids)
    return queued as T
  }
  params = match(pathname, /^\/vocabulary\/(\d+)$/)
  if (params && method === 'GET') return await serializeEntry(Number(params[1])) as T
  if (params && method === 'PUT') return await updateVocabulary(Number(params[1]), body!) as T
  if (params && method === 'DELETE') return await deleteVocabulary(Number(params[1])) as T
  params = match(pathname, /^\/vocabulary\/(\d+)\/retry$/)
  if (params && method === 'POST') {
    const id = Number(params[1])
    await retryVocabulary(id)
    return await queueAndStartVocabularyTranslations([id]) as T
  }
  params = match(pathname, /^\/vocabulary\/(\d+)\/review$/)
  if (params && method === 'POST') return await reviewVocabulary(Number(params[1]), body?.rating, body?.mode) as T

  if (pathname === '/ai/profiles' && method === 'GET') return await listProfiles() as T
  if (pathname === '/ai/profiles' && method === 'POST') return await createProfile(body!) as T
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
  if (params && method === 'GET') {
    const conversations = await listConversations()
    const found = conversations.find(item => item.id === Number(params![1]))
    if (!found) throw new LocalApiError(404, '对话不存在')
    const { rows } = await import('./database')
    return {
      ...found,
      messages: await rows(
        'SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY id',
        [Number(params[1])],
      ),
    } as T
  }
  if (params && method === 'DELETE') return await deleteConversation(Number(params[1])) as T
  if (pathname === '/ai/chat' && method === 'POST') return await sendChat(body!) as T
  if (pathname === '/ai/wrong-analysis-status' && method === 'GET') {
    return await analyzeWrongStatus() as T
  }
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
      return await labelNextUnit(body || {}) as T
    }
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
  if (pathname === '/android/lan-sync/status' && method === 'GET') {
    return await lanSyncStatus() as T
  }
  if (pathname === '/android/lan-sync/settings' && method === 'PUT') {
    return await updateLanSyncSettings(body || {}) as T
  }
  if (pathname === '/android/lan-sync/run' && method === 'POST') {
    return await runLanSync() as T
  }
  if (pathname === '/android/diagnostics/settings' && method === 'GET') {
    return await readUpdateSettings() as T
  }
  if (pathname === '/android/diagnostics/settings' && method === 'PUT') {
    return await updateSettings(body || {}) as T
  }

  throw new LocalApiError(501, `Android 本地接口尚未实现：${method} ${pathname}`)
}
