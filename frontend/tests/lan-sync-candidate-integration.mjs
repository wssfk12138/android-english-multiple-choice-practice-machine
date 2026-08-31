import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { unreferencedRemoteSessionIds } from '../src/platform/android/lan-sync-compat.ts'
import {
  validateLanSyncHandshakeResponse,
  validateLanSyncPullResponse,
  validateLanSyncPushResponse,
} from '../src/platform/android/lan-sync-validation.ts'
import {
  buildSerializationLookup,
  lookupProfile,
  lookupStableKey,
} from '../src/platform/android/lan-sync-serialization.ts'
import { createSyncCoordinator } from '../src/platform/android/sync-coordinator.ts'

const TABLES = ['practice_sessions', 'vocabulary_entries']
const testDir = path.dirname(fileURLToPath(import.meta.url))
const androidPublicRoot = path.resolve(testDir, '..', '..')
const windowsPublicRoot = process.env.WINDOWS_PUBLIC_REPO
  ? path.resolve(process.env.WINDOWS_PUBLIC_REPO)
  : path.resolve(androidPublicRoot, '..', 'english-practice-machine-github')
const python = process.env.WINDOWS_PUBLIC_PYTHON
  ? path.resolve(process.env.WINDOWS_PUBLIC_PYTHON)
  : path.join(windowsPublicRoot, '.venv', 'Scripts', 'python.exe')
const fixture = path.join(testDir, 'fixtures', 'windows-lan-sync-candidate.py')

function fixtureProcess() {
  const child = spawn(python, [fixture], { cwd: windowsPublicRoot, stdio: ['pipe', 'pipe', 'pipe'] })
  const lines = createInterface({ input: child.stdout })
  const errors = []
  child.stderr.on('data', chunk => errors.push(String(chunk)))
  let sequence = 0
  const pending = new Map()
  let readyResolve
  let readyReject
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  lines.on('line', line => {
    const payload = JSON.parse(line)
    if (payload.ready) {
      readyResolve(payload)
      return
    }
    const waiter = pending.get(payload.id)
    if (!waiter) return
    pending.delete(payload.id)
    payload.ok ? waiter.resolve(payload.result) : waiter.reject(new Error(payload.error))
  })
  child.on('exit', code => {
    const error = new Error(`Windows candidate fixture exited with ${code}: ${errors.join('')}`)
    readyReject(error)
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  })
  return {
    child,
    ready,
    rpc(action, args = {}) {
      if (child.exitCode !== null || child.killed) {
        return Promise.reject(new Error(
          `Windows candidate fixture is not running: ${errors.join('')}`,
        ))
      }
      const id = ++sequence
      const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
      child.stdin.write(`${JSON.stringify({ id, action, args })}\n`)
      return promise
    },
  }
}

async function post(baseUrl, route, data) {
  const response = await fetch(`${baseUrl}/api/lan-sync/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  let body
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return { status: response.status, body }
}

function localDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE vocabulary_entries (
      normalized_term TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
    );
    CREATE TABLE sync_tombstones (
      table_name TEXT NOT NULL, object_key TEXT NOT NULL, deleted_at TEXT NOT NULL,
      PRIMARY KEY (table_name, object_key)
    );
  `)
  return db
}

function applyVocabularyPull(db, pull) {
  db.exec('BEGIN')
  try {
    const upsert = db.prepare(`
      INSERT INTO vocabulary_entries(normalized_term, note, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(normalized_term) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
      WHERE excluded.updated_at > vocabulary_entries.updated_at
    `)
    for (const row of pull.changes.vocabulary_entries || []) {
      upsert.run(String(row.normalized_term), String(row.note || ''), String(row.updated_at || ''))
    }
    for (const tombstone of pull.tombstones) {
      if (tombstone.table_name !== 'vocabulary_entries') continue
      db.prepare('DELETE FROM vocabulary_entries WHERE normalized_term = ?').run(String(tombstone.object_key))
      db.prepare('INSERT OR REPLACE INTO sync_tombstones VALUES (?, ?, ?)').run(
        'vocabulary_entries', String(tombstone.object_key), String(tombstone.deleted_at),
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

async function handshake(baseUrl, passcode, profiles, deviceId = 'candidate-tablet') {
  const response = await post(baseUrl, 'handshake', {
    passcode, device_id: deviceId, profile_names: profiles,
  })
  assert.equal(response.status, 200, JSON.stringify(response.body))
  return validateLanSyncHandshakeResponse(response.body, [
    'practice_sessions', 'practice_answers', 'practice_answer_events',
    'practice_unit_submissions', 'wrong_stats', 'wrong_retry_rounds',
    'wrong_retry_round_questions', 'wrong_current_questions',
    'vocabulary_entries', 'vocabulary_occurrences', 'vocabulary_reviews', 'ai_profiles',
  ]).token
}

const host = fixtureProcess()
const local = localDatabase()
try {
  const { base_url: baseUrl, passcode } = await host.ready
  let token = await handshake(baseUrl, passcode, ['Profile A'])

  await host.rpc('insert_vocab', { term: 'from-windows', note: 'desktop', updated_at: '2031-01-01T00:00:00Z' })
  let pulled = await post(baseUrl, 'pull', { token, tables: TABLES, cursor: {}, tombstone_cursor: {} })
  assert.equal(pulled.status, 200)
  let validated = validateLanSyncPullResponse(pulled.body, TABLES)
  applyVocabularyPull(local, validated)
  assert.equal(local.prepare('SELECT note FROM vocabulary_entries WHERE normalized_term = ?').get('from-windows').note, 'desktop')

  let pushed = await post(baseUrl, 'push', {
    token,
    changes: { vocabulary_entries: [{
      term: 'from-android', normalized_term: 'from-android', note: 'tablet', updated_at: '2031-01-01T00:00:01Z',
    }] },
    tombstones: [],
  })
  assert.equal(pushed.status, 200)
  assert.equal(validateLanSyncPushResponse(pushed.body, TABLES).vocabulary_entries, 1)
  assert.equal((await host.rpc('query_vocab', { term: 'from-android' })).note, 'tablet')

  await host.rpc('insert_vocab', { term: 'same-stamp-a', updated_at: '2031-01-01T00:00:02Z' })
  await host.rpc('insert_vocab', { term: 'same-stamp-b', updated_at: '2031-01-01T00:00:02Z' })
  pulled = await post(baseUrl, 'pull', {
    token, tables: TABLES, cursor: validated.cursor, tombstone_cursor: validated.tombstone_cursor,
  })
  validated = validateLanSyncPullResponse(pulled.body, TABLES)
  assert.deepEqual(
    validated.changes.vocabulary_entries.map(row => row.normalized_term),
    ['from-android', 'same-stamp-a', 'same-stamp-b'],
    'incremental cursor must preserve equal-timestamp rows in rowid order',
  )
  const noReplay = await post(baseUrl, 'pull', {
    token, tables: TABLES, cursor: validated.cursor, tombstone_cursor: validated.tombstone_cursor,
  })
  assert.deepEqual(validateLanSyncPullResponse(noReplay.body, TABLES).changes.vocabulary_entries, [])

  await host.rpc('update_vocab', { term: 'from-android', note: 'desktop-newer', updated_at: '2031-01-02T00:00:00Z' })
  pushed = await post(baseUrl, 'push', {
    token, changes: { vocabulary_entries: [{
      term: 'from-android', normalized_term: 'from-android', note: 'tablet-older', updated_at: '2031-01-01T12:00:00Z',
    }] }, tombstones: [],
  })
  assert.equal(validateLanSyncPushResponse(pushed.body, TABLES).vocabulary_entries, 0)
  assert.equal((await host.rpc('query_vocab', { term: 'from-android' })).note, 'desktop-newer')
  pushed = await post(baseUrl, 'push', {
    token, changes: { vocabulary_entries: [{
      term: 'from-android', normalized_term: 'from-android', note: 'tablet-newest', updated_at: '2031-01-03T00:00:00Z',
    }] }, tombstones: [],
  })
  assert.equal(validateLanSyncPushResponse(pushed.body, TABLES).vocabulary_entries, 1)
  assert.equal((await host.rpc('query_vocab', { term: 'from-android' })).note, 'tablet-newest')

  await host.rpc('delete_vocab', { term: 'from-windows', deleted_at: '2031-01-04T00:00:00Z' })
  pulled = await post(baseUrl, 'pull', { token, tables: TABLES, cursor: {}, tombstone_cursor: {} })
  validated = validateLanSyncPullResponse(pulled.body, TABLES)
  applyVocabularyPull(local, validated)
  assert.equal(local.prepare('SELECT 1 FROM vocabulary_entries WHERE normalized_term = ?').get('from-windows'), undefined)
  pushed = await post(baseUrl, 'push', {
    token, changes: {}, tombstones: [{
      table_name: 'vocabulary_entries', object_key: 'from-android', profile_name: '', deleted_at: '2031-01-05T00:00:00Z',
    }],
  })
  assert.equal(validateLanSyncPushResponse(pushed.body, TABLES)._tombstones, 1)
  assert.equal(await host.rpc('query_vocab', { term: 'from-android' }), null)

  const atomicFailure = await post(baseUrl, 'push', {
    token,
    changes: {
      vocabulary_entries: [{ term: 'must-rollback', normalized_term: 'must-rollback', updated_at: '2031-01-06T00:00:00Z' }],
      practice_sessions: [{
        sync_id: 'broken-session', mode: 'unit', unit_ids_keys: ['missing-unit'],
        profile_name: 'Profile A', updated_at: '2031-01-06T00:00:01Z',
      }],
    },
    tombstones: [],
  })
  assert.equal(atomicFailure.status, 422)
  assert.equal(await host.rpc('query_vocab', { term: 'must-rollback' }), null, 'failed batch must roll back earlier rows')

  const lookup = buildSerializationLookup({
    paper: [{ id: 1, stable_key: 'paper-1', profile_name: 'Profile A' }],
    unit: [{ id: 11, stable_key: 'unit-1', profile_name: 'Profile A' }],
    question: [], session: [], round: [], entry: [],
  })
  const profilePayload = {
    sync_id: 'android-profile-a', mode: 'unit',
    unit_ids_keys: [lookupStableKey(lookup, 'unit', 11)],
    profile_name: lookupProfile(lookup, 'unit', 11),
    updated_at: '2031-01-07T00:00:00Z',
  }
  pushed = await post(baseUrl, 'push', {
    token, changes: { practice_sessions: [profilePayload, {
      ...profilePayload, sync_id: 'android-profile-b', unit_ids_keys: ['unit-2'], profile_name: 'Profile B',
    }] }, tombstones: [],
  })
  assert.equal(validateLanSyncPushResponse(pushed.body, TABLES).practice_sessions, 1)
  assert.ok(await host.rpc('query_session', { sync_id: 'android-profile-a' }))
  assert.equal(await host.rpc('query_session', { sync_id: 'android-profile-b' }), null)
  await host.rpc('seed_profile_session', {
    profile: 'Profile B', sync_id: 'windows-profile-b', updated_at: '2031-01-07T00:00:01Z',
  })
  pulled = await post(baseUrl, 'pull', { token, tables: TABLES, cursor: {}, tombstone_cursor: {} })
  validated = validateLanSyncPullResponse(pulled.body, TABLES)
  assert.deepEqual(validated.changes.practice_sessions.map(row => row.sync_id), ['android-profile-a'])
  assert.deepEqual([...unreferencedRemoteSessionIds(validated.changes)], ['android-profile-a'])
  token = await handshake(baseUrl, passcode, ['Profile B'])
  pulled = await post(baseUrl, 'pull', { token, tables: TABLES, cursor: {}, tombstone_cursor: {} })
  validated = validateLanSyncPullResponse(pulled.body, TABLES)
  assert.deepEqual(validated.changes.practice_sessions.map(row => row.sync_id), ['windows-profile-b'])

  const disconnectedPort = new URL(baseUrl).port === '65534' ? 65533 : 65534
  const coordinator = createSyncCoordinator(async () => {
    const response = await fetch(`http://127.0.0.1:${disconnectedPort}/api/lan-sync/pull`, {
      method: 'POST', signal: AbortSignal.timeout(500),
    })
    return response.status
  })
  await assert.rejects(coordinator.runNow())
  const recovered = createSyncCoordinator(async () => (await post(baseUrl, 'pull', {
    token, tables: TABLES, cursor: {}, tombstone_cursor: {},
  })).status)
  assert.equal(await recovered.runNow(), 200, 'a network failure must not block the next coordinated run')

  const oldToken = token
  const newPasscode = await host.rpc('rotate')
  assert.equal((await post(baseUrl, 'pull', { token: oldToken, tables: [] })).status, 401)
  assert.equal((await post(baseUrl, 'handshake', {
    passcode, device_id: 'candidate-tablet', profile_names: ['Profile B'],
  })).status, 401, 'old passcode and known device id must not authenticate')
  token = await handshake(baseUrl, newPasscode, ['Profile B'])
  assert.equal(await host.rpc('revoke'), 1)
  assert.equal((await post(baseUrl, 'pull', { token, tables: [] })).status, 401)
  token = await handshake(baseUrl, newPasscode, ['Profile B'])
  assert.equal((await post(baseUrl, 'pull', { token, tables: [] })).status, 200, 'revoked device may pair again with the current passcode')

  console.log('Android/Windows public candidate LAN sync integration: OK')
} finally {
  local.close()
  try {
    if (host.child.exitCode === null && !host.child.killed) await host.rpc('shutdown')
  } finally {
    host.child.stdin.end()
  }
}
