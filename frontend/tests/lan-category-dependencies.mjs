import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'

const read = name => readFileSync(new URL(`../src/platform/android/${name}.ts`, import.meta.url), 'utf8')
const compile = code => ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const parsed = ts.createSourceFile('database.ts', read('database'), ts.ScriptTarget.Latest, true)
let schema
let transactionSource
for (const statement of parsed.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'transaction') {
    transactionSource = statement.getText(parsed)
  }
  if (!ts.isVariableStatement(statement)) continue
  for (const declaration of statement.declarationList.declarations) {
    if (declaration.name.getText(parsed) === 'SCHEMA') schema = declaration.initializer.text
  }
}
assert.ok(schema && transactionSource)
const sqlite = new DatabaseSync(':memory:')
let active = false
const events = []
const db = {
  async query(sql, values = []) { return { values: sqlite.prepare(sql).all(...values) } },
  async run(sql, values = []) { return sqlite.prepare(sql).run(...values) },
  async isTransactionActive() { return { result: active } },
  async beginTransaction() { sqlite.exec('BEGIN'); active = true; events.push('begin') },
  async commitTransaction() { sqlite.exec('COMMIT'); active = false; events.push('commit') },
  async rollbackTransaction() { sqlite.exec('ROLLBACK'); active = false; events.push('rollback') },
}
// Execute the production transaction wrapper with a native-connection adapter.
const tx = { exports: {}, rawAndroidDatabase: async () => db, runTransactionSerially: fn => fn() }
vm.runInNewContext(compile(transactionSource), tx)
const database = { transaction: tx.exports.transaction, rows: async (sql, values = []) => sqlite.prepare(sql).all(...values) }
const compat = { exports: {} }
vm.runInNewContext(compile(read('lan-sync-compat')), compat)
const categoryModule = { exports: {} }
vm.runInNewContext(compile(read('lan-categories')), categoryModule)
const serialization = { exports: {} }
vm.runInNewContext(compile(read('lan-sync-serialization')), serialization)
const versions = { exports: {} }
vm.runInNewContext(compile(read('lan-sync-versions')), versions)
const snapshots = { exports: {}, require: () => database }
vm.runInNewContext(compile(read('practice-snapshots')), snapshots)
const context = { exports: {}, require: name => {
  if (name === './practice-snapshots') return snapshots.exports
  if (name === './database') return database
  if (name === './lan-sync-compat') return compat.exports
  if (name === './lan-categories') return categoryModule.exports
  if (name === './lan-sync-serialization') return serialization.exports
  if (name === './lan-sync-versions') return versions.exports
  return {}
} }
vm.runInNewContext(compile(read('lan-sync') + '; export { applyRemoteChanges, collectLocalChanges }'), context)
const { applyRemoteChanges: apply, collectLocalChanges: collect } = context.exports
try {
  sqlite.exec(schema)
  sqlite.exec("ALTER TABLE practice_sessions ADD COLUMN content_snapshot TEXT NOT NULL DEFAULT '{}'; ALTER TABLE practice_sessions ADD COLUMN content_revisions TEXT NOT NULL DEFAULT '{}'")
  sqlite.exec('PRAGMA foreign_keys=ON')
  for (const table of ['practice_sessions', 'wrong_retry_rounds']) {
    sqlite.exec('ALTER TABLE ' + table + ' ADD COLUMN sync_id TEXT')
    sqlite.exec('ALTER TABLE ' + table + ' ADD COLUMN updated_at TEXT')
  }
  sqlite.exec("INSERT INTO question_bank_profiles(id,name) VALUES(100,'Test Bank'); INSERT INTO papers(id,profile_id,year,title,external_key) VALUES(100,100,2026,'Test','paper-1'); INSERT INTO units(id,paper_id,unit_type,title,sequence,external_key) VALUES(100,100,'reading','Test',1,'unit-1')")
  await versions.exports.ensureSyncVersions(db)
  const stub = categoryModule.exports.sessionDependency({ sync_id: 'session-1', profile_name: 'Test Bank', unit_ids_keys: ['unit-1'] })
  const round = { sync_id: 'round-1', session_id_key: 'session-1', unit_id_key: 'unit-1', profile_name: 'Test Bank', round_number: 1, updated_at: '2020' }
  const changes = { practice_sessions: [stub], wrong_retry_rounds: [round] }
  categoryModule.exports.validateCategoryBatch('wrong', changes, [])
  await apply(changes, [], 'wrong')
  assert.equal(sqlite.prepare('SELECT count(*) n FROM wrong_retry_rounds').get().n, 1)
  sqlite.exec("UPDATE practice_sessions SET updated_at=CURRENT_TIMESTAMP WHERE updated_at IS NULL OR updated_at=''")
  assert.equal(sqlite.prepare('SELECT updated_at FROM practice_sessions').get().updated_at, categoryModule.exports.DEPENDENCY_TIMESTAMP)
  assert.equal((await collect({}, ['practice_sessions'])).changes.practice_sessions.length, 0)
  const real = { ...stub, mode: 'unit', updated_at: '2021', score: 90 }
  delete real._dependency
  await apply({ practice_sessions: [real] }, [], 'practice')
  await apply(changes, [], 'wrong')
  assert.equal(sqlite.prepare('SELECT score FROM practice_sessions').get().score, 90)
  for (const deleted_at of ['2030', '2021', '', null]) {
    await assert.rejects(apply({}, [{ table_name: 'practice_sessions', object_key: 'session-1', deleted_at }], 'practice'), /游标/)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM wrong_retry_rounds').get().n, 1)
  }
  sqlite.exec("UPDATE practice_sessions SET updated_at=''")
  await assert.rejects(apply({}, [{ table_name: 'practice_sessions', object_key: 'session-1', deleted_at: '2010' }], 'practice'), /游标/)
  await apply({ practice_sessions: [{ ...real, updated_at: '2040' }] }, [{ table_name: 'practice_sessions', object_key: 'session-1', deleted_at: '2030' }], 'practice')
  assert.equal(sqlite.prepare('SELECT updated_at FROM practice_sessions').get().updated_at, '2040')
  await apply({}, [{ table_name: 'practice_sessions', object_key: 'session-1', deleted_at: '2010' }], 'practice')
  assert.equal(sqlite.prepare('SELECT count(*) n FROM wrong_retry_rounds').get().n, 1)
  const invalid = { practice_sessions: [{ ...stub, sync_id: 'new-session' }], wrong_retry_rounds: [{ ...round, sync_id: 'new-round', session_id_key: 'new-session', unit_id_key: 'missing', round_number: 2 }] }
  await assert.rejects(apply(invalid, [], 'wrong'), /cannot be resolved/)
  assert.equal(sqlite.prepare("SELECT count(*) n FROM practice_sessions WHERE sync_id='new-session'").get().n, 0)
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), [])
  console.log('Category SQLite dependencies: sentinel, export isolation, hydration, replay, cascade and rollback passed')
} finally { sqlite.close() }
