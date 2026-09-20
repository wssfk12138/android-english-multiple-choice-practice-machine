import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'
import * as errors from '../src/platform/android/errors.ts'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const schemaSource = ts.createSourceFile('database.ts', read('../src/platform/android/database.ts'), ts.ScriptTarget.Latest, true)
const declaration = schemaSource.statements.filter(ts.isVariableStatement)
  .flatMap(statement => Array.from(statement.declarationList.declarations))
  .find(item => item.name.getText(schemaSource) === 'SCHEMA')
const sqlite = new DatabaseSync(':memory:')
sqlite.exec(declaration.initializer.text)
let reply = '{}'
let requestError
const requests = []
const dependencies = {
  './errors': errors,
  './database': {
    async row(sql, values = []) { return sqlite.prepare(sql).get(...values) },
    async run(sql, values = []) { return sqlite.prepare(sql).run(...values) },
  },
  './ai': {
    async chatCompletion(profileId, model) {
      requests.push({ profileId, model })
      if (requestError) throw requestError
      return reply
    },
  },
  './ordering-fixed-slots': { extractOrderingFixedSlots: () => [] },
}
const compiled = ts.transpileModule(read('../src/platform/android/document-import.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const context = { exports: {}, require: name => dependencies[name] || {} }
vm.runInNewContext(compiled, context)
const api = context.exports
const blocks = ['Section II Reading Comprehension', 'Part A', 'Text 1', 'Synthetic reading passage.',
  '21. Test question?', '[A] First [B] Second [C] Third [D] Fourth']
const draft = api.parseExtractedExam('2026.docx', { format: 'docx', blocks, text: blocks.join('\n') })
sqlite.prepare("INSERT INTO document_import_jobs (filename, draft_data) VALUES (?, ?)")
  .run('2026.docx', JSON.stringify(draft))
const snapshot = () => JSON.stringify(sqlite.prepare('SELECT * FROM document_import_jobs WHERE id = 1').get())
const baseline = snapshot()
const provider = (name, model, enabled = 1, isDefault = 0) => Number(sqlite.prepare(
  'INSERT INTO ai_profiles (name, base_url, default_model, enabled, is_default) VALUES (?, ?, ?, ?, ?)',
).run(name, 'https://example.invalid/v1', model, enabled, isDefault).lastInsertRowid)
try {
  sqlite.exec('DELETE FROM ai_profiles')
  await assert.rejects(api.retryDocumentModelAssist(1, {}), /配置并启用/)
  const empty = provider('Empty model', '', 1, 1)
  await assert.rejects(api.retryDocumentModelAssist(1, {}), /默认模型/)
  assert.equal(requests.length, 0, 'Configuration errors must not invoke a provider')
  assert.equal(snapshot(), baseline)
  const disabled = provider('Disabled', 'disabled-model', 0)
  await assert.rejects(api.retryDocumentModelAssist(1, { profile_id: disabled }), /不存在或已停用/)
  await assert.rejects(api.retryDocumentModelAssist(1, { profile_id: 999 }), /不存在或已停用/)
  const usable = provider('Configured', 'configured-model')
  requestError = new Error('synthetic network failure')
  await assert.rejects(api.retryDocumentModelAssist(1, {}), /synthetic network failure/)
  assert.deepEqual(requests.at(-1), { profileId: usable, model: 'configured-model' })
  assert.equal(snapshot(), baseline, 'Failed network request leaves stored draft unchanged')
  requestError = undefined
  reply = 'not JSON'
  await assert.rejects(api.retryDocumentModelAssist(1, { profile_id: empty, model: 'explicit-model' }), /JSON/)
  assert.equal(snapshot(), baseline, 'Malformed response leaves stored draft unchanged')
  reply = JSON.stringify({ answer_map: { 21: 'B' }, issues: [] })
  const result = await api.retryDocumentModelAssist(1, { profile_id: empty, model: 'explicit-model' })
  assert.deepEqual(requests.at(-1), { profileId: empty, model: 'explicit-model' })
  assert.equal(result.draft.answers['21'], 'B')
  assert.equal(result.draft.units[0].questions.length, 1)
  assert.equal(result.draft.source_text, undefined)
  const stored = JSON.parse(sqlite.prepare('SELECT draft_data FROM document_import_jobs WHERE id = 1').get().draft_data)
  assert.equal(stored.answers['21'], 'B')
  assert.equal(stored.source_text, draft.source_text)
  console.log('Document model retry: configuration states, network/JSON failure preservation and explicit-model recovery passed')
} finally { sqlite.close() }
