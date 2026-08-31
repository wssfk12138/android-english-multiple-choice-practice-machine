import assert from 'node:assert/strict'
import { resolveQuestionBankCatalogSources, validateQuestionBankCatalog, validateQuestionBankRemoteUrl } from '../src/platform/updates.ts'
import { MAX_ESQ_BYTES } from '../src/platform/question-bank-limits.ts'

function remotePackage(overrides = {}) {
  return {
    packageId: 'cet4-2026', title: 'CET4 2026', contentVersion: '1.0.0',
    fileName: 'cet4-2026.esq', downloadUrl: 'https://example.com/releases/cet4.esq',
    sha256: 'A'.repeat(64), size: 1234, license: 'licensed for redistribution',
    years: [2026, 2025, 2026], ...overrides,
  }
}

const normalized = validateQuestionBankCatalog({ catalogVersion: 1, packages: [remotePackage()] })
assert.equal(normalized.packages[0].sha256, 'a'.repeat(64))
assert.deepEqual(normalized.packages[0].years, [2025, 2026])
for (const fileName of ['../bank.esq', String.raw`..\bank.esq`, 'folder/bank.esq', String.raw`C:\bank.esq`, ' bank.esq']) {
  assert.throws(() => validateQuestionBankCatalog({ catalogVersion: 1, packages: [remotePackage({ fileName })] }), /fileName/)
}
assert.throws(() => validateQuestionBankCatalog({ catalogVersion: 1, packages: [remotePackage(), remotePackage()] }), /重复/)
assert.throws(() => validateQuestionBankCatalog({ catalogVersion: 1, packages: [remotePackage({ contentVersion: 'v1' })] }), /contentVersion/)
assert.throws(() => validateQuestionBankCatalog({ catalogVersion: 1, packages: [remotePackage({ sha256: 'abc' })] }), /SHA-256/)
assert.throws(() => validateQuestionBankCatalog({ catalogVersion: 1, packages: [remotePackage({ size: 0 })] }), /size/)
assert.doesNotThrow(() => validateQuestionBankCatalog({ catalogVersion: 1, packages: [remotePackage({ size: MAX_ESQ_BYTES })] }))
assert.throws(() => validateQuestionBankCatalog({ catalogVersion: 1, packages: [remotePackage({ size: MAX_ESQ_BYTES + 1 })] }), /size/)
assert.throws(() => validateQuestionBankCatalog({ catalogVersion: 1, packages: Array.from({ length: 501 }, (_, index) => remotePackage({ packageId: `bank-${index}` })) }), /500/)
assert.throws(() => validateQuestionBankRemoteUrl('http://example.com/bank.esq'), /HTTPS/)
assert.throws(() => validateQuestionBankRemoteUrl('https://user:password@example.com/bank.esq'), /HTTPS/)
assert.throws(() => validateQuestionBankRemoteUrl('https://example.com:8443/bank.esq'), /HTTPS/)
for (const url of ['https://localhost/bank.esq', 'https://192.168.1.2/bank.esq', 'https://[::1]/bank.esq']) {
  assert.throws(() => validateQuestionBankRemoteUrl(url), /局域网/)
}
assert.equal(validateQuestionBankRemoteUrl('https://example.com/bank.esq'), 'https://example.com/bank.esq')
assert.deepEqual(resolveQuestionBankCatalogSources({}), [])
assert.deepEqual(resolveQuestionBankCatalogSources({
  officialUrl: 'https://official.example/catalog.json',
  controlledMirrorUrls: ['https://mirror.example/catalog.json', 'https://mirror.example/catalog.json'],
}), ['https://official.example/catalog.json', 'https://mirror.example/catalog.json'])
assert.deepEqual(resolveQuestionBankCatalogSources({
  officialUrl: 'https://official.example/catalog.json',
  controlledMirrorUrls: ['https://mirror.example/catalog.json'],
  thirdPartyUrl: 'https://third-party.example/catalog.json',
}), ['https://third-party.example/catalog.json'])
console.log('Question-bank catalog validation verified')
