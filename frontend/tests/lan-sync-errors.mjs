import assert from 'node:assert/strict'
import { LocalApiError } from '../src/platform/android/errors.ts'
import { LanSyncError, classifyLanSyncError } from '../src/platform/android/lan-sync-errors.ts'

assert.equal(classifyLanSyncError(new LocalApiError(401, 'unauthorized')).code, 'AUTH_EXPIRED')
assert.equal(classifyLanSyncError({ code: 'LAN_TIMEOUT' }).code, 'TIMEOUT')
assert.equal(classifyLanSyncError({ code: 'LAN_NETWORK_ERROR' }).code, 'CONNECTION_REFUSED')
assert.equal(classifyLanSyncError(new LocalApiError(503, 'service unavailable')).code, 'SERVICE_DISABLED')
assert.equal(classifyLanSyncError(new LocalApiError(422, '同步地址格式不正确')).code, 'INVALID_CONFIGURATION')
assert.equal(classifyLanSyncError(new Error('从电脑端拉取数据失败：返回数据无效')).code, 'PULL_FAILED')
assert.equal(classifyLanSyncError(new Error('向电脑端推送数据失败：返回数据无效')).code, 'PUSH_FAILED')

const auth = classifyLanSyncError(new LocalApiError(403, 'forbidden'))
assert.ok(auth instanceof LanSyncError)
assert.equal(auth.pauseAuto, true)
assert.equal(auth.retryable, false)
assert.doesNotMatch(auth.message, /token|passcode|口令：/)

console.log('Android LAN sync error classification: OK')
