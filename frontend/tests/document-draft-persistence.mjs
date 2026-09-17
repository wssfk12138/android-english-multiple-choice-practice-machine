import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import vm from 'node:vm'
import { parse } from 'vue/compiler-sfc'
import * as vue from 'vue'
import ts from 'typescript'

const read = name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const plain = value => JSON.parse(JSON.stringify(value))
const parsed = ts.createSourceFile('database.ts', read('platform/android/database.ts'), ts.ScriptTarget.Latest, true)
let schema
for (const statement of parsed.statements) {
  if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
    if (declaration.name.getText(parsed) === 'SCHEMA') schema = declaration.initializer.text
  }
}
assert.ok(schema)

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'epm-draft-persistence-'))
  const databasePath = join(directory, 'draft.sqlite3')
  let sqlite = new DatabaseSync(databasePath)
  sqlite.exec(schema)
  sqlite.exec('PRAGMA foreign_keys=ON')
  const counts = { puts: 0, answers: 0, publishes: 0, confirms: 0 }
  let failWrite = false
  const database = {
    row: async (sql, values = []) => sqlite.prepare(sql).get(...values),
    rows: async (sql, values = []) => sqlite.prepare(sql).all(...values),
    run: async (sql, values = []) => {
      if (failWrite) throw new Error('Injected draft write failure')
      const result = sqlite.prepare(sql).run(...values)
      return { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) }
    },
  }
  const profiles = {
    activeQuestionBankProfileId: async () => 1,
    listQuestionBankProfiles: async () => [{ id: 1, name: 'Synthetic bank', is_active: true }],
  }
  const errors = { exports: {} }
  vm.runInNewContext(compile(read('platform/android/errors.ts')), errors)
  const document = { exports: {}, require: name => ({
    './database': database, './question-bank-profiles': profiles, './errors': errors.exports,
  })[name] || {} }
  vm.runInNewContext(compile(read('platform/android/document-import.ts')), document)
  const local = { exports: {}, URL, FormData, require: name => ({
    './content-remediation': { ensureContentRemediation: async () => {} },
    './document-import': {
      ...document.exports,
      publishDocumentImport: async () => { counts.publishes++; return {} },
    },
    './question-bank-profiles': profiles,
    './question-bank': { listEsqImports: async () => [], sweepEmptyPaperSessions: async () => {} },
    './errors': errors.exports,
  })[name] || {} }
  vm.runInNewContext(compile(read('platform/android/local-api.ts')), local)
  const api = async (path, options = {}) => {
    if (options.method === 'PUT') counts.puts++
    if (options.method === 'PATCH' && path.endsWith('/answers')) counts.answers++
    return plain(await local.exports.androidLocalApi(path, options))
  }
  const methods = { api }
  for (const method of ['get', 'put', 'post', 'patch', 'del']) {
    methods[method] = (path, body) => api(path, {
      method: method === 'del' ? 'DELETE' : method.toUpperCase(),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }
  const script = parse(read('views/ImportView.vue')).descriptor.scriptSetup.content
  const component = {
    exports: {},
    confirm: () => { counts.confirms++; return false },
    window: { setInterval: () => 1, clearInterval: () => {} },
    require: name => ({
      vue: { ...vue, onMounted: () => {}, onUnmounted: () => {} },
      'vue-router': { useRoute: () => ({ query: {} }), useRouter: () => ({}) },
      '../api': methods,
      '../services/questionBankProfiles': {
        loadQuestionBankProfiles: async () => {},
        questionBankProfilesState: { activeId: 1, items: [{ id: 1, name: 'Synthetic bank' }] },
      },
      '../services/questionLabeling': { questionLabelingState: {} },
    })[name] || {},
  }
  vm.runInNewContext(compile(script + '\nexport { current, notice, error, openJob, saveDraft, saveAnswers, publishDocument };'), component)
  const blocks = [
    'Section II Reading Comprehension', 'Part A', 'Text 1',
    'A synthetic passage for persistence testing.',
    '21. What should be retained?', '[A] First choice', '[B] Second choice',
    '[C] Third choice', '[D] Fourth choice',
  ]
  const draft = plain(document.exports.parseExtractedExam('Synthetic-2026.docx', {
    format: 'docx', blocks, text: blocks.join('\n'), hasTextLayer: true,
  }))
  draft.source_text = 'Synthetic original source'
  draft.answer_text = 'Synthetic original answers'
  sqlite.prepare('INSERT INTO document_import_jobs(id, profile_id, filename, draft_data) VALUES(?, ?, ?, ?)')
    .run(1, 1, 'Synthetic-2026.docx', JSON.stringify(draft))
  return {
    ...component.exports, counts, api, document: document.exports,
    setFailWrite(value) { failWrite = value },
    stored() { return JSON.parse(sqlite.prepare('SELECT draft_data FROM document_import_jobs WHERE id=1').get().draft_data) },
    reopen() { sqlite.close(); sqlite = new DatabaseSync(databasePath); sqlite.exec('PRAGMA foreign_keys=ON') },
    close() { sqlite.close(); rmSync(directory, { recursive: true, force: true }) },
  }
}

function edit(view, title) {
  const draft = view.current.value.draft
  draft.title = title
  draft.year = 2027
  draft.subject = 'Edited subject'
  draft.units[0].title = 'Edited unit'
  draft.units[0].passage = 'Edited passage with apostrophe: learner\'s note.'
  draft.units[0].questions[0].stem = 'Edited question'
  draft.units[0].questions[0].options[0].content = 'Edited option'
  draft.answers['21'] = 'A'
  return plain(draft)
}

function assertEdited(actual, expected) {
  for (const field of ['title', 'year', 'subject', 'units', 'answers']) {
    if (field === 'units') {
      const normalized = plain(expected.units)
      normalized[0].questions[0].answer = 'A'
      assert.deepEqual(plain(actual.units), normalized)
    } else assert.deepEqual(plain(actual[field]), plain(expected[field]))
  }
}

test('explicit save persists edited fields across a closed SQLite connection and record reopen', async () => {
  const f = fixture()
  try {
    await f.openJob(1)
    const expected = edit(f, 'EDIT1 saved')
    await f.saveDraft()
    assert.equal(f.counts.puts, 1)
    assertEdited(f.stored(), expected)
    assert.equal(f.stored().source_text, 'Synthetic original source')
    assert.equal(f.stored().answer_text, 'Synthetic original answers')
    f.reopen()
    await f.openJob(1)
    assertEdited(f.current.value.draft, expected)
    assert.equal(f.current.value.draft.source_text, undefined)
    assert.ok(f.current.value.draft.warnings.length > 0, 'Incomplete-paper validation remains intact')
  } finally { f.close() }
})

test('confirming answers persists unsaved field edits before replacing the editor draft', async () => {
  const f = fixture()
  try {
    await f.openJob(1)
    const expected = edit(f, 'EDIT1 answer confirmation')
    await f.saveAnswers()
    assertEdited(f.stored(), expected)
    f.reopen()
    await f.openJob(1)
    assertEdited(f.current.value.draft, expected)
    assert.equal(f.current.value.draft.answers_confirmed, true)
    assert.equal(f.counts.answers, 1)
  } finally { f.close() }
})

test('failed save clears stale success, retains edits for retry and does not change stored data', async () => {
  const f = fixture()
  try {
    await f.openJob(1)
    await f.saveDraft()
    const before = f.stored()
    const expected = edit(f, 'EDIT1 failed write')
    f.setFailWrite(true)
    assert.equal(await f.saveDraft(), false)
    assert.equal(f.notice.value, '')
    assert.match(f.error.value, /Injected draft write failure/)
    assert.deepEqual(f.stored(), before)
    assert.equal(f.current.value.draft.title, expected.title)
    f.setFailWrite(false)
    assert.equal(await f.saveDraft(), true)
    assert.equal(f.error.value, '')
    f.reopen()
    await f.openJob(1)
    assertEdited(f.current.value.draft, expected)
  } finally { f.close() }
})

test('failed prepublish save stops before publish confirmation and API call', async () => {
  const f = fixture()
  try {
    await f.openJob(1)
    edit(f, 'EDIT1 unpublished')
    f.current.value.draft.warnings = []
    f.setFailWrite(true)
    await f.publishDocument()
    assert.equal(f.counts.confirms, 0)
    assert.equal(f.counts.publishes, 0)
    assert.match(f.error.value, /Injected draft write failure/)
  } finally { f.close() }
})

test('failed presave does not confirm answers against an older stored draft', async () => {
  const f = fixture()
  try {
    await f.openJob(1)
    edit(f, 'EDIT1 unconfirmed')
    f.setFailWrite(true)
    await f.saveAnswers()
    assert.equal(f.counts.answers, 0)
    assert.equal(f.current.value.draft.title, 'EDIT1 unconfirmed')
  } finally { f.close() }
})

test('successful presave still validates and blocks an incomplete paper from publishing', async () => {
  const f = fixture()
  try {
    await f.openJob(1)
    edit(f, 'EDIT1 incomplete paper')
    f.current.value.draft.warnings = []
    await f.publishDocument()
    assert.equal(f.counts.puts, 1)
    assert.ok(f.current.value.draft.warnings.length > 0)
    assert.equal(f.counts.confirms, 0)
    assert.equal(f.counts.publishes, 0)
  } finally { f.close() }
})

test('a pending save rejects overlapping draft and answer writes', async () => {
  const f = fixture()
  try {
    await f.openJob(1)
    edit(f, 'EDIT1 pending write')
    const pending = f.saveDraft()
    assert.equal(await f.saveDraft(), false)
    await f.saveAnswers()
    assert.equal(await pending, true)
    assert.equal(f.counts.puts, 1)
    assert.equal(f.counts.answers, 0)
  } finally { f.close() }
})

test('published drafts do not submit edits or answer confirmations', async () => {
  const f = fixture()
  try {
    await f.openJob(1)
    f.current.value.status = 'published'
    assert.equal(await f.saveDraft(), false)
    await f.saveAnswers()
    await f.publishDocument()
    assert.equal(f.counts.puts, 0)
    assert.equal(f.counts.answers, 0)
    assert.equal(f.counts.confirms, 0)
    assert.equal(f.counts.publishes, 0)
  } finally { f.close() }
})
