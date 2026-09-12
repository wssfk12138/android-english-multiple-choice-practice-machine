export type LanSyncJsonRecord = Record<string, unknown>

export type LanSyncCursor = Record<string, { updated_at: string, rowid: number, seq?: number }>
export type LanSyncTombstoneCursor = { deleted_at?: string, rowid?: number, seq?: number }

export type ValidatedLanSyncPull = {
  changes: Record<string, LanSyncJsonRecord[]>
  tombstones: LanSyncJsonRecord[]
  cursor: LanSyncCursor
  tombstone_cursor: LanSyncTombstoneCursor
}

const MAX_TABLES = 64
const MAX_CHANGE_ROWS = 10_000
const MAX_TOMBSTONES = 10_000
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const TOMBSTONE_APPLIED_KEY = '_tombstones'

function invalid(message: string): never {
  throw new Error(`电脑端同步响应无效：${message}`)
}

function isPlainRecord(value: unknown): value is LanSyncJsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function plainRecord(value: unknown, field: string): LanSyncJsonRecord {
  if (!isPlainRecord(value)) invalid(`${field} 必须是普通对象`)
  return value
}

function assertResponseSize(value: unknown): void {
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    invalid('内容无法序列化')
  }
  if (typeof encoded !== 'string') invalid('内容不是 JSON 对象')
  if (new TextEncoder().encode(encoded).byteLength > MAX_RESPONSE_BYTES) {
    invalid('内容超过 16 MiB')
  }
}

function allowedTableSet(tables: readonly string[]): Set<string> {
  return new Set(tables)
}

function validateTableKeys(
  value: LanSyncJsonRecord,
  allowedTables: ReadonlySet<string>,
  field: string,
): string[] {
  const keys = Object.keys(value)
  if (keys.length > MAX_TABLES) invalid(`${field} 的表数量超过 ${MAX_TABLES}`)
  for (const table of keys) {
    if (!allowedTables.has(table)) invalid(`${field} 包含不允许的表 ${table}`)
  }
  return keys
}

function validateCursor(
  value: unknown,
  allowedTables: ReadonlySet<string>,
): LanSyncCursor {
  const cursor = plainRecord(value, 'cursor')
  const result: LanSyncCursor = {}
  for (const table of validateTableKeys(cursor, allowedTables, 'cursor')) {
    const watermark = plainRecord(cursor[table], `cursor.${table}`)
    const updatedAt = watermark.updated_at
    const rowid = watermark.rowid
    if (typeof updatedAt !== 'string') invalid(`cursor.${table}.updated_at 必须是字符串`)
    if (!Number.isSafeInteger(rowid) || Number(rowid) < 0) {
      invalid(`cursor.${table}.rowid 必须是非负安全整数`)
    }
    result[table] = { updated_at: updatedAt, rowid: Number(rowid) }
    if ('seq' in watermark) {
      if (!Number.isSafeInteger(watermark.seq) || Number(watermark.seq) < 0) invalid('Invalid sync sequence')
      result[table].seq = Number(watermark.seq)
    }
  }
  return result
}

function validateTombstoneCursor(value: unknown): LanSyncTombstoneCursor {
  const cursor = plainRecord(value, 'tombstone_cursor')
  const result: LanSyncTombstoneCursor = {}
  if ('seq' in cursor) {
    if (!Number.isSafeInteger(cursor.seq) || Number(cursor.seq) < 0) invalid('Invalid sync sequence')
    result.seq = Number(cursor.seq)
  }
  if ('deleted_at' in cursor) {
    if (typeof cursor.deleted_at !== 'string') {
      invalid('tombstone_cursor.deleted_at 必须是字符串')
    }
    result.deleted_at = cursor.deleted_at
  }
  if ('rowid' in cursor) {
    if (!Number.isSafeInteger(cursor.rowid) || Number(cursor.rowid) < 0) {
      invalid('tombstone_cursor.rowid 必须是非负安全整数')
    }
    result.rowid = Number(cursor.rowid)
  }
  return result
}

export function validateLanSyncHandshakeResponse(
  value: unknown,
  tables: readonly string[],
): { token: string, pairingToken?: string } {
  assertResponseSize(value)
  const response = plainRecord(value, 'handshake')
  if (typeof response.token !== 'string' || !response.token || response.token.length > 128) {
    invalid('token 必须是 1 至 128 个字符的字符串')
  }
  if (!Array.isArray(response.tables) || response.tables.length > MAX_TABLES) {
    invalid(`tables 必须是至多 ${MAX_TABLES} 项的数组`)
  }
  const allowedTables = allowedTableSet(tables)
  for (const table of response.tables) {
    if (typeof table !== 'string' || !allowedTables.has(table)) {
      invalid(`tables 包含不允许的表 ${String(table)}`)
    }
  }
  if (response.pairing_token !== null && response.pairing_token !== undefined
    && (typeof response.pairing_token !== 'string' || response.pairing_token.length > 256)) {
    invalid('pairing_token 必须是至多 256 个字符的字符串或 null')
  }
  const pairingToken = typeof response.pairing_token === 'string' && response.pairing_token
    ? response.pairing_token
    : null
  return pairingToken ? { token: response.token, pairingToken } : { token: response.token }
}

export function validateLanSyncPullResponse(
  value: unknown,
  tables: readonly string[],
): ValidatedLanSyncPull {
  assertResponseSize(value)
  const response = plainRecord(value, 'pull')
  const allowedTables = allowedTableSet(tables)
  const changesValue = plainRecord(response.changes, 'changes')
  const changes: Record<string, LanSyncJsonRecord[]> = {}
  let changeRows = 0
  for (const table of validateTableKeys(changesValue, allowedTables, 'changes')) {
    const items = changesValue[table]
    if (!Array.isArray(items)) invalid(`changes.${table} 必须是数组`)
    changeRows += items.length
    if (changeRows > MAX_CHANGE_ROWS) {
      invalid(`changes 总行数超过 ${MAX_CHANGE_ROWS}`)
    }
    changes[table] = items.map((item, index) =>
      plainRecord(item, `changes.${table}[${index}]`))
  }

  if (!Array.isArray(response.tombstones)) invalid('tombstones 必须是数组')
  if (response.tombstones.length > MAX_TOMBSTONES) {
    invalid(`tombstones 数量超过 ${MAX_TOMBSTONES}`)
  }
  const tombstones = response.tombstones.map((item, index) =>
    plainRecord(item, `tombstones[${index}]`))

  return {
    changes,
    tombstones,
    cursor: validateCursor(response.cursor, allowedTables),
    tombstone_cursor: validateTombstoneCursor(response.tombstone_cursor),
  }
}

export function validateLanSyncPushResponse(
  value: unknown,
  tables: readonly string[],
): Record<string, number> {
  assertResponseSize(value)
  const response = plainRecord(value, 'push')
  const appliedValue = plainRecord(response.applied, 'applied')
  const allowedTables = allowedTableSet(tables)
  const applied: Record<string, number> = {}
  const keys = Object.keys(appliedValue)
  if (keys.length > MAX_TABLES) invalid(`applied 的键数量超过 ${MAX_TABLES}`)
  for (const table of keys) {
    if (table !== TOMBSTONE_APPLIED_KEY && !allowedTables.has(table)) {
      invalid(`applied 包含不允许的表 ${table}`)
    }
    const count = appliedValue[table]
    if (!Number.isSafeInteger(count) || Number(count) < 0) {
      invalid(`applied.${table} 必须是非负安全整数`)
    }
    applied[table] = Number(count)
  }
  return applied
}
