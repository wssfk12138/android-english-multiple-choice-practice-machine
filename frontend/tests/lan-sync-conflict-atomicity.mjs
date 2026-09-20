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
const versions = { exports: {} }
vm.runInNewContext(compile(read('lan-sync-versions')), versions)
const context = { exports: {}, require: name => {
  if (name === './database') return database
  if (name === './lan-sync-compat') return compat.exports
  if (name === './lan-sync-versions') return versions.exports
  return {}
} }
vm.runInNewContext(compile(read('lan-sync') + '; export { applyRemoteChanges }'), context)
const apply = changes => context.exports.applyRemoteChanges(changes, [])
const vocab = (note, updated_at, term = 'qa-conflict') => ({ term, normalized_term: term, note, updated_at })
const get = () => sqlite.prepare('SELECT * FROM vocabulary_entries WHERE normalized_term=?').get('qa-conflict')
const snapshot = () => JSON.stringify(sqlite.prepare('SELECT * FROM vocabulary_entries ORDER BY id').all())
try {
  sqlite.exec(schema)
  sqlite.exec('PRAGMA foreign_keys=ON')
  await versions.exports.ensureSyncVersions(db)
  await apply({ vocabulary_entries: [vocab('local', '2031-01-02T00:00:00Z')] })
  const original = snapshot()
  for (const timestamp of ['2031-01-01T00:00:00Z', '2031-01-02T00:00:00Z']) {
    await apply({ vocabulary_entries: [vocab('remote-not-newer', timestamp)] })
    assert.equal(snapshot(), original, 'older/equal remote timestamp retains local row')
  }
  const id = get().id
  await apply({ vocabulary_entries: [vocab('remote-newer', '2031-01-03T00:00:00Z')] })
  assert.equal(get().id, id)
  assert.equal(get().note, 'remote-newer')
  const merged = snapshot()
  await apply({ vocabulary_entries: [vocab('remote-newer', '2031-01-03T00:00:00Z')] })
  assert.equal(snapshot(), merged, 'replay must not duplicate or mutate')
  events.length = 0
  await assert.rejects(apply({ vocabulary_entries: [
    vocab('rollback-update', '2031-01-04T00:00:00Z'),
    vocab('rollback-insert', '2031-01-04T00:00:00Z', 'qa-new'),
    { normalized_term: 'qa-invalid', updated_at: '2031-01-04T00:00:00Z' },
  ] }), /单词同步身份与词形不一致/)
  assert.equal(snapshot(), merged, 'later identity rejection rolls back earlier update and insert')
  assert.deepEqual(events, ['begin', 'rollback'])
  events.length = 0
  sqlite.exec("CREATE TRIGGER fail_remote_row BEFORE INSERT ON vocabulary_entries WHEN NEW.term = 'qa-invalid' BEGIN SELECT RAISE(ABORT, 'synthetic SQL failure'); END")
  await assert.rejects(apply({ vocabulary_entries: [
    vocab('rollback-update', '2031-01-04T00:00:00Z'),
    vocab('rollback-insert', '2031-01-04T00:00:00Z', 'qa-new'),
    vocab('rollback-trigger', '2031-01-04T00:00:00Z', 'qa-invalid'),
  ] }), /synthetic SQL failure/)
  sqlite.exec('DROP TRIGGER fail_remote_row')
  assert.equal(snapshot(), merged, 'later SQL failure rolls back earlier update and insert')
  assert.deepEqual(events, ['begin', 'rollback'])
  assert.equal(active, false)
  events.length = 0
  await assert.rejects(apply({
    vocabulary_entries: [vocab('rollback-reference', '2031-01-04T00:00:00Z')],
    vocabulary_reviews: [{ entry_id_key: 'qa-missing-parent', rating: 'good' }],
  }), /vocabulary_reviews.entry_id cannot be resolved/)
  assert.equal(snapshot(), merged, 'later unresolved parent rolls back earlier table')
  assert.deepEqual(events, ['begin', 'rollback'])
  const retry = { vocabulary_entries: [
    vocab('retry-ok', '2031-01-04T00:00:00Z'),
    vocab('retry-insert', '2031-01-04T00:00:00Z', 'qa-new'),
  ] }
  await apply(retry)
  assert.equal(get().id, id)
  assert.equal(get().note, 'retry-ok')
  const recovered = snapshot()
  await apply(retry)
  assert.equal(snapshot(), recovered)
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM vocabulary_entries').get().n, 2)
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(active, false)
  console.log('Android production merge: older/equal/newer, identity, replay, SQL/reference rollback and retry passed')
} finally {
  sqlite.close()
}
