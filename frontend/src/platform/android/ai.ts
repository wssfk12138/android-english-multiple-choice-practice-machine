import { secureStore } from '../secure-store'
import { row, rows, run } from './database'
import { LocalApiError } from './errors'
import { nativeJson } from './native-http'

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
  return (await listProfiles()).find(profile => profile.id === id)!
}

export async function deleteProfile(id: number): Promise<{ ok: true }> {
  const count = await row<{ total: number }>('SELECT COUNT(*) AS total FROM ai_profiles')
  if (Number(count?.total || 0) <= 1) throw new LocalApiError(409, '至少保留一个 API 配置')
  await profileOr404(id)
  await run('DELETE FROM ai_profile_models WHERE profile_id = ?', [id])
  await run('DELETE FROM ai_profiles WHERE id = ?', [id])
  await secureStore.remove(keyName(id))
  await ensureDefault()
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
      max_tokens: options.maxTokens || Number(profile.max_tokens),
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

export async function translateVocabularyEntries(entryIds: number[]): Promise<number> {
  const profile = await row<JsonRecord>(
    `SELECT * FROM ai_profiles
     WHERE enabled = 1 AND TRIM(default_model) <> ''
     ORDER BY is_default DESC, id LIMIT 1`,
  )
  if (!profile || !entryIds.length) return 0
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
{"translations":[{"entryId":1,"lemma":"","phonetic":"","partOfSpeech":"","contextualMeaning":"","commonMeaning":"","memoryHint":""}]}
必须原样返回 entryId。释义只写简洁中文词义，不要加入括号、来源、例句说明或“在本文中”等标注。`,
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
        id,
      ],
    )
    translated++
  }
  return translated
}

export async function analyzeWrongQuestions(
  questionIds: number[],
  scopeTitle: string,
): Promise<JsonRecord> {
  if (!questionIds.length) throw new LocalApiError(400, '没有可分析的错题')
  const profile = await row<JsonRecord>(
    `SELECT * FROM ai_profiles
     WHERE enabled = 1 AND TRIM(default_model) <> ''
     ORDER BY is_default DESC, id LIMIT 1`,
  )
  if (!profile) throw new LocalApiError(400, '请先配置并启用一个模型')
  const placeholders = questionIds.map(() => '?').join(',')
  const questions = await rows<JsonRecord>(
    `SELECT q.id, q.number, q.stem, q.answer, u.title AS unit_title,
       l.primary_skill, l.secondary_skills, l.trap_types,
       l.attention_points, l.vocabulary_demand, l.context_dependency,
       l.grammar_dependency,
       (SELECT user_answer FROM practice_answer_events e
        WHERE e.question_id = q.id ORDER BY e.id DESC LIMIT 1) AS latest_wrong_answer
     FROM questions q
     JOIN units u ON u.id = q.unit_id
     LEFT JOIN question_ai_labels l ON l.question_id = q.id
     WHERE q.id IN (${placeholders})`,
    questionIds,
  )
  const content = await chatCompletion(
    profile.id,
    profile.default_model,
    [
      {
        role: 'system',
        content: `你负责分析英语选择题错因，但不能翻译或复述整篇文章、题干和选项，
也不能显示题号、正确选项字母或错误选项字母。根据匿名化的题目特征、用户错误选择、
正确答案和已有考点标签，判断可能是词汇、上下文、逻辑、定位、语法或干扰项识别问题。
允许表达不确定性。只输出：
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
            wrongAnswer: item.latest_wrong_answer,
            correctAnswer: item.answer,
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
  return {
    analysis: content,
    aggregate: {
      question_count: questions.length,
      categories: [],
      recommended_actions: [],
      uncertain_count: 0,
    },
  }
}

export { chatCompletion }
