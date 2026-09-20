import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const read = name => readFileSync(new URL(`../src/platform/android/${name}.ts`, import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const categories = { exports: {} }
vm.runInNewContext(compile(read('lan-categories')), categories)
const rules = categories.exports
for (const value of [['bad'], ['wrong', 'wrong'], null, ['__proto__']]) assert.throws(() => rules.validateCategories(value))
assert.throws(() => rules.categoryAgreement({}, ['wrong']))
assert.throws(() => rules.categoryAgreement({ category_protocol: 1, host_categories: ['wrong'], effective_categories: ['models'] }, ['wrong']))
assert.throws(() => rules.validateCategoryBatch('wrong', { practice_answers: [] }, []))
assert.throws(() => rules.validateCategoryBatch('models', { ai_profiles: [{ api_key: 'test' }] }, []))
assert.throws(() => rules.validateCategoryBatch('wrong', {}, [{ table_name: 'practice_sessions' }]))
assert.throws(() => rules.validateCategoryBatch('practice', { practice_sessions: [{ _dependency: true }] }, []))
const stub = rules.sessionDependency({ sync_id: 'session', profile_name: 'bank', score: 100, mode: 'unit', updated_at: '2030' })
assert.equal(stub.score, undefined)
assert.equal(stub.updated_at, rules.DEPENDENCY_TIMESTAMP)
assert.throws(() => rules.validateCategoryBatch('wrong', { practice_sessions: [{ ...stub, updated_at: '2035' }], wrong_retry_rounds: [{ session_id_key: 'session', profile_name: 'bank' }] }, []))
rules.validateCategoryBatch('wrong', { practice_sessions: [stub], wrong_retry_rounds: [{ session_id_key: 'session', profile_name: 'bank' }] }, [])
assert.throws(() => rules.validateCategoryBatch('wrong', { practice_sessions: [stub] }, []))

// Execute the production orchestration; transport and persistence failures are deterministic.
const source = ts.createSourceFile('sync.ts', read('lan-sync'), ts.ScriptTarget.Latest, true)
const run = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'runLanSyncInternal').getText(source)
const settings = new Map()
let enabled = ['practice', 'vocabulary']
let host = 'host-a'
let profile = 'profile-a'
let failure = ''
const calls = []
const lookup = {}
const context = { exports: {}, ...rules,
  loadSerializationLookup: () => lookup,
  handshake: async () => ({ token: 'test', base: 'https://test', tls: {}, modelKeys: true, profileFingerprint: profile, categories: enabled }),
  syncModelKeys: async () => { if (failure === 'models-only') throw Error('models rejected') },
  categoryScope: async () => `scope:${host}:`, syncSetting: async key => settings.get(key) || '',
  setSyncSetting: async (key, value) => { if (failure === 'persist') throw Error('persist'); settings.set(key, value) },
  LocalApiError: Error, LanSyncError: Error,
  LanTransport: { post: async ({ url, data }) => {
    calls.push({ url, data: structuredClone(data) })
    if (failure === 'models-only' && data.category === 'models') return { status: 403 }
    if (failure === 'push' && url.endsWith('/push')) return { status: 500 }
    if (url.endsWith('/pull')) return { status: 200, data: { changes: Object.fromEntries(data.tables.map(table => [table, []])), tombstones: [],
      cursor: Object.fromEntries(data.tables.map(table => [table, { updated_at: '2030', rowid: 3 }])), tombstone_cursor: { deleted_at: '2030', rowid: 4 } } }
    return { status: 200, data: { applied: {} } }
  } },
  validateLanSyncPullResponse: data => { if (failure === 'validate') throw Error('validate'); return data },
  validateLanSyncPushResponse: data => data.applied,
  applyRemoteChanges: async () => { if (failure === 'apply') throw Error('apply') },
  collectLocalChanges: async (cursor, tables, sharedLookup) => { assert.equal(sharedLookup, lookup); calls.push({ localCursor: structuredClone(cursor), tables }); return { changes: Object.fromEntries(tables.map(table => [table, []])), cursor: Object.fromEntries(tables.map(table => [table, { updated_at: '2031', rowid: 8 }])) } },
  collectLocalTombstones: async (cursor, tables) => { calls.push({ deletedCursor: structuredClone(cursor), tables }); return { tombstones: [], cursor: { deleted_at: '2031', rowid: 9 } } },
}
vm.runInNewContext(compile(run + '; export { runLanSyncInternal }'), context)
await context.exports.runLanSyncInternal()
const modelKey = 'scope:host-a:cursor:practice'
const original = settings.get(modelKey)
const record = JSON.parse(original)
assert.equal(record.remote.practice_sessions.rowid, 3)
assert.equal(record.local.practice_sessions.rowid, 8)
assert.equal(record.remoteTombstone.rowid, 4)
assert.equal(record.localTombstone.rowid, 9)
enabled = ['vocabulary']
await context.exports.runLanSyncInternal()
assert.equal(settings.get(modelKey), original, 'disabled category keeps all cursors')
enabled = ['practice']
calls.length = 0
await context.exports.runLanSyncInternal()
assert.equal(calls[0].data.cursor.practice_sessions.rowid, 3, 'reenable resumes its own historical cursor')
assert.equal(calls[1].localCursor.practice_sessions.rowid, 8)
for (failure of ['push', 'apply', 'validate', 'persist']) {
  const before = JSON.stringify([...settings])
  await assert.rejects(context.exports.runLanSyncInternal())
  assert.equal(JSON.stringify([...settings]), before, `${failure} does not advance cursors`)
}
failure = ''
enabled = ['models', 'vocabulary']
settings.delete('scope:host-a:cursor:vocabulary')
failure = 'models-only'
const beforeModelFailure = settings.get(modelKey)
await assert.rejects(context.exports.runLanSyncInternal())
assert.equal(settings.get(modelKey), beforeModelFailure)
assert.ok(settings.get('scope:host-a:cursor:vocabulary'), 'a rejected category does not block the other categories')
failure = ''
enabled = ['practice']
host = 'host-b'
calls.length = 0
await context.exports.runLanSyncInternal()
assert.equal(Object.keys(calls[0].data.cursor).length, 0, 'new host does not inherit cursor')
host = 'host-a'
profile = 'profile-b'
calls.length = 0
await context.exports.runLanSyncInternal()
assert.equal(Object.keys(calls[0].data.cursor).length, 0, 'profile changes replay category history')
enabled = ['question_bank']
await assert.rejects(context.exports.runLanSyncInternal())
console.log('Category validation and production orchestration: isolation, disable/reopen, four failure paths, host/profile cursors passed')
