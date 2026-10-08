import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'
import { webcrypto, randomUUID } from 'node:crypto'
export const read = path => readFileSync(new URL('../../src/' + path, import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
export class LocalApiError extends Error { constructor(status, message, detail) { super(message); this.status = status; this.detail = detail } }
const source = ts.createSourceFile('db.ts', read('platform/android/database.ts'), ts.ScriptTarget.Latest, true)
export const schema = source.statements.flatMap(s => ts.isVariableStatement(s) ? [...s.declarationList.declarations] : [])
  .find(d => d.name.getText(source) === 'SCHEMA').initializer.text

export function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(schema)
  for (const table of ['vocabulary_occurrences','vocabulary_entries','vocabulary_reviews']) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'sync_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN sync_id TEXT`)
  }
  db.exec("INSERT INTO ai_profiles(id,name,base_url,enabled,default_model) VALUES(1,'Synthetic','https://synthetic.invalid',1,'synthetic')")
  let fault = null
  const run = async (sql, args = []) => {
    if (fault?.(sql, args)) throw new Error('injected storage failure')
    const result = db.prepare(sql).run(...args)
    return { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) }
  }
  const rows = async (sql, args = []) => db.prepare(sql).all(...args)
  const row = async (sql, args = []) => (await rows(sql, args))[0] || null
  const raw = {
    query: async (sql, args) => ({ values: await rows(sql, args) }),
    run: async (sql, args) => { const value = await run(sql, args); return { changes: { changes: value.changes, lastId: value.lastId } } },
    beginTransaction: async () => db.exec('BEGIN IMMEDIATE'), commitTransaction: async () => db.exec('COMMIT'),
    rollbackTransaction: async () => db.exec('ROLLBACK'),
  }
  let serial = Promise.resolve()
  const database = { row, rows, run, dbExecutor: () => ({ row, rows, run }), transaction: operation => {
    const result = serial.then(async () => { await raw.beginTransaction(); try { const result = await operation(raw); await raw.commitTransaction(); return result } catch (cause) { await raw.rollbackTransaction(); throw cause } })
    serial = result.catch(() => {})
    return result
  } }
  const cache = new Map()
  const timers = new Map()
  const calls = []
  let response = ids => ({ translations: ids.map(validWord) })
  let onRequest = async () => {}
  let beforeSend = async () => {}
  const state = { now: Date.now(), key: 'synthetic-key', responseStatus: 200 }
  class TestDate extends Date { static now() { return state.now } }
  const base = { console, URL, crypto: { subtle: webcrypto.subtle, randomUUID }, TextEncoder, Uint8Array, Date: TestDate, performance,
    setTimeout: (fn, delay) => { if (!delay) return setTimeout(fn, 0); const id = randomUUID(); timers.set(id, fn); return id },
    clearTimeout: id => { if (!timers.delete(id)) clearTimeout(id) } }
  function evaluate(name, code, extra = {}) {
    const context = { ...base, exports: {}, require: dependency => {
      if (dependency === './database') return database
      if (dependency === './errors') return { LocalApiError }
      if (dependency === './model-key-store') return { selectedKey: async () => state.key }
      if (dependency === './app-settings') return {
        optionalAppSetting: async key => (await row('SELECT value FROM app_settings WHERE key=?', [key]))?.value,
        writeAppSetting: async (key, value) => run('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]),
      }
      const module = dependency.startsWith('../../') ? dependency.slice(6) : 'platform/android/' + dependency.slice(2)
      return load(module)
    }, ...extra }
    vm.runInNewContext(compile(code), context, { filename: name })
    return context.exports
  }
  function load(name) {
    if (cache.has(name)) return cache.get(name)
    if (name === 'platform/android/ai') {
      const ast = ts.createSourceFile('ai.ts', read(name + '.ts'), ts.ScriptTarget.Latest, true)
      const functions = ast.statements.filter(s => ts.isFunctionDeclaration(s) && ['translateVocabularyEntries','enrichVocabularyEntry','extractJsonObject','discriminationList'].includes(s.name?.text)).map(s => s.getText(ast)).join('\n')
      const api = evaluate(name, functions, {
        ...database, ...load('vocabulary-context'), ...load('platform/android/vocabulary-enrichment-fields'), ...load('platform/android/vocabulary-request-result'), LocalApiError,
        chatCompletion: async (_profile, _model, messages, options) => {
          const config = await load('platform/android/vocabulary-request-config').vocabularyConfiguration()
          await beforeSend()
          await options.execution.beforeSend(config.hash)
          const items = JSON.parse(messages[1].content)
          const ids = items.items ? items.items.map(item => item.entryId) : [items.entryId]
          calls.push({ ids, messages, task: items.items ? 'translation' : 'enrichment' })
          await onRequest(ids, options.execution)
          options.execution.response({ httpStatus: state.responseStatus, usage: { total_tokens: 123 } })
          return typeof response === 'string' ? response : JSON.stringify(response(ids, calls.at(-1).task))
        },
      })
      cache.set(name, api); return api
    }
    const api = evaluate(name, read(name + '.ts'))
    cache.set(name, api); return api
  }
  const seed = (count, status = 'pending', start = 1) => {
    for (let id = start; id < start + count; id++) db.prepare('INSERT INTO vocabulary_entries(id,term,normalized_term,translation_status,sync_id) VALUES(?,?,?,?,?)').run(id, 'go', 'go' + id, status, 'word-' + id)
  }
  return { db, raw, database, calls, state, load, seed, evaluate,
    setResponse: value => { response = value }, onRequest: value => { onRequest = value }, fault: value => { fault = value },
    beforeSend: value => { beforeSend = value },
    expire: async () => { for (const fn of [...timers.values()]) fn(); await new Promise(resolve => setImmediate(resolve)) },
    settle: () => load('platform/android/vocabulary-request-runner').startVocabularyRequestWorker(), close: () => db.close() }
}
export function validWord(id) {
  return { entryId: id, lemma: 'go', phonetic: '/ɡəʊ/', partOfSpeech: 'verb', commonMeaning: '去', memoryHint: '', synonyms: [], antonyms: [], similarForms: [],
    morphology: { lemma: 'go', currentForm: '原形', ambiguous: false, note: '', forms: [] }, generatedExample: { sentence: 'Go away.', translation: '走开。' } }
}
export const plain = value => JSON.parse(JSON.stringify(value))
export async function waitUntil(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)) }
  assert.fail('Timed out waiting for synthetic worker')
}
