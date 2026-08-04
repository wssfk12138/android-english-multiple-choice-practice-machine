import { row, rows, run } from './database'
import { LocalApiError } from './errors'

type JsonRecord = Record<string, any>

function normalizeTerm(value: string): string {
  return value.trim().replaceAll('’', "'").replace(/\s+/g, ' ').toLowerCase()
}

function vocabularyKey(value: string): string {
  const normalized = normalizeTerm(value)
  if (normalized.includes(' ') || normalized.includes("'") || normalized.length < 5) return normalized
  if (normalized.endsWith('ies') && normalized.length > 5) return `${normalized.slice(0, -3)}y`
  if (normalized.endsWith('ing') && normalized.length > 6) {
    let stem = normalized.slice(0, -3)
    if (stem.length >= 3 && stem.at(-1) === stem.at(-2)) stem = stem.slice(0, -1)
    return stem
  }
  if (normalized.endsWith('ed') && normalized.length > 5) {
    let stem = normalized.slice(0, -2)
    if (stem.endsWith('i')) return `${stem.slice(0, -1)}y`
    if (stem.length >= 3 && stem.at(-1) === stem.at(-2)) stem = stem.slice(0, -1)
    return stem
  }
  if (normalized.endsWith('es') && normalized.length > 5) {
    return /(ses|xes|zes|ches|shes)$/.test(normalized)
      ? normalized.slice(0, -2)
      : normalized.slice(0, -1)
  }
  if (normalized.endsWith('s') && !normalized.endsWith('ss')) return normalized.slice(0, -1)
  return normalized
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
  const pool = await rows<{ id: number; term: string }>(
    'SELECT id, term FROM vocabulary_entries',
  )
  const own = pool.find(row => Number(row.id) === id)
  if (!own) return []
  const ownKey = matchKey(own.term)
  const excluded = new Set(excludeWords.map(word => word.toLowerCase()))
  const buckets = new Map<number, { id: number; key: string; term: string }[]>()
  for (const row of pool) {
    const key = matchKey(row.term)
    const bucket = buckets.get(key.length) || []
    bucket.push({ id: Number(row.id), key, term: row.term })
    buckets.set(key.length, bucket)
  }
  const candidates: { distance: number; term: string }[] = []
  for (let length = Math.max(1, ownKey.length - 2); length <= ownKey.length + 2; length++) {
    for (const item of buckets.get(length) || []) {
      if (item.id === id || excluded.has(item.term.toLowerCase())) continue
      if (Math.abs(item.key.length - ownKey.length) > 2) continue
      const distance = editDistance(ownKey, item.key)
      if (distance <= 2) candidates.push({ distance, term: item.term })
    }
  }
  candidates.sort((left, right) => left.distance - right.distance || left.term.localeCompare(right.term))
  return candidates.slice(0, 4).map(item => ({
    word: item.term,
    note: '本地匹配',
    source: '本地匹配',
  }))
}

async function serializeEntry(id: number): Promise<JsonRecord> {
  const entry = await row<JsonRecord>('SELECT * FROM vocabulary_entries WHERE id = ?', [id])
  if (!entry) throw new LocalApiError(404, '单词不存在')
  const synonyms = discriminationList(entry.synonyms)
  const antonyms = discriminationList(entry.antonyms)
  const similarForms = discriminationList(entry.similar_forms)
  return {
    ...entry,
    synonyms,
    antonyms,
    similar_forms: similarForms,
    local_similar: await localSimilarMatches(
      Number(entry.id),
      similarForms.map(item => item.word),
    ),
    is_frequent: Boolean(entry.manually_frequent) || Number(entry.encounter_count) >= 2,
    occurrences: await rows(
      'SELECT * FROM vocabulary_occurrences WHERE entry_id = ? ORDER BY id DESC',
      [id],
    ),
  }
}

export async function addVocabulary(body: JsonRecord): Promise<JsonRecord> {
  const term = validateTerm(String(body.term || ''))
  const normalized = vocabularyKey(term)
  const existing = await row<JsonRecord>(
    'SELECT * FROM vocabulary_entries WHERE normalized_term = ?',
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
      `INSERT INTO vocabulary_entries (term, normalized_term, translation_status)
       VALUES (?, ?, 'pending')`,
      [term, normalized],
    )
    id = Number(created.lastId)
  }
  await run(
    `INSERT INTO vocabulary_occurrences
      (entry_id, surface_form, context_sentence, context_before, context_after,
       unit_id, question_id, year, unit_title, unit_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ],
  )
  const entry = await serializeEntry(id)
  return {
    entry_id: id,
    is_new: isNew,
    encounter_count: entry.encounter_count,
    is_frequent: entry.is_frequent,
    translation_status: entry.translation_status,
  }
}

export async function listVocabulary(searchParams: URLSearchParams): Promise<JsonRecord> {
  const status = searchParams.get('status') || 'all'
  const search = searchParams.get('search') || ''
  const conditions = ['1 = 1']
  const values: unknown[] = []
  if (status === 'frequent') conditions.push('(encounter_count >= 2 OR manually_frequent = 1)')
  else if (status === 'review') {
    conditions.push("(next_review_at IS NULL OR next_review_at <= CURRENT_TIMESTAMP)")
    conditions.push("translation_status = 'ready'")
    conditions.push("study_status != 'mastered'")
  } else if (status === 'learning') conditions.push("study_status = 'learning'")
  else if (status === 'mastered') conditions.push("study_status = 'mastered'")
  else if (status === 'pending') conditions.push("translation_status != 'ready'")
  if (search.trim()) {
    conditions.push('(term LIKE ? OR lemma LIKE ? OR contextual_meaning LIKE ? OR common_meaning LIKE ?)')
    values.push(...Array(4).fill(`%${search.trim()}%`))
  }
  const items = await rows<JsonRecord>(
    `SELECT *,
       (SELECT context_sentence FROM vocabulary_occurrences
        WHERE entry_id = vocabulary_entries.id ORDER BY id DESC LIMIT 1) AS latest_sentence,
       CASE WHEN encounter_count >= 2 OR manually_frequent = 1 THEN 1 ELSE 0 END AS is_frequent
     FROM vocabulary_entries
     WHERE ${conditions.join(' AND ')}
     ORDER BY is_frequent DESC, encounter_count DESC, last_seen_at DESC`,
    values,
  )
  const counts = await row<JsonRecord>(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN encounter_count >= 2 OR manually_frequent = 1 THEN 1 ELSE 0 END), 0) AS frequent,
       COALESCE(SUM(CASE WHEN study_status = 'mastered' THEN 1 ELSE 0 END), 0) AS mastered,
       COALESCE(SUM(CASE WHEN translation_status != 'ready' THEN 1 ELSE 0 END), 0) AS pending,
       COALESCE(SUM(CASE WHEN translation_status = 'ready'
         AND study_status != 'mastered'
         AND (next_review_at IS NULL OR next_review_at <= CURRENT_TIMESTAMP)
       THEN 1 ELSE 0 END), 0) AS review
     FROM vocabulary_entries`,
  )
  return { items, counts }
}

export async function homeVocabulary(limit: number): Promise<JsonRecord> {
  const items = await rows<JsonRecord>(
    `SELECT id, term, lemma, contextual_meaning, common_meaning,
       encounter_count, study_status,
       CASE WHEN encounter_count >= 2 OR manually_frequent = 1 THEN 1 ELSE 0 END AS is_frequent
     FROM vocabulary_entries
     WHERE translation_status = 'ready'
     ORDER BY is_frequent DESC,
       CASE WHEN next_review_at IS NULL OR next_review_at <= CURRENT_TIMESTAMP THEN 0 ELSE 1 END,
       encounter_count DESC, RANDOM()
     LIMIT ?`,
    [Math.max(1, Math.min(limit, 50))],
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
    assignments.push('user_edited = 1', 'updated_at = CURRENT_TIMESTAMP')
    values.push(id)
    await run(`UPDATE vocabulary_entries SET ${assignments.join(', ')} WHERE id = ?`, values)
  }
  return serializeEntry(id)
}

export async function deleteVocabulary(id: number): Promise<{ ok: true }> {
  await run('DELETE FROM vocabulary_entries WHERE id = ?', [id])
  return { ok: true }
}

export async function retryVocabulary(id: number): Promise<{ ok: true }> {
  await run(
    `UPDATE vocabulary_entries SET translation_status = 'queued',
      translation_error = '', user_edited = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [id],
  )
  return { ok: true }
}

export async function reviewVocabulary(id: number, rating: string): Promise<JsonRecord> {
  const days = rating === 'again' ? 1 : rating === 'hard' ? 3 : 7
  const next = new Date(Date.now() + days * 86400000).toISOString()
  await run(
    `UPDATE vocabulary_entries SET study_status = ?, last_reviewed_at = ?,
      next_review_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [rating === 'mastered' ? 'mastered' : 'learning', new Date().toISOString(), next, id],
  )
  await run(
    'INSERT INTO vocabulary_reviews (entry_id, rating, next_review_at) VALUES (?, ?, ?)',
    [id, rating, next],
  )
  return serializeEntry(id)
}

export async function queueTranslations(entryIds: number[]): Promise<JsonRecord> {
  const ids = [...new Set(entryIds.map(Number).filter(id => id > 0))].slice(0, 100)
  if (ids.length) {
    await run(
      `UPDATE vocabulary_entries SET translation_status = 'queued',
        translation_error = '', updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${ids.map(() => '?').join(',')})
         AND user_edited = 0 AND translation_status IN ('pending','queued','failed')`,
      ids,
    )
  }
  return { accepted: true, queuedCount: ids.length }
}

export { serializeEntry }
