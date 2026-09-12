import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'

const read = name => readFileSync(new URL('../src/platform/android/' + name + '.ts', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('database.ts', read('database'), ts.ScriptTarget.Latest, true)
let schema
for (const statement of parsed.statements) {
  if (!ts.isVariableStatement(statement)) continue
  for (const declaration of statement.declarationList.declarations) {
    if (declaration.name.getText(parsed) === 'SCHEMA') schema = declaration.initializer.text
  }
}
const db = new DatabaseSync(':memory:')
db.exec(schema)
const item = { packageId: 'lan.bank.synthetic', contentVersion: '1.0.0+' + 'a'.repeat(64),
  sha256: 'b'.repeat(64), fileName: 'b'.repeat(64) + '.esq', title: 'Synthetic', size: 123, years: [2026], license: 'Test only' }
let catalog = { catalogVersion: 1, hostId: 'host-a', packages: [item] }
let base = 'https://192.168.1.2:8767'
let downloads = 0, imports = 0, failure = ''
const cleanup = [], urls = []
const dependencies = {
  '@capacitor/core': { registerPlugin: () => ({
    downloadLanQuestionBank: async options => {
      downloads++; urls.push(options.url)
      if (failure === 'network') throw Error('synthetic interrupted transfer')
      return { cleanupToken: 'owned-temp', packageData: failure === 'json' ? 'invalid' : JSON.stringify({ manifest: { ...item, packageId: failure === 'identity' ? 'wrong' : item.packageId } }) }
    },
    resolveQuestionBankAssets: async options => cleanup.push(options),
  }) },
  './database': { row: async (sql, values = []) => db.prepare(sql).get(...values) },
  './errors': { LocalApiError: class extends Error { constructor(status, message) { super(message); this.status = status } } },
  './lan-transport': { LanTransport: { post: async options => { urls.push(options.url); return { status: 200, data: catalog } } } },
  './lan-sync': { withLanQuestionBankSession: async (host, operation) => {
    if (host && host !== 'host-a') throw Error('host changed')
    return operation({ token: 'synthetic', base, tls: { hostId: 'host-a' } })
  } },
  './question-bank': { createEsqImportFromNativePackage: async () => {
    imports++
    if (failure === 'storage') throw Error('synthetic storage failure')
    return { id: 7 }
  } },
}
const context = { exports: {}, require: name => dependencies[name] }
vm.runInNewContext(ts.transpileModule(read('lan-question-banks'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
const api = context.exports
await api.checkLanQuestionBanks()
assert.equal(downloads, 0, 'catalog checks never download')
for (const bad of [{ ...catalog, hostId: 'other' }, { ...catalog, packages: [item, item] },
  { ...catalog, packages: [{ ...item, fileName: '../private' }] }, { ...catalog, packages: [{ ...item, size: -1 }] }]) {
  assert.throws(() => api.validateLanBankCatalog(bad, 'host-a'))
}
await assert.rejects(api.downloadLanQuestionBank('other', item, { newProfileName: 'Test' }))
await assert.rejects(api.downloadLanQuestionBank('host-a', { ...item, sha256: 'c'.repeat(64) }, { newProfileName: 'Test' }))
await assert.rejects(api.downloadLanQuestionBank('host-a', item, { profileId: 99999 }))
assert.equal(downloads, 0)
for (failure of ['network', 'json', 'identity', 'storage']) {
  await assert.rejects(api.downloadLanQuestionBank('host-a', item, { newProfileName: 'Test' }))
  if (failure !== 'network') assert.equal(cleanup.at(-1).delete, true, failure + ' releases extracted assets')
}
failure = ''
base = 'https://192.168.1.3:8767'
const result = await api.downloadLanQuestionBank('host-a', item, { newProfileName: 'Test' })
assert.equal(result.id, 7)
assert.equal(cleanup.at(-1).delete, false)
assert.ok(urls.at(-1).startsWith(base), 'uses recovered authenticated address')
db.prepare("INSERT INTO esq_import_jobs(filename,status,package_data) VALUES (?,?,?)").run('same.esq', 'draft', JSON.stringify({ manifest: { packageId: 'lan.bank.other-host', contentVersion: item.contentVersion } }))
const before = downloads
assert.equal((await api.downloadLanQuestionBank('host-a', item, { newProfileName: 'Test' })).skipped, true)
assert.equal(downloads, before, 'same content from another host is not downloaded again')
db.exec('DELETE FROM esq_import_jobs')
assert.equal((await api.downloadLanQuestionBank('host-a', item, { newProfileName: 'Test' })).skipped, false, 'deleted draft can retry')
db.close()
console.log('LAN banks: catalog-only, boundaries, host/address, retries, cleanup, content dedup passed')
