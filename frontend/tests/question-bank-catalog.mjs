import assert from 'node:assert/strict'
import { validateQuestionBankCatalog, validateQuestionBankRemoteUrl } from '../src/platform/updates.ts'
import { MAX_ESQ_BYTES } from '../src/platform/question-bank-limits.ts'

function remotePackage(overrides = {}) {
  return {
    packageId: 'cet4-2026',
    title: 'CET4 2026',
    contentVersion: '1.0.0',
    fileName: 'cet4-2026.esq',
    downloadUrl: 'https://github.com/example/banks/releases/download/v1/cet4.esq',
    sha256: 'A'.repeat(64),
    size: 1234,
    license: 'licensed for redistribution',
    years: [2026, 2025, 2026],
    ...overrides,
  }
}

const normalized = validateQuestionBankCatalog({
  catalogVersion: 1,
  updatedAt: '2026-08-27T12:00:00Z',
  packages: [remotePackage()],
})
assert.equal(normalized.catalogVersion, 1)
assert.equal(normalized.packages[0].sha256, 'a'.repeat(64))
assert.deepEqual(normalized.packages[0].years, [2025, 2026])

for (const fileName of ['../bank.esq', String.raw`..\bank.esq`, 'folder/bank.esq', String.raw`C:\bank.esq`, ' bank.esq']) {
  assert.throws(
    () => validateQuestionBankCatalog({ catalogVersion: 1, packages: [remotePackage({ fileName })] }),
    /fileName/,
  )
}
assert.throws(
  () => validateQuestionBankCatalog({ catalogVersion: 1, packages: [remotePackage(), remotePackage()] }),
  /重复/,
)
assert.throws(
  () => validateQuestionBankCatalog({ catalogVersion: 1, packages: [remotePackage({ contentVersion: 'v1' })] }),
  /contentVersion/,
)
assert.throws(
  () => validateQuestionBankCatalog({ catalogVersion: 1, packages: [remotePackage({ sha256: 'abc' })] }),
  /SHA-256/,
)
assert.throws(
  () => validateQuestionBankCatalog({ catalogVersion: 1, packages: [remotePackage({ size: 0 })] }),
  /size/,
)
assert.doesNotThrow(
  () => validateQuestionBankCatalog({
    catalogVersion: 1,
    packages: [remotePackage({ size: MAX_ESQ_BYTES })],
  }),
)
assert.throws(
  () => validateQuestionBankCatalog({
    catalogVersion: 1,
    packages: [remotePackage({ size: MAX_ESQ_BYTES + 1 })],
  }),
  /size/,
)
assert.throws(
  () => validateQuestionBankCatalog({
    catalogVersion: 1,
    packages: Array.from({ length: 501 }, (_, index) => remotePackage({ packageId: `bank-${index}` })),
  }),
  /500/,
)
assert.throws(
  () => validateQuestionBankCatalog({
    catalogVersion: 1,
    packages: [remotePackage({ downloadUrl: 'http://example.com/bank.esq' })],
  }),
  /HTTPS/,
)
assert.doesNotThrow(() => validateQuestionBankCatalog({
  catalogVersion: 1,
  packages: [remotePackage({ downloadUrl: 'http://localhost:8765/bank.esq' })],
}))
for (const privateUrl of [
  'http://127.0.0.1:8877/bank.esq',
  'http://10.0.0.8:8877/bank.esq',
  'http://172.16.0.8:8877/bank.esq',
  'http://172.31.255.254:8877/bank.esq',
  'http://192.168.50.10:8877/bank.esq',
]) {
  assert.doesNotThrow(() => validateQuestionBankRemoteUrl(privateUrl))
}
for (const publicHttpUrl of [
  'http://8.8.8.8/bank.esq',
  'http://172.15.0.8/bank.esq',
  'http://172.32.0.8/bank.esq',
  'http://192.169.0.8/bank.esq',
  'http://lan.example/bank.esq',
]) {
  assert.throws(() => validateQuestionBankRemoteUrl(publicHttpUrl), /HTTPS/)
}
assert.equal(
  validateQuestionBankRemoteUrl('https://github.com/example/banks/releases/download/v1/bank.esq'),
  'https://github.com/example/banks/releases/download/v1/bank.esq',
)
assert.throws(
  () => validateQuestionBankRemoteUrl('http://example.com/redirected.esq', '最终响应地址'),
  /最终响应地址.*HTTPS/,
)
assert.throws(
  () => validateQuestionBankRemoteUrl('https://user:password@example.com/bank.esq'),
  /HTTPS/,
)
assert.throws(
  () => validateQuestionBankRemoteUrl('http://user:password@192.168.50.10:8877/bank.esq'),
  /HTTPS/,
)

console.log('Question-bank catalog validation verified')
