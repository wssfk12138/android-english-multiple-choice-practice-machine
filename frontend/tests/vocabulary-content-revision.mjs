import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'

const databaseSource = readFileSync(new URL('../src/platform/android/database.ts', import.meta.url), 'utf8')
const databaseAst = ts.createSourceFile('database.ts', databaseSource, ts.ScriptTarget.Latest, true)
const schema = databaseAst.statements
  .flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
  .find(declaration => declaration.name.getText(databaseAst) === 'SCHEMA').initializer.text
const db = new DatabaseSync(':memory:')
db.exec(schema)

const revision = () => Number(db.prepare("SELECT value FROM app_settings WHERE key='vocabulary_revision'").get().value)
db.exec("INSERT INTO vocabulary_entries(id,term,normalized_term) VALUES(20,'fixture','fixture')")
db.exec("UPDATE app_settings SET value='0' WHERE key='vocabulary_revision'")
const seen = []
const mutate = statement => { db.exec(statement); seen.push(revision()) }

mutate("INSERT INTO vocabulary_entries(id,term,normalized_term) VALUES(10,'entry','entry')")
mutate("UPDATE vocabulary_entries SET note='changed' WHERE id=10")
mutate('DELETE FROM vocabulary_entries WHERE id=10')
mutate("INSERT INTO vocabulary_occurrences(id,entry_id,surface_form) VALUES(30,20,'fixture')")
mutate("UPDATE vocabulary_occurrences SET context_sentence='changed' WHERE id=30")
mutate('DELETE FROM vocabulary_occurrences WHERE id=30')
mutate("INSERT INTO vocabulary_reviews(id,entry_id,rating) VALUES(40,20,'hard')")
mutate("UPDATE vocabulary_reviews SET rating='fluent' WHERE id=40")
mutate('DELETE FROM vocabulary_reviews WHERE id=40')
assert.deepEqual(seen, [1,2,3,4,5,6,7,8,9], 'every same-second content mutation must advance the monotonic revision')

const vocabularySource = readFileSync(new URL('../src/platform/android/vocabulary.ts', import.meta.url), 'utf8')
const vocabularyAst = ts.createSourceFile('vocabulary.ts', vocabularySource, ts.ScriptTarget.Latest, true)
const functionText = vocabularyAst.statements
  .find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'vocabularyRevision')
  .getText(vocabularyAst)
assert.doesNotMatch(functionText, /COUNT\s*\(/i)
assert.doesNotMatch(functionText, /MAX\s*\(\s*updated_at/i)
const queries = []
const context = {
  exports: {}, URLSearchParams, String,
  row: async statement => { queries.push(statement); return { value: String(revision()) } },
  activeQuestionBankProfileId: async () => 17,
}
vm.createContext(context)
vm.runInContext(ts.transpileModule(functionText + '\nthis.vocabularyRevision = vocabularyRevision', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context)
assert.deepEqual(
  JSON.parse(JSON.stringify(await context.vocabularyRevision(new URLSearchParams()))),
  { scope_key: 'all', revision: 'v2:9' },
)
assert.deepEqual(
  JSON.parse(JSON.stringify(await context.vocabularyRevision(new URLSearchParams('scope=current')))),
  { scope_key: 'profile:17', revision: 'v2:9' },
)
assert.equal(queries.length, 2)
assert.ok(queries.every(statement => /SELECT value FROM app_settings/.test(statement)))
db.close()
console.log('PASS vocabulary content revision: 9 triggers, same-second monotonicity, O(1) revision read and scope isolation')
