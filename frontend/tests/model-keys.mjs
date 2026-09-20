import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const clone = x => JSON.parse(JSON.stringify(x))
function load(path, require = () => ({})) {
  const context = { exports: {}, require, URL, TextEncoder, crypto: webcrypto, structuredClone }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/platform/' + path + '.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return context.exports
}
const policy = load('model-keys')
for (const [input, expected] of [
  [' https://EXAMPLE.test/v1 ', 'https://example.test/v1'],
  ['https://[ABCD::1]:443/V1/', 'https://[abcd::1]:443/V1/'],
  ['http://EXAMPLE.test:80', 'http://example.test:80'],
]) assert.equal(policy.baseIdentity(input), expected)
for (const value of ['https://u:p@example.test', 'https://example.test?key=x', 'https://exa\nmple.test', 'https://example.test:bad', 'https://example.test:99999', 'https://example.test\\evil']) assert.throws(() => policy.baseIdentity(value))
assert.notEqual(policy.baseIdentity('https://example.test/v1'), policy.baseIdentity('https://example.test/v1/'))

const storage = new Map([['ai-profile-1-api-key', 'synthetic-legacy']])
let failSave = false, failRemove = false, failPush = false, status = 200
let profiles = [{ id: 1, name: 'Receiver', adapter: 'openai-chat', base_url: 'https://EXAMPLE.test/v1', default_model: 'test', temperature: 0.2, max_tokens: 0, reasoning_effort: '', system_prompt: '' }]
const db = {
  transaction: async operation => operation(),
  row: async (sql, args) => profiles.find(p => sql.includes('name = ?') ? p.name === args[0] : p.id === args[0]) || null,
  rows: async () => clone(profiles),
  run: async (sql, values) => { if (sql.includes('ai_profile_models')) { catalogs.push(values); return }; const fields = ['name', 'adapter', 'base_url', 'default_model', 'temperature', 'max_tokens', 'reasoning_effort', 'system_prompt']; profiles.push({ id: profiles.length + 1, ...Object.fromEntries(fields.map((f, i) => [f, values[i]])) }) },
}
const catalogs = []
const secureStore = {
  get: async key => storage.get(key) ?? null,
  set: async (key, value) => { if (failSave) throw Error('injected storage failure'); storage.set(key, value) },
  remove: async key => { if (failRemove) throw Error('injected remove failure'); storage.delete(key) },
}
const makeStore = () => load('android/model-key-store', name => name === '../secure-store' ? { secureStore } : name === '../model-keys' ? policy : db)
let vault = makeStore()
failSave = true
await assert.rejects(vault.namedKeySummary(1))
assert.equal(storage.get('ai-profile-1-api-key'), 'synthetic-legacy')
failSave = false
failRemove = true
await assert.rejects(vault.namedKeySummary(1))
assert.ok(storage.has('ai-named-keys-v1'))
failRemove = false
vault = makeStore()
assert.equal(await vault.selectedKey(1), 'synthetic-legacy')
assert.equal(storage.has('ai-profile-1-api-key'), false)
assert.equal((await vault.namedKeySummary(1)).keys.length, 1)
assert.ok(!JSON.stringify(await vault.namedKeySummary(1)).includes('synthetic-legacy'))
await assert.rejects(vault.editNamedKey(1, { action: 'add', value: { secret: 'synthetic' }, name: 'Bad' }))
const value = 'synthetic-incoming'
const identity = await policy.keyIdentity(value)
let incoming = [{ ...profiles[0], name: 'Remote', adapter: 'openai-responses', keys: [{ id: identity, name: 'Remote key', value }], selected: identity }].map(({ id, ...p }) => p)
const calls = []
const transport = { LanTransport: { post: async request => {
  calls.push(clone(request))
  if (request.data.operation === 'pull') return { status, data: { version: 1, known: {}, profiles: clone(incoming) } }
  if (failPush) throw Error('injected disconnect')
  return { status, data: { version: 1, conflicts: [] } }
} } }
const exchange = load('android/model-key-sync', name => name === '../model-keys' ? policy : name === './model-key-store' ? vault : name === './lan-transport' ? transport : db)
const sync = () => exchange.syncModelKeys('https://192.168.1.2:8767', 'synthetic-token', { hostId: 'synthetic-host', certificateSha256: 'synthetic-pin' })
failPush = true
await assert.rejects(sync())
failPush = false
await sync(); await sync()
assert.equal((await vault.namedKeySummary(1)).keys.length, 2)
assert.equal(await vault.selectedKey(1), 'synthetic-legacy')
assert.equal(profiles[0].name, 'Receiver')
await vault.editNamedKey(1, { action: 'delete', identity })
await sync()
assert.equal((await vault.namedKeySummary(1)).keys.length, 1)
assert.ok(calls.at(-2).data.known['https://example.test/v1'].includes(identity))
assert.ok(calls.every(call => call.tls && call.url.startsWith('https://')))
status = 403
const before = storage.get('ai-named-keys-v1')
await assert.rejects(sync(), /403/)
assert.equal(storage.get('ai-named-keys-v1'), before)
status = 200
incoming[0].adapter = 'anthropic'
await assert.rejects(sync(), /#1/)
assert.equal((await vault.namedKeySummary(1)).keys.length, 1)
incoming[0].adapter = 'openai-chat'
incoming.push({ ...incoming[0], keys: [{ ...incoming[0].keys[0], id: '0'.repeat(64) }] })
await assert.rejects(sync())
assert.equal((await vault.namedKeySummary(1)).keys.length, 1)
await vault.suppressProfileKeys(1, profiles[0].base_url, async () => { profiles = [] })
await assert.rejects(vault.selectedKey(1))
incoming = incoming.slice(0, 1)
await sync()
assert.equal(profiles.length, 0, 'deleted profile must not resurrect')
incoming[0].base_url = 'https://new.test/v1/'
await sync(); await sync()
assert.equal(profiles.length, 1)
assert.equal(catalogs.length, 1)
assert.equal(catalogs[0][1], 'test')
assert.equal(await vault.selectedKey(profiles[0].id), '')
console.log('S4: identities, migration interruption/restart, redaction, manual selection, duplicate/replay, suppression, TLS arguments, permission rejection and conflicts passed')
