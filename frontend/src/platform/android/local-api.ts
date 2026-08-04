import { analyzeWrongQuestions, analyzeWrongStatus, createProfile, createConversation, deleteConversation, deleteProfile, listConversations, listProfiles, selectorModels, sendChat, setAllModelVisibility, setModelVisibility, syncModels, testProfile, translateVocabularyEntries, updateProfile } from './ai'
import { LocalApiError } from './errors'
import { createSession, dashboard, getSession, listWrong, saveAnswer, submitSession, submitUnit } from './practice'
import { createEsqImport, listEsqImports, listPapers, publishEsqImport, readEsqImport } from './question-bank'
import { addVocabulary, deleteVocabulary, homeVocabulary, listVocabulary, queueTranslations, reviewVocabulary, retryVocabulary, serializeEntry, updateVocabulary } from './vocabulary'
import { checkAppUpdate, checkQuestionBankCatalog, downloadQuestionBankPackage, installAppUpdate, readUpdateSettings, updateSettings } from './app-update'

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
  if (method === 'GET' && pathname === '/wrong') return await listWrong() as T

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
    return listEsqImports() as T
  }
  if (pathname === '/question-banks/imports' && method === 'POST') {
    if (!(options.body instanceof FormData)) throw new LocalApiError(400, '请选择 ESQ 文件')
    const file = options.body.get('file')
    if (!(file instanceof File)) throw new LocalApiError(400, '请选择 ESQ 文件')
    return await createEsqImport(file) as T
  }
  params = match(pathname, /^\/question-banks\/imports\/(\d+)$/)
  if (params && method === 'GET') return readEsqImport(Number(params[1])) as T
  params = match(pathname, /^\/question-banks\/imports\/(\d+)\/publish$/)
  if (params && method === 'POST') {
    return await publishEsqImport(Number(params[1]), body || {}) as T
  }
  if (pathname === '/imports' && method === 'GET') return [] as T

  if (pathname === '/vocabulary' && method === 'GET') {
    return await listVocabulary(url.searchParams) as T
  }
  if (pathname === '/vocabulary' && method === 'POST') return await addVocabulary(body!) as T
  if (pathname === '/vocabulary/home' && method === 'GET') {
    return await homeVocabulary(Number(url.searchParams.get('limit') || 20)) as T
  }
  if (pathname === '/vocabulary/translation-runs' && method === 'POST') {
    let ids = (body?.entry_ids || []).map(Number).filter(Boolean)
    if (String(body?.trigger || '') === 'practice_exit') {
      const { rows } = await import('./database')
      const pending = await rows<{ id: number }>(
        `SELECT id FROM vocabulary_entries
         WHERE user_edited = 0 AND translation_status IN ('pending', 'queued')
         ORDER BY updated_at, id LIMIT 100`,
      )
      ids = [...new Set([...ids, ...pending.map(item => Number(item.id))])].slice(0, 100)
    }
    const queued = await queueTranslations(ids)
    if (ids.length) {
      void translateVocabularyEntries(ids).catch(async error => {
        const { run } = await import('./database')
        await run(
          `UPDATE vocabulary_entries SET translation_status = 'failed',
            translation_error = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id IN (${ids.map(() => '?').join(',')})
             AND translation_status = 'queued'`,
          [String(error).slice(0, 600), ...ids],
        )
      })
    }
    return queued as T
  }
  params = match(pathname, /^\/vocabulary\/(\d+)$/)
  if (params && method === 'GET') return await serializeEntry(Number(params[1])) as T
  if (params && method === 'PUT') return await updateVocabulary(Number(params[1]), body!) as T
  if (params && method === 'DELETE') return await deleteVocabulary(Number(params[1])) as T
  params = match(pathname, /^\/vocabulary\/(\d+)\/retry$/)
  if (params && method === 'POST') return await retryVocabulary(Number(params[1])) as T
  params = match(pathname, /^\/vocabulary\/(\d+)\/review$/)
  if (params && method === 'POST') return await reviewVocabulary(Number(params[1]), body?.rating) as T

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
      return { year: null, years: [], total: 0, labeled: 0, locked: 0, review_pending: 0, remaining: 0, percentage: 0 } as T
    }
    if (pathname === '/ai/question-labels' && method === 'GET') return [] as T
    throw new LocalApiError(501, 'Android 版不提供题库智能标注功能')
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
  if (pathname === '/android/diagnostics/settings' && method === 'GET') {
    return await readUpdateSettings() as T
  }
  if (pathname === '/android/diagnostics/settings' && method === 'PUT') {
    return await updateSettings(body || {}) as T
  }

  throw new LocalApiError(501, `Android 本地接口尚未实现：${method} ${pathname}`)
}
