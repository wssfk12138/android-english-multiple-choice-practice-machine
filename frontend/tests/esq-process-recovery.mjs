import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

// Isolated process death during the real publication transaction; no user data.
const folder = mkdtempSync(path.join(tmpdir(), 'esq-process-recovery-'))
const file = path.join(folder, 'import.sqlite')
const runner = fileURLToPath(new URL('./esq-staged-import.mjs', import.meta.url))
const child = mode => spawnSync(process.execPath, [runner], {
  env: { ...process.env, ESQ_CRASH_DB: file, ESQ_CRASH_MODE: mode }, encoding: 'utf8', timeout: 30000,
})
try {
  const killed = child('kill')
  assert.notEqual(killed.status, 0, killed.stdout + killed.stderr)
  let db = new DatabaseSync(file)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM esq_import_jobs').get().n, 1)
  assert.equal(db.prepare('SELECT status FROM esq_import_jobs').get().status, 'draft')
  for (const table of ['papers', 'units', 'questions', 'options', 'question_bank_packages'])
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 0, table)
  db.close()
  const retry = child('retry')
  assert.equal(retry.status, 0, retry.stdout + retry.stderr)
  db = new DatabaseSync(file)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM questions').get().n, 2)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM esq_import_jobs').get().n, 1)
  assert.equal(db.prepare('SELECT status FROM esq_import_jobs').get().status, 'published')
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  db.close()
  console.log('Process termination: durable draft, journal rollback, reopen and retry passed')
} finally {
  rmSync(folder, { recursive: true, force: true })
}
