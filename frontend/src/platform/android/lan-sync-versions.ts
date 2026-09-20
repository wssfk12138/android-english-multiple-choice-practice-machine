type VersionDb = {
  query: (sql: string, values?: unknown[]) => Promise<{ values?: any[] }>
  run: (sql: string, values?: unknown[], transaction?: boolean) => Promise<any>
}

export function syncSequence(cursor: Record<string, unknown>): number {
  const value = 'seq' in cursor ? cursor.seq : 0
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('Invalid sync sequence')
  return Number(value)
}

export function syncVersion(payload: Record<string, unknown>): [number, string] {
  const revision = '_sync_rev' in payload ? payload._sync_rev : 0
  const origin = '_sync_origin' in payload ? payload._sync_origin : ''
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) throw new Error('Invalid sync revision')
  if (typeof origin !== 'string' || (origin !== '' && !/^[0-9a-f]{32}$/.test(origin))) throw new Error('Invalid sync origin')
  return [Number(revision), origin]
}

export const SYNC_VERSION_TABLES = [
  'practice_sessions', 'practice_answers', 'practice_answer_events', 'practice_unit_submissions',
  'wrong_stats', 'wrong_retry_rounds', 'wrong_retry_round_questions', 'wrong_current_questions',
  'vocabulary_entries', 'vocabulary_occurrences', 'vocabulary_reviews', 'ai_profiles', 'sync_tombstones',
] as const

async function businessColumns(db: VersionDb, table: string): Promise<string[]> {
  const columns = (await db.query(`PRAGMA table_info(${table})`)).values || []
  return columns
    .map(column => String(column.name))
    .filter(name => !name.startsWith('_sync_'))
    .sort()
}

/**
 * Rows that predate the captured-change triggers still sit at `_sync_seq=0` and
 * need one touch to be picked up by incremental sync. The touch must be an
 * update of a business column, otherwise the `AFTER UPDATE OF` trigger stays
 * quiet.
 */
async function touchPendingRows(
  db: VersionDb,
  table: string,
  execute: (sql: string) => Promise<unknown>,
): Promise<void> {
  const business = await businessColumns(db, table)
  if (!business.length) return
  await execute(`UPDATE ${table} SET ${business[0]}=${business[0]} WHERE _sync_seq=0`)
}

export async function ensureSyncVersions(
  db: VersionDb,
  tables: readonly string[] = SYNC_VERSION_TABLES,
): Promise<void> {
  const execute = (sql: string) => db.run(sql, [], false)
  await execute('CREATE TABLE IF NOT EXISTS sync_change_clock (id INTEGER PRIMARY KEY CHECK(id=1), seq INTEGER NOT NULL)')
  await execute('INSERT OR IGNORE INTO sync_change_clock VALUES (1, 0)')

  // Steady-state launches already carry every trigger and cursor index. Probing
  // the thirteen tables one bridge call at a time cost about a second on
  // Android, so a complete catalogue short-circuits to the combined backfill
  // probe below. A table whose trigger exists must also carry the `_sync_*`
  // columns, because SQLite validates them when the trigger is created.
  const catalogue = await db.query(
    "SELECT name FROM sqlite_master WHERE type IN ('trigger', 'index') AND name LIKE 'lan_seq_%'",
  )
  const captured = new Set((catalogue.values || []).map(item => String(item.name)))
  const complete = tables.every(table =>
    captured.has(`lan_seq_${table}`)
    && captured.has(`lan_seq_${table}_insert`)
    && captured.has(`lan_seq_${table}_update`),
  )
  if (complete) {
    const pending = await db.query(tables
      .map(table => `SELECT '${table}' AS table_name WHERE EXISTS (SELECT 1 FROM ${table} WHERE _sync_seq=0)`)
      .join(' UNION ALL '))
    for (const entry of pending.values || []) {
      const table = String(entry.table_name)
      if (!tables.includes(table)) continue
      await touchPendingRows(db, table, execute)
    }
    return
  }

  for (const table of tables) {
    const columns = (await db.query(`PRAGMA table_info(${table})`)).values || []
    if (!columns.length) continue
    const names = new Set<string>(columns.map(column => String(column.name)))
    for (const [name, definition] of [['_sync_seq', 'INTEGER NOT NULL DEFAULT 0'], ['_sync_rev', 'INTEGER NOT NULL DEFAULT 0'], ['_sync_origin', "TEXT NOT NULL DEFAULT ''"]] as const) {
      if (!names.has(name)) await execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
    }
    const business = [...names].filter(name => !name.startsWith('_sync_')).sort()
    const increment = `UPDATE sync_change_clock SET seq=seq+1 WHERE id=1; UPDATE ${table} SET _sync_seq=(SELECT seq FROM sync_change_clock WHERE id=1)`
    // Metadata writes are excluded from UPDATE OF, including with recursive triggers.
    // https://sqlite.org/lang_createtrigger.html
    await execute(`CREATE TRIGGER IF NOT EXISTS lan_seq_${table}_insert AFTER INSERT ON ${table}
      BEGIN ${increment}, _sync_rev=CASE WHEN NEW._sync_rev=0 THEN 1 ELSE NEW._sync_rev END,
      _sync_origin=CASE WHEN NEW._sync_origin='' THEN lower(hex(randomblob(16))) ELSE NEW._sync_origin END
      WHERE rowid=NEW.rowid; END`)
    await execute(`CREATE TRIGGER IF NOT EXISTS lan_seq_${table}_update AFTER UPDATE OF ${business.join(', ')} ON ${table}
      BEGIN ${increment},
      _sync_rev=CASE WHEN NEW._sync_rev=OLD._sync_rev AND NEW._sync_origin=OLD._sync_origin THEN OLD._sync_rev+1 ELSE NEW._sync_rev END,
      _sync_origin=CASE WHEN NEW._sync_rev=OLD._sync_rev AND NEW._sync_origin=OLD._sync_origin THEN lower(hex(randomblob(16))) ELSE NEW._sync_origin END
      WHERE rowid=NEW.rowid; END`)
    await execute(`CREATE INDEX IF NOT EXISTS lan_seq_${table} ON ${table}(_sync_seq)`)
    // Rows that predate the triggers still sit at _sync_seq=0 and need one
    // touch to be picked up by incremental sync. Probe first so launches with
    // nothing pending do not rewrite every table.
    const pendingSequence = await db.query(`SELECT 1 FROM ${table} WHERE _sync_seq=0 LIMIT 1`)
    if ((pendingSequence.values || []).length) await touchPendingRows(db, table, execute)
  }
}
