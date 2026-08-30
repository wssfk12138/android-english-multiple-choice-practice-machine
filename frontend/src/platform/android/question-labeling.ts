import { chatCompletion } from './ai'
import { row, rows, run, transaction } from './database'
import { LocalApiError } from './errors'
import { activeQuestionBankProfileId } from './question-bank-profiles'

type JsonRecord = Record<string, any>

function ids(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : String(value || '').split(',')
  return [...new Set(raw.map(Number).filter(item => Number.isInteger(item) && item > 0))]
}

type LabelRunContext = {
  run_id: string
  question_bank_profile_id: number
  scope_kind: 'all' | 'year' | 'papers'
  year: number | null
  paper_ids: number[]
  overwrite_unlocked: boolean
  status: string
}

function scopeWhere(year: number | null, paperIds: number[], profileId: number, alias = 'p') {
  const conditions: string[] = []
  const values: unknown[] = []
  conditions.push(alias + '.profile_id = ?', alias + '.deleted_at IS NULL')
  values.push(profileId)
  if (alias === 'p') conditions.push("u.unit_type <> 'listening'")
  if (year != null && Number.isFinite(year)) {
    conditions.push(`${alias}.year = ?`)
    values.push(year)
  }
  if (paperIds.length) {
    conditions.push(`${alias}.id IN (${paperIds.map(() => '?').join(',')})`)
    values.push(...paperIds)
  }
  return {
    clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  }
}

function profileValue(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

async function resolveProfileId(value: unknown): Promise<number> {
  const profileId = profileValue(value) ?? await activeQuestionBankProfileId()
  const exists = await row('SELECT id FROM question_bank_profiles WHERE id = ? AND deleted_at IS NULL', [profileId])
  if (!exists) throw new LocalApiError(400, '题库配置不存在或已在回收站')
  return profileId
}

async function loadRunContext(runId: string): Promise<LabelRunContext | null> {
  if (!runId.trim()) return null
  const found = await row<JsonRecord>('SELECT * FROM question_label_runs WHERE run_id = ?', [runId.trim().slice(0, 80)])
  if (!found) return null
  let paperIds: number[] = []
  try { paperIds = ids(JSON.parse(String(found.paper_ids || '[]'))) } catch { paperIds = [] }
  return {
    run_id: String(found.run_id),
    question_bank_profile_id: Number(found.question_bank_profile_id),
    scope_kind: String(found.scope_kind || 'all') as LabelRunContext['scope_kind'],
    year: found.year == null ? null : Number(found.year),
    paper_ids: paperIds,
    overwrite_unlocked: Number(found.overwrite_unlocked) === 1 || String(found.overwrite_unlocked).toLowerCase() === 'true',
    status: String(found.status || 'running'),
  }
}

async function ensureRunContext(body: JsonRecord): Promise<{ runId: string; context: LabelRunContext }> {
  const runId = String(body.run_id || crypto.randomUUID()).trim().slice(0, 80)
  const existing = await loadRunContext(runId)
  if (existing) {
    if (existing.status === 'paused' || existing.status === 'failed') {
      await run(
        "UPDATE question_label_runs SET status = 'running', last_error = '', updated_at = CURRENT_TIMESTAMP, finished_at = NULL WHERE run_id = ?",
        [runId],
      )
      existing.status = 'running'
    }
    return { runId, context: existing }
  }
  const profileId = await resolveProfileId(body.question_bank_profile_id)
  const yearValue = body.year == null || body.year === '' ? null : Number(body.year)
  const year = yearValue == null || Number.isFinite(yearValue) ? yearValue : null
  const paperIds = ids(body.paper_ids)
  if (paperIds.length) {
    const placeholders = paperIds.map(() => '?').join(',')
    const count = await row<{ count: number }>(
      'SELECT COUNT(*) AS count FROM papers WHERE id IN (' + placeholders + ') AND profile_id = ? AND deleted_at IS NULL',
      [...paperIds, profileId],
    )
    if (Number(count?.count || 0) !== paperIds.length) {
      throw new LocalApiError(400, '标注试卷不属于当前绑定的题库配置')
    }
  }
  const scopeKind = paperIds.length ? 'papers' : year != null ? 'year' : 'all'
  await run(
    'INSERT OR IGNORE INTO question_label_runs ' +
      '(run_id, question_bank_profile_id, scope_kind, year, paper_ids, overwrite_unlocked, status) ' +
      "VALUES (?, ?, ?, ?, ?, ?, 'running')",
    [runId, profileId, scopeKind, year, JSON.stringify(paperIds), body.overwrite_unlocked ? 1 : 0],
  )
  const context = await loadRunContext(runId)
  if (!context) throw new LocalApiError(500, '无法创建智能标注运行上下文')
  return { runId, context }
}

async function updateRunStatus(runId: string, status: 'running' | 'paused' | 'done' | 'failed' | 'cancelled', error = '') {
  await run(
    'UPDATE question_label_runs SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP, ' +
      "finished_at = CASE WHEN ? IN ('done', 'failed', 'cancelled') THEN CURRENT_TIMESTAMP ELSE NULL END WHERE run_id = ?",
    [status, error.slice(0, 1000), status, runId],
  )
}

export async function pauseLabelRun(runId: string): Promise<JsonRecord> {
  const context = await loadRunContext(runId)
  if (!context) throw new LocalApiError(404, '智能标注运行不存在')
  await updateRunStatus(context.run_id, 'paused')
  return { run_id: context.run_id, status: 'paused' }
}

export async function failLabelRun(runId: string, error: unknown): Promise<void> {
  if (runId.trim()) await updateRunStatus(runId.trim().slice(0, 80), 'failed', String(error))
}

export async function labelingStatus(search: URLSearchParams | JsonRecord): Promise<JsonRecord> {
  const yearValue = search instanceof URLSearchParams ? search.get('year') : search.year
  let year = yearValue == null || yearValue === '' ? null : Number(yearValue)
  let paperIds = ids(search instanceof URLSearchParams ? search.get('paper_ids') : search.paper_ids)
  const requestedRunId = String(search instanceof URLSearchParams ? search.get('run_id') || '' : search.run_id || '')
  const runContext = await loadRunContext(requestedRunId)
  const profileInput = search instanceof URLSearchParams
    ? search.get('question_bank_profile_id')
    : search.question_bank_profile_id
  let profileId = await resolveProfileId(profileInput)
  if (runContext) {
    year = runContext.year
    paperIds = runContext.paper_ids
    profileId = runContext.question_bank_profile_id
  }
  const scope = scopeWhere(year, paperIds, profileId)
  const status = await row<JsonRecord>(
    `SELECT COUNT(q.id) AS total,
       SUM(CASE WHEN l.question_id IS NOT NULL THEN 1 ELSE 0 END) AS labeled,
       SUM(CASE WHEN l.locked = 1 THEN 1 ELSE 0 END) AS locked,
       SUM(CASE WHEN l.primary_skill = '题目结构待校正' THEN 1 ELSE 0 END) AS review_pending
     FROM questions q JOIN units u ON u.id = q.unit_id
     JOIN papers p ON p.id = u.paper_id
     LEFT JOIN question_ai_labels l ON l.question_id = q.id
     ${scope.clause}`,
    scope.values,
  )
  const total = Number(status?.total || 0)
  const labeled = Number(status?.labeled || 0)
  return {
    year,
    paper_ids: paperIds,
    years: (await rows<{ year: number }>(
      'SELECT DISTINCT year FROM papers WHERE profile_id = ? AND deleted_at IS NULL ORDER BY year DESC',
      [profileId],
    )).map(item => item.year),
    total,
    labeled,
    locked: Number(status?.locked || 0),
    review_pending: Number(status?.review_pending || 0),
    remaining: Math.max(0, total - labeled),
    percentage: total ? Math.round(labeled * 100 / total) : 0,
    question_bank_profile_id: profileId,
    ...(requestedRunId ? { run_id: requestedRunId } : {}),
  }
}

export async function listQuestionLabels(search: URLSearchParams): Promise<JsonRecord[]> {
  const yearValue = search.get('year')
  const year = yearValue ? Number(yearValue) : null
  const paperIds = ids(search.get('paper_ids'))
  const profileId = await resolveProfileId(search.get('question_bank_profile_id'))
  const query = String(search.get('search') || '').trim()
  const limit = Math.min(200, Math.max(1, Number(search.get('limit') || 120)))
  const conditions: string[] = []
  const values: unknown[] = []
  conditions.push('p.profile_id = ?', 'p.deleted_at IS NULL', "u.unit_type <> 'listening'")
  values.push(profileId)
  if (year != null) { conditions.push('p.year = ?'); values.push(year) }
  if (paperIds.length) {
    conditions.push(`p.id IN (${paperIds.map(() => '?').join(',')})`)
    values.push(...paperIds)
  }
  if (query) {
    conditions.push('(CAST(q.number AS TEXT) LIKE ? OR u.title LIKE ? OR l.primary_skill LIKE ?)')
    values.push(`%${query}%`, `%${query}%`, `%${query}%`)
  }
  values.push(limit)
  const result = await rows<JsonRecord>(
    `SELECT q.id AS question_id, q.number, p.year, u.title AS unit_title,
       COALESCE(l.primary_skill, '') AS primary_skill,
       COALESCE(l.secondary_skills, '[]') AS secondary_skills,
       COALESCE(l.trap_types, '[]') AS trap_types,
       COALESCE(l.attention_points, '[]') AS attention_points,
       COALESCE(l.vocabulary_demand, 'medium') AS vocabulary_demand,
       COALESCE(l.context_dependency, 'medium') AS context_dependency,
       COALESCE(l.grammar_dependency, 'medium') AS grammar_dependency,
       COALESCE(l.confidence, 0) AS confidence,
       COALESCE(l.locked, 0) AS locked,
       COALESCE(l.user_edited, 0) AS user_edited,
       COALESCE(l.model_name, '') AS model_name,
       COALESCE(l.updated_at, '') AS updated_at
     FROM questions q JOIN units u ON u.id = q.unit_id
     JOIN papers p ON p.id = u.paper_id
     LEFT JOIN question_ai_labels l ON l.question_id = q.id
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY p.year DESC, u.sequence, q.sequence LIMIT ?`,
    values,
  )
  const parseList = (value: string) => {
    try { return JSON.parse(value || '[]') } catch { return [] }
  }
  return result.map(item => ({
    ...item,
    secondary_skills: parseList(item.secondary_skills),
    trap_types: parseList(item.trap_types),
    attention_points: parseList(item.attention_points),
    locked: Boolean(item.locked),
    user_edited: Boolean(item.user_edited),
  }))
}

function parseJson(content: string): JsonRecord {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced || content).trim()
  try { return JSON.parse(candidate) } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1))
    throw new Error('模型未返回合法 JSON')
  }
}

async function requestLabels(profile: JsonRecord, unit: JsonRecord, questions: JsonRecord[]): Promise<JsonRecord[]> {
  const prompt = `你负责为考研英语固定题库建立结构化考点标签，不写解析或翻译。
只输出 JSON：{"labels":[{"question_id":1,"primary_skill":"上下文逻辑","secondary_skills":[],
"trap_types":[],"attention_points":[],"vocabulary_demand":"low|medium|high",
"context_dependency":"low|medium|high","grammar_dependency":"low|medium|high","confidence":0.0}]}。
attention_points 只能写抽象方法，不复述原题或泄露答案。每个 question_id 必须恰好输出一次。`
  const raw = await chatCompletion(
    Number(profile.id),
    String(profile.default_model),
    [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: JSON.stringify({
          year: unit.year,
          title: unit.title,
          unit_type: unit.unit_type,
          passage: String(unit.passage || '').slice(0, 9000),
          questions,
        }),
      },
    ],
    { maxTokens: Math.max(4200, Number(profile.max_tokens || 0)), responseFormat: { type: 'json_object' } },
  )
  const labels = parseJson(raw).labels
  if (!Array.isArray(labels)) throw new Error('模型没有返回题目标签数组')
  const expected = new Set(questions.map(question => Number(question.id)))
  const cleaned = labels.filter((label: JsonRecord) => expected.has(Number(label?.question_id)))
  if (new Set(cleaned.map((label: JsonRecord) => Number(label.question_id))).size !== expected.size) {
    throw new Error('模型返回的题目标签不完整')
  }
  return cleaned
}

async function requestWithFallback(profile: JsonRecord, unit: JsonRecord, questions: JsonRecord[]): Promise<JsonRecord[]> {
  try { return await requestLabels(profile, unit, questions) } catch (cause) {
    if (questions.length <= 1) throw new LocalApiError(400, `模型未能完成题目标签：${String(cause)}`)
    const midpoint = Math.max(1, Math.floor(questions.length / 2))
    return [
      ...await requestWithFallback(profile, unit, questions.slice(0, midpoint)),
      ...await requestWithFallback(profile, unit, questions.slice(midpoint)),
    ]
  }
}

function list(value: unknown): string[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return [...new Set(source.map(item => String(item).trim()).filter(Boolean))].slice(0, 6)
}

export async function labelNextUnit(body: JsonRecord): Promise<JsonRecord> {
  const ensured = await ensureRunContext(body)
  const runId = ensured.runId
  const context = ensured.context
  const year = context.year
  const paperIds = context.paper_ids
  const overwrite = context.overwrite_unlocked
  const conditions = [
    overwrite ? '(l.question_id IS NULL OR l.locked = 0)' : 'l.question_id IS NULL',
    'ri.question_id IS NULL',
    'p.profile_id = ?',
    'p.deleted_at IS NULL',
    "u.unit_type <> 'listening'",
  ]
  const values: unknown[] = [runId, context.question_bank_profile_id]
  if (year != null) { conditions.push('p.year = ?'); values.push(year) }
  if (paperIds.length) {
    conditions.push(`p.id IN (${paperIds.map(() => '?').join(',')})`)
    values.push(...paperIds)
  }
  const unit = await row<JsonRecord>(
    `SELECT u.id, u.title, u.unit_type, u.passage, p.year
     FROM units u JOIN papers p ON p.id = u.paper_id
     JOIN questions q ON q.unit_id = u.id
     LEFT JOIN question_ai_labels l ON l.question_id = q.id
     LEFT JOIN question_label_run_items ri ON ri.question_id = q.id AND ri.run_id = ?
     WHERE ${conditions.join(' AND ')}
     GROUP BY u.id ORDER BY p.year DESC, u.sequence LIMIT 1`,
    values,
  )
  if (!unit) {
    await updateRunStatus(runId, 'done')
    return {
      done: true,
      processed: 0,
      run_id: runId,
      question_bank_profile_id: context.question_bank_profile_id,
      ...await labelingStatus({ year, paper_ids: paperIds, question_bank_profile_id: context.question_bank_profile_id, run_id: runId }),
    }
  }
  const questionRows = await rows<JsonRecord>(
    `SELECT q.id, q.number, q.stem, q.answer, q.question_type
     FROM questions q LEFT JOIN question_ai_labels l ON l.question_id = q.id
     LEFT JOIN question_label_run_items ri ON ri.question_id = q.id AND ri.run_id = ?
     WHERE q.unit_id = ? AND ${overwrite ? '(l.question_id IS NULL OR l.locked = 0)' : 'l.question_id IS NULL'}
       AND ri.question_id IS NULL ORDER BY q.sequence`,
    [runId, unit.id],
  )
  const questions = []
  for (const question of questionRows) {
    questions.push({
      ...question,
      options: await rows('SELECT stable_key, content FROM options WHERE question_id = ? ORDER BY sequence', [question.id]),
    })
  }
  const profile = await row<JsonRecord>(
    `SELECT * FROM ai_profiles WHERE enabled = 1 AND TRIM(default_model) <> ''
     ORDER BY is_default DESC, id LIMIT 1`,
  )
  if (!profile) throw new LocalApiError(400, '请先配置并启用一个默认模型')
  let processed = 0
  for (let start = 0; start < questions.length; start += 5) {
    const batch = questions.slice(start, start + 5)
    const labels = await requestWithFallback(profile, unit, batch)
    await transaction(async db => {
      for (const label of labels) {
        const questionId = Number(label.question_id)
        await db.run(
          `INSERT INTO question_ai_labels
            (question_id, primary_skill, secondary_skills, trap_types,
             attention_points, vocabulary_demand, context_dependency,
             grammar_dependency, confidence, locked, user_edited, model_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
           ON CONFLICT(question_id) DO UPDATE SET
             primary_skill = excluded.primary_skill,
             secondary_skills = excluded.secondary_skills,
             trap_types = excluded.trap_types,
             attention_points = excluded.attention_points,
             vocabulary_demand = excluded.vocabulary_demand,
             context_dependency = excluded.context_dependency,
             grammar_dependency = excluded.grammar_dependency,
             confidence = excluded.confidence,
             locked = 1,
             model_name = excluded.model_name,
             label_version = question_ai_labels.label_version + 1,
             updated_at = CURRENT_TIMESTAMP
           WHERE question_ai_labels.locked = 0`,
          [
            questionId,
            String(label.primary_skill || '待补充').slice(0, 80),
            JSON.stringify(list(label.secondary_skills)),
            JSON.stringify(list(label.trap_types)),
            JSON.stringify(list(label.attention_points)),
            ['low', 'medium', 'high'].includes(label.vocabulary_demand) ? label.vocabulary_demand : 'medium',
            ['low', 'medium', 'high'].includes(label.context_dependency) ? label.context_dependency : 'medium',
            ['low', 'medium', 'high'].includes(label.grammar_dependency) ? label.grammar_dependency : 'medium',
            Math.max(0, Math.min(1, Number(label.confidence || 0))),
            profile.default_model,
          ],
          false,
        )
        await db.run(
          'INSERT OR REPLACE INTO question_label_run_items (run_id, question_id) VALUES (?, ?)',
          [runId, questionId],
          false,
        )
        processed++
      }
    })
  }
  return {
    done: false,
    processed,
    run_id: runId,
    question_bank_profile_id: context.question_bank_profile_id,
    unit_id: unit.id,
    unit_title: `${unit.year} 年 ${unit.title}`,
    ...await labelingStatus({ year, paper_ids: paperIds, question_bank_profile_id: context.question_bank_profile_id, run_id: runId }),
  }
}

export async function updateQuestionLabel(questionId: number, body: JsonRecord): Promise<JsonRecord> {
  const exists = await row('SELECT id FROM questions WHERE id = ?', [questionId])
  if (!exists) throw new LocalApiError(404, '题目不存在')
  await run(
    `INSERT INTO question_ai_labels
      (question_id, primary_skill, secondary_skills, trap_types, attention_points,
       vocabulary_demand, context_dependency, grammar_dependency, confidence,
       locked, user_edited, model_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '人工校正')
     ON CONFLICT(question_id) DO UPDATE SET
       primary_skill = excluded.primary_skill,
       secondary_skills = excluded.secondary_skills,
       trap_types = excluded.trap_types,
       attention_points = excluded.attention_points,
       vocabulary_demand = excluded.vocabulary_demand,
       context_dependency = excluded.context_dependency,
       grammar_dependency = excluded.grammar_dependency,
       confidence = excluded.confidence,
       locked = excluded.locked,
       user_edited = 1, model_name = '人工校正',
       label_version = question_ai_labels.label_version + 1,
       updated_at = CURRENT_TIMESTAMP`,
    [
      questionId,
      String(body.primary_skill || '').trim(),
      JSON.stringify(list(body.secondary_skills)),
      JSON.stringify(list(body.trap_types)),
      JSON.stringify(list(body.attention_points)),
      body.vocabulary_demand || 'medium',
      body.context_dependency || 'medium',
      body.grammar_dependency || 'medium',
      Math.max(0, Math.min(1, Number(body.confidence || 0))),
      body.locked === false ? 0 : 1,
    ],
  )
  return { updated: true, locked: body.locked !== false }
}
