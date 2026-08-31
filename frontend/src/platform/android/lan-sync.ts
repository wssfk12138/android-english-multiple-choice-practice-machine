import { CapacitorHttp } from '@capacitor/core'
import { row, rows, run, transaction } from './database'
import { LocalApiError } from './errors'
import { unreferencedRemoteSessionIds } from './lan-sync-compat'
import {
  validateLanSyncHandshakeResponse,
  validateLanSyncPullResponse,
  validateLanSyncPushResponse,
} from './lan-sync-validation'
import {
  buildSerializationLookup,
  lookupProfile,
  lookupStableKey,
  type SerializationLookup,
  type SerializationReferenceRow,
  type SyncReferenceKind,
} from './lan-sync-serialization'

type JsonRecord = Record<string, any>
type QueryDb = {
  query: (statement: string, values?: unknown[]) => Promise<{ values?: any[] }>
  run: (statement: string, values?: unknown[], transaction?: boolean) => Promise<any>
}

export const LAN_SYNC_TABLES = [
  'practice_sessions',
  'practice_answers',
  'practice_answer_events',
  'practice_unit_submissions',
  'wrong_stats',
  'wrong_retry_rounds',
  'wrong_retry_round_questions',
  'wrong_current_questions',
  'vocabulary_entries',
  'vocabulary_occurrences',
  'vocabulary_reviews',
  'ai_profiles',
]

const GLOBAL_TABLES = new Set(['vocabulary_entries', 'vocabulary_reviews', 'ai_profiles'])

const LOGICAL_KEYS: Record<string, string[]> = {
  practice_answers: ['session_id', 'question_id'],
  practice_unit_submissions: ['session_id', 'unit_id'],
  wrong_retry_rounds: ['unit_id', 'round_number'],
  wrong_retry_round_questions: ['round_id', 'question_id'],
  wrong_current_questions: ['unit_id', 'question_id'],
}

const REQUIRED_REFS: Record<string, string[]> = {
  practice_answers: ['session_id', 'question_id'],
  practice_answer_events: ['session_id', 'question_id'],
  practice_unit_submissions: ['session_id', 'unit_id'],
  wrong_stats: ['question_id'],
  wrong_retry_rounds: ['unit_id', 'session_id'],
  wrong_retry_round_questions: ['round_id', 'question_id'],
  wrong_current_questions: ['unit_id', 'question_id'],
  vocabulary_occurrences: ['entry_id'],
  vocabulary_reviews: ['entry_id'],
}

async function queryRow<T>(db: QueryDb, statement: string, values: unknown[] = []): Promise<T | null> {
  const result = await db.query(statement, values)
  return (result.values?.[0] as T | undefined) || null
}

function baseUrl(raw: string): string {
  const value = String(raw || '').trim()
  if (!value) throw new LocalApiError(400, '请先填写电脑端局域网地址')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new LocalApiError(422, '电脑端局域网地址格式不正确')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LocalApiError(422, '同步地址只允许使用 HTTP 或 HTTPS')
  }
  return url.toString().replace(/\/+$/, '')
}

export async function lanSyncStatus(): Promise<JsonRecord> {
  return {
    configured: Boolean(await syncSetting('lan_sync_host')),
    host: await syncSetting('lan_sync_host'),
    auto: (await syncSetting('lan_sync_auto')) === '1',
    tables: LAN_SYNC_TABLES,
    last_sync_at: await syncSetting('lan_sync_last_at'),
  }
}

export async function updateLanSyncSettings(body: JsonRecord): Promise<JsonRecord> {
  if ('lan_sync_host' in body && String(body.lan_sync_host || '').trim()) {
    body.lan_sync_host = baseUrl(String(body.lan_sync_host))
  }
  for (const key of ['lan_sync_host', 'lan_sync_passcode', 'lan_sync_auto']) {
    if (!(key in body)) continue
    await run(
      `INSERT INTO app_settings(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, String(body[key] ?? '').trim()],
    )
  }
  return lanSyncStatus()
}

async function syncSetting(key: string): Promise<string> {
  const existing = await row<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key],
  )
  return existing?.value || ''
}

async function setSyncSetting(key: string, value: string): Promise<void> {
  await run(
    `INSERT INTO app_settings(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  )
}

async function ensureDeviceId(): Promise<string> {
  let id = await syncSetting('lan_sync_device_id')
  if (!id) {
    id = `android-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    await setSyncSetting('lan_sync_device_id', id)
  }
  return id
}

export async function localProfileNames(): Promise<string[]> {
  const items = await rows<{ name: string }>(
    'SELECT name FROM question_bank_profiles WHERE deleted_at IS NULL ORDER BY id',
  )
  return items.map(item => String(item.name)).filter(name => name)
}

async function handshake(): Promise<{ token: string; base: string; profileFingerprint: string }> {
  const host = await syncSetting('lan_sync_host')
  const passcode = await syncSetting('lan_sync_passcode')
  const base = baseUrl(host)
  const deviceId = await ensureDeviceId()
  const profiles = await localProfileNames()
  let response
  try {
    response = await CapacitorHttp.post({
      url: `${base}/api/lan-sync/handshake`,
      headers: { 'Content-Type': 'application/json' },
      data: { passcode, device_id: deviceId, profile_names: profiles },
      connectTimeout: 10000,
      readTimeout: 15000,
    })
  } catch (cause) {
    throw new LocalApiError(503, `无法连接电脑端同步服务 ${base}：${String(cause)}`)
  }
  if (response.status !== 200) {
    throw new LocalApiError(401, '同步口令不正确或电脑端同步服务未开启')
  }
  const { token } = validateLanSyncHandshakeResponse(response.data, LAN_SYNC_TABLES)
  return { token, base, profileFingerprint: JSON.stringify([...profiles].sort()) }
}

function parseUnitIds(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map(item => Number(item)).filter(item => Number.isFinite(item))
  }
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return parsed.map((item: unknown) => Number(item)).filter(item => Number.isFinite(item))
      }
    } catch {
      // fall through
    }
  }
  return []
}

async function localId(
  kind: string,
  stableKey: string,
  profileName = '',
  db?: QueryDb,
): Promise<number | null> {
  if (!stableKey) return null
  if (kind === 'paper' || kind === 'unit' || kind === 'question') {
    const joins = kind === 'paper'
      ? 'papers pa JOIN question_bank_profiles p ON p.id = pa.profile_id'
      : kind === 'unit'
        ? 'units u JOIN papers pa ON pa.id = u.paper_id JOIN question_bank_profiles p ON p.id = pa.profile_id'
        : 'questions q JOIN units u ON u.id = q.unit_id JOIN papers pa ON pa.id = u.paper_id JOIN question_bank_profiles p ON p.id = pa.profile_id'
    const keyColumn = kind === 'paper' ? 'pa.external_key' : kind === 'unit' ? 'u.external_key' : 'q.external_key'
    const idColumn = kind === 'paper' ? 'pa.id' : kind === 'unit' ? 'u.id' : 'q.id'
    const statement = `SELECT ${idColumn} AS id FROM ${joins}
      WHERE ${keyColumn} = ? AND pa.deleted_at IS NULL AND p.deleted_at IS NULL
        AND (? = '' OR p.name = ?)
      ORDER BY ${idColumn} LIMIT 2`
    const result = db
      ? await db.query(statement, [stableKey, profileName, profileName])
      : { values: await rows<{ id: number }>(statement, [stableKey, profileName, profileName]) }
    const candidates = result.values || []
    if (candidates.length > 1) {
      throw new Error(`${kind} stable key ${stableKey} conflicts in profile ${profileName || '<unspecified>'}`)
    }
    return candidates.length ? Number(candidates[0].id) : null
  }
  const find = async <T>(statement: string, values: unknown[]) => db
    ? await queryRow<T>(db, statement, values)
    : await row<T>(statement, values)
  if (kind === 'session') {
    const found = await find<{ id: number }>(
      `SELECT id FROM practice_sessions WHERE sync_id = ?
       UNION ALL
       SELECT p.id FROM sync_id_aliases a
       JOIN practice_sessions p ON p.sync_id = a.canonical_sync_id
       WHERE a.table_name = 'practice_sessions' AND a.alias_sync_id = ?
       LIMIT 1`,
      [stableKey, stableKey],
    )
    return found ? Number(found.id) : null
  }
  if (kind === 'round') {
    const found = await find<{ id: number }>(
      `SELECT id FROM wrong_retry_rounds WHERE sync_id = ?
       UNION ALL
       SELECT r.id FROM sync_id_aliases a
       JOIN wrong_retry_rounds r ON r.sync_id = a.canonical_sync_id
       WHERE a.table_name = 'wrong_retry_rounds' AND a.alias_sync_id = ?
       LIMIT 1`,
      [stableKey, stableKey],
    )
    return found ? Number(found.id) : null
  }
  if (kind === 'entry') {
    const found = await find<{ id: number }>(
      'SELECT id FROM vocabulary_entries WHERE normalized_term = ? LIMIT 1',
      [stableKey],
    )
    return found ? Number(found.id) : null
  }
  return null
}

async function stableKey(
  kind: SyncReferenceKind,
  localIdValue: number | null,
  lookup?: SerializationLookup,
): Promise<string> {
  if (localIdValue == null) return ''
  if (lookup) return lookupStableKey(lookup, kind, localIdValue)
  if (kind === 'paper') {
    const found = await row<{ external_key: string }>(
      'SELECT external_key FROM papers WHERE id = ?',
      [localIdValue],
    )
    return found?.external_key || ''
  }
  if (kind === 'unit') {
    const found = await row<{ external_key: string }>(
      'SELECT external_key FROM units WHERE id = ?',
      [localIdValue],
    )
    return found?.external_key || ''
  }
  if (kind === 'question') {
    const found = await row<{ external_key: string }>(
      'SELECT external_key FROM questions WHERE id = ?',
      [localIdValue],
    )
    return found?.external_key || ''
  }
  if (kind === 'session') {
    const found = await row<{ sync_id: string }>(
      'SELECT sync_id FROM practice_sessions WHERE id = ?',
      [localIdValue],
    )
    return found?.sync_id || ''
  }
  if (kind === 'round') {
    const found = await row<{ sync_id: string }>(
      'SELECT sync_id FROM wrong_retry_rounds WHERE id = ?',
      [localIdValue],
    )
    return found?.sync_id || ''
  }
  if (kind === 'entry') {
    const found = await row<{ normalized_term: string }>(
      'SELECT normalized_term FROM vocabulary_entries WHERE id = ?',
      [localIdValue],
    )
    return found?.normalized_term || ''
  }
  return ''
}

async function profileFor(
  kind: 'paper' | 'unit' | 'question',
  localIdValue: number | null,
  lookup?: SerializationLookup,
): Promise<string> {
  if (localIdValue == null) return ''
  if (lookup) return lookupProfile(lookup, kind, localIdValue)
  if (kind === 'paper') {
    const found = await row<{ name: string }>(
      `SELECT p.name FROM question_bank_profiles p
       JOIN papers pa ON pa.profile_id = p.id WHERE pa.id = ?`,
      [localIdValue],
    )
    return found?.name || ''
  }
  if (kind === 'unit') {
    const found = await row<{ name: string }>(
      `SELECT p.name FROM question_bank_profiles p
       JOIN papers pa ON pa.profile_id = p.id
       JOIN units u ON u.paper_id = pa.id WHERE u.id = ?`,
      [localIdValue],
    )
    return found?.name || ''
  }
  if (kind === 'question') {
    const found = await row<{ name: string }>(
      `SELECT p.name FROM question_bank_profiles p
       JOIN papers pa ON pa.profile_id = p.id
       JOIN units u ON u.paper_id = pa.id
       JOIN questions q ON q.unit_id = u.id WHERE q.id = ?`,
      [localIdValue],
    )
    return found?.name || ''
  }
  return ''
}

async function rowProfile(
  table: string,
  item: JsonRecord,
  lookup?: SerializationLookup,
): Promise<string> {
  if (GLOBAL_TABLES.has(table)) return ''
  if (table === 'practice_sessions') {
    let profile = await profileFor('paper', item.paper_id == null ? null : Number(item.paper_id), lookup)
    if (profile) return profile
    const ids = parseUnitIds(item.unit_ids)
    return ids.length ? await profileFor('unit', ids[0], lookup) : ''
  }
  if (table === 'practice_answers' || table === 'practice_answer_events') {
    return await profileFor('question', item.question_id == null ? null : Number(item.question_id), lookup)
  }
  if (table === 'practice_unit_submissions' || table === 'wrong_retry_rounds' || table === 'wrong_current_questions') {
    return await profileFor('unit', item.unit_id == null ? null : Number(item.unit_id), lookup)
  }
  if (table === 'wrong_stats' || table === 'wrong_retry_round_questions') {
    return await profileFor('question', item.question_id == null ? null : Number(item.question_id), lookup)
  }
  if (table === 'vocabulary_occurrences') {
    let profile = await profileFor('unit', item.unit_id == null ? null : Number(item.unit_id), lookup)
    if (profile) return profile
    return await profileFor('question', item.question_id == null ? null : Number(item.question_id), lookup)
  }
  return ''
}

async function queryOne(db: QueryDb | null, statement: string, values: unknown[] = []): Promise<JsonRecord | null> {
  if (db) {
    const result = await db.query(statement, values)
    return (result.values?.[0] as JsonRecord | undefined) || null
  }
  return row<JsonRecord>(statement, values)
}

async function exec(db: QueryDb | null, statement: string, values: unknown[] = []): Promise<void> {
  if (db) {
    await db.run(statement, values, false)
  } else {
    await run(statement, values)
  }
}

async function recordTombstone(
  db: QueryDb | null,
  table: string,
  objectKey: string,
  profileName: string,
): Promise<void> {
  if (!objectKey) return
  await exec(
    db,
    `INSERT INTO sync_tombstones(table_name, object_key, profile_name, deleted_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(table_name, object_key, profile_name)
     DO UPDATE SET deleted_at = CURRENT_TIMESTAMP`,
    [table, objectKey, profileName || ''],
  )
}

async function recordVocabularyDeleteTombstones(
  db: QueryDb | null,
  normalizedTerm: string,
  profileName = '',
): Promise<void> {
  const entry = await queryOne(
    db,
    'SELECT id FROM vocabulary_entries WHERE normalized_term = ? LIMIT 1',
    [normalizedTerm],
  )
  await recordTombstone(db, 'vocabulary_entries', normalizedTerm, profileName)
  if (!entry) return
  const entryId = Number(entry.id)
  const occurrences = await (db
    ? db.query('SELECT sync_id, unit_id, question_id FROM vocabulary_occurrences WHERE entry_id = ?', [entryId])
    : Promise.resolve({ values: await rows<JsonRecord>('SELECT sync_id, unit_id, question_id FROM vocabulary_occurrences WHERE entry_id = ?', [entryId]) }))
  for (const occ of occurrences.values || []) {
    let occProfile = profileName || await profileFor('unit', occ.unit_id == null ? null : Number(occ.unit_id))
    if (!occProfile) occProfile = await profileFor('question', occ.question_id == null ? null : Number(occ.question_id))
    await recordTombstone(db, 'vocabulary_occurrences', String(occ.sync_id || ''), occProfile)
  }
  const reviews = await (db
    ? db.query('SELECT sync_id FROM vocabulary_reviews WHERE entry_id = ?', [entryId])
    : Promise.resolve({ values: await rows<JsonRecord>('SELECT sync_id FROM vocabulary_reviews WHERE entry_id = ?', [entryId]) }))
  for (const review of reviews.values || []) {
    await recordTombstone(db, 'vocabulary_reviews', String(review.sync_id || ''), '')
  }
}

async function syncRow(db: QueryDb, table: string, syncId: string): Promise<JsonRecord | null> {
  if (!syncId) return null
  return await queryRow<JsonRecord>(
    db,
    `SELECT rowid AS _rowid, updated_at, sync_id FROM ${table}
     WHERE sync_id = COALESCE(
       (SELECT canonical_sync_id FROM sync_id_aliases
        WHERE table_name = ? AND alias_sync_id = ? LIMIT 1),
       ?
     ) LIMIT 1`,
    [table, syncId, syncId],
  )
}

async function recordSyncAlias(db: QueryDb, table: string, alias: string, canonical: string): Promise<void> {
  if (!alias || !canonical || alias === canonical) return
  await exec(
    db,
    `INSERT INTO sync_id_aliases(table_name, alias_sync_id, canonical_sync_id)
     VALUES (?, ?, ?)
     ON CONFLICT(table_name, alias_sync_id)
     DO UPDATE SET canonical_sync_id = excluded.canonical_sync_id`,
    [table, alias, canonical],
  )
}

async function localUpdatedAt(db: QueryDb, table: string, objectKey: string): Promise<string> {
  if (table === 'vocabulary_entries') {
    const found = await queryRow<{ updated_at: string }>(db,
      'SELECT updated_at FROM vocabulary_entries WHERE normalized_term = ? LIMIT 1',
      [objectKey],
    )
    return found?.updated_at || ''
  }
  if (table === 'ai_profiles') {
    const found = await queryRow<{ updated_at: string }>(db,
      'SELECT updated_at FROM ai_profiles WHERE name = ? LIMIT 1',
      [objectKey],
    )
    return found?.updated_at || ''
  }
  if (table === 'wrong_stats') {
    const found = await queryRow<{ updated_at: string }>(db,
      `SELECT updated_at FROM wrong_stats WHERE question_id =
       (SELECT id FROM questions WHERE external_key = ?) LIMIT 1`,
      [objectKey],
    )
    return found?.updated_at || ''
  }
  const found = await syncRow(db, table, objectKey)
  return found?.updated_at || ''
}

async function canonicalObjectKey(db: QueryDb, table: string, objectKey: string): Promise<string> {
  if (table === 'vocabulary_entries' || table === 'ai_profiles' || table === 'wrong_stats') {
    return objectKey
  }
  const alias = await queryRow<{ canonical_sync_id: string }>(
    db,
    `SELECT canonical_sync_id FROM sync_id_aliases
     WHERE table_name = ? AND alias_sync_id = ? LIMIT 1`,
    [table, objectKey],
  )
  return alias?.canonical_sync_id || objectKey
}

async function deleteLocalRow(db: QueryDb, table: string, objectKey: string): Promise<void> {
  if (table === 'vocabulary_entries') {
    await exec(db, 'DELETE FROM vocabulary_entries WHERE normalized_term = ?', [objectKey])
  } else if (table === 'ai_profiles') {
    await exec(db, 'DELETE FROM ai_profiles WHERE name = ?', [objectKey])
  } else if (table === 'wrong_stats') {
    await exec(db, 'DELETE FROM wrong_stats WHERE question_id = (SELECT id FROM questions WHERE external_key = ?)', [objectKey])
  } else {
    const found = await syncRow(db, table, objectKey)
    if (found) await exec(db, `DELETE FROM ${table} WHERE rowid = ?`, [found._rowid])
  }
}

async function applyTombstone(db: QueryDb, tombstone: JsonRecord): Promise<void> {
  const table = String(tombstone.table_name || '')
  const objectKey = String(tombstone.object_key || '')
  const profileName = String(tombstone.profile_name || '')
  const deletedAt = String(tombstone.deleted_at || '')
  if (!LAN_SYNC_TABLES.includes(table) || !objectKey) return
  const canonicalKey = await canonicalObjectKey(db, table, objectKey)
  const localTs = await localUpdatedAt(db, table, canonicalKey)
  if (!deletedAt || !localTs || deletedAt >= localTs) {
    if (table === 'vocabulary_entries') {
      await recordVocabularyDeleteTombstones(db, canonicalKey, profileName)
    }
    await deleteLocalRow(db, table, canonicalKey)
  }
  await recordTombstone(db, table, canonicalKey, profileName)
}

async function serializeLocalRow(
  table: string,
  item: JsonRecord,
  lookup: SerializationLookup,
): Promise<JsonRecord> {
  const payload: JsonRecord = { ...item }
  const resolve = async (kind: string, idValue: number | null) =>
    (await stableKey(kind as SyncReferenceKind, idValue == null ? null : Number(idValue), lookup))
  if (table === 'practice_sessions') {
    payload.paper_id_key = await resolve('paper', item.paper_id)
    payload.unit_ids_keys = []
    const unitIds = parseUnitIds(item.unit_ids)
    for (const id of unitIds) {
      const key = await stableKey('unit', id, lookup)
      if (!key) {
        throw new Error(
          `practice_sessions unit reference cannot be serialized; session=${String(item.sync_id || item.id || '<unknown>')}; missing=1`,
        )
      }
      payload.unit_ids_keys.push(key)
    }
    if (payload.unit_ids_keys.length !== unitIds.length) {
      throw new Error(
        `practice_sessions unit references are incomplete; session=${String(item.sync_id || item.id || '<unknown>')}; missing=${unitIds.length - payload.unit_ids_keys.length}`,
      )
    }
  } else if (table === 'practice_answers' || table === 'practice_answer_events') {
    payload.session_id_key = await resolve('session', item.session_id)
    payload.question_id_key = await resolve('question', item.question_id)
  } else if (table === 'practice_unit_submissions') {
    payload.session_id_key = await resolve('session', item.session_id)
    payload.unit_id_key = await resolve('unit', item.unit_id)
  } else if (table === 'wrong_stats') {
    payload.question_id_key = await resolve('question', item.question_id)
    payload.question_external_key = await resolve('question', item.question_id)
  } else if (table === 'wrong_retry_rounds') {
    payload.unit_id_key = await resolve('unit', item.unit_id)
    payload.session_id_key = await resolve('session', item.session_id)
  } else if (table === 'wrong_retry_round_questions') {
    payload.round_id_key = await resolve('round', item.round_id)
    payload.question_id_key = await resolve('question', item.question_id)
  } else if (table === 'wrong_current_questions') {
    payload.unit_id_key = await resolve('unit', item.unit_id)
    payload.question_id_key = await resolve('question', item.question_id)
    payload.since_round_id_key = await resolve('round', item.since_round_id)
  } else if (table === 'vocabulary_occurrences') {
    payload.entry_id_key = await resolve('entry', item.entry_id)
    payload.unit_id_key = await resolve('unit', item.unit_id)
    payload.question_id_key = await resolve('question', item.question_id)
  } else if (table === 'vocabulary_reviews') {
    payload.entry_id_key = await resolve('entry', item.entry_id)
  }
  payload.profile_name = await rowProfile(table, item, lookup)
  return payload
}

async function loadSerializationLookup(): Promise<SerializationLookup> {
  const paper = await rows<SerializationReferenceRow>(
    `SELECT pa.id, pa.external_key AS stable_key, p.name AS profile_name
     FROM papers pa JOIN question_bank_profiles p ON p.id = pa.profile_id`,
  )
  const unit = await rows<SerializationReferenceRow>(
    `SELECT u.id, u.external_key AS stable_key, p.name AS profile_name
     FROM units u JOIN papers pa ON pa.id = u.paper_id
     JOIN question_bank_profiles p ON p.id = pa.profile_id`,
  )
  const question = await rows<SerializationReferenceRow>(
    `SELECT q.id, q.external_key AS stable_key, p.name AS profile_name
     FROM questions q JOIN units u ON u.id = q.unit_id
     JOIN papers pa ON pa.id = u.paper_id
     JOIN question_bank_profiles p ON p.id = pa.profile_id`,
  )
  const session = await rows<SerializationReferenceRow>(
    'SELECT id, sync_id AS stable_key FROM practice_sessions',
  )
  const round = await rows<SerializationReferenceRow>(
    'SELECT id, sync_id AS stable_key FROM wrong_retry_rounds',
  )
  const entry = await rows<SerializationReferenceRow>(
    'SELECT id, normalized_term AS stable_key FROM vocabulary_entries',
  )
  return buildSerializationLookup({ paper, unit, question, session, round, entry })
}

type SyncCursor = Record<string, { updated_at: string, rowid: number }>

function parseCursor(raw: string): SyncCursor {
  try {
    const value = JSON.parse(raw || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function parseTombstoneCursor(raw: string): { deleted_at?: string, rowid?: number } {
  try {
    const value = JSON.parse(raw || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

async function collectLocalChanges(cursor: SyncCursor): Promise<{
  changes: Record<string, JsonRecord[]>
  cursor: SyncCursor
}> {
  const changes: Record<string, JsonRecord[]> = {}
  const nextCursor: SyncCursor = { ...cursor }
  const profileNames = await localProfileNames()
  const lookup = await loadSerializationLookup()
  const profiles = new Set(profileNames)
  for (const table of LAN_SYNC_TABLES) {
    const watermark = cursor[table] || { updated_at: '', rowid: 0 }
    const items = await rows<JsonRecord>(
      `SELECT rowid AS _sync_rowid, * FROM ${table}
       WHERE updated_at > ? OR (updated_at = ? AND rowid > ?)
       ORDER BY updated_at, rowid`,
      [watermark.updated_at || '', watermark.updated_at || '', Number(watermark.rowid || 0)],
    )
    const serialized: JsonRecord[] = []
    for (const item of items) {
      const payload = await serializeLocalRow(table, item, lookup)
      const profile = String(payload.profile_name || '')
      if (!profile || profiles.has(profile)) {
        serialized.push(payload)
        nextCursor[table] = {
          updated_at: String(item.updated_at || ''),
          rowid: Number(item._sync_rowid || 0),
        }
      }
    }
    changes[table] = serialized
  }
  return { changes, cursor: nextCursor }
}

async function recoverPaperSessionUnitIds(
  db: QueryDb,
  payload: JsonRecord,
  profileName: string,
  resolvedIds: Array<number | null>,
): Promise<number[] | null> {
  const expectedCount = resolvedIds.length
  if (String(payload.mode || '') !== 'paper' || !String(payload.paper_id_key || '') || expectedCount < 1) {
    return null
  }
  const paperId = await localId('paper', String(payload.paper_id_key), profileName, db)
  if (paperId == null) return null
  const result = await db.query(
    `SELECT id FROM units WHERE paper_id = ? ORDER BY sequence, id`,
    [paperId],
  )
  const ids = (result.values || []).map(item => Number(item.id)).filter(Number.isFinite)
  if (ids.length !== expectedCount) return null
  return resolvedIds.every((resolvedId, index) => resolvedId == null || resolvedId === ids[index])
    ? ids
    : null
}

async function collectLocalTombstones(cursor: { deleted_at?: string, rowid?: number }): Promise<{
  tombstones: JsonRecord[]
  cursor: { deleted_at?: string, rowid?: number }
}> {
  const profiles = new Set(await localProfileNames())
  const items = await rows<JsonRecord>(
    `SELECT rowid AS _sync_rowid, table_name, object_key, profile_name, deleted_at
     FROM sync_tombstones WHERE deleted_at > ? OR (deleted_at = ? AND rowid > ?)
     ORDER BY deleted_at, rowid`,
    [String(cursor.deleted_at || ''), String(cursor.deleted_at || ''), Number(cursor.rowid || 0)],
  )
  const visibleItems = items
    .filter(item => !String(item.profile_name || '') || profiles.has(String(item.profile_name || '')))
  const tombstones = visibleItems
    .map(item => ({
      table_name: String(item.table_name || ''),
      object_key: String(item.object_key || ''),
      profile_name: String(item.profile_name || ''),
      deleted_at: String(item.deleted_at || ''),
    }))
  const last = visibleItems.at(-1)
  return {
    tombstones,
    cursor: last ? { deleted_at: String(last.deleted_at || ''), rowid: Number(last._sync_rowid || 0) } : cursor,
  }
}

async function upsertRemoteRow(db: QueryDb, table: string, payload: JsonRecord): Promise<void> {
  const columnsResult = await db.query(`PRAGMA table_info(${table})`)
  const columns = columnsResult.values || []
  const columnNames = new Set<string>(columns.map((column: any) => String(column.name)))
  const updates: JsonRecord = {}
  const profileName = String(payload.profile_name || '')
  for (const column of columnNames) {
    const name = String(column)
    if (name === 'id') continue
    if (name === 'unit_ids') {
      const keys = payload.unit_ids_keys || []
      let ids = await Promise.all(keys.map((key: string) => localId('unit', String(key), profileName, db)))
      const missingCount = ids.filter(value => value == null).length
      if (missingCount) {
        const recovered = await recoverPaperSessionUnitIds(db, payload, profileName, ids)
        if (recovered) ids = recovered
        else {
          throw new Error(
            `practice_sessions.unit_ids contains an unresolved stable reference; session=${String(payload.sync_id || '<unknown>')}; profile=${profileName || '<unspecified>'}; missing=${missingCount}`,
          )
        }
      }
      updates[name] = JSON.stringify(ids)
      continue
    }
    const refColumn = `${name}_key`
    if (refColumn in payload) {
      const kind = refKind(table, name)
      updates[name] = kind
        ? await localId(kind, String(payload[refColumn] || ''), profileName, db)
        : payload[refColumn]
      continue
    }
    if (name in payload) updates[name] = payload[name]
  }
  if (!Object.keys(updates).length) return
  for (const required of REQUIRED_REFS[table] || []) {
    if (updates[required] == null) {
      throw new Error(`${table}.${required} cannot be resolved from its stable reference`)
    }
  }

  let existing: JsonRecord | null = null
  let remoteSyncId = ''
  if (columnNames.has('sync_id') && payload.sync_id) {
    remoteSyncId = String(payload.sync_id)
    existing = await syncRow(db, table, remoteSyncId)
    if (!existing && LOGICAL_KEYS[table]) {
      const logicalColumns = LOGICAL_KEYS[table]
      if (logicalColumns.every(column => updates[column] != null)) {
        existing = await queryRow<JsonRecord>(
          db,
          `SELECT rowid AS _rowid, updated_at, sync_id FROM ${table}
           WHERE ${logicalColumns.map(column => `${column} = ?`).join(' AND ')} LIMIT 1`,
          logicalColumns.map(column => updates[column]),
        )
      }
    }
    if (existing) {
      const canonical = String(existing.sync_id || remoteSyncId)
      await recordSyncAlias(db, table, remoteSyncId, canonical)
      updates.sync_id = canonical
    } else {
      updates.sync_id = remoteSyncId
    }
  } else if (table === 'vocabulary_entries' && payload.normalized_term) {
    existing = await queryRow<JsonRecord>(db,
      'SELECT rowid AS _rowid, updated_at FROM vocabulary_entries WHERE normalized_term = ? LIMIT 1',
      [payload.normalized_term])
  } else if (table === 'ai_profiles' && payload.name) {
    existing = await queryRow<JsonRecord>(db,
      'SELECT rowid AS _rowid, updated_at FROM ai_profiles WHERE name = ? LIMIT 1',
      [payload.name])
  } else if (table === 'wrong_stats' && payload.question_external_key) {
    const questionId = await localId('question', String(payload.question_external_key), profileName, db)
    if (questionId == null) throw new Error(`wrong_stats.question_id cannot be resolved`)
    updates.question_id = questionId
    existing = await queryRow<JsonRecord>(db,
      'SELECT rowid AS _rowid, updated_at FROM wrong_stats WHERE question_id = ? LIMIT 1',
      [questionId])
  } else {
    return
  }
  if (existing) {
    const localTs = String(existing.updated_at || '')
    const remoteTs = String(payload.updated_at || '')
    if (remoteTs && localTs && remoteTs <= localTs) return
    const setClause = Object.keys(updates).map(column => `${column} = ?`).join(', ')
    await db.run(
      `UPDATE ${table} SET ${setClause} WHERE rowid = ?`,
      [...Object.values(updates), existing._rowid],
      false,
    )
  } else {
    const placeholders = Object.keys(updates).map(() => '?').join(', ')
    await db.run(
      `INSERT INTO ${table} (${Object.keys(updates).join(', ')}) VALUES (${placeholders})`,
      Object.values(updates),
      false,
    )
  }
}

function isUnresolvedSessionUnitReference(error: unknown, syncId: string): boolean {
  if (!(error instanceof Error) || !syncId) return false
  return error.message.startsWith(
    `practice_sessions.unit_ids contains an unresolved stable reference; session=${syncId};`,
  )
}

async function localSessionHasLearningData(db: QueryDb, syncId: string): Promise<boolean> {
  const session = await syncRow(db, 'practice_sessions', syncId)
  if (!session) return false
  const sessionId = Number(session._rowid)
  if (!Number.isFinite(sessionId)) return true
  const found = await queryRow<{ has_learning_data: number }>(db,
    `SELECT (
       EXISTS(SELECT 1 FROM practice_answers WHERE session_id = ?)
       OR EXISTS(SELECT 1 FROM practice_answer_events WHERE session_id = ?)
       OR EXISTS(SELECT 1 FROM practice_unit_submissions WHERE session_id = ?)
       OR EXISTS(SELECT 1 FROM wrong_retry_rounds WHERE session_id = ?)
     ) AS has_learning_data`,
    [sessionId, sessionId, sessionId, sessionId],
  )
  return Number(found?.has_learning_data || 0) === 1
}

async function applyRemoteChanges(changes: Record<string, JsonRecord[]>, tombstones: JsonRecord[]): Promise<void> {
  const profiles = new Set(await localProfileNames())
  const emptyRemoteSessions = unreferencedRemoteSessionIds(changes)
  await transaction(async (db) => {
    for (const [table, items] of Object.entries(changes)) {
      if (!LAN_SYNC_TABLES.includes(table)) continue
      for (const payload of items) {
        const profile = String(payload.profile_name || '')
        if (profile && !profiles.has(profile)) continue
        try {
          await upsertRemoteRow(db, table, payload)
        } catch (error) {
          const syncId = String(payload.sync_id || '').trim()
          const maySkipEmptyOrphan = table === 'practice_sessions'
            && emptyRemoteSessions.has(syncId)
            && isUnresolvedSessionUnitReference(error, syncId)
          if (!maySkipEmptyOrphan || await localSessionHasLearningData(db, syncId)) throw error
        }
      }
    }
    for (const tombstone of tombstones) {
      const profile = String(tombstone.profile_name || '')
      if (profile && !profiles.has(profile)) continue
      await applyTombstone(db, tombstone)
    }
  })
}

function refKind(table: string, column: string): string | null {
  if (table === 'practice_sessions' && column === 'paper_id') return 'paper'
  if ((table === 'practice_answers' || table === 'practice_answer_events')
    && (column === 'session_id' || column === 'question_id')) {
    return column === 'session_id' ? 'session' : 'question'
  }
  if (table === 'practice_unit_submissions') {
    if (column === 'session_id') return 'session'
    if (column === 'unit_id') return 'unit'
  }
  if (table === 'wrong_stats' && column === 'question_id') return 'question'
  if (table === 'wrong_retry_rounds') {
    if (column === 'unit_id') return 'unit'
    if (column === 'session_id') return 'session'
  }
  if (table === 'wrong_retry_round_questions') {
    if (column === 'round_id') return 'round'
    if (column === 'question_id') return 'question'
  }
  if (table === 'wrong_current_questions') {
    if (column === 'unit_id') return 'unit'
    if (column === 'question_id') return 'question'
    if (column === 'since_round_id') return 'round'
  }
  if (table === 'vocabulary_occurrences') {
    if (column === 'entry_id') return 'entry'
    if (column === 'unit_id') return 'unit'
    if (column === 'question_id') return 'question'
  }
  if (table === 'vocabulary_reviews' && column === 'entry_id') return 'entry'
  return null
}

export async function runLanSync(): Promise<JsonRecord> {
  const { token, base, profileFingerprint } = await handshake()
  const profileChanged = profileFingerprint !== await syncSetting('lan_sync_cursor_profiles')
  const remoteCursor = profileChanged
    ? {}
    : parseCursor(await syncSetting('lan_sync_remote_cursor'))
  const remoteTombstoneCursor = profileChanged
    ? {}
    : parseTombstoneCursor(await syncSetting('lan_sync_remote_tombstone_cursor'))
  const pullResponse = await CapacitorHttp.post({
    url: `${base}/api/lan-sync/pull`,
    headers: { 'Content-Type': 'application/json' },
    data: {
      token,
      tables: LAN_SYNC_TABLES,
      cursor: remoteCursor,
      tombstone_cursor: remoteTombstoneCursor,
    },
    connectTimeout: 10000,
    readTimeout: 60000,
  })
  if (pullResponse.status !== 200) {
    throw new LocalApiError(502, `从电脑端拉取数据失败：${pullResponse.status}`)
  }
  const validatedPull = validateLanSyncPullResponse(pullResponse.data, LAN_SYNC_TABLES)
  const remoteChanges = validatedPull.changes
  const remoteTombstones = validatedPull.tombstones
  await applyRemoteChanges(remoteChanges, remoteTombstones)
  const localCursor = profileChanged
    ? {}
    : parseCursor(await syncSetting('lan_sync_local_cursor'))
  const localTombstoneCursor = profileChanged
    ? {}
    : parseTombstoneCursor(await syncSetting('lan_sync_local_tombstone_cursor'))
  const localBatch = await collectLocalChanges(localCursor)
  const localTombstoneBatch = await collectLocalTombstones(localTombstoneCursor)
  const pushResponse = await CapacitorHttp.post({
    url: `${base}/api/lan-sync/push`,
    headers: { 'Content-Type': 'application/json' },
    data: { token, changes: localBatch.changes, tombstones: localTombstoneBatch.tombstones },
    connectTimeout: 10000,
    readTimeout: 60000,
  })
  if (pushResponse.status !== 200) {
    throw new LocalApiError(502, `向电脑端推送数据失败：${pushResponse.status}`)
  }
  const applied = validateLanSyncPushResponse(pushResponse.data, LAN_SYNC_TABLES)
  await setSyncSetting('lan_sync_remote_cursor', JSON.stringify(validatedPull.cursor))
  await setSyncSetting('lan_sync_remote_tombstone_cursor', JSON.stringify(validatedPull.tombstone_cursor))
  await setSyncSetting('lan_sync_local_cursor', JSON.stringify(localBatch.cursor))
  await setSyncSetting('lan_sync_local_tombstone_cursor', JSON.stringify(localTombstoneBatch.cursor))
  await setSyncSetting('lan_sync_cursor_profiles', profileFingerprint)
  await setSyncSetting('lan_sync_last_at', new Date().toISOString())
  return {
    pulled: Object.fromEntries(
      Object.entries(remoteChanges).map(([table, items]) => [table, items.length]),
    ),
    pulled_tombstones: remoteTombstones.length,
    pushed: applied,
    pushed_tombstones: localTombstoneBatch.tombstones.length,
    last_sync_at: new Date().toISOString(),
  }
}

/**
 * Delete-site hooks: record tombstones so the deletion propagates. Callers
 * still perform the actual local DELETE afterwards.
 */
export async function tombstoneVocabularyEntry(id: number): Promise<void> {
  const entry = await row<{ normalized_term: string }>(
    'SELECT normalized_term FROM vocabulary_entries WHERE id = ?',
    [id],
  )
  if (!entry) return
  await recordVocabularyDeleteTombstones(null, String(entry.normalized_term), '')
}

export async function tombstoneAiProfile(name: string): Promise<void> {
  if (!name) return
  await recordTombstone(null, 'ai_profiles', name, '')
}

export async function tombstoneWrongUnit(unitId: number): Promise<void> {
  const current = await rows<{ sync_id: string }>(
    'SELECT sync_id FROM wrong_current_questions WHERE unit_id = ?',
    [unitId],
  )
  const rounds = await rows<{ sync_id: string }>(
    'SELECT sync_id FROM wrong_retry_rounds WHERE unit_id = ?',
    [unitId],
  )
  const roundIds = await rows<{ id: number }>(
    'SELECT id FROM wrong_retry_rounds WHERE unit_id = ?',
    [unitId],
  )
  const profile = await profileFor('unit', unitId)
  for (const item of current) {
    await recordTombstone(null, 'wrong_current_questions', String(item.sync_id || ''), profile)
  }
  for (const item of rounds) {
    await recordTombstone(null, 'wrong_retry_rounds', String(item.sync_id || ''), profile)
  }
  if (roundIds.length) {
    const roundQuestions = await rows<{ sync_id: string }>(
      `SELECT sync_id FROM wrong_retry_round_questions WHERE round_id IN (${roundIds.map(() => '?').join(',')})`,
      roundIds.map(item => Number(item.id)),
    )
    for (const item of roundQuestions) {
      await recordTombstone(null, 'wrong_retry_round_questions', String(item.sync_id || ''), profile)
    }
  }
}
