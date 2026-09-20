import { queueVocabularyEnrichment } from './vocabulary-enrichment-runner'
import { vocabularyProfileCondition } from './study-todos'
import { activeQuestionBankProfileId } from './question-bank-profiles'
import { executeSet, row, rows, run } from './database'
import { LocalApiError } from './errors'
import { occurrenceProjectionColumns, projectVocabulary } from '../../vocabulary-context'

type JsonRecord = Record<string, any>

function normalizeTerm(value: string): string {
  return value.trim().replaceAll('’', "'").replace(/\s+/g, ' ').toLowerCase()
}

function vocabularyKey(value: string): string {
  // Model morphology is descriptive; it must never merge selected surface forms.
  return normalizeTerm(value)
}

function validateTerm(value: string): string {
  const term = value.trim().replace(/\s+/g, ' ')
  if (!/^[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,4}$/.test(term)) {
    throw new LocalApiError(400, '请选择一个英文单词或不超过 5 个词的英文短语')
  }
  return term
}

function parseJsonArray(value: unknown): JsonRecord[] {
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function discriminationList(value: unknown, limit = 3): { word: string; note: string }[] {
  const parsed = Array.isArray(value) ? value : parseJsonArray(value)
  const result: { word: string; note: string }[] = []
  const seen = new Set<string>()
  for (const item of parsed) {
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

function matchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '')
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0
  if (!left) return right.length
  if (!right) return left.length
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i++) {
    const current = [i]
    for (let j = 1; j <= right.length; j++) {
      current.push(Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      ))
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[previous.length - 1]
}

async function localSimilarMatches(
  id: number,
  excludeWords: string[],
): Promise<{ word: string; note: string; source: string }[]> {
  const pool = await vocabularyTermPool()
  const own = pool.find(row => row.id === id)
  if (!own) return []
  const cacheKey = `${vocabularyTermPoolVersion}:${own.term.toLowerCase()}|${excludeWords.slice().sort().join(',')}`
  const cached = localSimilarCache.get(cacheKey)
  if (cached) return cached
  const excluded = new Set(excludeWords.map(word => word.toLowerCase()))
  const candidates: { distance: number; term: string }[] = []
  for (const item of pool) {
    if (item.id === id || excluded.has(item.term.toLowerCase())) continue
    if (Math.abs(item.key.length - own.key.length) > 2) continue
    // Shared-2gram shortfall > 2*2 proves edit distance > 2, so this filter
    // never removes a candidate the exact DP below would accept. It only
    // bounds how many candidates reach the O(len^2) dynamic program.
    let common = 0
    for (const [gram, count] of own.grams) common += Math.min(count, item.grams.get(gram) || 0)
    if (own.gramTotal - common > 4 || item.gramTotal - common > 4) continue
    const distance = editDistance(own.key, item.key)
    if (distance <= 2) candidates.push({ distance, term: item.term })
  }
  candidates.sort((left, right) => left.distance - right.distance || left.term.localeCompare(right.term))
  const result = candidates.slice(0, 4).map(item => ({
    word: item.term,
    note: '本地匹配',
    source: '本地匹配',
  }))
  if (localSimilarCache.size >= 50) {
    const oldest = localSimilarCache.keys().next().value
    if (oldest !== undefined) localSimilarCache.delete(oldest)
  }
  localSimilarCache.set(cacheKey, result)
  return result
}

type VocabularyPoolEntry = { id: number; term: string; key: string; grams: Map<string, number>; gramTotal: number }
let vocabularyTermPoolCache: Promise<VocabularyPoolEntry[]> | null = null
let vocabularyTermPoolVersion = 0
let vocabularyTermPoolCacheVersion = -1
const localSimilarCache = new Map<string, { word: string; note: string; source: string }[]>()
async function vocabularyTermPool(): Promise<VocabularyPoolEntry[]> {
  if (!vocabularyTermPoolCache || vocabularyTermPoolCacheVersion !== vocabularyTermPoolVersion) {
    const version = vocabularyTermPoolVersion
    vocabularyTermPoolCache = rows<{ id: number; term: string }>('SELECT id, term FROM vocabulary_entries')
      .then(list => list.map(row => {
        const key = matchKey(String(row.term))
        const grams = new Map<string, number>()
        for (let index = 0; index + 2 <= key.length; index++) {
          const gram = key.slice(index, index + 2)
          grams.set(gram, (grams.get(gram) || 0) + 1)
        }
        return { id: Number(row.id), term: String(row.term), key, grams, gramTotal: [...grams.values()].reduce((sum, count) => sum + count, 0) }
      }))
    vocabularyTermPoolCacheVersion = version
  }
  return vocabularyTermPoolCache
}
// Only a real insert or delete changes the (id, term) pool; encounter/review
// writes must not force the next detail view to rebuild it.
function bumpVocabularyTermPool() {
  vocabularyTermPoolVersion += 1
}

async function serializeEntry(id: number): Promise<JsonRecord> {
  const entry = await reviewEntry(id)
  const [job, occurrences] = await Promise.all([
    row<JsonRecord>('SELECT state,error FROM vocabulary_enrichment_jobs WHERE entry_id=?', [id]),
    rows<JsonRecord>('SELECT ' + occurrenceProjectionColumns + ' FROM vocabulary_occurrences WHERE entry_id = ?', [id]),
  ])
  entry.enrichment_status = job?.state || ''
  entry.enrichment_error = job?.error || ''
  return serializeDetails(entry, occurrences)
}

// 卡片身份是乐观并发的契约：到期队列清单、评分前的状态读取与单卡详情三处都要
// 算出同一个值，所以身份只能用这三处都读得到的列。身份同时必须是短标量——
// 903 行到期队列里 JSON 数组身份每行 121 B，是这块界面载荷的第一大头，而它当时
// 依赖的 updated_at 只是同步与编辑的记账列（评分链路从不读回），留在身份里既贵，
// 又会让裁掉该列的清单与状态读取算出两个身份，评分被静默判成过期。
function reviewRevision(entry: JsonRecord): string {
  return `${Number(entry.review_count || 0)}|${entry.last_reviewed_at || ''}|${entry.next_review_at || ''}`
}

// 评分与并发校验只需要更新后的卡片身份与回执字段；读整行会把同义词、例句、
// 语境键一起搬过桥，而复习界面从不读取这些字段。
const reviewStateColumns = [
  'id', 'last_reviewed_at', 'next_review_at',
  'study_status', 'review_stage', 'lapse_count',
  '(SELECT COUNT(*) FROM vocabulary_reviews WHERE entry_id=vocabulary_entries.id) AS review_count',
].join(', ')

async function reviewState(id: number): Promise<JsonRecord> {
  const entry = await row<JsonRecord>(`SELECT ${reviewStateColumns} FROM vocabulary_entries WHERE id = ?`, [id])
  if (!entry) throw new LocalApiError(404, '单词不存在')
  return entry
}

function reviewAckOf(entry: JsonRecord): JsonRecord {
  return {
    id: Number(entry.id),
    review_revision: reviewRevision(entry),
    next_review_at: entry.next_review_at || null,
    review_count: Number(entry.review_count || 0),
    review_stage: Number(entry.review_stage || 0),
    study_status: String(entry.study_status || ''),
  }
}

async function reviewEntry(id: number): Promise<JsonRecord> {
  const entry = await row<JsonRecord>('SELECT *, (SELECT COUNT(*) FROM vocabulary_reviews WHERE entry_id=vocabulary_entries.id) AS review_count FROM vocabulary_entries WHERE id = ?', [id])
  if (!entry) throw new LocalApiError(404, '单词不存在')
  entry.review_revision = reviewRevision(entry)
  return entry
}

async function serializeDetails(
  entry: JsonRecord,
  occurrenceRows?: JsonRecord[],
  includeLocalSimilar = true,
): Promise<JsonRecord> {
  const id = Number(entry.id)
  const synonyms = discriminationList(entry.synonyms)
  const antonyms = discriminationList(entry.antonyms)
  const similarForms = discriminationList(entry.similar_forms)
  const projection = projectVocabulary(entry, occurrenceRows
    || await rows('SELECT ' + occurrenceProjectionColumns + ' FROM vocabulary_occurrences WHERE entry_id = ?', [id]))
  return {
    ...projection,
    synonyms,
    antonyms,
    similar_forms: similarForms,
    local_similar: includeLocalSimilar
      ? await localSimilarMatches(Number(entry.id), similarForms.map(item => item.word))
      : [],
    is_frequent: Boolean(entry.manually_frequent) || Number(entry.encounter_count) >= 2,
    occurrences: projection.occurrences,
  }
}

export async function addVocabulary(body: JsonRecord): Promise<JsonRecord> {
  const term = validateTerm(String(body.term || ''))
  const normalized = vocabularyKey(term)
  const existing = await row<JsonRecord>(
    "SELECT * FROM vocabulary_entries WHERE lower(replace(trim(term), '’', char(39))) = ? ORDER BY id LIMIT 1",
    [normalized],
  )
  let id: number
  const isNew = !existing
  if (existing) {
    id = Number(existing.id)
    const status = ['pending', 'failed'].includes(existing.translation_status) && !existing.user_edited
      ? 'pending'
      : existing.translation_status
    await run(
      `UPDATE vocabulary_entries SET
        encounter_count = encounter_count + 1,
        study_status = 'learning',
        translation_status = ?,
        translation_error = CASE WHEN ? = 'pending' THEN '' ELSE translation_error END,
        last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, status, id],
    )
  } else {
    const created = await run(
      `INSERT INTO vocabulary_entries (term, normalized_term, translation_status, updated_at)
       VALUES (?, ?, 'pending', CURRENT_TIMESTAMP)`,
      [term, 'surface:v1:' + normalized],
    )
    id = Number(created.lastId)
    bumpVocabularyTermPool()
  }
  await run(
    `INSERT INTO vocabulary_occurrences
      (entry_id, surface_form, context_sentence, context_before, context_after,
       unit_id, question_id, year, unit_title, unit_type, source_kind, selection_start, sync_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, lower(hex(randomblob(16))), CURRENT_TIMESTAMP)`,
    [
      id,
      term,
      String(body.context_sentence || '').slice(0, 1500),
      String(body.context_before || '').slice(0, 1000),
      String(body.context_after || '').slice(0, 1000),
      body.unit_id || null,
      body.question_id || null,
      body.year || null,
      body.unit_title || '',
      body.unit_type || '',
      ['passage','option','question','fragment'].includes(body.source_kind) ? body.source_kind : 'unknown',
      Number.isInteger(body.selection_start) && body.selection_start >= 0 ? body.selection_start : -1,
    ],
  )
  const entry = await serializeEntry(id)
  if (existing?.translation_status === 'ready' && entry.context_key && entry.context_key !== existing.contextual_occurrence_key) {
    await queueVocabularyEnrichment(id, true)
  }
  return {
    entry_id: id,
    is_new: isNew,
    encounter_count: entry.encounter_count,
    is_frequent: entry.is_frequent,
    translation_status: entry.translation_status,
  }
}

// 到期队列与巩固候选只回传“清单”列：卡片抬头、队列排序（reconcileDueQueue）、
// 评分确认与乐观并发（reviewRevision）真正读取的字段。展开内容（释义、例句、
// 同义词、记忆提示、出现记录）改为卡片成为当前卡时按需单条读取。
// 实测（155 词到期队列）：28 列整行 + 整队出现记录 228,680 B，清单 63,045 B，
// 单张卡片详情 1,430 B——裁剪整行只能省 11%，裁剪到清单才是量级差别。
// 卡片身份只由 review_count/last_reviewed_at/next_review_at 算出，因为只有这三个列
// 在清单、评分前的状态读取（reviewStateColumns）与单卡详情里同时存在；updated_at 只服务
// 同步与编辑记账，评分链路从不读回，留在清单里纯是桥载荷（903 行到期队列实测 33 B/行）。
// 实测（155 词到期队列，平板无线调试）：再裁掉复习流程从不读取的 lemma/
// study_status/review_stage/lapse_count 后，载荷 62,478 B → 50,373 B、
// 同一条语句 96.4 ms → 68.3 ms。这四个列只服务浏览列表、编辑表单与卡片详情。
const queueEntryColumns = [
  'id', 'term', 'normalized_term', 'phonetic',
  'translation_status', 'last_result',
  'next_review_at', 'last_reviewed_at', 'created_at',
].join(', ')
const reviewCardColumns = [
  queueEntryColumns, 'lemma', 'part_of_speech', 'contextual_meaning', 'common_meaning',
  'synonyms', 'antonyms', 'similar_forms', 'morphology', 'generated_example',
  'contextual_occurrence_key', 'memory_hint', 'note', 'encounter_count',
  'manually_frequent', 'study_status', 'review_stage', 'lapse_count',
].join(', ')

function queueProjection(entry: JsonRecord): JsonRecord {
  return {
    ...Object.fromEntries(queueEntryColumns.split(', ').map(key => [key, entry[key]])),
    review_count: Number(entry.review_count || 0),
    review_revision: reviewRevision(entry),
    // Keep the existing API shape. SQLite returns this computed flag as 0/1,
    // and callers/tests compare the lightweight queue with the full record.
    is_frequent: entry.is_frequent,
  }
}

export async function listVocabulary(searchParams: URLSearchParams): Promise<JsonRecord> {
  const status = searchParams.get('status') || 'all'
  const search = searchParams.get('search') || ''
  const profileOnly = searchParams.get('scope') === 'current'
  // Review flows (due queue, reinforcement) must see the complete due set, so
  // they pass limit=all; the browsing list pages instead. The response shape
  // is identical in both cases.
  const limitAll = searchParams.get('limit') === 'all'
  // Browsing does not render memory content or encounter history.
  const summary = !limitAll && searchParams.get('projection') === 'summary'
  // 到期队列（limit=all）与巩固候选（limit=<n>）都走清单投影。
  const queue = searchParams.get('projection') === 'queue'
  // 首页复习队列额外内嵌轻量卡片详情。只覆盖 12 张首屏卡，省掉当前卡、
  // 下一卡各自的多次桥读取；后续分页仍保持极小 queue 投影。
  const reviewCards = searchParams.get('projection') === 'review'
  const limit = limitAll ? 0 : Math.max(1, Math.min(Number(searchParams.get('limit')) || 100, 500))
  const offset = limitAll ? 0 : Math.max(0, Number(searchParams.get('offset')) || 0)
  const dueNow = new Date().toISOString()
  const conditions = ['1 = 1']
  const values: unknown[] = []
  if (profileOnly) {
    conditions.push(vocabularyProfileCondition)
    values.push(await activeQuestionBankProfileId())
  }
  if (status === 'frequent') conditions.push('(encounter_count >= 2 OR manually_frequent = 1)')
  else if (status === 'review') {
    conditions.push("(next_review_at IS NULL OR next_review_at <= ?)")
    conditions.push("translation_status = 'ready'")
    values.push(dueNow)
  } else if (status === 'learning') conditions.push("study_status = 'learning'")
  else if (status === 'mastered') conditions.push("study_status = 'mastered'")
  else if (status === 'pending') conditions.push("translation_status != 'ready'")
  if (search.trim()) {
    conditions.push('(term LIKE ? OR lemma LIKE ? OR contextual_meaning LIKE ? OR common_meaning LIKE ?)')
    values.push(...Array(4).fill(`%${search.trim()}%`))
  }
  const itemColumns = summary
    ? 'id, term, lemma, common_meaning, contextual_meaning, contextual_occurrence_key, part_of_speech, encounter_count, study_status, translation_status'
    : queue ? queueEntryColumns : reviewCards ? reviewCardColumns : '*'
  // 到期队列（status=review）在 SQL 侧按客户端 reconcileDueQueue 的排序键排好：
  // 队列要分页（limit/offset）取队首，只有两侧顺序逐项一致，第一页才是真正的
  // 队首那一页，续读页也不会跳词。键依次是：未复习的在前、上次复习时间、到期
  // 时间（缺省回落到创建时间）、词形键（与 wordKey 的 normalized_term 口径一致）。
  // 浏览顺序（其余筛选）保持原样，它服务的是单词本列表界面。
  const orderBy = status === 'review'
    ? `CASE WHEN last_reviewed_at IS NULL OR last_reviewed_at = '' THEN 0 ELSE 1 END,
       datetime(NULLIF(last_reviewed_at, '')),
       datetime(COALESCE(NULLIF(next_review_at, ''), NULLIF(created_at, ''))),
       lower(COALESCE(NULLIF(normalized_term, ''), term))`
    : `CASE WHEN datetime(last_seen_at) >= datetime('now', '-7 days') THEN 0 ELSE 1 END,
       is_frequent DESC, encounter_count DESC, last_seen_at DESC`
  const items = await rows<JsonRecord>(
    `SELECT ${itemColumns}${summary ? '' : ', (SELECT COUNT(*) FROM vocabulary_reviews WHERE entry_id=vocabulary_entries.id) AS review_count'},
       CASE WHEN encounter_count >= 2 OR manually_frequent = 1 THEN 1 ELSE 0 END AS is_frequent
     FROM vocabulary_entries
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${orderBy}
     ${limitAll ? '' : 'LIMIT ? OFFSET ?'}`,
    limitAll ? values : [...values, limit, offset],
  )
  // The due comparison uses the same ISO format the app writes, so the counts
  // aggregate and the list filter always agree.
  const counts = await row<JsonRecord>(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN encounter_count >= 2 OR manually_frequent = 1 THEN 1 ELSE 0 END), 0) AS frequent,
       COALESCE(SUM(CASE WHEN study_status = 'mastered' THEN 1 ELSE 0 END), 0) AS mastered,
       COALESCE(SUM(CASE WHEN translation_status != 'ready' THEN 1 ELSE 0 END), 0) AS pending,
       COALESCE(SUM(CASE WHEN translation_status = 'ready'
         AND (next_review_at IS NULL OR next_review_at <= ?)
       THEN 1 ELSE 0 END), 0) AS review,
       (SELECT value FROM app_settings WHERE key = 'vocabulary_revision') AS content_revision
     FROM vocabulary_entries
     WHERE ${profileOnly ? vocabularyProfileCondition : '1 = 1'}`,
    profileOnly ? [dueNow, values[0]] : [dueNow],
  )
  const byEntry = new Map<number, JsonRecord[]>()
  // 清单只回传词条本身；出现记录的批量读取只服务于完整投影
  // （完整列表，以及 summary 里回落到语境释义所需的有效来源校验）。
  const itemIds = (queue ? [] : items.filter(item => reviewCards || !summary || (!item.common_meaning && item.contextual_meaning)))
    .map(item => Number(item.id)).filter(Number.isInteger)
  for (let offset = 0; offset < itemIds.length; offset += 500) {
    const batch = itemIds.slice(offset, offset + 500)
    if (!batch.length) continue
    const placeholders = batch.map(() => '?').join(', ')
    const occurrences = await rows<JsonRecord>(
      `SELECT ${occurrenceProjectionColumns} FROM vocabulary_occurrences WHERE entry_id IN (${placeholders})`,
      batch,
    )
    for (const occurrence of occurrences) {
      const history = byEntry.get(Number(occurrence.entry_id)) || []
      history.push(occurrence)
      byEntry.set(Number(occurrence.entry_id), history)
    }
  }
  const serializedItems = await Promise.all(items.map(async item => {
    if (queue) return queueProjection(item)
    if (reviewCards) {
      const detail = await serializeDetails(item, byEntry.get(Number(item.id)) || [], false)
      return { ...queueProjection(item), review_detail: detail }
    }
    if (!summary) return projectVocabulary({...item, review_revision: reviewRevision(item)}, byEntry.get(Number(item.id)) || [])
    const contextual = !item.common_meaning && item.contextual_meaning
      ? projectVocabulary(item, byEntry.get(Number(item.id)) || []).contextual_meaning : ''
    return { ...item, contextual_meaning: contextual, is_frequent: Boolean(item.is_frequent) }
  }))
  const revision = `v2:${String(counts?.content_revision || '0')}`
  if (counts) delete counts.content_revision
  return { items: serializedItems, counts, scope_key: profileOnly ? `profile:${values[0]}` : 'all', revision }
}

export async function vocabularyRevision(searchParams: URLSearchParams = new URLSearchParams()): Promise<{ revision: string; scope_key: string }> {
  const profileOnly = searchParams.get('scope') === 'current'
  const profileId = profileOnly ? await activeQuestionBankProfileId() : null
  const revision = await row<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'vocabulary_revision'",
  )
  const scopeKey = profileOnly ? `profile:${profileId}` : 'all'
  return {
    scope_key: scopeKey,
    revision: `v2:${String(revision?.value || '0')}`,
  }
}

export async function homeVocabulary(limit: number): Promise<JsonRecord> {
  // next_review_at is written with JS toISOString(), so comparing against an
  // ISO parameter keeps due words (whose dates equal today) ahead of future
  // ones — the old unwritten comparison ranked today's due words last.
  const dueNow = new Date().toISOString()
  const items = await rows<JsonRecord>(
    `SELECT id, term, lemma, contextual_meaning, common_meaning,
       encounter_count, study_status,
       CASE WHEN encounter_count >= 2 OR manually_frequent = 1 THEN 1 ELSE 0 END AS is_frequent
     FROM vocabulary_entries
     WHERE translation_status = 'ready'
     ORDER BY
       CASE WHEN datetime(created_at) >= datetime('now', '-7 days') THEN 0 ELSE 1 END,
       is_frequent DESC,
       CASE WHEN next_review_at IS NULL OR next_review_at <= ? THEN 0 ELSE 1 END,
       encounter_count DESC, RANDOM()
     LIMIT ?`,
    [dueNow, Math.max(1, Math.min(limit, 50))],
  )
  return { items }
}

export async function updateVocabulary(id: number, body: JsonRecord): Promise<JsonRecord> {
  const allowed = new Set([
    'contextual_meaning',
    'common_meaning',
    'phonetic',
    'part_of_speech',
    'note',
    'study_status',
    'manually_frequent',
  ])
  const assignments: string[] = []
  const values: unknown[] = []
  for (const [key, value] of Object.entries(body)) {
    if (!allowed.has(key) || value == null) continue
    assignments.push(`${key} = ?`)
    values.push(key === 'manually_frequent' ? (value ? 1 : 0) : value)
  }
  if (assignments.length) {
    if (typeof body.contextual_meaning === 'string') {
      const projection = projectVocabulary({}, await rows(`SELECT ${occurrenceProjectionColumns} FROM vocabulary_occurrences WHERE entry_id = ?`, [id]))
      assignments.push('contextual_occurrence_key = ?')
      values.push(projection.context_key ?? '')
    }
    assignments.push('user_edited = 1', 'updated_at = CURRENT_TIMESTAMP')
    values.push(id)
    await run(`UPDATE vocabulary_entries SET ${assignments.join(', ')} WHERE id = ?`, values)
  }
  return serializeEntry(id)
}

export async function deleteVocabulary(id: number): Promise<{ ok: true }> {
  await run('DELETE FROM vocabulary_entries WHERE id = ?', [id])
  bumpVocabularyTermPool()
  return { ok: true }
}

export async function retryVocabulary(_id: number): Promise<{ ok: true }> {
  await run(
    `UPDATE vocabulary_entries SET translation_status = 'queued',
      translation_error = '', updated_at = CURRENT_TIMESTAMP
     WHERE user_edited = 0 AND translation_status IN ('pending', 'failed')`,
  )
  return { ok: true }
}

export async function reviewVocabulary(id: number, rating: string, mode = 'scheduled', expectedRevision?: string, commandId?: string): Promise<JsonRecord> {
  if (commandId && !/^[a-f0-9]{32}$/i.test(commandId)) throw new LocalApiError(400, '无效的复习命令')
  // A retry after a bridge timeout must be safe. The command id is stored in
  // vocabulary_reviews.sync_id, so a repeated request returns the original
  // acknowledgement instead of advancing the schedule twice.
  if (commandId) {
    const prior = await row<JsonRecord>(
      `SELECT entry_id, rating, mode FROM vocabulary_reviews WHERE sync_id = ? ORDER BY id DESC LIMIT 1`,
      [commandId],
    )
    if (prior) {
      if (Number(prior.entry_id) !== id || String(prior.rating) !== rating || String(prior.mode) !== mode) {
        throw new LocalApiError(409, '复习命令已用于其他评价')
      }
      return reviewAckOf(await reviewState(id))
    }
  }
  // 集合内取不到 SELECT 结果，所以并发校验在写库之前单独读一次；写库本身
  // （更新词条 + 记账）合并成一次桥调用、一个原生事务，失败整组回滚。
  const current = await reviewState(id)
  if (expectedRevision !== undefined && expectedRevision !== reviewRevision(current)) {
    throw new LocalApiError(409, '复习记录已更新，请刷新当前单词后重新评分')
  }
  return applyVocabularyReview(id, rating, mode, current, commandId)
}

async function applyVocabularyReview(id: number, rating: string, mode = 'scheduled', current?: JsonRecord, commandId?: string): Promise<JsonRecord> {
  if (!['again', 'hard', 'know', 'fluent'].includes(rating)) throw new LocalApiError(400, '无效的复习评价')
  if (!['scheduled', 'reinforcement'].includes(mode)) throw new LocalApiError(400, '无效的复习模式')
  const entry = current || await reviewState(id)
  const now = new Date()
  const set: { statement: string; values?: unknown[] }[] = []
  let nextReviewAt = now.toISOString()
  if (mode === 'scheduled') {
    let stage = Math.max(0, Math.min(7, Number(entry.review_stage || 0)))
    stage = rating === 'again' ? 0 : rating === 'hard' ? Math.max(0, stage - 1) : rating === 'know' ? Math.min(7, stage + 1) : Math.min(7, stage + 2)
    const delays = [10 / 1440, 1, 3, 7, 14, 30, 60, 120]
    nextReviewAt = new Date(now.getTime() + delays[stage] * 86400000).toISOString()
    set.push({
      statement: `UPDATE vocabulary_entries SET review_stage = ?, last_result = ?, study_status = ?, lapse_count = lapse_count + ?,
        last_reviewed_at = ?, next_review_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values: [stage, rating, rating === 'fluent' ? 'mastered' : 'learning', rating === 'again' ? 1 : 0, now.toISOString(), nextReviewAt, id],
    })
  }
  set.push({
    statement: `INSERT INTO vocabulary_reviews (entry_id, rating, mode, next_review_at, sync_id, updated_at) VALUES (?, ?, '${mode}', ?, COALESCE(?, lower(hex(randomblob(16)))), CURRENT_TIMESTAMP)`,
    values: [id, rating, nextReviewAt, commandId || null],
  })
  await executeSet(set)
  // The transaction has already written every field used by the card. Build
  // the acknowledgement from the validated state instead of issuing a third
  // bridge read immediately after the write. A later queue refresh can still
  // reconcile the full row in the background.
  return reviewAckOf({
    ...entry,
    id,
    next_review_at: nextReviewAt,
    last_reviewed_at: mode === 'scheduled' ? now.toISOString() : entry.last_reviewed_at,
    review_stage: mode === 'scheduled' ? Number(set[0]?.values?.[0] ?? entry.review_stage ?? 0) : entry.review_stage,
    study_status: mode === 'scheduled' ? (rating === 'fluent' ? 'mastered' : 'learning') : entry.study_status,
    review_count: Number(entry.review_count || 0) + 1,
  })
}

export async function queueTranslations(entryIds: number[]): Promise<JsonRecord> {
  const allIds = [...new Set(entryIds.map(Number).filter(id => Number.isInteger(id) && id > 0))]
  let queuedCount = 0
  for (let offset = 0; offset < allIds.length; offset += 400) {
    const ids = allIds.slice(offset, offset + 400)
    const result = await run(
      `UPDATE vocabulary_entries SET translation_status = 'queued',
        translation_error = '', updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${ids.map(() => '?').join(',')})
         AND user_edited = 0 AND translation_status IN ('pending','failed')`,
      ids,
    )
    queuedCount += result.changes
  }
  return { accepted: true, queuedCount }
}

export { serializeEntry }
