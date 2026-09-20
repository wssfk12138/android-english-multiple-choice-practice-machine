import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@capacitor/core') return { url: 'data:text/javascript,export const CapacitorHttp = {}', shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { CapacitorHttp } = await import('@capacitor/core')
const { fetchUpdateManifest, fetchQuestionBankCatalog } = await import('../src/platform/updates.ts')
import { decodeJsonResponse } from '../src/platform/json-response.ts'

const url = 'https://example.com/data.json'
const manifest = { schemaVersion: 1, channel: 'beta', versionName: '1.0.0', versionCode: 104, apkUrl: 'https://example.com/app.apk', apkSha256: 'a'.repeat(64) }
const catalog = { catalogVersion: 1, updatedAt: '', packages: [] }
const originalGet = CapacitorHttp.get
let count = 0
try {
  for (const [fetcher, value] of [[fetchUpdateManifest, manifest], [fetchQuestionBankCatalog, catalog]]) {
    for (const contentType of ['application/json', 'text/plain', 'application/octet-stream']) {
      CapacitorHttp.get = async () => ({ status: 200, url, headers: { 'Content-Type': contentType }, data: contentType === 'application/json' ? value : JSON.stringify(value) })
      assert.deepEqual(await fetcher(url), value)
      count++
    }
    for (const [data, code] of [['{', 'REMOTE_JSON_SYNTAX'], ['null', 'REMOTE_JSON_SCHEMA'], ['{}', 'REMOTE_JSON_SCHEMA'], ['x'.repeat(2 * 1024 * 1024 + 1), 'REMOTE_JSON_SIZE']]) {
      CapacitorHttp.get = async () => ({ status: 200, url, data })
      await assert.rejects(fetcher(url), error => error.code === code)
      count++
    }
    CapacitorHttp.get = async () => ({ status: 404, url, data: '<html>missing</html>' })
    await assert.rejects(fetcher(url), error => error.code === 'HTTP_404')
    const timeout = new Error('request timeout')
    CapacitorHttp.get = async () => { throw timeout }
    await assert.rejects(fetcher(url), error => error.code === 'REMOTE_TIMEOUT')
    CapacitorHttp.get = async () => { throw new Error('connection refused') }
    await assert.rejects(fetcher(url), error => error.code === 'REMOTE_NETWORK')
    count += 3
  }
  assert.throws(() => decodeJsonResponse('中文', 'JSON', 5), error => error.code === 'REMOTE_JSON_SIZE')
} finally {
  CapacitorHttp.get = originalGet
  hooks.deregister()
}
console.log('JSON HTTP boundary: ' + count + ' cases passed, plus UTF-8 byte cap')
