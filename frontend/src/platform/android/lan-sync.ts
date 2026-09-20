import { LanTransport, validateLanBaseUrl } from './lan-transport'
import { recoverLanAddress } from './lan-recovery'
import { CATEGORY_TABLES, DEFAULT_CATEGORIES, DEPENDENCY_TIMESTAMP, categoryAgreement, sessionDependency, validateCategories, validateCategoryBatch, type LanCategory } from './lan-categories'
import type { LanTlsIdentity } from './lan-transport'
import { validateTlsAddress, validateTlsIdentity, validateTlsPairing } from './lan-pairing'
import { row, rows, run, transaction } from './database'
import { invalidateAppSettings, readAppSetting, writeAppSetting } from './app-settings'
import { syncSequence, syncVersion } from './lan-sync-versions'
import { aggregateAttempts } from './attempt-stats'
import { LocalApiError } from './errors'
import { classifyLanSyncError, LanSyncError } from './lan-sync-errors'
import { secureStore } from '../secure-store'
import { unreferencedRemoteSessionIds } from './lan-sync-compat'
import {
  validateLanSyncHandshakeResponse,
  validateLanSyncPullResponse,
  validateLanSyncPushResponse,
} from './lan-sync-validation'
import {
  lookupProfile,
  lookupStableKey,
  type SerializationLookup,
  type SerializationReferenceRow,
  type SyncReferenceKind,
} from './lan-sync-serialization'

type JsonRecord = Record<string, any>
type TrustedHost = { tls: LanTlsIdentity; pairingToken: string; pairingCode: string; expiresAt: number }
let operationQueue: Promise<unknown> = Promise.resolve()

function serializeSync<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation)
  operationQueue = result.catch(() => undefined)
  return result
}

function trustedHostKey(hostId: string): string { return 'lan-sync-host-v2:' + hostId }

export function withLanQuestionBankSession<T>(hostId: string | undefined, operation: (session: {
  token: string; base: string; tls: LanTlsIdentity
}) => Promise<T>): Promise<T> {
  return serializeSync(async () => {
    const current = await syncSetting('lan_sync_host_id')
    if (!current || (hostId && current !== hostId)) throw new LocalApiError(409, '电脑绑定已变化，请刷新题库目录')
    const session = await handshake()
    if (!session.tls || !session.categories.includes('question_bank')) {
      throw new LocalApiError(403, '请在双方设备中启用题库权限，并开启电脑题库共享')
    }
    return operation({ token: session.token, base: session.base, tls: session.tls })
  })
}

async function readTrustedHost(hostId: string): Promise<TrustedHost> {
  const raw = await secureStore.get(trustedHostKey(hostId))
  if (!raw) throw new Error('安全同步主机身份缺失，请重新扫码')
  if (raw.length > 12000) throw new Error('安全同步主机身份损坏，请重新扫码')
  let value: TrustedHost
  try { value = JSON.parse(raw) as TrustedHost }
  catch { throw new Error('安全同步主机身份损坏，请重新扫码') }
  if (!value) throw new Error('安全同步主机身份损坏，请重新扫码')
  const tls = validateTlsIdentity(value.tls)
  if (tls.hostId !== hostId || typeof value.pairingToken !== 'string' || value.pairingToken.length > 256
    || typeof value.pairingCode !== 'string' || (value.pairingCode !== '' && !/^[A-Za-z0-9_-]{43}$/.test(value.pairingCode))
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt < 0) {
    throw new Error('安全同步主机身份损坏，请重新扫码')
  }
  return { ...value, tls }
}
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
    url = new URL(validateLanBaseUrl(value))
  } catch {
    throw new LocalApiError(422, '电脑端局域网地址格式不正确')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LocalApiError(422, '同步地址只允许使用 HTTP 或 HTTPS')
  }
  return url.toString().replace(/\/+$/, '')
}

export async function lanSyncStatus(): Promise<JsonRecord> {
  const scope = await categoryScope()
  return {
    categories: await selectedCategories(),
    effective_categories: JSON.parse(await syncSetting(scope + 'effective') || '[]'),
    configured: Boolean(await syncSetting('lan_sync_host')),
    host_id: await syncSetting('lan_sync_host_id'),
    host: await syncSetting('lan_sync_host'),
    auto: (await syncSetting('lan_sync_auto')) === '1',
    tables: LAN_SYNC_TABLES,
    last_sync_at: await syncSetting('lan_sync_last_at'),
  }
}

export async function updateLanSyncSettings(body: JsonRecord): Promise<JsonRecord> {
  return serializeSync(() => updateLanSyncSettingsInternal(body))
}

async function updateLanSyncSettingsInternal(body: JsonRecord): Promise<JsonRecord> {
  const categories = body.categories === undefined ? null : validateCategories(body.categories)
  const hostId = await syncSetting('lan_sync_host_id')
  if (body.pairing != null) {
    const pairing = validateTlsPairing(body.pairing)
    if (baseUrl(String(body.lan_sync_host)) !== pairing.host) throw new Error('安全同步地址与二维码不一致')
    const raw = await secureStore.get(trustedHostKey(pairing.tls.hostId))
    const previous = raw ? await readTrustedHost(pairing.tls.hostId) : null
    if (previous && previous.tls.certificatePin !== pairing.tls.certificatePin) {
      throw new Error('安全同步主机证书已变化，需明确恢复身份后重新配对')
    }
    await secureStore.set(trustedHostKey(pairing.tls.hostId), JSON.stringify({
      tls: pairing.tls, pairingToken: previous?.pairingToken || '',
      pairingCode: pairing.pairingCode, expiresAt: pairing.expiresAt,
    } satisfies TrustedHost))
    // Publish the identity pointer only after the complete secure record is durable.
    await transaction(async db => {
      for (const [key, value] of Object.entries({ lan_sync_host: pairing.host,
        lan_sync_host_id: pairing.tls.hostId, lan_sync_auto: String(body.lan_sync_auto ?? '0'),
        lan_sync_passcode: '', lan_sync_pairing_requested: '0', lan_sync_cursor_profiles: '' })) {
        await db.run('INSERT INTO app_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value], false)
      }
    })
    invalidateAppSettings()
    if (categories) await setSyncSetting(await categoryScope() + 'selected', JSON.stringify(categories))
    return lanSyncStatus()
  }
  if (hostId) {
    await readTrustedHost(hostId)
    if ('lan_sync_host' in body) body.lan_sync_host = validateTlsAddress(String(body.lan_sync_host))
    if (String(body.lan_sync_passcode ?? '').trim()) throw new Error('安全绑定需要重新扫码，不接受旧口令')
  }
  if ('lan_sync_host' in body && String(body.lan_sync_host || '').trim()) {
    body.lan_sync_host = baseUrl(String(body.lan_sync_host))
  }
  for (const key of ['lan_sync_host', 'lan_sync_passcode', 'lan_sync_auto']) {
    if (!(key in body)) continue
    if (key === 'lan_sync_passcode' && !String(body[key] ?? '').trim()) continue
    await writeAppSetting(key, String(body[key] ?? '').trim())
  }
  if (String(body.lan_sync_passcode ?? '').trim()) {
    await setSyncSetting('lan_sync_pairing_requested', '1')
  }
  if (categories) await setSyncSetting(await categoryScope() + 'selected', JSON.stringify(categories))
  return lanSyncStatus()
}

async function categoryScope(): Promise<string> {
  return 'lan_sync_categories_v1:' + (await syncSetting('lan_sync_host_id') || await syncSetting('lan_sync_host')) + ':'
}

async function selectedCategories(): Promise<LanCategory[]> {
  const raw = await syncSetting(await categoryScope() + 'selected')
  return raw ? validateCategories(JSON.parse(raw)) : [...DEFAULT_CATEGORIES]
}

async function syncSetting(key: string): Promise<string> {
  return readAppSetting(key)
}

async function setSyncSetting(key: string, value: string): Promise<void> {
  await writeAppSetting(key, value)
}

async function ensureDeviceId(): Promise<string> {
  let id = await syncSetting('lan_sync_device_id')
  if (!id) {
    id = `android-${crypto.randomUUID()}`
    await setSyncSetting('lan_sync_device_id', id)
  }
  return id
}

function pairingStorageKey(host: string): string {
  return `lan-sync-pairing-token:${encodeURIComponent(host).slice(0, 180)}`
}

async function loadPairingToken(host: string): Promise<string> {
  return String(await secureStore.get(pairingStorageKey(host)) || '')
}

async function savePairingToken(host: string, token: string | null): Promise<void> {
  if (token) await secureStore.set(pairingStorageKey(host), token)
  else await secureStore.remove(pairingStorageKey(host))
}

export async function localProfileNames(): Promise<string[]> {
  const items = await rows<{ name: string }>(
    'SELECT name FROM question_bank_profiles WHERE deleted_at IS NULL ORDER BY id',
  )
  return items.map(item => String(item.name)).filter(name => name)
}

async function handshake(): Promise<{ token: string; base: string; profileFingerprint: string; categories: LanCategory[]; tls?: LanTlsIdentity; modelKeys?: boolean; modelSnapshot?: boolean }> {
  const categories = await selectedCategories()
  const host = await syncSetting('lan_sync_host')
  const passcode = await syncSetting('lan_sync_passcode')
  let base = baseUrl(host)
  const deviceId = await ensureDeviceId()
  const profiles = await localProfileNames()
  const hostId = await syncSetting('lan_sync_host_id')
  if (hostId) {
    validateTlsAddress(base)
    const trusted = await readTrustedHost(hostId)
    const code = trusted.expiresAt * 1000 > Date.now() ? trusted.pairingCode : ''
    const request = (pairingToken: string, pairingCode: string, address = base) => LanTransport.post({
      url: address + '/api/lan-sync/handshake', tls: trusted.tls,
      data: { host_id: hostId, pairing_token: pairingToken, pairing_code: pairingCode,
        device_id: deviceId, profile_names: profiles, categories },
    })
    const recovered = await recoverLanAddress(base,
      address => request(trusted.pairingToken, trusted.pairingToken ? '' : code, address),
      () => LanTransport.discover({ hostId }))
    base = recovered.base
    let response = recovered.response
    if ([401, 403].includes(response.status) && trusted.pairingToken && code) response = await request('', code)
    if ([401, 403].includes(response.status)) {
      await secureStore.set(trustedHostKey(hostId), JSON.stringify({ ...trusted, pairingCode: '', expiresAt: 0 }))
      throw new LocalApiError(401, '安全绑定已失效或配对码已过期，请重新扫码')
    }
    if (response.status !== 200) throw new LocalApiError(response.status, '安全同步服务暂时不可用')
    const data = response.data as JsonRecord
    if (data?.host_id !== hostId || data?.version !== 2) throw new Error('安全同步主机身份不匹配')
    const { token, pairingToken } = validateLanSyncHandshakeResponse(data, LAN_SYNC_TABLES)
    const durableToken = pairingToken || trusted.pairingToken
    if (!durableToken) throw new Error('安全同步缺少绑定凭证，请重新扫码')
    await secureStore.set(trustedHostKey(hostId), JSON.stringify({
      tls: trusted.tls, pairingToken: durableToken, pairingCode: '', expiresAt: 0,
    } satisfies TrustedHost))
    if (base !== baseUrl(host)) await setSyncSetting('lan_sync_host', base)
    const effective = categoryAgreement(data, categories)
    await setSyncSetting(await categoryScope() + 'effective', JSON.stringify(effective))
    return { token, base, tls: trusted.tls, categories: effective, modelKeys: data.model_keys_version === 1, modelSnapshot: data.model_snapshot_version === 1,
      profileFingerprint: JSON.stringify([hostId, [...profiles].sort()]) }
  }
  const storedPairingToken = await loadPairingToken(base)
  const pairingRequested = (await syncSetting('lan_sync_pairing_requested')) === '1'
  let response = await LanTransport.post({
    url: `${base}/api/lan-sync/handshake`,
    data: {
      passcode: storedPairingToken || !pairingRequested ? '' : passcode,
      pairing_token: storedPairingToken,
      device_id: deviceId,
      profile_names: profiles,
      categories,
    },
  })
  if ((response.status === 401 || response.status === 403) && storedPairingToken && passcode && pairingRequested) {
    response = await LanTransport.post({
      url: `${base}/api/lan-sync/handshake`,
      data: { passcode, pairing_token: '', device_id: deviceId, profile_names: profiles, categories },
    })
  }
  if (response.status === 401 || response.status === 403) {
    await setSyncSetting('lan_sync_pairing_requested', '0')
    throw new LocalApiError(401, storedPairingToken
      ? '此设备绑定已失效，请输入电脑端当前口令重新绑定'
      : '首次绑定需要输入电脑端同步口令')
  }
  if (response.status !== 200) throw new LocalApiError(response.status, '电脑端同步服务暂时不可用，请检查地址和局域网连接')
  const { token, pairingToken } = validateLanSyncHandshakeResponse(response.data, LAN_SYNC_TABLES)
  if (pairingToken) await savePairingToken(base, pairingToken)
  await setSyncSetting('lan_sync_pairing_requested', '0')
  await setSyncSetting('lan_sync_passcode', '')
  const effective = categoryAgreement(response.data, categories)
  await setSyncSetting(await categoryScope() + 'effective', JSON.stringify(effective))
  return { token, base, categories: effective, profileFingerprint: JSON.stringify([...profiles].sort()) }
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
    const found = await vocabularySyncRow(db || null, stableKey)
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
  deletedAt: string | null = null,
): Promise<void> {
  if (!objectKey) return
  await exec(
    db,
    `INSERT INTO sync_tombstones(table_name, object_key, profile_name, deleted_at)
     VALUES (?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
     ON CONFLICT(table_name, object_key, profile_name)
     DO UPDATE SET deleted_at = excluded.deleted_at
     WHERE ? IS NULL OR excluded.deleted_at > sync_tombstones.deleted_at`,
    [table, objectKey, profileName || '', deletedAt, deletedAt],
  )
}

async function recordVocabularyDeleteTombstones(
  db: QueryDb | null,
  normalizedTerm: string,
  profileName = '',
  deletedAt: string | null = null,
): Promise<void> {
  const entry = await queryOne(
    db,
    'SELECT id FROM vocabulary_entries WHERE normalized_term = ? LIMIT 1',
    [normalizedTerm],
  )
  await recordTombstone(db, 'vocabulary_entries', normalizedTerm, profileName, deletedAt)
  const aliasSql = "SELECT alias_sync_id FROM sync_id_aliases WHERE table_name='vocabulary_entries' AND canonical_sync_id=?"
  const aliases = db ? (await db.query(aliasSql, [normalizedTerm])).values || [] : await rows<JsonRecord>(aliasSql, [normalizedTerm])
  for (const alias of aliases) await recordTombstone(db, 'vocabulary_entries', String(alias.alias_sync_id), profileName, deletedAt)
  if (!entry) return
  const entryId = Number(entry.id)
  const occurrences = await (db
    ? db.query('SELECT sync_id, unit_id, question_id FROM vocabulary_occurrences WHERE entry_id = ?', [entryId])
    : Promise.resolve({ values: await rows<JsonRecord>('SELECT sync_id, unit_id, question_id FROM vocabulary_occurrences WHERE entry_id = ?', [entryId]) }))
  for (const occ of occurrences.values || []) {
    let occProfile = profileName || await profileFor('unit', occ.unit_id == null ? null : Number(occ.unit_id))
    if (!occProfile) occProfile = await profileFor('question', occ.question_id == null ? null : Number(occ.question_id))
    await recordTombstone(db, 'vocabulary_occurrences', String(occ.sync_id || ''), occProfile, deletedAt)
  }
  const reviews = await (db
    ? db.query('SELECT sync_id FROM vocabulary_reviews WHERE entry_id = ?', [entryId])
    : Promise.resolve({ values: await rows<JsonRecord>('SELECT sync_id FROM vocabulary_reviews WHERE entry_id = ?', [entryId]) }))
  for (const review of reviews.values || []) {
    await recordTombstone(db, 'vocabulary_reviews', String(review.sync_id || ''), '', deletedAt)
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


// Identity aliases are local references, never lemma/stem equivalence.
function entrySurface(value: unknown): string {
  return String(value || '').trim().replaceAll('’', "'").replace(/\s+/g, ' ').toLowerCase()
}

async function vocabularySyncRow(db: QueryDb | null, key: string, term?: string): Promise<JsonRecord | null> {
  const alias = await queryOne(db,
    "SELECT canonical_sync_id FROM sync_id_aliases WHERE table_name='vocabulary_entries' AND alias_sync_id=?", [key])
  const canonical = String(alias?.canonical_sync_id || key)
  let found = await queryOne(db, 'SELECT rowid AS _rowid, * FROM vocabulary_entries WHERE normalized_term=?', [canonical])
  const surface = term === undefined ? (key.startsWith('surface:v1:') ? key.slice(11) : '') : entrySurface(term)
  if (term !== undefined && (!surface || (key.startsWith('surface:v1:') && key.slice(11) !== surface))) {
    throw new Error('单词同步身份与词形不一致，请升级全部设备后重试')
  }
  if (found && surface && entrySurface(found.term) !== surface) {
    throw new Error('单词同步身份对应不同词形，学习记录未被合并')
  }
  if (!found && surface) {
    const sql = "SELECT rowid AS _rowid, * FROM vocabulary_entries WHERE lower(replace(trim(term), '’', char(39)))=? LIMIT 2"
    const matches = db ? (await db.query(sql, [surface])).values || [] : await rows<JsonRecord>(sql, [surface])
    if (matches.length > 1) throw new Error('存在多个相同词形的词条，请先解决单词身份冲突')
    found = matches[0] || null
  }
  return found
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
  if (table === 'vocabulary_entries') {
    const found = await vocabularySyncRow(db, objectKey)
    if (found) return String(found.normalized_term)
  }
  if (table === 'ai_profiles' || table === 'wrong_stats') {
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
  if (typeof tombstone.deleted_at !== 'string' || !deletedAt.trim()) throw new Error('Remote tombstone requires deleted_at')
  const canonicalKey = await canonicalObjectKey(db, table, objectKey)
  const localTs = await localUpdatedAt(db, table, canonicalKey)
  if (!deletedAt || !localTs || deletedAt >= localTs) {
    if (table === 'vocabulary_entries') {
      await recordVocabularyDeleteTombstones(db, canonicalKey, profileName, deletedAt || null)
    }
    await deleteLocalRow(db, table, canonicalKey)
  }
  await recordTombstone(db, table, canonicalKey, profileName, deletedAt || null)
}

async function serializeLocalRow(
  table: string,
  item: JsonRecord,
  lookup: SerializationLookup,
): Promise<JsonRecord> {
  const payload: JsonRecord = { ...item }
  if (table === 'wrong_stats' && !payload.attempt_ledger) Object.assign(payload, aggregateAttempts(payload))
  delete payload._sync_seq
  if (table === 'ai_profiles') {
    delete payload.api_key
    delete payload.api_key_encrypted
  }
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

const LOOKUP_REFERENCE_QUERIES: Record<SyncReferenceKind, (placeholders: string) => string> = {
  paper: ph => `SELECT pa.id, pa.external_key AS stable_key, p.name AS profile_name
     FROM papers pa JOIN question_bank_profiles p ON p.id = pa.profile_id
     WHERE pa.id IN (${ph})`,
  unit: ph => `SELECT u.id, u.external_key AS stable_key, p.name AS profile_name
     FROM units u JOIN papers pa ON pa.id = u.paper_id
     JOIN question_bank_profiles p ON p.id = pa.profile_id
     WHERE u.id IN (${ph})`,
  question: ph => `SELECT q.id, q.external_key AS stable_key, p.name AS profile_name
     FROM questions q JOIN units u ON u.id = q.unit_id
     JOIN papers pa ON pa.id = u.paper_id
     JOIN question_bank_profiles p ON p.id = pa.profile_id
     WHERE q.id IN (${ph})`,
  session: ph => `SELECT id, sync_id AS stable_key FROM practice_sessions WHERE id IN (${ph})`,
  round: ph => `SELECT id, sync_id AS stable_key FROM wrong_retry_rounds WHERE id IN (${ph})`,
  entry: ph => `SELECT id, normalized_term AS stable_key FROM vocabulary_entries WHERE id IN (${ph})`,
}

// Reference rows are resolved per batch with chunked IN queries and memoized
// for the whole sync run: the stable keys and profile isolation are identical
// to the previous full-table prefetch, without holding every bank row in
// memory while the database grows.
class IncrementalSerializationLookup {
  private readonly stableKeys: Record<SyncReferenceKind, Map<number, string>> = {
    paper: new Map(),
    unit: new Map(),
    question: new Map(),
    session: new Map(),
    round: new Map(),
    entry: new Map(),
  }
  private readonly profiles: Record<'paper' | 'unit' | 'question', Map<number, string>> = {
    paper: new Map(),
    unit: new Map(),
    question: new Map(),
  }
  private readonly resolved = new Set<string>()
  snapshot(): SerializationLookup {
    return { stableKeys: this.stableKeys, profiles: this.profiles }
  }
  async ensure(kind: SyncReferenceKind, ids: number[]): Promise<void> {
    const wanted = [...new Set(ids
      .filter(id => Number.isInteger(id) && id > 0)
      .filter(id => !this.stableKeys[kind].has(id) && !this.resolved.has(`${kind}:${id}`)))]
    for (const id of wanted) this.resolved.add(`${kind}:${id}`)
    for (let offset = 0; offset < wanted.length; offset += 400) {
      const part = wanted.slice(offset, offset + 400)
      const placeholders = part.map(() => '?').join(', ')
      for (const reference of await rows<SerializationReferenceRow>(LOOKUP_REFERENCE_QUERIES[kind](placeholders), part)) {
        this.stableKeys[kind].set(Number(reference.id), String(reference.stable_key || ''))
        if (kind === 'paper' || kind === 'unit' || kind === 'question') {
          this.profiles[kind].set(Number(reference.id), String(reference.profile_name || ''))
        }
      }
    }
  }
}

// Mirrors exactly the references serializeLocalRow/rowProfile resolve per table.
const TABLE_REFERENCE_KINDS: Record<string, SyncReferenceKind[]> = {
  practice_sessions: ['paper', 'unit'],
  practice_answers: ['session', 'question'],
  practice_answer_events: ['session', 'question'],
  practice_unit_submissions: ['session', 'unit'],
  wrong_stats: ['question'],
  wrong_retry_rounds: ['unit', 'session'],
  wrong_retry_round_questions: ['round', 'question'],
  wrong_current_questions: ['unit', 'question'],
  vocabulary_entries: [],
  vocabulary_occurrences: ['entry', 'unit', 'question'],
  vocabulary_reviews: ['entry'],
  ai_profiles: [],
}

function tableReferenceIds(table: string, items: JsonRecord[]): Record<SyncReferenceKind, number[]> {
  const ids: Record<SyncReferenceKind, number[]> = { paper: [], unit: [], question: [], session: [], round: [], entry: [] }
  for (const item of items) {
    switch (table) {
      case 'practice_sessions':
        if (item.paper_id != null) ids.paper.push(Number(item.paper_id))
        for (const id of parseUnitIds(item.unit_ids)) ids.unit.push(id)
        break
      case 'practice_answers':
      case 'practice_answer_events':
        if (item.session_id != null) ids.session.push(Number(item.session_id))
        if (item.question_id != null) ids.question.push(Number(item.question_id))
        break
      case 'practice_unit_submissions':
        if (item.session_id != null) ids.session.push(Number(item.session_id))
        if (item.unit_id != null) ids.unit.push(Number(item.unit_id))
        break
      case 'wrong_stats':
        if (item.question_id != null) ids.question.push(Number(item.question_id))
        break
      case 'wrong_retry_rounds':
        if (item.unit_id != null) ids.unit.push(Number(item.unit_id))
        if (item.session_id != null) ids.session.push(Number(item.session_id))
        break
      case 'wrong_retry_round_questions':
        if (item.round_id != null) ids.round.push(Number(item.round_id))
        if (item.question_id != null) ids.question.push(Number(item.question_id))
        break
      case 'wrong_current_questions':
        if (item.unit_id != null) ids.unit.push(Number(item.unit_id))
        if (item.question_id != null) ids.question.push(Number(item.question_id))
        break
      case 'vocabulary_occurrences':
        if (item.entry_id != null) ids.entry.push(Number(item.entry_id))
        if (item.unit_id != null) ids.unit.push(Number(item.unit_id))
        if (item.question_id != null) ids.question.push(Number(item.question_id))
        break
      case 'vocabulary_reviews':
        if (item.entry_id != null) ids.entry.push(Number(item.entry_id))
        break
    }
  }
  return ids
}

function loadSerializationLookup(): IncrementalSerializationLookup {
  return new IncrementalSerializationLookup()
}

type SyncCursor = Record<string, { updated_at: string, rowid: number, seq?: number }>

function parseCursor(raw: string): SyncCursor {
  try {
    const value = JSON.parse(raw || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function parseTombstoneCursor(raw: string): { deleted_at?: string, rowid?: number, seq?: number } {
  try {
    const value = JSON.parse(raw || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

async function collectLocalChanges(cursor: SyncCursor, tables: readonly string[] = LAN_SYNC_TABLES, lookupLoader: IncrementalSerializationLookup = loadSerializationLookup()): Promise<{
  changes: Record<string, JsonRecord[]>
  cursor: SyncCursor
}> {
  const changes: Record<string, JsonRecord[]> = {}
  const nextCursor: SyncCursor = { ...cursor }
  const profileNames = await localProfileNames()
  const profiles = new Set(profileNames)
  for (const table of tables) {
    const watermark = cursor[table] || { updated_at: '', rowid: 0 }
    const items = await rows<JsonRecord>(
      `SELECT rowid AS _sync_rowid, * FROM ${table}
       WHERE _sync_seq > ? ORDER BY _sync_seq`,
      [syncSequence(watermark)],
    )
    const needed = tableReferenceIds(table, items)
    for (const kind of TABLE_REFERENCE_KINDS[table] || []) await lookupLoader.ensure(kind, needed[kind])
    const lookup = lookupLoader.snapshot()
    const serialized: JsonRecord[] = []
    for (const item of items) {
      if (table === 'practice_sessions' && item.updated_at === DEPENDENCY_TIMESTAMP) continue
      const payload = await serializeLocalRow(table, item, lookup)
      const profile = String(payload.profile_name || '')
      if (!profile || profiles.has(profile)) {
        serialized.push(payload)
        nextCursor[table] = {
          updated_at: String(item.updated_at || ''),
          rowid: Number(item._sync_rowid || 0),
          seq: Number(item._sync_seq),
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

async function collectLocalTombstones(cursor: { deleted_at?: string, rowid?: number, seq?: number }, tables: readonly string[] = LAN_SYNC_TABLES): Promise<{
  tombstones: JsonRecord[]
  cursor: { deleted_at?: string, rowid?: number, seq?: number }
}> {
  const profiles = new Set(await localProfileNames())
  const items = await rows<JsonRecord>(
    `SELECT rowid AS _sync_rowid, *
     FROM sync_tombstones WHERE _sync_seq > ? ORDER BY _sync_seq`,
    [syncSequence(cursor)],
  )
  const visibleItems = items
    .filter(item => tables.includes(String(item.table_name)))
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
    cursor: last ? { deleted_at: String(last.deleted_at || ''), rowid: Number(last._sync_rowid || 0), seq: Number(last._sync_seq) } : cursor,
  }
}

async function upsertRemoteRow(db: QueryDb, table: string, payload: JsonRecord): Promise<void> {
  const remoteVersion = syncVersion(payload)
  const columnsResult = await db.query(`PRAGMA table_info(${table})`)
  const columns = columnsResult.values || []
  const columnNames = new Set<string>(columns.map((column: any) => String(column.name)))
  const updates: JsonRecord = {}
  const profileName = String(payload.profile_name || '')
  for (const column of columnNames) {
    const name = String(column)
    if (name === 'id' || name.startsWith('_sync_')) continue
    if (table === 'ai_profiles' && (name === 'api_key' || name === 'api_key_encrypted')) continue
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
    const incomingKey = String(payload.normalized_term)
    existing = await vocabularySyncRow(db, incomingKey, String(payload.term || ''))
    const canonical = existing ? String(existing.normalized_term) : await canonicalObjectKey(db, table, incomingKey)
    await recordSyncAlias(db, table, incomingKey, canonical)
    updates.normalized_term = canonical
  } else if (table === 'ai_profiles' && payload.name) {
    existing = await queryRow<JsonRecord>(db,
      'SELECT rowid AS _rowid, updated_at, is_default FROM ai_profiles WHERE name = ? LIMIT 1',
      [payload.name])
    // Default model selection stays local, including when another device updates it.
    if (existing) {
      updates.is_default = existing.is_default
      delete updates.base_url
    } else if (await queryRow(db, 'SELECT 1 FROM ai_profiles WHERE is_default = 1 LIMIT 1')) {
      updates.is_default = 0
    }
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
  if (table === 'practice_sessions' && !(existing && payload._dependency === true)) {
    const {validateIncomingSessionContent} = await import('./practice-snapshots')
    await validateIncomingSessionContent(updates, (sql, values) => queryRow<JsonRecord>(db, sql, values))
  }
  const objectKey = String(updates.sync_id || updates.normalized_term || payload.question_external_key || payload.name || '')
  const tombstone = await queryRow<JsonRecord>(db,
    'SELECT deleted_at FROM sync_tombstones WHERE table_name=? AND object_key=? AND (profile_name=? OR ?=1) ORDER BY deleted_at DESC LIMIT 1',
    [table, objectKey, profileName, GLOBAL_TABLES.has(table) ? 1 : 0])
  if (tombstone && payload.updated_at && String(payload.updated_at) <= String(tombstone.deleted_at)) return
  if (table === 'wrong_stats') {
    if (existing && !updates.attempt_ledger) {
      const current = await queryRow<JsonRecord>(db, 'SELECT attempt_ledger FROM wrong_stats WHERE rowid=?', [existing._rowid])
      if (current?.attempt_ledger) throw new Error('旧设备不支持作答次数合并，请先升级全部设备')
    }
    Object.assign(updates, aggregateAttempts(updates))
  }
  if (existing) {
    const localTs = String(existing.updated_at || '')
    if (table === 'practice_sessions' && payload._dependency === true) return
    const remoteTs = String(payload.updated_at || '')
    const local = await queryRow<JsonRecord>(db, `SELECT _sync_rev, _sync_origin FROM ${table} WHERE rowid=?`, [existing._rowid])
    const localVersion = syncVersion(local || {})
    const remoteOlder = Boolean(remoteTs && localTs && (remoteTs < localTs || (remoteTs === localTs
      && (remoteVersion[0] < localVersion[0] || (remoteVersion[0] === localVersion[0] && remoteVersion[1] <= localVersion[1])))))
    if (table === 'wrong_stats') {
      const current = (await queryRow<JsonRecord>(db, 'SELECT * FROM wrong_stats WHERE rowid=?', [existing._rowid]))!
      const merged = aggregateAttempts(current, updates)
      if (remoteOlder) {
        for (const key of Object.keys(updates)) delete updates[key]
        updates.updated_at = localTs
        remoteVersion[0] = localVersion[0]
        remoteVersion[1] = localVersion[1]
      }
      Object.assign(updates, merged)
      if (Object.entries(updates).every(([key, value]) => current[key] === value)) return
    } else if (remoteOlder) return
    if (table === 'practice_sessions') {
      const { readSnapshot, snapshotsEquivalent } = await import('./practice-snapshots')
      const stored = await queryRow<JsonRecord>(db, 'SELECT content_snapshot FROM practice_sessions WHERE rowid=?', [existing._rowid])
      const localSnapshot = readSnapshot(stored?.content_snapshot)
      const remoteSnapshot = readSnapshot(String(updates.content_snapshot || '{}'))
      if (Object.keys(localSnapshot).length && !snapshotsEquivalent(localSnapshot, remoteSnapshot)) {
        throw new Error('旧练习内容快照不一致，请升级全部设备后同步；学习记录未被覆盖')
      }
    }
    const setClause = Object.keys(updates).map(column => `${column} = ?`).join(', ')
    await db.run(
      `UPDATE ${table} SET ${setClause} WHERE rowid = ?`,
      [...Object.values(updates), existing._rowid],
      false,
    )
    await db.run(`UPDATE ${table} SET _sync_rev=?, _sync_origin=? WHERE rowid=?`, [...remoteVersion, existing._rowid], false)
  } else {
    const placeholders = Object.keys(updates).map(() => '?').join(', ')
    await db.run(
      `INSERT INTO ${table} (${Object.keys(updates).join(', ')}) VALUES (${placeholders})`,
      Object.values(updates),
      false,
    )
    await db.run(`UPDATE ${table} SET _sync_rev=?, _sync_origin=? WHERE rowid=last_insert_rowid()`, remoteVersion, false)
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

async function applyRemoteChanges(changes: Record<string, JsonRecord[]>, tombstones: JsonRecord[], category?: LanCategory): Promise<void> {
  const profiles = new Set(await localProfileNames())
  const emptyRemoteSessions = unreferencedRemoteSessionIds(changes)
  await transaction(async (db) => {
    for (const [table, items] of Object.entries(changes)) {
      if (table === 'ai_profiles') continue
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
      if (tombstone.table_name === 'ai_profiles') continue
      const profile = String(tombstone.profile_name || '')
      if (profile && !profiles.has(profile)) continue
      if (category === 'practice' && tombstone.table_name === 'practice_sessions') {
        const session = await syncRow(db, 'practice_sessions', String(tombstone.object_key || ''))
        if (session) {
          const deletedAt = String(tombstone.deleted_at || '')
          const localTs = String(session.updated_at || '')
          if ((!deletedAt || !localTs || deletedAt >= localTs)
            && await queryRow(db, 'SELECT 1 FROM wrong_retry_rounds WHERE session_id = ?', [session._rowid])) {
            throw new Error('做题会话删除会影响错题本，已保留数据和本类别游标')
          }
        }
      }
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

async function runLanSyncInternal(): Promise<JsonRecord> {
  const { token, base, profileFingerprint, tls, categories, modelKeys } = await handshake()
  const active = categories.filter(category => category !== 'question_bank')
    .sort((a, b) => Number(b === 'wrong') - Number(a === 'wrong'))
  if (!active.length) throw new LanSyncError('INVALID_CONFIGURATION', '双方没有启用可同步的学习类别；题库分发尚未开放', { retryable: false, pauseAuto: true })
  const scope = await categoryScope()
  const totals: JsonRecord = { pulled: {}, pushed: {}, pulled_tombstones: 0, pushed_tombstones: 0 }
  const failures: unknown[] = []
  // One incremental lookup per sync run: batched prefetches memoize across
  // categories instead of re-reading every reference table each round.
  const lookupLoader = loadSerializationLookup()
  for (const category of active) {
    try {
      if (category === 'models') {
        if (!tls || !modelKeys) throw new LanSyncError('INVALID_CONFIGURATION', '模型同步需要双方新版安全连接，请重新扫码绑定', { retryable: false, pauseAuto: true })
        await syncModelKeys(base, token, tls)
        continue
      }
      const tables: readonly string[] = CATEGORY_TABLES[category]
      const responseTables = category === 'wrong' ? ['practice_sessions', ...tables] : [...tables]
      const cursorKey = scope + 'cursor:' + category
      const stored = JSON.parse(await syncSetting(cursorKey) || '{}')
      const previous = stored.profileFingerprint === profileFingerprint ? stored : {}
      const pullResponse = await LanTransport.post({
        ...(tls ? { tls } : {}), url: `${base}/api/lan-sync/pull`,
        data: { token, category, tables, cursor: previous.remote || {}, tombstone_cursor: previous.remoteTombstone || {} },
      })
      if (pullResponse.status !== 200) throw new LocalApiError(pullResponse.status, `拉取 ${category} 失败：${pullResponse.status}`)
      const pulled = validateLanSyncPullResponse(pullResponse.data, responseTables)
      validateCategoryBatch(category, pulled.changes, pulled.tombstones)
      if (Object.keys(pulled.cursor).some(table => !tables.includes(table))) throw new Error('分类游标包含无关表')
      const ordered = Object.fromEntries(responseTables.filter(table => table in pulled.changes).map(table => [table, pulled.changes[table]]))
      await applyRemoteChanges(ordered, pulled.tombstones, category)
      const localBatch = await collectLocalChanges(previous.local || {}, tables, lookupLoader)
      const deleted = await collectLocalTombstones(previous.localTombstone || {}, tables)
      if (category === 'wrong') {
        const dependencies = new Map<string, JsonRecord>()
        const dependencySessions: JsonRecord[] = []
        for (const round of localBatch.changes.wrong_retry_rounds || []) {
          const key = String(round.session_id_key || '')
          const session = await row<JsonRecord>('SELECT * FROM practice_sessions WHERE sync_id = ?', [key])
          if (!session) throw new Error('错题本会话依赖缺失')
          dependencySessions.push(session)
        }
        await lookupLoader.ensure('paper', dependencySessions.map(session => Number(session.paper_id)).filter(id => Number.isInteger(id)))
        await lookupLoader.ensure('unit', dependencySessions.flatMap(session => parseUnitIds(session.unit_ids)))
        const lookup = lookupLoader.snapshot()
        for (const session of dependencySessions) {
          dependencies.set(String(session.sync_id), sessionDependency(await serializeLocalRow('practice_sessions', session, lookup)))
        }
        localBatch.changes = { practice_sessions: [...dependencies.values()], ...localBatch.changes }
      }
      validateCategoryBatch(category, localBatch.changes, deleted.tombstones)
      const pushResponse = await LanTransport.post({
        ...(tls ? { tls } : {}), url: `${base}/api/lan-sync/push`,
        data: { token, category, changes: localBatch.changes, tombstones: deleted.tombstones },
      })
      if (pushResponse.status !== 200) throw new LocalApiError(pushResponse.status, `推送 ${category} 失败：${pushResponse.status}`)
      const applied = validateLanSyncPushResponse(pushResponse.data, responseTables)
      // One durable record advances both directions only after the category succeeds.
      await setSyncSetting(cursorKey, JSON.stringify({ profileFingerprint, remote: pulled.cursor,
        remoteTombstone: pulled.tombstone_cursor, local: localBatch.cursor, localTombstone: deleted.cursor }))
      for (const [table, items] of Object.entries(pulled.changes)) totals.pulled[table] = (totals.pulled[table] || 0) + items.length
      for (const [table, count] of Object.entries(applied)) totals.pushed[table] = (totals.pushed[table] || 0) + count
      totals.pulled_tombstones += pulled.tombstones.length
      totals.pushed_tombstones += deleted.tombstones.length
    } catch (error) {
      const status = Number((error as any)?.status || 0)
      failures.push(status === 403 || status === 409
        ? new LanSyncError('INVALID_CONFIGURATION', '同步类别权限已变更，请核对双方选择后重新同步', { retryable: false, pauseAuto: true })
        : error)
    }
  }
  if (failures.length) throw failures[0]
  const last_sync_at = new Date().toISOString()
  await setSyncSetting('lan_sync_last_at', last_sync_at)
  return { ...totals, last_sync_at }
}


export async function runLanSync(): Promise<JsonRecord> {
  try {
    return await serializeSync(runLanSyncInternal)
  } catch (cause) {
    throw classifyLanSyncError(cause)
  }
}

export async function pushAuthoritativeModelConfiguration(): Promise<JsonRecord> {
  return serializeSync(async () => {
    const session = await handshake()
    if (!session.tls || !session.modelSnapshot || !session.categories.includes('models')) {
      throw new LocalApiError(409, '需要电脑新版安全连接，且双方均开启模型同步')
    }
    const applied = await authoritativePushModelKeys(session.base, session.token, session.tls)
    return { applied_profiles: applied }
  })
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
  void name // Model deletion is local only.
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
import { authoritativePushModelKeys, syncModelKeys } from './model-key-sync'
