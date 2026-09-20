import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'

// Execute the production functions; unused native module imports are stubbed.
const source = readFileSync(new URL('../src/platform/android/lan-sync.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(
  source + '\nexport { upsertRemoteRow, serializeLocalRow }',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const versions = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/platform/android/lan-sync-versions.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, versions)
const context = { exports: {}, require: name => name === './lan-sync-versions' ? versions.exports : {} }
vm.runInNewContext(compiled, context)
const { upsertRemoteRow, serializeLocalRow } = context.exports
const databaseSource = readFileSync(new URL('../src/platform/android/database.ts', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('database.ts', databaseSource, ts.ScriptTarget.Latest, true)
let schema
for (const statement of parsed.statements) {
  if (!ts.isVariableStatement(statement)) continue
  for (const declaration of statement.declarationList.declarations) {
    if (declaration.name.getText(parsed) === 'SCHEMA') schema = declaration.initializer.text
  }
}
assert.ok(schema)
const sqlite = new DatabaseSync(':memory:')
try {
  sqlite.exec(schema)
  sqlite.exec('DELETE FROM ai_profiles')
  sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS test_default ON ai_profiles(is_default) WHERE is_default = 1')
  // Reject legacy/hostile fields even if a future schema contains them.
  sqlite.exec("ALTER TABLE ai_profiles ADD COLUMN api_key_encrypted TEXT DEFAULT ''")
  sqlite.exec("ALTER TABLE ai_profiles ADD COLUMN api_key TEXT DEFAULT ''")
  const db = {
    async query(sql, values = []) { return { values: sqlite.prepare(sql).all(...values) } },
    async run(sql, values = []) { return sqlite.prepare(sql).run(...values) },
  }
  const get = name => sqlite.prepare('SELECT * FROM ai_profiles WHERE name = ?').get(name)
  await versions.exports.ensureSyncVersions(db)
  const remote = {
    name: 'Remote', base_url: 'https://example.invalid/v1', is_default: 1,
    api_key: 'synthetic-remote', api_key_encrypted: 'synthetic-remote', updated_at: '2030-01-01',
  }
  sqlite.prepare('INSERT INTO ai_profiles (name, base_url, is_default, api_key_encrypted, api_key, updated_at) VALUES (?, ?, 1, ?, ?, ?)')
    .run('Local', 'https://example.invalid/v1', 'synthetic-local', 'synthetic-local', '2026-01-01')
  await upsertRemoteRow(db, 'ai_profiles', remote)
  assert.equal(get('Local').is_default, 1)
  assert.equal(get('Remote').is_default, 0)
  assert.equal(get('Remote').api_key_encrypted, '')
  assert.equal(get('Remote').api_key, '')
  await upsertRemoteRow(db, 'ai_profiles', { ...remote, name: 'Local', is_default: 0, base_url: 'https://changed.invalid/v1' })
  assert.equal(get('Local').base_url, 'https://example.invalid/v1')
  assert.equal(get('Local').is_default, 1)
  assert.equal(get('Local').api_key_encrypted, 'synthetic-local')
  assert.equal(get('Local').api_key, 'synthetic-local')
  const beforeReplay = JSON.stringify(get('Remote'))
  await upsertRemoteRow(db, 'ai_profiles', remote)
  assert.equal(JSON.stringify(get('Remote')), beforeReplay)
  const exported = await serializeLocalRow('ai_profiles', get('Local'), {})
  assert.equal('api_key' in exported, false)
  assert.equal('api_key_encrypted' in exported, false)
  sqlite.exec('DELETE FROM ai_profiles')
  await upsertRemoteRow(db, 'ai_profiles', remote)
  assert.equal(get('Remote').is_default, 1)
  await upsertRemoteRow(db, 'ai_profiles', { ...remote, name: 'Second' })
  assert.equal(get('Second').is_default, 0)
  console.log('Android production AI sync: default conflict, update, replay, empty device and secrets passed')
} finally {
  sqlite.close()
}
