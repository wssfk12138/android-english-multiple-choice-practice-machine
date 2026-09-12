import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(name, require = () => ({})) {
  const context = { exports: {}, require, URL, Date }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/platform/android/' + name + '.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return context.exports
}
const pairing = load('lan-pairing')
const { recoverLanAddress } = load('lan-recovery', () => pairing)
const old = 'https://192.168.1.2:8767'
const next = 'https://192.168.1.9:8767'
const failure = code => Object.assign(new Error(code), { code })
for (const code of ['LAN_NETWORK_ERROR', 'LAN_TIMEOUT', 'LAN_TLS_IDENTITY_ERROR']) {
  const calls = []
  const result = await recoverLanAddress(old, async address => {
    calls.push(address)
    if (address === old) throw failure(code)
    return { status: 200 }
  }, async () => ({ urls: ['http://192.168.1.4:8766', 'https://example.com:8767', old, next] }))
  assert.equal(result.base, next)
  assert.deepEqual(calls, [old, next])
}
let discovered = false
assert.equal((await recoverLanAddress(old, async () => ({ status: 401 }), async () => {
  discovered = true; return { urls: [next] }
})).response.status, 401)
assert.equal(discovered, false, 'authentication rejection must not trigger a discovery retry')
await assert.rejects(recoverLanAddress(old, async () => { throw failure('LAN_REQUEST_INVALID') }, async () => {
  discovered = true; return { urls: [next] }
}))
assert.equal(discovered, false)
let requests = 0
await assert.rejects(recoverLanAddress(old, async () => { requests++; throw failure('LAN_TLS_IDENTITY_ERROR') },
  async () => ({ urls: Array.from({ length: 50 }, (_, i) => 'https://10.0.0.' + (i + 1) + ':8767') })))
assert.equal(requests, 5, 'discovery retries are bounded')
await assert.rejects(recoverLanAddress(old, async () => { throw failure('LAN_TIMEOUT') }, async () => { throw Error('offline') }), /LAN_TIMEOUT/)
console.log('LAN recovery: authenticated address recovery, invalid locators, bounded candidates and fail-closed errors passed')
