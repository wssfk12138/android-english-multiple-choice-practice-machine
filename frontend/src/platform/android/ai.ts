import { secureStore } from '../secure-store'
import { row, rows, run, transaction } from './database'
import { LocalApiError } from './errors'
import { nativeJson } from './native-http'
import { tombstoneAiProfile } from './lan-sync'
import { notifyLocalChange } from './sync-scheduler'

type JsonRecord = Record<string, any>

const keyName = (profileId: number) => `ai-profile-${profileId}-api-key`

function profilePayload(profile: JsonRecord, models: JsonRecord[]): JsonRecord {
  return {
    ...profile,
    enabled: Boolean(profile.enabled),
    is_default: Boolean(profile.is_default),
    has_api_key: Boolean(profile.has_api_key),
    models: models.map(model => ({
      ...model,
      is_visible: Boolean(model.is_visible),
      is_available: Boolean(model.is_available),
    })),
  }
}

export async function listProfiles(): Promise<JsonRecord[]> {
  const profiles = await rows<JsonRecord>(
    `SELECT p.*,
       CASE WHEN EXISTS(
         SELECT 1 FROM ai_profile_models m WHERE m.profile_id = p.id
       ) THEN 1 ELSE 0 END AS has_models
     FROM ai_profiles p ORDER BY p.is_default DESC, p.id`,
  )
  const result = []
  for (const profile of profiles) {
    let hasApiKey = false
    try { hasApiKey = Boolean(await secureStore.get(keyName(profile.id))) } catch { hasApiKey = false }
    result.push(profilePayload(
      { ...profile, has_api_key: hasApiKey },
      await rows('SELECT * FROM ai_profile_models WHERE profile_id = ? ORDER BY model_id', [profile.id]),
    ))
  }
  return result
}

async function profileOr404(id: number): Promise<JsonRecord> {
  const profile = await row<JsonRecord>('SELECT * FROM ai_profiles WHERE id = ?', [id])
  if (!profile) throw new LocalApiError(404, 'API 配置不存在')
  return profile
}

async function ensureDefault() {
  const current = await row('SELECT id FROM ai_profiles WHERE is_default = 1 LIMIT 1')
  if (current) return
  const first = await row<{ id: number }>('SELECT id FROM ai_profiles ORDER BY id LIMIT 1')
  if (first) await run('UPDATE ai_profiles SET is_default = 1 WHERE id = ?', [first.id])
}

export async function createProfile(body: JsonRecord): Promise<JsonRecord> {
  if (!String(body.name || '').trim() || !String(body.base_url || '').trim()) {
    throw new LocalApiError(400, '配置名称和 API Base URL 不能为空')
  }
  const count = await row<{ total: number }>('SELECT COUNT(*) AS total FROM ai_profiles')
  const makeDefault = Boolean(body.is_default) || !Number(count?.total || 0)
  if (makeDefault) await run('UPDATE ai_profiles SET is_default = 0')
  const created = await run(
    `INSERT INTO ai_profiles
      (name, base_url, enabled, is_default, default_model, temperature, max_tokens, system_prompt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(body.name).trim(),
      String(body.base_url).trim().replace(/\/+$/, ''),
      body.enabled === false ? 0 : 1,
      makeDefault ? 1 : 0,
      String(body.default_model || '').trim(),
      Number(body.temperature ?? 0.2),
      Number(body.max_tokens ?? 1200),
      String(body.system_prompt || ''),
    ],
  )
  const id = Number(created.lastId)
  if (body.api_key) await secureStore.set(keyName(id), String(body.api_key).trim())
  if (body.default_model) {
    await run(
      `INSERT OR IGNORE INTO ai_profile_models
       (profile_id, model_id, display_name) VALUES (?, ?, ?)`,
      [id, body.default_model, body.default_model],
    )
  }
  notifyLocalChange()
  return (await listProfiles()).find(profile => profile.id === id)!
}

export async function updateProfile(id: number, body: JsonRecord): Promise<JsonRecord> {
  await profileOr404(id)
  if (!String(body.name || '').trim() || !String(body.base_url || '').trim()) {
    throw new LocalApiError(400, '配置名称和 API Base URL 不能为空')
  }
  if (body.clear_api_key) await secureStore.remove(keyName(id))
  else if (body.api_key) await secureStore.set(keyName(id), String(body.api_key).trim())
  if (body.is_default) await run('UPDATE ai_profiles SET is_default = 0 WHERE id <> ?', [id])
  await run(
    `UPDATE ai_profiles SET name = ?, base_url = ?, enabled = ?, is_default = ?,
      default_model = ?, temperature = ?, max_tokens = ?, system_prompt = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [
      String(body.name).trim(),
      String(body.base_url).trim().replace(/\/+$/, ''),
      body.enabled === false ? 0 : 1,
      body.is_default ? 1 : 0,
      String(body.default_model || '').trim(),
      Number(body.temperature ?? 0.2),
      Number(body.max_tokens ?? 1200),
      String(body.system_prompt || ''),
      id,
    ],
  )
  if (body.default_model) {
    await run(
      `INSERT OR IGNORE INTO ai_profile_models
       (profile_id, model_id, display_name) VALUES (?, ?, ?)`,
      [id, body.default_model, body.default_model],
    )
  }
  await ensureDefault()
  notifyLocalChange()
  return (await listProfiles()).find(profile => profile.id === id)!
}

export async function deleteProfile(id: number): Promise<{ ok: true }> {
  const count = await row<{ total: number }>('SELECT COUNT(*) AS total FROM ai_profiles')
  if (Number(count?.total || 0) <= 1) throw new LocalApiError(409, '至少保留一个 API 配置')
  const profile = await profileOr404(id)
  await tombstoneAiProfile(String(profile.name || ''))
  await run('DELETE FROM ai_profile_models WHERE profile_id = ?', [id])
  await run('DELETE FROM ai_profiles WHERE id = ?', [id])
  await secureStore.remove(keyName(id))
  await ensureDefault()
  notifyLocalChange()
  return { ok: true }
}

async function apiHeaders(profile: JsonRecord): Promise<Headers> {
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' })
  const key = await secureStore.get(keyName(profile.id))
  if (key) headers.set('Authorization', `Bearer ${key}`)
  return headers
}

function modelUrls(baseUrl: string): string[] {
  const normalized = baseUrl.replace(/\/+$/, '')
  const urls = [`${normalized}/models`]
  if (normalized.endsWith('/v1')) urls.push(`${normalized.slice(0, -3)}/api/tags`)
  else urls.push(`${normalized}/api/tags`)
  return [...new Set(urls)]
}

export async function syncModels(id: number): Promise<JsonRecord> {
  const profile = await profileOr404(id)
  const headers = await apiHeaders(profile)
  let data: any = null
  let source = ''
  let lastError = ''
  for (const url of modelUrls(profile.base_url)) {
    try {
      data = await nativeJson<any>({
        url,
        method: 'GET',
        headers: Object.fromEntries(headers.entries()),
      }, '读取模型列表')
      source = url.includes('/api/tags') ? 'ollama' : 'openai-compatible'
      break
    } catch (error) {
      lastError = String(error)
    }
  }
  const rawModels = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : null
  if (!rawModels) throw new LocalApiError(400, `读取模型列表失败：${lastError || '返回格式不受支持'}`)
  const models: Array<{ id: string; owned_by: string }> = rawModels
    .map((item: any) => ({
      id: String(item.id || item.name || item.model || '').trim(),
      owned_by: String(item.owned_by || item.details?.family || ''),
    }))
    .filter((item: any) => item.id)
  await run('UPDATE ai_profile_models SET is_available = 0 WHERE profile_id = ?', [id])
  for (const model of models) {
    await run(
      `INSERT INTO ai_profile_models
        (profile_id, model_id, display_name, owned_by, provider, is_visible, is_available)
       VALUES (?, ?, ?, ?, ?, 1, 1)
       ON CONFLICT(profile_id, model_id) DO UPDATE SET
         owned_by = excluded.owned_by, provider = excluded.provider,
         is_available = 1, updated_at = CURRENT_TIMESTAMP`,
      [id, model.id, model.id, model.owned_by, source],
    )
  }
  return {
    profile_id: id,
    source,
    models: models.map(model => ({ ...model, is_visible: true, is_available: true })),
  }
}

async function chatCompletion(
  profileId: number,
  model: string,
  messages: JsonRecord[],
  options: { maxTokens?: number; responseFormat?: JsonRecord } = {},
): Promise<string> {
  const profile = await profileOr404(profileId)
  const data = await nativeJson<any>({
    url: `${String(profile.base_url).replace(/\/+$/, '')}/chat/completions`,
    method: 'POST',
    headers: Object.fromEntries((await apiHeaders(profile)).entries()),
    data: {
      model,
      messages,
      temperature: Number(profile.temperature),
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    },
  }, '模型请求')
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new LocalApiError(400, '模型没有返回可显示的正文')
  }
  return content.trim()
}

export async function testProfile(id: number, body: JsonRecord): Promise<JsonRecord> {
  const profile = await profileOr404(id)
  const model = String(body.model || profile.default_model || '')
  if (!model) throw new LocalApiError(400, '请先选择默认模型')
  const content = await chatCompletion(id, model, [{ role: 'user', content: '只回复“连接成功”，不要补充其他内容。' }])
  return { ok: true, message: content }
}

export async function setModelVisibility(id: number, body: JsonRecord): Promise<{ ok: true }> {
  await run(
    `UPDATE ai_profile_models SET is_visible = ?, updated_at = CURRENT_TIMESTAMP
     WHERE profile_id = ? AND model_id = ?`,
    [body.is_visible ? 1 : 0, id, body.model_id],
  )
  return { ok: true }
}

export async function setAllModelVisibility(id: number, body: JsonRecord): Promise<{ ok: true }> {
  await run(
    `UPDATE ai_profile_models SET is_visible = ?, updated_at = CURRENT_TIMESTAMP
     WHERE profile_id = ?`,
    [body.is_visible ? 1 : 0, id],
  )
  return { ok: true }
}

export async function selectorModels(): Promise<JsonRecord> {
  return {
    models: await rows(
      `SELECT m.profile_id, p.name AS profile_name, p.is_default,
        m.model_id, m.display_name, m.owned_by
       FROM ai_profile_models m JOIN ai_profiles p ON p.id = m.profile_id
       WHERE p.enabled = 1 AND m.is_visible = 1 AND m.is_available = 1
       ORDER BY p.is_default DESC, p.name, m.model_id`,
    ),
  }
}

export async function listConversations(): Promise<JsonRecord[]> {
  return rows(
    `SELECT c.*,
      (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id) AS message_count
     FROM ai_conversations c ORDER BY c.updated_at DESC, c.id DESC LIMIT 50`,
  )
}

async function conversation(id: number): Promise<JsonRecord> {
  const current = await row<JsonRecord>('SELECT * FROM ai_conversations WHERE id = ?', [id])
  if (!current) throw new LocalApiError(404, '对话不存在')
  return {
    ...current,
    messages: await rows('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY id', [id]),
  }
}

export async function createConversation(): Promise<JsonRecord> {
  const created = await run('INSERT INTO ai_conversations DEFAULT VALUES')
  return conversation(Number(created.lastId))
}

export async function deleteConversation(id: number): Promise<{ ok: true }> {
  await run('DELETE FROM ai_messages WHERE conversation_id = ?', [id])
  await run('DELETE FROM ai_conversations WHERE id = ?', [id])
  return { ok: true }
}

export async function sendChat(body: JsonRecord): Promise<JsonRecord> {
  const profile = await profileOr404(Number(body.profile_id))
  const selected = await row(
    `SELECT 1 AS found FROM ai_profile_models
     WHERE profile_id = ? AND model_id = ? AND is_visible = 1 AND is_available = 1`,
    [body.profile_id, body.model],
  )
  if (!profile.enabled || !selected) throw new LocalApiError(400, '所选模型当前不可用于对话')
  let conversationId = body.conversation_id ? Number(body.conversation_id) : 0
  if (!conversationId) conversationId = Number((await run('INSERT INTO ai_conversations DEFAULT VALUES')).lastId)
  else await conversation(conversationId)
  const history = (await rows<JsonRecord>(
    `SELECT role, content FROM ai_messages WHERE conversation_id = ?
     ORDER BY id DESC LIMIT 24`,
    [conversationId],
  )).reverse()
  const system = [
    '你是英语刷题机中的考研英语学习助手。回答要准确、清晰、直接。',
    '除非用户明确要求，不要主动泄露题库中的标准答案。',
    String(profile.system_prompt || ''),
  ].filter(Boolean).join('\n')
  const content = await chatCompletion(
    profile.id,
    String(body.model),
    [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: String(body.message || '').trim() },
    ],
  )
  await run(
    `INSERT INTO ai_messages (conversation_id, role, content, profile_id, model_id)
     VALUES (?, 'user', ?, ?, ?)`,
    [conversationId, String(body.message).trim(), profile.id, body.model],
  )
  await run(
    `INSERT INTO ai_messages (conversation_id, role, content, profile_id, model_id)
     VALUES (?, 'assistant', ?, ?, ?)`,
    [conversationId, content, profile.id, body.model],
  )
  const current = await row<{ title: string }>('SELECT title FROM ai_conversations WHERE id = ?', [conversationId])
  const title = current?.title === '新对话'
    ? String(body.message).trim().replace(/\n/g, ' ').slice(0, 28) || '新对话'
    : current?.title || '新对话'
  await run(
    'UPDATE ai_conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [title, conversationId],
  )
  return {
    conversation_id: conversationId,
    title,
    message: { role: 'assistant', content, profile_id: profile.id, model_id: body.model },
  }
}

function extractJsonObject(content: string): JsonRecord {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced || content).trim()
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1))
    throw new LocalApiError(400, '模型没有返回有效 JSON')
  }
}

function discriminationList(value: unknown, limit = 3): { word: string; note: string }[] {
  if (!Array.isArray(value)) return []
  const result: { word: string; note: string }[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const word = String((item as JsonRecord).word || '').trim()
    const note = String((item as JsonRecord).note || (item as JsonRecord).reason || '').trim()
    if (!word || word.length > 60) continue
    const key = word.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ word: word.slice(0, 60), note: note.slice(0, 80) })
    if (result.length >= limit) break
  }
  return result
}

export async function translateVocabularyEntries(entryIds: number[]): Promise<number> {
  if (!entryIds.length) return 0
  const profile = await row<JsonRecord>(
    `SELECT * FROM ai_profiles
     WHERE enabled = 1 AND TRIM(default_model) <> ''
     ORDER BY is_default DESC, id LIMIT 1`,
  )
  if (!profile) throw new LocalApiError(400, '请先配置并启用一个用于单词翻译的模型')
  const placeholders = entryIds.map(() => '?').join(',')
  const items = await rows<JsonRecord>(
    `SELECT v.id, v.term,
       (SELECT context_sentence FROM vocabulary_occurrences
        WHERE entry_id = v.id ORDER BY id DESC LIMIT 1) AS sentence
     FROM vocabulary_entries v
     WHERE v.id IN (${placeholders}) AND v.user_edited = 0`,
    entryIds,
  )
  if (!items.length) return 0
  const content = await chatCompletion(
    profile.id,
    profile.default_model,
    [
      {
        role: 'system',
        content: `你是考研英语语境词汇助手。只返回 JSON：
{"translations":[{"entryId":1,"lemma":"","phonetic":"","partOfSpeech":"","contextualMeaning":"","commonMeaning":"","memoryHint":"","synonyms":[{"word":"同义词","note":"一句极简辨析"}],"antonyms":[{"word":"反义词","note":"一句极简辨析"}],"similarForms":[{"word":"形近词","note":"一句极简辨析"}]}]}
必须原样返回 entryId。释义只写简洁中文词义，不要加入括号、来源、例句说明或“在本文中”等标注。
同义词/反义词/形近词每组 0-3 条，辨析各用一句话（30 字以内）说明差别或易混点；
如果该词没有自然的同义、反义或形近词，对应数组返回空数组 []，不要强行编造或凑数。`,
      },
      { role: 'user', content: JSON.stringify({ items }) },
    ],
    { maxTokens: 2400, responseFormat: { type: 'json_object' } },
  )
  const parsed = extractJsonObject(content)
  const translations = Array.isArray(parsed.translations) ? parsed.translations : []
  let translated = 0
  for (const item of translations) {
    const id = Number(item?.entryId)
    if (!entryIds.includes(id) || !String(item?.contextualMeaning || '').trim()) continue
    const clean = (value: unknown, limit = 1000) =>
      String(value || '')
        .replace(/^\s*[（(【\[].*?[）)】\]]\s*/, '')
        .replace(/\s*[（(【\[].*?[）)】\]]\s*$/, '')
        .trim()
        .slice(0, limit)
    await run(
      `UPDATE vocabulary_entries SET lemma = ?, phonetic = ?, part_of_speech = ?,
        contextual_meaning = ?, common_meaning = ?, memory_hint = ?,
        synonyms = ?, antonyms = ?, similar_forms = ?,
        translation_status = 'ready', translation_error = '',
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_edited = 0`,
      [
        clean(item.lemma, 120),
        clean(item.phonetic, 120),
        clean(item.partOfSpeech, 80),
        clean(item.contextualMeaning),
        clean(item.commonMeaning),
        clean(item.memoryHint),
        JSON.stringify(discriminationList(item.synonyms)),
        JSON.stringify(discriminationList(item.antonyms)),
        JSON.stringify(discriminationList(item.similarForms)),
        id,
      ],
    )
    translated++
  }
  return translated
}

function scopeKeyOf(unitIds: number[]): string {
  return [...new Set(unitIds)].sort((left, right) => left - right).join(',')
}

async function latestWrongSnapshot(
  unitIds: number[],
  questionIds: number[],
  retrySessionIds = new Map<number, number>(),
): Promise<JsonRecord> {
  const placeholders = questionIds.map(() => '?').join(',')
  const snapshot: JsonRecord = {}
  for (const unitId of unitIds) {
    const retrySessionId = retrySessionIds.get(unitId)
    const questionRows = await rows<JsonRecord>(
      `SELECT q.id, q.number,
         (SELECT pa.user_answer
          FROM practice_answers pa
          JOIN practice_sessions ps ON ps.id = pa.session_id
          WHERE pa.question_id = q.id AND pa.is_correct = 0
            AND TRIM(pa.user_answer) <> ''
            ${retrySessionId ? 'AND pa.session_id = ?' : ''}
          ORDER BY COALESCE(ps.submitted_at, pa.answered_at) DESC, pa.id DESC
          LIMIT 1) AS user_answer
       FROM questions q
       WHERE q.unit_id = ? AND q.id IN (${placeholders})
       ORDER BY q.sequence`,
      retrySessionId
        ? [retrySessionId, unitId, ...questionIds]
        : [unitId, ...questionIds],
    )
    snapshot[String(unitId)] = {
      errors: questionRows
        .filter(item => item.user_answer)
        .map(item => ({
          question_id: Number(item.id),
          number: Number(item.number),
          selected: String(item.user_answer),
        })),
    }
  }
  return snapshot
}

async function latestCompletedWrongRetrySession(
  unitId: number,
  afterSessionId: number,
): Promise<number | null> {
  const completed = await row<{ session_id: number }>(
    `SELECT pus.session_id
     FROM practice_unit_submissions pus
     JOIN practice_sessions ps ON ps.id = pus.session_id
     WHERE pus.unit_id = ?
       AND pus.session_id > ?
       AND ps.mode = 'wrong'
     ORDER BY pus.session_id DESC
     LIMIT 1`,
    [unitId, afterSessionId],
  )
  return completed ? Number(completed.session_id) : null
}

function parseJsonObject(value: unknown): JsonRecord {
  try {
    const parsed = JSON.parse(String(value || '{}'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export async function analyzeWrongStatus(): Promise<JsonRecord> {
  const states = await rows<JsonRecord>(
    `SELECT s.unit_id, s.report_id, s.analyzed_session_id,
       r.scope_key, r.scope_title, r.report, r.aggregate_data
     FROM wrong_analysis_states s
     JOIN wrong_analysis_reports r ON r.id = s.report_id
     ORDER BY s.unit_id`,
  )
  const units = []
  for (const state of states) {
    const completed = await latestCompletedWrongRetrySession(
      Number(state.unit_id),
      Number(state.analyzed_session_id),
    )
    units.push({
      unit_id: Number(state.unit_id),
      report_id: Number(state.report_id),
      scope_title: state.scope_title,
      scope_key: state.scope_key,
      locked: !completed,
      can_reanalyze: Boolean(completed),
      report: state.report,
      aggregate: parseJsonObject(state.aggregate_data),
    })
  }
  return { units }
}

export async function analyzeWrongQuestions(
  questionIds: number[],
  scopeTitle: string,
): Promise<JsonRecord> {
  if (!questionIds.length) throw new LocalApiError(400, '没有可分析的错题')
  const normalized = [...new Set(questionIds.map(Number).filter(Boolean))]
  const placeholders = normalized.map(() => '?').join(',')
  const unitRows = await rows<{ unit_id: number }>(
    `SELECT DISTINCT unit_id FROM questions WHERE id IN (${placeholders})`,
    normalized,
  )
  const unitIds = unitRows.map(item => Number(item.unit_id))
  if (!unitIds.length) throw new LocalApiError(400, '没有可分析的篇目')
  const scopeKey = scopeKeyOf(unitIds)

  const report = await row<JsonRecord>(
    `SELECT * FROM wrong_analysis_reports
     WHERE scope_key = ? ORDER BY id DESC LIMIT 1`,
    [scopeKey],
  )
  const states = await rows<JsonRecord>(
    `SELECT unit_id, report_id, analyzed_session_id, analyzed_at
     FROM wrong_analysis_states
     WHERE unit_id IN (${unitIds.map(() => '?').join(',')})`,
    unitIds,
  )
  const statesByUnit = new Map<number, JsonRecord>()
  for (const state of states) statesByUnit.set(Number(state.unit_id), state)

  let allRetried = true
  const lockedReportIds: number[] = []
  const retrySessionIds = new Map<number, number>()
  for (const unitId of unitIds) {
    const state = statesByUnit.get(unitId)
    if (!state) continue
    const completed = await latestCompletedWrongRetrySession(
      unitId,
      Number(state.analyzed_session_id),
    )
    if (!completed) {
      allRetried = false
      lockedReportIds.push(Number(state.report_id))
    } else {
      retrySessionIds.set(unitId, completed)
    }
  }

  let cachedReport: JsonRecord | null = report && !allRetried ? report : null
  if (!cachedReport && lockedReportIds.length) {
    cachedReport = await row<JsonRecord>(
      `SELECT * FROM wrong_analysis_reports
       WHERE id = ? ORDER BY id DESC LIMIT 1`,
      [lockedReportIds[0]],
    )
  }
  if (cachedReport) {
    return {
      analysis: cachedReport.report,
      aggregate: parseJsonObject(cachedReport.aggregate_data),
      report_id: Number(cachedReport.id),
      scope_title: cachedReport.scope_title,
      cached: true,
      locked: true,
      reanalyze_after_retry: true,
    }
  }

  let previousSnapshot: JsonRecord = report
    ? parseJsonObject(report.input_snapshot)
    : {}
  if (!Object.keys(previousSnapshot).length) {
    for (const unitId of unitIds) {
      const state = statesByUnit.get(unitId)
      if (!state) continue
      const previous = await row<JsonRecord>(
        `SELECT input_snapshot FROM wrong_analysis_reports WHERE id = ?`,
        [state.report_id],
      )
      if (!previous) continue
      const parsed = parseJsonObject(previous.input_snapshot)
      if (parsed[String(unitId)] != null) {
        previousSnapshot[String(unitId)] = parsed[String(unitId)]
      }
    }
  }

  const inputSnapshot = await latestWrongSnapshot(unitIds, normalized, retrySessionIds)
  const currentWrongAnswers = new Map<number, string>()
  for (const unitId of unitIds) {
    for (const item of (inputSnapshot[String(unitId)]?.errors || [])) {
      currentWrongAnswers.set(Number(item.question_id), String(item.selected))
    }
  }

  const retryingAnExistingAnalysis = statesByUnit.size > 0
  if (retryingAnExistingAnalysis && !currentWrongAnswers.size) {
    const aggregate = {
      question_count: 0,
      categories: [],
      recommended_actions: ['本次重做没有新的错误选项，无需再次进行错题分析。'],
      uncertain_count: 0,
    }
    const content = '本次重做没有新的错误选项，无需再次进行错题分析。'
    let reportId = 0
    await transaction(async db => {
      const created = await db.run(
        `INSERT INTO wrong_analysis_reports
          (scope_key, unit_ids, input_snapshot, scope_title,
           question_count, aggregate_data, report, model_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [scopeKey, JSON.stringify(unitIds), JSON.stringify(inputSnapshot), scopeTitle,
          0, JSON.stringify(aggregate), content, 'local'],
        false,
      )
      reportId = Number(created.changes?.lastId)
      for (const unitId of unitIds) {
        await db.run(
          `INSERT OR REPLACE INTO wrong_analysis_states
            (unit_id, report_id, analyzed_session_id, analyzed_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          [unitId, reportId, retrySessionIds.get(unitId) || 0],
          false,
        )
      }
    })
    return {
      analysis: content, aggregate, report_id: reportId, scope_title: scopeTitle,
      cached: false, locked: true, reanalyze_after_retry: true,
    }
  }

  const profile = await row<JsonRecord>(
    `SELECT * FROM ai_profiles
     WHERE enabled = 1 AND TRIM(default_model) <> ''
     ORDER BY is_default DESC, id LIMIT 1`,
  )
  if (!profile) throw new LocalApiError(400, '请先配置并启用一个模型')
  const questions = (await rows<JsonRecord>(
    `SELECT q.id, q.number, q.stem, q.answer, q.unit_id, u.title AS unit_title,
       l.primary_skill, l.secondary_skills, l.trap_types,
       l.attention_points, l.vocabulary_demand, l.context_dependency,
       l.grammar_dependency
     FROM questions q
     JOIN units u ON u.id = q.unit_id
     LEFT JOIN question_ai_labels l ON l.question_id = q.id
     WHERE q.id IN (${placeholders})`,
    normalized,
  )).filter(item => currentWrongAnswers.has(Number(item.id)))
  const content = await chatCompletion(
    profile.id,
    profile.default_model,
    [
      {
        role: 'system',
        content: `你负责分析英语选择题错因，但不能翻译或复述整篇文章、题干和选项，
也不能显示题号、正确选项字母或错误选项字母。根据匿名化的题目特征、用户错误选择、
正确答案和已有考点标签，判断可能是词汇、上下文、逻辑、定位、语法或干扰项识别问题。
如果提供了 previous_errors（上一次分析时的错误选项），可以对比两次作答，判断用户
是否仍然选择同一错误选项或薄弱环节是否变化；对比结果只能用于归因和复习建议，
绝不能复述选项内容或暴露选项文字。允许表达不确定性。只输出：
1. 错误类型数量和比例；
2. 近期薄弱点；
3. 不泄露原题答案的训练与复习建议。`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          scope: scopeTitle,
          questions: questions.map(item => ({
            stem: item.stem,
            wrongAnswer: currentWrongAnswers.get(Number(item.id)),
            correctAnswer: item.answer,
            previousErrors: previousSnapshot[String(item.unit_id)]?.errors || [],
            labels: {
              primarySkill: item.primary_skill,
              secondarySkills: JSON.parse(item.secondary_skills || '[]'),
              trapTypes: JSON.parse(item.trap_types || '[]'),
              attentionPoints: JSON.parse(item.attention_points || '[]'),
              vocabularyDemand: item.vocabulary_demand,
              contextDependency: item.context_dependency,
              grammarDependency: item.grammar_dependency,
            },
          })),
        }),
      },
    ],
    { maxTokens: Math.max(1600, Number(profile.max_tokens || 1600)) },
  )
  const aggregate = {
    question_count: questions.length,
    categories: [],
    recommended_actions: [],
    uncertain_count: 0,
  }
  let reportId = 0
  await transaction(async db => {
    const created = await db.run(
      `INSERT INTO wrong_analysis_reports
        (scope_key, unit_ids, input_snapshot, scope_title,
         question_count, aggregate_data, report, model_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scopeKey,
        JSON.stringify(unitIds),
        JSON.stringify(inputSnapshot),
        scopeTitle,
        questions.length,
        JSON.stringify(aggregate),
        content,
        String(profile.default_model || ''),
      ],
      false,
    )
    reportId = Number(created.changes?.lastId)
    const maxSession = await row<{ max_id: number }>(
      'SELECT COALESCE(MAX(id), 0) AS max_id FROM practice_sessions',
    )
    for (const unitId of unitIds) {
      await db.run(
        `INSERT OR REPLACE INTO wrong_analysis_states
          (unit_id, report_id, analyzed_session_id, analyzed_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [unitId, reportId, retrySessionIds.get(unitId) || Number(maxSession?.max_id || 0)],
        false,
      )
    }
  })
  return {
    analysis: content,
    aggregate,
    report_id: reportId,
    scope_title: scopeTitle,
    cached: false,
    locked: true,
    reanalyze_after_retry: true,
  }
}

export { chatCompletion }
