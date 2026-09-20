import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(name, require = () => ({})) {
  const context = { exports: {}, URL, Date, require }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/platform/android/' + name + '.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return context.exports
}
const pairing = load('lan-pairing')
const { parseLanSyncQrPayload: parse } = load('lan-sync-qr', name => name === './lan-pairing' ? pairing : {})
const fields = ['https://192.168.1.2:8767', '12345678-1234-1234-1234-123456789abc', 'YWJj',
  'sha256/' + 'A'.repeat(43) + '=', 'a'.repeat(43), Math.floor(Date.now() / 1000) + 180]
const result = parse('EPM2:' + JSON.stringify(fields))
assert.equal(result.host, fields[0])
assert.equal(result.pairing.tls.certificatePem, '-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----\n')
assert.equal(result.pairing.tls.certificatePin, fields[3])
assert.equal(result.pairing.pairingCode, fields[4])
assert.equal(result.pairing.expiresAt, fields[5])
const legacyV2 = parse(JSON.stringify({ type: 'english-practice-lan-sync', version: 2, host: fields[0],
  host_id: fields[1], certificate_pem: result.pairing.tls.certificatePem, certificate_pin: fields[3],
  pairing_code: fields[4], expires_at: fields[5] }))
assert.deepEqual(legacyV2, result)
assert.equal(parse(JSON.stringify({type: 'english-practice-lan-sync', version: 1, host: 'http://10.0.0.2:8766', passcode: 'ABCD'})).passcode, 'ABCD')
for (const value of [[], fields.slice(0, 5), [...fields, 'extra'], [...fields.slice(0, 5), 1],
  [fields[0], fields[1], '-----evil-----', ...fields.slice(3)], ['http://10.0.0.2:8766', ...fields.slice(1)]]) {
  assert.throws(() => parse('EPM2:' + JSON.stringify(value)))
}
assert.throws(() => parse('a'.repeat(16001)))
console.log('LAN QR: compact and legacy roundtrips, complete trust fields, expiry, malformed and oversized input passed')
