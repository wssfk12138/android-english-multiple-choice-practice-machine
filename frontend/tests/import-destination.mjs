import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'
import JSZip from 'jszip'
import * as errors from '../src/platform/android/errors.ts'
import * as format from '../src/platform/android/esq-format.ts'
import * as limits from '../src/platform/question-bank-limits.ts'
import { createSerialQueue } from '../src/platform/android/serial-queue.ts'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const parsed = ts.createSourceFile('database.ts', read('../src/platform/android/database.ts'), ts.ScriptTarget.Latest, true)
let schema
for (const statement of parsed.statements) {
  if (!ts.isVariableStatement(statement)) continue
  for (const declaration of statement.declarationList.declarations) {
    if (declaration.name.getText(parsed) === 'SCHEMA') schema = declaration.initializer.text
  }
}
const sqlite = new DatabaseSync(':memory:')
sqlite.exec(schema)
const db = {
  async query(sql, values = []) { return { values: sqlite.prepare(sql).all(...values) } },
  async run(sql, values = [], nested = false) {
    assert.equal(nested, false)
    const result = sqlite.prepare(sql).run(...values)
    return { changes: { lastId: Number(result.lastInsertRowid), changes: Number(result.changes) } }
  },
}
const database = {
  async row(sql, values = []) { return sqlite.prepare(sql).get(...values) },
  async transaction(operation) {
    sqlite.exec('BEGIN')
    try { const result = await operation(db); sqlite.exec('COMMIT'); return result }
    catch (error) { sqlite.exec('ROLLBACK'); throw error }
  },
}
const dependencies = {
  './serial-queue': { createSerialQueue },
  './database': database, './errors': errors, jszip: JSZip, './esq-format': format,
  '../question-bank-limits.ts': limits,
  './question-bank-profiles': { activeQuestionBankProfileId: async () => 1 },
}
function load(path) {
  const compiled = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const context = { exports: {}, TextDecoder, TextEncoder, Uint8Array, btoa, File, FormData,
    require: name => dependencies[name] || {} }
  vm.runInNewContext(compiled, context)
  return context.exports
}
const destination = load('../src/platform/android/import-destination.ts')
dependencies['./import-destination'] = destination
const bank = load('../src/platform/android/question-bank.ts')
dependencies['./esq-stage'] = { nativeEsqStage: {
  stageSelected: async ({ name }) => {
    if (name === 'broken.esq') throw new Error('synthetic parse failure')
    return bank.parseEsqBytes(readFileSync(new URL('../../examples/demo-bank.esq', import.meta.url)))
  },
} }
let extractionFails = false
dependencies['./document-extractor'] = {
  async extractDocument() {
    if (extractionFails) throw new Error('synthetic extraction failure')
    const blocks = ['2026 English Test', 'Section II Reading Comprehension', 'Part A', 'Text 1',
      'This is a synthetic reading passage.', '21. What is this?', '[A] A test [B] A book [C] A song [D] A game']
    return { format: 'docx', blocks, text: blocks.join('\n'), warnings: [] }
  },
}
dependencies['./ordering-fixed-slots'] = { extractOrderingFixedSlots: () => [] }
const documentApi = load('../src/platform/android/document-import.ts')
const count = () => sqlite.prepare('SELECT COUNT(*) AS n FROM question_bank_profiles').get().n
try {
  const initial = count()
  const invalid = new File(['not a zip'], 'broken.esq')
  await assert.rejects(bank.createEsqImport(invalid, undefined, 'Broken'))
  assert.equal(count(), initial, 'Parse failure must not create a profile')
  const bytes = readFileSync(new URL('../../examples/demo-bank.esq', import.meta.url))
  const file = new File([bytes], 'demo.esq')
  sqlite.exec("CREATE TRIGGER fail_draft BEFORE INSERT ON esq_import_jobs BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END")
  await assert.rejects(bank.createEsqImport(file, undefined, 'Rolled back'), /synthetic storage failure/)
  assert.equal(count(), initial, 'Draft failure rolls back the new profile')
  sqlite.exec('DROP TRIGGER fail_draft')
  const result = await bank.createEsqImport(file, undefined, 'New bank')
  assert.equal(count(), initial + 1)
  assert.equal(sqlite.prepare('SELECT profile_id FROM esq_import_jobs WHERE id = ?').get(result.id).profile_id, result.profile_id)
  await assert.rejects(bank.createEsqImport(file, undefined, 'NEW BANK'), /同名/)
  assert.equal(count(), initial + 1)
  await bank.createEsqImport(file, 1)
  assert.equal(count(), initial + 1, 'Existing destination never creates a profile')
  await assert.rejects(destination.saveImportDraft(999, undefined, async () => {}), /不存在/)
  await assert.rejects(destination.saveImportDraft(1, 'ambiguous', async () => {}), /同时/)
  await assert.rejects(destination.saveImportDraft(undefined, ' ', async () => {}), /不能为空/)
  const form = new FormData()
  form.append('file', new File(['synthetic'], '2026.docx'))
  form.append('new_profile_name', 'Document bank')
  form.append('use_model_assist', 'false')
  extractionFails = true
  await assert.rejects(documentApi.createDocumentImport(form), /synthetic extraction failure/)
  assert.equal(count(), initial + 1)
  extractionFails = false
  sqlite.exec("CREATE TRIGGER fail_document BEFORE INSERT ON document_import_jobs BEGIN SELECT RAISE(ABORT, 'synthetic document storage failure'); END")
  await assert.rejects(documentApi.createDocumentImport(form), /synthetic document storage failure/)
  assert.equal(count(), initial + 1)
  sqlite.exec('DROP TRIGGER fail_document')
  const documentResult = await documentApi.createDocumentImport(form)
  assert.ok(documentResult.id > 0)
  assert.equal(count(), initial + 2)
  assert.equal(sqlite.prepare('SELECT profile_id FROM document_import_jobs WHERE id = ?').get(documentResult.id).profile_id, documentResult.profile_id)
  const view = read('../src/views/ImportView.vue')
  assert.equal(view.includes("post('/question-bank-profiles'"), false, 'Destination confirmation must not persist a profile')
  const document = read('../src/platform/android/document-import.ts')
  assert.ok(document.indexOf('await saveImportDraft(') > document.indexOf('draft = await applyDocumentModelAssist('))
  console.log('Import destination: parse failure, transactional rollback, success, duplicate, existing and invalid targets passed')
  const nativePackage = JSON.parse(sqlite.prepare('SELECT package_data FROM esq_import_jobs WHERE id = ?').get(result.id).package_data)
  const beforeRemote = count()
  const originalDrafts = sqlite.prepare('SELECT COUNT(*) AS n FROM esq_import_jobs WHERE profile_id = 1').get().n
  const remote = await bank.createEsqImportFromNativePackage('remote.esq', nativePackage, undefined, 'Remote QA')
  assert.notEqual(remote.profile_id, 1, 'Native new destination must not fall back to the active profile')
  assert.equal(count(), beforeRemote + 1)
  assert.equal(sqlite.prepare('SELECT profile_id FROM esq_import_jobs WHERE id = ?').get(remote.id).profile_id, remote.profile_id)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM esq_import_jobs WHERE profile_id = 1').get().n, originalDrafts)
  const nativeExisting = await bank.createEsqImportFromNativePackage('existing.esq', nativePackage, remote.profile_id)
  assert.equal(nativeExisting.profile_id, remote.profile_id)
  await assert.rejects(bank.createEsqImportFromNativePackage('duplicate.esq', nativePackage, undefined, 'Remote QA'), /同名/)
  sqlite.exec("CREATE TRIGGER fail_native BEFORE INSERT ON esq_import_jobs BEGIN SELECT RAISE(ABORT, 'native storage failure'); END")
  await assert.rejects(bank.createEsqImportFromNativePackage('failure.esq', nativePackage, undefined, 'Native rollback'), /native storage failure/)
  sqlite.exec('DROP TRIGGER fail_native')
  assert.equal(count(), beforeRemote + 1)

  const updateAst = ts.createSourceFile('update.ts', read('../src/platform/android/app-update.ts'), ts.ScriptTarget.Latest, true)
  const downloadNode = updateAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'downloadQuestionBankPackage')
  const downloadCode = ts.transpileModule(downloadNode.getText(updateAst), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  let downloads = 0
  let failDownload = false
  const cleanup = []
  const fallbackContext = { exports: {} }
  vm.runInNewContext(ts.transpileModule(read('../src/platform/official-download-sources.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, fallbackContext)
  const apiContext = { exports: {}, ...fallbackContext.exports, LocalApiError: errors.LocalApiError, row: database.row,
    questionBankCatalog: async () => ({ packages: [{ packageId: 'qa', contentVersion: '1', fileName: 'qa.esq', size: 10, sha256: 'hash', downloadUrl: 'https://example.invalid/qa.esq' }] }),
    validateQuestionBankRemoteUrl: url => url, createEsqImportFromNativePackage: bank.createEsqImportFromNativePackage,
    NativeAppUpdater: {
      async downloadQuestionBank() { downloads++; if (failDownload) throw new Error('download failure'); return { packageData: JSON.stringify(nativePackage), cleanupToken: 'qa' } },
      async resolveQuestionBankAssets(value) { cleanup.push(value.delete) },
    },
  }
  vm.runInNewContext(downloadCode, apiContext)
  const download = body => apiContext.exports.downloadQuestionBankPackage({ package_id: 'qa', content_version: '1', ...body })
  for (const body of [{}, { profile_id: 0 }, { profile_id: -1 }, { profile_id: '1' }, { profile_id: 1.5 }, { profile_id: 999 }, { new_profile_name: ' ' }, { new_profile_name: 123 }, { new_profile_name: 'x'.repeat(81) }, { profile_id: 1, new_profile_name: 'Both' }, { new_profile_name: 'Remote QA' }]) {
    await assert.rejects(download(body))
  }
  assert.equal(downloads, 0, 'Invalid destinations must be rejected before native download')
  failDownload = true
  await assert.rejects(download({ new_profile_name: 'Network rollback' }), /download failure/)
  assert.equal(count(), beforeRemote + 1)
  failDownload = false
  const apiNew = await download({ new_profile_name: 'API remote QA' })
  assert.notEqual(apiNew.profile_id, 1)
  const apiExisting = await download({ profile_id: remote.profile_id })
  assert.equal(apiExisting.profile_id, remote.profile_id)
  sqlite.exec("CREATE TRIGGER fail_remote BEFORE INSERT ON esq_import_jobs BEGIN SELECT RAISE(ABORT, 'remote storage failure'); END")
  await assert.rejects(download({ new_profile_name: 'API rollback' }), /remote storage failure/)
  sqlite.exec('DROP TRIGGER fail_remote')
  assert.equal(count(), beforeRemote + 2)
  assert.deepEqual(cleanup, [false, false, true])
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM esq_import_jobs WHERE profile_id = 1').get().n, originalDrafts)
  assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length, 0)
  console.log('Remote destination: pre-download guards, new/existing isolation, network/storage rollback and asset cleanup passed')
} finally { sqlite.close() }
