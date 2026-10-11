import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/platform/android/database.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('database.ts', source, ts.ScriptTarget.Latest, true)
const schema = ast.statements.flatMap(s => ts.isVariableStatement(s) ? [...s.declarationList.declarations] : [])
  .find(d => d.name.getText(ast) === 'SCHEMA').initializer.text
const migration = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'migrateVocabularyStudyIdentity')

async function verify(db, legacy) {
  try {
    if (legacy) {
      db.exec("CREATE TABLE vocabulary_entries(id INTEGER PRIMARY KEY AUTOINCREMENT, term TEXT NOT NULL, normalized_term TEXT NOT NULL UNIQUE, note TEXT DEFAULT '', review_stage INTEGER DEFAULT 0)")
      db.exec("INSERT INTO vocabulary_entries(term,normalized_term,note,review_stage) VALUES('go','surface:v1:go','keep me',3)")
    } else db.exec(schema)
    assert.ok(migration, 'production bootstrap must supply the word identity migration')
    const context = { ensureColumn: async (_db, table, column, declaration) => {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
    } }
    vm.runInNewContext(ts.transpileModule(migration.getText(ast) + '\n globalThis.migrate = migrateVocabularyStudyIdentity', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
    const adapter = { execute: async sql => db.exec(sql) }
    await context.migrate(adapter)
    const insert = db.prepare("INSERT INTO vocabulary_entries(term,normalized_term) VALUES('read','surface:v1:read')")
    const id = Number(insert.run().lastInsertRowid)
    const identity = () => db.prepare('SELECT daily_study_identity AS identity FROM vocabulary_entries WHERE id=?').get(id).identity
    const original = identity()
    assert.match(original, /^[a-f0-9]{32}$/)
    db.prepare("UPDATE vocabulary_entries SET note='edited' WHERE id=?").run(id)
    await context.migrate(adapter)
    assert.equal(identity(), original, 'edit and repeated startup retain identity')
    db.prepare('DELETE FROM vocabulary_entries WHERE id=?').run(id)
    db.prepare("INSERT INTO vocabulary_entries(id,term,normalized_term) VALUES(?,'read','surface:v1:read')").run(id)
    assert.notEqual(identity(), original, 'physical ID reuse must generate a new identity')
    db.exec("INSERT INTO vocabulary_entries(term,normalized_term,daily_study_identity) VALUES('null','null',NULL),('blank','blank','')")
    const words = db.prepare('SELECT * FROM vocabulary_entries').all()
    assert.ok(words.every(w => /^[a-f0-9]{32}$/.test(w.daily_study_identity)))
    assert.equal(new Set(words.map(w => w.daily_study_identity)).size, words.length)
    assert.equal(db.prepare('PRAGMA table_info(vocabulary_entries)').all().some(c => c.name === 'sync_id'), false, 'LAN normalized_term identity must remain unchanged')
    if (legacy) {
      const word = words.find(w => w.id === 1)
      assert.equal(word.note, 'keep me'); assert.equal(word.review_stage, 3)
      assert.equal(word.normalized_term, 'surface:v1:go')
    }
  } finally { db.close() }
}
assert.ok(source.includes('await migrateVocabularyStudyIdentity(db)'), 'real initialization must call the migration')
await verify(new DatabaseSync(':memory:'), false)
await verify(new DatabaseSync(':memory:'), true)
if (process.env.DAILY_STUDY_LEGACY_DB) {
  const directory = mkdtempSync(join(tmpdir(), 'study-migration-'))
  const target = join(directory, 'legacy.db')
  copyFileSync(process.env.DAILY_STUDY_LEGACY_DB, target)
  const db = new DatabaseSync(target)
  try {
    const before = db.prepare('SELECT * FROM vocabulary_entries ORDER BY id').all()
    db.exec(schema)
    const context = { ensureColumn: async (_db, table, column, declaration) => {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
    } }
    vm.runInNewContext(ts.transpileModule(migration.getText(ast) + '\n globalThis.migrate = migrateVocabularyStudyIdentity', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
    await context.migrate({ execute: async sql => db.exec(sql) })
    const after = db.prepare('SELECT * FROM vocabulary_entries ORDER BY id').all()
    assert.equal(after.length, before.length)
    assert.ok(after.every(w => /^[a-f0-9]{32}$/.test(w.daily_study_identity)))
    assert.equal(new Set(after.map(w => w.daily_study_identity)).size, before.length)
    assert.deepEqual(after.map(({ daily_study_identity, ...word }) => ({...word})), before.map(word => ({...word})))
    const identities = after.map(w => w.daily_study_identity)
    await context.migrate({ execute: async sql => db.exec(sql) })
    assert.deepEqual(db.prepare('SELECT daily_study_identity FROM vocabulary_entries ORDER BY id').all().map(w => w.daily_study_identity), identities)
    console.log(`PASS real tablet backup migration: ${before.length} words and all original word fields preserved`)
  } finally { db.close(); rmSync(directory, { recursive: true }) }
}
console.log('PASS daily study native schema: production clean/legacy startup, new inserts, stable identities, deletion/reuse and learning data preservation')
