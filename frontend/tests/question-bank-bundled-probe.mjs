// The bundled banks are re-checked on every launch. The fast path reads only
// manifest.json and returns as soon as the published package row matches, so a
// corrupt or incomplete asset must never short-circuit, and a manifest that the
// probe cannot read must fall back to the strict parseEsqBytes error path.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const JSZip = require('jszip')
const src = new URL('../src/', import.meta.url)
const read = path => readFileSync(new URL(path, src), 'utf8')
const compile = code => ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

let packageRow
let packageQueries = 0
const database = {
  androidDatabase: async () => ({}),
  row: async sql => {
    packageQueries += 1
    assert.ok(sql.includes('question_bank_packages'), sql)
    return packageRow
  },
  rows: async () => [],
  run: async () => ({ changes: 0, lastId: 0 }),
  transaction: async operation => operation({}),
}
const stubs = {
  // question-bank.ts imports the default export, so the stub must carry it.
  jszip: { default: JSZip },
  './database': database,
  './esq-format': { esqFormatName: () => 'ESQ', paperExamMetadata: () => ({}), validateEsqManifest: () => {} },
  './question-bank-profiles': { activeQuestionBankProfileId: async () => 1 },
  './import-destination': { saveImportDraft: async () => ({}) },
  './ordering-fixed-slots': { orderingFixedSlotsForPaperUnit: () => null, validateOrderingFixedSlots: () => {} },
  './learning-history-rebind': { rebindLearningHistory: async () => {} },
}
const realPath = key => (key.startsWith('../')
  ? 'platform/' + key.slice(3)
  : 'platform/android/' + key.replace('./', '') + '.ts')
const modules = new Map()
function load(key) {
  if (stubs[key]) return stubs[key]
  const file = realPath(key)
  const id = new URL(file, src).href
  if (modules.has(id)) return modules.get(id)
  const context = {
    exports: {},
    // The app runs in a single realm; the vm sandbox is not. JSZip identifies
    // its input with `instanceof Uint8Array`, so hand it the host constructors
    // or every bundled asset looks unreadable inside the sandbox.
    ArrayBuffer,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    crypto: webcrypto,
    fetch: fetchAsset,
    require: inner => load(inner),
  }
  modules.set(id, context.exports)
  const code = compile(read(file))
  vm.runInNewContext(code, context)
  return context.exports
}

const bundle = async manifest => {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest))
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  return bytes
}
const paper = { paperKey: 'paper-1', path: 'papers/paper-1.json', answerPath: 'answers/paper-1.json' }
let served
let assetStatus = 200
// The sandbox keeps the function it was handed, so the stub reads the mutable
// state above instead of the test replacing a global the module already closed over.
const fetchAsset = async () => (assetStatus === 404
  ? { status: 404, ok: false, arrayBuffer: async () => new Uint8Array() }
  : { status: 200, ok: true, arrayBuffer: async () => served })
served = await bundle({ packageId: 'bundled-one', contentVersion: '1.0.0', papers: [paper] })

const bank = load('./question-bank')

// 1. Published package: one lookup, no full parse of an asset whose paper files
//    are deliberately missing.
packageRow = { id: 7 }
packageQueries = 0
const installed = await bank.installBundledQuestionBank('internal-question-bank.esq', 1)
assert.equal(installed.available, true)
assert.equal(installed.installed, false)
assert.equal(installed.alreadyInstalled, true)
assert.equal(packageQueries, 1, 'the fast path must look the package up exactly once')

// 2. Unknown package or newer content version: back to the strict parse, which
//    reports the missing bundled file instead of pretending the bank is ready.
packageRow = undefined
packageQueries = 0
await assert.rejects(bank.installBundledQuestionBank('internal-question-bank.esq', 1), /题库包缺少 papers\/paper-1\.json/)
assert.equal(packageQueries, 1, 'a readable manifest is checked against the table once before the strict parse')

served = await bundle({ packageId: 'bundled-one', contentVersion: '1.0.1', papers: [paper] })
await assert.rejects(bank.installBundledQuestionBank('internal-question-bank.esq', 1), /题库包缺少 papers\/paper-1\.json/)

// 3. Unreadable manifest and unreadable asset both fall through to the strict
//    parse instead of reporting an installed bank.
served = await bundle({ papers: [paper] })
await assert.rejects(bank.installBundledQuestionBank('internal-question-bank.esq', 1), /题库包缺少 papers\/paper-1\.json/)
packageQueries = 0
served = new Uint8Array([1, 2, 3, 4])
await assert.rejects(bank.installBundledQuestionBank('internal-question-bank.esq', 1))
assert.equal(packageQueries, 0, 'an unreadable asset must not consult the package table')

// 4. A 404 asset stays a missing bank, not an installation.
assetStatus = 404
const missing = await bank.installBundledQuestionBank('internal-question-bank.esq', 1)
assert.equal(missing.available, false)
assert.equal(missing.installed, false)

console.log('Bundled question-bank manifest probe: OK')
