import type { SQLiteDBConnection } from '@capacitor-community/sqlite'

/** Bootstrap uses only its raw connection; never await the database bootstrap itself. */
export async function recoverVocabularyRequests(db: SQLiteDBConnection): Promise<void> {
  await db.beginTransaction()
  try {
    const query = async (sql: string, values: unknown[] = []) => (await db.query(sql, values)).values || []
    const write = (sql: string, values: unknown[] = []) => db.run(sql, values, false)
    // The intent/send boundary cannot be made atomic with the remote provider.
    await write("UPDATE vocabulary_request_attempts SET state='unknown', category='process_interrupted' WHERE state IN ('intent','inflight')")
    for (const [task, sql] of [
      ['translation', "SELECT id FROM vocabulary_entries WHERE translation_status='translating'"],
      ['enrichment', "SELECT entry_id AS id FROM vocabulary_enrichment_jobs WHERE state='inflight'"],
    ]) {
      const entries = await query(sql!)
      for (const entry of entries) {
        const prior = await query("SELECT 1 FROM vocabulary_request_heads h JOIN vocabulary_request_attempts a ON a.id=h.attempt_id WHERE h.task=? AND h.entry_id=? AND a.state='unknown'", [task, entry.id])
        if (!prior.length) {
          const id = crypto.randomUUID()
          await write("INSERT INTO vocabulary_request_attempts(id,task,state,ids,category,created_at) VALUES(?,?,'unknown',?,'legacy_inflight',?)", [id, task, JSON.stringify([entry.id]), Date.now()])
          await write('INSERT OR REPLACE INTO vocabulary_request_heads(task,entry_id,attempt_id) VALUES(?,?,?)', [task, entry.id, id])
        }
      }
    }
    await write("UPDATE vocabulary_entries SET translation_status='failed',translation_error='上次请求结果未知，请在词汇任务状态中处理' WHERE translation_status='translating'")
    await write("UPDATE vocabulary_enrichment_jobs SET state='failed',error='上次请求结果未知，请在词汇任务状态中处理' WHERE state='inflight'")
    await write("UPDATE vocabulary_request_runs SET state='stopped' WHERE id IN (SELECT run_id FROM vocabulary_request_attempts WHERE state='unknown')")
    const unknown = await query("SELECT 1 FROM vocabulary_request_attempts WHERE state='unknown' LIMIT 1")
    if (unknown.length) await write("UPDATE vocabulary_request_gate SET reason='unknown',allowed_run=NULL WHERE id=1")
    else if (!(await query("SELECT 1 FROM app_migrations WHERE migration_key='vocabulary-request-pause-v1'")).length
      && (await query("SELECT value FROM app_settings WHERE key='vocabulary-enrichment-paused'"))[0]?.value === '1') {
      await write("UPDATE vocabulary_request_gate SET reason='user',allowed_run=NULL WHERE id=1")
    }
    await write("INSERT OR IGNORE INTO app_migrations(migration_key) VALUES('vocabulary-request-pause-v1')")
    await db.commitTransaction()
  } catch (cause) {
    await db.rollbackTransaction()
    throw cause
  }
}
