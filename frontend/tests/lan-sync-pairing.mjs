import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/platform/android/lan-sync.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source + '\nexport { handshake };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const pairingContext = { exports: {}, URL, Date }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/platform/android/lan-pairing.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, pairingContext)
const recoveryContext = { exports: {}, require: () => pairingContext.exports }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/platform/android/lan-recovery.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, recoveryContext)
const pairing = { host: 'https://192.168.1.2:8767', pairingCode: 'a'.repeat(43),
  expiresAt: Math.floor(Date.now() / 1000) + 180, tls: {
    hostId: '12345678-1234-1234-1234-123456789abc',
    certificatePem: '-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----\n',
    certificatePin: 'sha256/' + 'A'.repeat(43) + '=',
  } }
const hostKey = 'lan-sync-host-v2:' + pairing.tls.hostId
const categories = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/platform/android/lan-categories.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, categories)

function fixture() {
  const settings = new Map([
    ['lan_sync_host', 'http://192.168.1.2:8766'],
    ['lan_sync_passcode', 'stale-passcode'],
    ['lan_sync_device_id', 'android-existing'],
  ])
  const secrets = new Map([['lan-sync-pairing-token:http%3A%2F%2F192.168.1.2%3A8766', 'old-token']])
  const calls = []
  const requests = []
  let failStore = false
  let failWrite = false
  let accept = false
  let failDb = false
  let recover = false
  let wrongIdentity = false
  const database = {
    row: async (_sql, values) => ({ value: settings.get(values[0]) }),
    rows: async () => [{ name: 'Bank A' }],
    run: async (_sql, values) => { settings.set(values[0], values[1]) },
    transaction: async callback => {
      if (failDb) throw new Error('database unavailable')
      return callback(database)
    },
  }
  class LocalApiError extends Error {
    constructor(status, message) { super(message); this.status = status }
  }
  const modules = {
    './lan-categories': categories.exports,
    './lan-pairing': pairingContext.exports,
    './lan-recovery': recoveryContext.exports,
    './database': database,
    './app-settings': {readAppSetting:async key=>settings.get(key)||'',writeAppSetting:async(key,value)=>settings.set(key,value),invalidateAppSettings:()=>{}},
    './errors': { LocalApiError },
    '../secure-store': { secureStore: {
      get: async key => { if (failStore) throw new Error('secure storage unavailable'); return secrets.get(key) },
      set: async (key, value) => { if (failStore || failWrite) throw new Error('secure storage unavailable'); secrets.set(key, value) },
    } },
    './lan-transport': {
      validateLanBaseUrl: value => value,
      LanTransport: { discover: async () => ({ urls: ['https://192.168.1.9:8767'] }), post: async (request) => {
        requests.push(request)
        const { data } = request
        calls.push(data)
        if (recover && request.url.startsWith(pairing.host + '/')) throw Object.assign(new Error('address moved'), { code: 'LAN_NETWORK_ERROR' })
        return accept ? { status: 200, data: { host_id: wrongIdentity ? 'wrong-host' : pairing.tls.hostId, version: 2, category_protocol: 1, host_categories: categories.exports.DEFAULT_CATEGORIES, effective_categories: categories.exports.DEFAULT_CATEGORIES } } : { status: 401, data: {} }
      } },
    },
    './lan-sync-validation': {
      validateLanSyncHandshakeResponse: () => ({ token: 'session-only', pairingToken: 'new-token' }),
    },
  }
  const context = { exports: {}, URL, crypto: webcrypto, require: name => modules[name] || {} }
  vm.runInNewContext(code, context)
  return { ...context.exports, settings, secrets, calls, requests, recover: () => { recover = true }, wrongIdentity: () => { wrongIdentity = true }, failDb: () => { failDb = true }, accept: () => { accept = true }, failStore: () => { failStore = true }, failWrite: () => { failWrite = true } }
}

{
  const f = fixture()
  await assert.rejects(f.handshake(), error => error.status === 401)
  assert.equal(f.calls.length, 1, 'revoked device must not fall back to an old saved passcode')
  assert.equal(f.calls[0].passcode, '')
  assert.equal(f.settings.get('lan_sync_device_id'), 'android-existing')
  await f.updateLanSyncSettings({ lan_sync_passcode: 'newly-entered' })
  await assert.rejects(f.handshake(), error => error.status === 401)
  assert.equal(f.calls.length, 3, 'explicit save may retry with the entered passcode')
  assert.equal(f.calls.at(-1).passcode, 'newly-entered')
  assert.equal(f.settings.get('lan_sync_pairing_requested'), '0')
  assert.equal([...f.secrets.values()][0], 'old-token', 'failed replacement retains original credential')
}
{
  const f = fixture()
  f.accept()
  await f.handshake()
  assert.equal(f.settings.get('lan_sync_passcode'), '')
  assert.equal(f.settings.get('lan_sync_pairing_requested'), '0')
  assert.equal([...f.secrets.values()][0], 'new-token')
  await f.handshake()
  assert.equal(f.calls.at(-1).pairing_token, 'new-token')
  assert.equal(f.calls.at(-1).device_id, 'android-existing')
}
{
  const f = fixture()
  f.secrets.clear()
  await assert.rejects(f.handshake())
  assert.equal(f.calls[0].passcode, '', 'missing secure credential is not permission to reuse a stale passcode')
  f.settings.delete('lan_sync_device_id')
  f.accept()
  await f.updateLanSyncSettings({ lan_sync_passcode: 'explicit-first-pair' })
  await f.handshake()
  assert.match(f.settings.get('lan_sync_device_id'), /^android-[0-9a-f-]{36}$/)
}
{
  const f = fixture()
  f.failStore()
  await assert.rejects(f.handshake(), /secure storage unavailable/)
  assert.equal(f.calls.length, 0, 'storage failure must not send a passcode or claim success')
}
{
  const f = fixture()
  await f.updateLanSyncSettings({ lan_sync_passcode: 'explicit-pair' })
  f.accept()
  f.failWrite()
  await assert.rejects(f.handshake(), /secure storage unavailable/)
  assert.equal(f.calls.length, 1)
  assert.equal(f.settings.get('lan_sync_pairing_requested'), '1')
  assert.equal(f.settings.get('lan_sync_passcode'), 'explicit-pair')
  assert.equal([...f.secrets.values()][0], 'old-token')
}
{
  const f = fixture()
  await f.updateLanSyncSettings({ lan_sync_host: pairing.host, pairing })
  assert.equal(f.settings.get('lan_sync_host_id'), pairing.tls.hostId)
  assert.equal(f.settings.get('lan_sync_passcode'), '')
  f.accept()
  const result = await f.handshake()
  assert.equal(f.calls[0].pairing_token, '', 'HTTP token must not migrate to TLS')
  assert.equal(f.calls[0].pairing_code, pairing.pairingCode)
  assert.equal(f.requests[0].tls.hostId, pairing.tls.hostId)
  assert.equal(f.calls[0].device_id, 'android-existing')
  assert.equal(JSON.parse(f.secrets.get(hostKey)).pairingCode, '')
  assert.match(result.profileFingerprint, new RegExp(pairing.tls.hostId))
  await f.updateLanSyncSettings({ lan_sync_host: 'https://192.168.1.9:8767' })
  await f.handshake()
  assert.equal(f.calls.at(-1).pairing_token, 'new-token')
  assert.equal(f.requests.at(-1).url, 'https://192.168.1.9:8767/api/lan-sync/handshake')
  await assert.rejects(f.updateLanSyncSettings({ lan_sync_host: 'http://192.168.1.9:8766' }))
  await assert.rejects(f.updateLanSyncSettings({ lan_sync_host: pairing.host, pairing: { ...pairing, tls: { ...pairing.tls, certificatePin: 'sha256/' + 'B'.repeat(43) + '=' } } }))
}
for (const failure of ['failWrite', 'failDb']) {
  const f = fixture()
  f[failure]()
  await assert.rejects(f.updateLanSyncSettings({ lan_sync_host: pairing.host, pairing }))
  assert.equal(f.settings.get('lan_sync_host'), 'http://192.168.1.2:8766')
  assert.equal(f.settings.has('lan_sync_host_id'), false)
  assert.equal(f.calls.length, 0)
}
{
  const f = fixture()
  await f.updateLanSyncSettings({ lan_sync_host: pairing.host, pairing })
  await assert.rejects(f.handshake())
  assert.equal(JSON.parse(f.secrets.get(hostKey)).pairingCode, '')
  await assert.rejects(f.handshake())
  assert.equal(f.calls.at(-1).pairing_code, '', 'rejected QR must not be replayed')
  f.secrets.set(hostKey, '{invalid')
  const count = f.calls.length
  await assert.rejects(f.handshake())
  assert.equal(f.calls.length, count)
}
for (const outcome of ['success', 'wrongIdentity', 'failWrite']) {
  const f = fixture()
  await f.updateLanSyncSettings({ lan_sync_host: pairing.host, pairing })
  f.accept()
  await f.handshake()
  f.recover()
  if (outcome === 'wrongIdentity' || outcome === 'failWrite') f[outcome]()
  if (outcome === 'success') {
    await f.handshake()
    assert.equal(f.settings.get('lan_sync_host'), 'https://192.168.1.9:8767')
  } else {
    await assert.rejects(f.handshake())
    assert.equal(f.settings.get('lan_sync_host'), pairing.host)
  }
  assert.equal(f.requests.at(-1).tls.certificatePin, pairing.tls.certificatePin)
  assert.equal(f.calls.at(-1).pairing_token, 'new-token')
}
{
  const f = fixture()
  await f.updateLanSyncSettings({ lan_sync_host: pairing.host, pairing })
  f.recover()
  await assert.rejects(f.handshake(), error => error.status === 401)
  assert.equal(f.settings.get('lan_sync_host'), pairing.host)
}
for (const invalid of [
  { ...pairing, host: 'http://192.168.1.2:8767' },
  { ...pairing, host: 'https://example.com:8767' },
  { ...pairing, expiresAt: 1 },
  { ...pairing, tls: { ...pairing.tls, certificatePin: 'invalid' } },
]) assert.throws(() => pairingContext.exports.validateTlsPairing(invalid))
console.log('LAN pairing: legacy and TLS migration, address changes, protocol isolation, validation and storage failures passed')
