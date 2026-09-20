import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { webcrypto, createHash } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const read = name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const source = read('platform/android/database.ts')
const ast = ts.createSourceFile('database.ts', source, ts.ScriptTarget.Latest, true)
let schema
for (const statement of ast.statements) if (ts.isVariableStatement(statement)) for (const d of statement.declarationList.declarations) if (d.name.getText(ast) === 'SCHEMA') schema = d.initializer.text
const sqlite = new DatabaseSync(process.env.ESQ_CRASH_DB || ':memory:')
sqlite.exec(schema)
sqlite.exec('PRAGMA foreign_keys=ON')
const connection = {
  query: async (sql, args = []) => ({ values: sqlite.prepare(sql).all(...args) }),
  run: async (sql, args = []) => {
    const r = sqlite.prepare(sql).run(...args)
    if (process.env.ESQ_CRASH_MODE === 'kill' && sql.includes('INSERT INTO questions')) process.kill(process.pid, 'SIGKILL')
    return { changes: { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) } }
  },
  isTransactionActive: async () => ({ result: sqlite.isTransaction }),
  beginTransaction: async () => sqlite.exec('BEGIN IMMEDIATE'),
  commitTransaction: async () => sqlite.exec('COMMIT'),
  rollbackTransaction: async () => sqlite.exec('ROLLBACK'),
}
// Exercise the production connection barrier and transaction implementation.
const dbContext = { exports: {}, rawAndroidDatabase: async () => connection, createSerialQueue: () => { let tail = Promise.resolve(); return op => { const result = tail.then(op); tail = result.catch(() => {}); return result } } }
vm.runInNewContext(compile(source.slice(source.indexOf('// Only the import transaction'))), dbContext)
const database = dbContext.exports
const modules = new Map()
let stagedReads = 0
const units = [0, 1].map(i => ({ unitKey: 'u' + i, type: 'reading', title: 'Unit ' + i, sequence: 1, passage: { blocks: [] }, questions: [{ questionKey: 'q' + i, number: 1, stem: 'Question ' + i, options: [{ key: 'A', content: 'yes' }, { key: 'B', content: 'no' }] }] }))
const manifest = { format: 'esq', schemaVersion: '1.1', packageId: 'fixture', contentVersion: '1', title: 'fixture', papers: [0, 1].map(i => ({ paperKey: 'p' + i, path: 'p' + i + '.json', answerPath: 'a' + i + '.json', examType: 'cet4' })) }
const pkg = { stageId: 'a'.repeat(64), stageVersion: 1, manifest, assets: [], papers: manifest.papers.map((descriptor, i) => ({ descriptor, paper: { paperKey: 'p' + i, year: 2026, title: 'Paper ' + i }, unitCount: 1, questionCount: 1 })) }
const native = { resume: async () => pkg, read: async ({ paper, question }) => { stagedReads++; const unit = structuredClone(units[paper]); return question === undefined ? { ...unit, questions: unit.questions.map(q => ({ questionKey: q.questionKey, number: q.number })) } : { question: unit.questions[question], answer: { correctOption: 'A' }, label: null } } }
function load(name) {
  if (modules.has(name)) return modules.get(name)
  const context = { exports: {}, TextEncoder, crypto: webcrypto, require: key => {
    const stubs = { './database': database, './esq-stage': { nativeEsqStage: native }, './question-bank-profiles': { activeQuestionBankProfileId: async () => 1 }, './content-remediation': { ensureContentRemediation: async () => {}, loadBundledContentManifest: async () => null, validateRemediatedImport: async () => {} }, './learning-history-rebind': { rebindLearningHistory: async () => {} }, jszip: {} }
    return stubs[key] || load(key.startsWith('../') ? 'platform/question-bank-limits.ts' : 'platform/android/' + key.slice(2) + '.ts')
  } }
  modules.set(name, context.exports)
  vm.runInNewContext(compile(read(name)), context)
  return context.exports
}
const api = load('platform/android/question-bank.ts')
let acknowledgements = 0
native.acknowledge = async () => { acknowledgements++ }
native.pending = async () => ({ tasks: [{ stageId: pkg.stageId, filename: 'recovered.esq', profileId: 1 }] })
if (process.env.ESQ_CRASH_DB) {
  const draft = await api.createEsqImportFromNativePackage('crash.esq', pkg, 1)
  await api.publishEsqImport(draft.id, {})
  sqlite.close()
  process.exit(0)
}
// A source copied before SQLite draft creation is adopted once on next list.
const recovered = await api.listEsqImports()
assert.equal(recovered.length, 1)
const job = await api.createEsqImportFromNativePackage('fixture.esq', pkg, 1)
assert.equal(job.id, recovered[0].id)
assert.equal(acknowledgements, 2)
assert.equal(sqlite.prepare('SELECT raw_file_base64 FROM esq_import_jobs').get().raw_file_base64, '')
sqlite.exec("CREATE TRIGGER fail_second BEFORE INSERT ON questions WHEN NEW.external_key='q1' BEGIN SELECT RAISE(ABORT,'injected disk failure'); END")
await assert.rejects(api.publishEsqImport(job.id, {}), /injected disk failure/)
for (const table of ['papers', 'units', 'questions', 'options', 'question_bank_packages']) assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 0, table)
assert.equal(sqlite.prepare('SELECT status FROM esq_import_jobs').get().status, 'draft')
sqlite.exec('DROP TRIGGER fail_second')
await api.publishEsqImport(job.id, {})
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM questions').get().n, 2)
assert.equal(sqlite.prepare('SELECT status FROM esq_import_jobs').get().status, 'published')
await assert.rejects(api.publishEsqImport(job.id, {}), /已完成入库/)
const ids = sqlite.prepare('SELECT id FROM questions ORDER BY id').all()
const legacy = { manifest, assets: [], papers: pkg.papers.map((item, i) => ({ descriptor: item.descriptor, paper: { ...item.paper, units: [units[i]] }, answers: { paperKey: item.paper.paperKey, answers: { ['q' + i]: { correctOption: 'A' } } }, labels: null })) }
legacy.assets.push({ assetId: 'audio1', mediaType: 'audio/mpeg', size: 1, sha256: 'b'.repeat(64), storedPath: 'question-banks/audio.mp3' })
legacy.papers[0].paper.units[0].questions[0].stemBlocks = [{ type: 'audio', assetId: 'audio1' }]
const oldJob = await api.createEsqImportFromNativePackage('legacy.esq', legacy, 1)
await api.publishEsqImport(oldJob.id, { resolutions: manifest.papers.map(p => ({ paper_key: p.paperKey, action: 'replace_with_imported' })) })
assert.deepEqual(sqlite.prepare('SELECT id FROM questions ORDER BY id').all(), ids)
assert.equal(JSON.parse(sqlite.prepare('SELECT shared_data FROM units WHERE id=1').get().shared_data).audio_tracks[0].asset_id, 'audio1')
// A background write requested inside the exclusive interval must execute after rollback.
let background
await assert.rejects(database.transaction(async db => {
  await db.run("UPDATE papers SET title='rolled back' WHERE id=1")
  background = database.run("UPDATE papers SET title='background survived' WHERE id=1")
  await Promise.resolve()
  throw new Error('rollback barrier test')
}, { exclusive: true }), /rollback barrier test/)
await background
assert.equal(sqlite.prepare('SELECT title FROM papers WHERE id=1').get().title, 'background survived')
assert.equal(sqlite.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length, 0)
console.log(JSON.stringify({ stagedReads, wholePackageRollback: true, retry: true, duplicatePublishRejected: true, legacyBoundedRead: true, stableQuestionIds: true, backgroundWriteIsolated: true }))
if (process.env.ESQ_STAGE_OUTPUT) {
  const readRecord = file => {
    const bytes = readFileSync(file)
    const content = bytes.subarray(0, -32)
    assert.ok(createHash('sha256').update(content).digest().equals(bytes.subarray(-32)), file)
    return JSON.parse(content.toString('utf8'))
  }
  for (const [name, expectedPapers, expectedQuestions] of [['cet4', 35, 1825], ['cet6', 43, 2365]]) {
    const tasks = path.join(process.env.ESQ_STAGE_OUTPUT, name, 'esq-tasks')
    const stageId = readdirSync(tasks).find(id => /^[a-f0-9]{64}$/.test(id))
    const folder = path.join(tasks, stageId)
    const summary = readRecord(path.join(folder, 'ready.json'))
    native.resume = async () => summary
    native.read = async ({ paper, unit, question }) => {
      const paperDir = path.join(folder, 'p' + paper)
      const unitDir = path.join(paperDir, 'u' + unit)
      if (question === undefined) return readRecord(path.join(unitDir, 'unit.json'))
      const value = readRecord(path.join(unitDir, 'q' + question + '.json'))
      const key = createHash('sha256').update(value.questionKey).digest('hex')
      const answer = readRecord(path.join(paperDir, 'answers', key + '.json'))
      let label = null
      try { label = readRecord(path.join(paperDir, 'labels', key + '.json')) } catch (error) { if (error.code !== 'ENOENT') throw error }
      return { question: value, answer, label }
    }
    const before = sqlite.prepare('SELECT COUNT(*) AS n FROM questions').get().n
    const draft = await api.createEsqImportFromNativePackage(name + '.esq', summary, 1)
    await api.publishEsqImport(draft.id, {})
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM questions').get().n - before, expectedQuestions)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM papers WHERE package_id=?').get(summary.manifest.packageId).n, expectedPapers)
    assert.ok(sqlite.prepare("SELECT COUNT(*) AS n FROM units WHERE json_array_length(shared_data, '$.audio_tracks') > 0").get().n > 0)
    assert.equal(sqlite.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length, 0)
    console.log(JSON.stringify({ realPackage: name, papers: expectedPapers, questions: expectedQuestions, assets: summary.assets.length, published: true }))
  }
}
// A failed rollback must quarantine this connection instead of admitting writers.
const rollback = connection.rollbackTransaction
connection.rollbackTransaction = async () => { throw new Error('injected rollback failure') }
await assert.rejects(database.transaction(async () => { throw new Error('operation failure') }, { exclusive: true }), /operation failure/)
await assert.rejects(database.run("UPDATE papers SET title='must not join failed transaction'"), /回滚失败/)
await assert.rejects(database.transaction(async () => {}), /回滚失败/)
connection.rollbackTransaction = rollback
await rollback()
sqlite.close()
