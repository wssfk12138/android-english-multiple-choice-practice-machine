import { queueVocabularyEnrichment } from './vocabulary-enrichment-runner'
import { vocabularyProfileCondition } from './study-todos'
import { activeQuestionBankProfileId } from './question-bank-profiles'
import { row, rows, run, transaction } from './database'
import { LocalApiError } from './errors'
import { occurrenceProjectionColumns, projectVocabulary } from '../../vocabulary-context'
import type { SQLiteDBConnection } from '@capacitor-community/sqlite'

type JsonRecord = Record<string, any>
// 事务内的读写优先走事务句柄（与 practice.ts 约定一致）；缺省时回落到共享连接。
type TransactionDb = Pick<SQLiteDBConnection, 'query' | 'run'>

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
  const job = await row<JsonRecord>('SELECT state,error FROM vocabulary_enrichment_jobs WHERE entry_id=?', [id])
  entry.enrichment_status = job?.state || ''
  entry.enrichment_error = job?.error || ''
  return serializeDetails(entry)
}

function reviewRevision(entry: JsonRecord): string {
  return JSON.stringify([entry.normalized_term, entry.last_reviewed_at, entry.next_review_at, entry.updated_at, entry.review_count || 0])
}

// 评分与并发校验只需要更新后的卡片身份；读整行会把同义词、例句、语境键
// 一起搬过桥，而复习界面从不读取这些字段。
const reviewStateColumns = [
  'id', 'normalized_term', 'last_reviewed_at', 'next_review_at', 'updated_at',
  'study_status', 'review_stage', 'lapse_count',
  '(SELECT COUNT(*) FROM vocabulary_reviews WHERE entry_id=vocabulary_entries.id) AS review_count',
].join(', ')

async function reviewState(id: number, db?: TransactionDb): Promise<JsonRecord> {
  const statement = `SELECT ${reviewStateColumns} FROM vocabulary_entries WHERE id = ?`
  const entry = db
    ? (await db.query(statement, [id])).values?.[0] as JsonRecord | undefined
    : await row<JsonRecord>(statement, [id])
  if (!entry) throw new LocalApiError(404, '单词不存在')
  return entry
}

async function reviewRun(db: TransactionDb | undefined, statement: string, values: unknown[] = []): Promise<void> {
  if (db) {
    await db.run(statement, values, false)
    return
  }
  await run(statement, values)
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

async function serializeDetails(entry: JsonRecord): Promise<JsonRecord> {
  const id = Number(entry.id)
  const synonyms = discriminationList(entry.synonyms)
  const antonyms = discriminationList(entry.antonyms)
  const similarForms = discriminationList(entry.similar_forms)
  const projection = projectVocabulary(entry, await rows(`SELECT ${occurrenceProjectionColumns} FROM vocabulary_occurrences WHERE entry_id = ?`, [id]))
  return {
    ...projection,
    synonyms,
    antonyms,
    similar_forms: similarForms,
    local_similar: await localSimilarMatches(
      Number(entry.id),
      similarForms.map(item => item.word),
    ),
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
// reviewRevision 依赖的 normalized_term/last_reviewed_at/next_review_at/
// updated_at 与 review_count 子查询全部保留，清单与详情给出同一份卡片身份。
// 实测（155 词到期队列，平板无线调试）：再裁掉复习流程从不读取的 lemma/
// study_status/review_stage/lapse_count 后，载荷 62,478 B → 50,373 B、
// 同一条语句 96.4 ms → 68.3 ms。这四个列只服务浏览列表、编辑表单与卡片详情。
const queueEntryColumns = [
  'id', 'term', 'normalized_term', 'phonetic',
  'translation_status', 'last_result',
  'next_review_at', 'last_reviewed_at', 'created_at', 'updated_at',
].join(', ')

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
    : queue ? queueEntryColumns : '*'
  const items = await rows<JsonRecord>(
    `SELECT ${itemColumns}${summary ? '' : ', (SELECT COUNT(*) FROM vocabulary_reviews WHERE entry_id=vocabulary_entries.id) AS review_count'},
       CASE WHEN encounter_count >= 2 OR manually_frequent = 1 THEN 1 ELSE 0 END AS is_frequent
     FROM vocabulary_entries
     WHERE ${conditions.join(' AND ')}
     ORDER BY
       CASE WHEN datetime(last_seen_at) >= datetime('now', '-7 days') THEN 0 ELSE 1 END,
       is_frequent DESC, encounter_count DESC, last_seen_at DESC
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
       THEN 1 ELSE 0 END), 0) AS review
     FROM vocabulary_entries
     WHERE ${profileOnly ? vocabularyProfileCondition : '1 = 1'}`,
    profileOnly ? [dueNow, values[0]] : [dueNow],
  )
  const byEntry = new Map<number, JsonRecord[]>()
  // 清单只回传词条本身；出现记录的批量读取只服务于完整投影
  // （完整列表，以及 summary 里回落到语境释义所需的有效来源校验）。
  const itemIds = (queue ? [] : items.filter(item => !summary || (!item.common_meaning && item.contextual_meaning)))
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
  return { items: items.map(item => {
    if (queue) return { ...item, review_revision: reviewRevision(item) }
    if (!summary) return projectVocabulary({...item, review_revision: reviewRevision(item)}, byEntry.get(Number(item.id)) || [])
    const contextual = !item.common_meaning && item.contextual_meaning
      ? projectVocabulary(item, byEntry.get(Number(item.id)) || []).contextual_meaning : ''
    return { ...item, contextual_meaning: contextual, is_frequent: Boolean(item.is_frequent) }
  }), counts, scope_key: profileOnly ? `profile:${values[0]}` : 'all' }
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

export async function reviewVocabulary(id: number, rating: string, mode = 'scheduled', expectedRevision?: string): Promise<JsonRecord> {
  return transaction(async db => {
    const current = await reviewState(id, db)
    if (expectedRevision !== undefined && expectedRevision !== reviewRevision(current)) {
      throw new LocalApiError(409, '复习记录已更新，请刷新当前单词后重新评分')
    }
    return applyVocabularyReview(id, rating, mode, current, db)
  })
}

async function applyVocabularyReview(id: number, rating: string, mode = 'scheduled', current?: JsonRecord, db?: TransactionDb): Promise<JsonRecord> {
  if (!['again', 'hard', 'know', 'fluent'].includes(rating)) throw new LocalApiError(400, '无效的复习评价')
  if (!['scheduled', 'reinforcement'].includes(mode)) throw new LocalApiError(400, '无效的复习模式')
  const entry = current || await reviewState(id, db)
  const now = new Date()
  if (mode === 'reinforcement') {
    await reviewRun(db,
      "INSERT INTO vocabulary_reviews (entry_id, rating, mode, next_review_at, sync_id, updated_at) VALUES (?, ?, 'reinforcement', ?, lower(hex(randomblob(16))), CURRENT_TIMESTAMP)",
      [id, rating, now.toISOString()],
    )
    return reviewAckOf(await reviewState(id, db))
  }
  let stage = Math.max(0, Math.min(7, Number(entry.review_stage || 0)))
  stage = rating === 'again' ? 0 : rating === 'hard' ? Math.max(0, stage - 1) : rating === 'know' ? Math.min(7, stage + 1) : Math.min(7, stage + 2)
  const delays = [10 / 1440, 1, 3, 7, 14, 30, 60, 120]
  const next = new Date(now.getTime() + delays[stage] * 86400000).toISOString()
  await reviewRun(db,
    `UPDATE vocabulary_entries SET review_stage = ?, last_result = ?, study_status = ?, lapse_count = lapse_count + ?,
      last_reviewed_at = ?, next_review_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [stage, rating, rating === 'fluent' ? 'mastered' : 'learning', rating === 'again' ? 1 : 0, now.toISOString(), next, id],
  )
  await reviewRun(db,
    "INSERT INTO vocabulary_reviews (entry_id, rating, mode, next_review_at, sync_id, updated_at) VALUES (?, ?, 'scheduled', ?, lower(hex(randomblob(16))), CURRENT_TIMESTAMP)",
    [id, rating, next],
  )
  return reviewAckOf(await reviewState(id, db))
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
