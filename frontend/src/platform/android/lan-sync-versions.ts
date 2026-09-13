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

export async function ensureSyncVersions(db: VersionDb, tables: readonly string[] = [
  'practice_sessions', 'practice_answers', 'practice_answer_events', 'practice_unit_submissions',
  'wrong_stats', 'wrong_retry_rounds', 'wrong_retry_round_questions', 'wrong_current_questions',
  'vocabulary_entries', 'vocabulary_occurrences', 'vocabulary_reviews', 'ai_profiles', 'sync_tombstones',
]): Promise<void> {
  const execute = (sql: string) => db.run(sql, [], false)
  await execute('CREATE TABLE IF NOT EXISTS sync_change_clock (id INTEGER PRIMARY KEY CHECK(id=1), seq INTEGER NOT NULL)')
  await execute('INSERT OR IGNORE INTO sync_change_clock VALUES (1, 0)')
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
    if ((pendingSequence.values || []).length) {
      await execute(`UPDATE ${table} SET ${business[0]}=${business[0]} WHERE _sync_seq=0`)
    }
  }
}
