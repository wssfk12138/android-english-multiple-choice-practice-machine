import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createSyncCoordinator } from '../src/platform/android/sync-coordinator.ts'
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
const rejected = classifyLanSyncError(new LocalApiError(422, '向电脑端推送数据失败：422'))
assert.equal(rejected.code, 'DATA_REJECTED')
assert.equal(rejected.retryable, false)
assert.equal(rejected.pauseAuto, true)
assert.match(rejected.message, /本机记录已保留/)
assert.doesNotMatch(rejected.message, /自动重试/)
assert.equal(classifyLanSyncError(new LocalApiError(500, '向电脑端推送数据失败：500')).retryable, true)
assert.equal(classifyLanSyncError(new LocalApiError(401, '向电脑端推送数据失败：401')).code, 'AUTH_EXPIRED')

const source = readFileSync(new URL('../src/platform/android/sync-scheduler.ts', import.meta.url), 'utf8')
const view = readFileSync(new URL('../src/views/AndroidUpdatesView.vue', import.meta.url), 'utf8')
assert.ok(view.includes('lanSync.runtime.autoPaused && lanSync.runtime.errorCode ==='))
assert.ok(view.includes('自动同步已暂停，请处理上述问题后手动同步'))
const schedulerModule = { exports: {} }
let attempts = 0
let rejectSync
let acceptSync
const timers = new Map()
const intervals = []
const dependencies = {
  '@capacitor/app': { App: { addListener: async () => ({ remove() {} }) } },
  '@capacitor/network': { Network: { getStatus: async () => ({ connected: true }), addListener: async () => ({ remove() {} }) } },
  './lan-sync': {
    lanSyncStatus: async () => ({ configured: true, auto: true }),
    runLanSync: () => { attempts++; return new Promise((resolve, reject) => { acceptSync = resolve; rejectSync = reject }) },
  },
  './sync-coordinator': { createSyncCoordinator },
  './lan-sync-errors': { classifyLanSyncError },
  './sync-retry-policy': { getLanSyncRetryDelayMs: () => 1000 },
}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports: schedulerModule.exports,
  require: name => { assert.ok(dependencies[name], name); return dependencies[name] },
  setTimeout: fn => { const id = {}; timers.set(id, fn); return id },
  clearTimeout: id => timers.delete(id),
  setInterval: fn => { intervals.push(fn); return fn },
  clearInterval() {},
})
const scheduler = schedulerModule.exports
const flush = () => new Promise(resolve => setImmediate(resolve))
await scheduler.refreshSyncState()
const manual = scheduler.syncNow()
await flush()
scheduler.notifyLocalChange()
const pendingChange = [...timers.values()][0]
timers.clear()
pendingChange()
rejectSync(new LocalApiError(422, '向电脑端推送数据失败：422'))
await assert.rejects(manual, error => error.code === 'DATA_REJECTED')
await flush()
assert.equal(attempts, 1, 'rejected data must cancel a queued automatic follow-up')
assert.equal(scheduler.syncState().autoPaused, true, 'manual rejection must pause automatic sync')
assert.equal(scheduler.syncState().nextRetryAt, '')
await scheduler.startAutoSync()
intervals[0]()
await flush()
assert.equal(attempts, 1, 'polling must not retry rejected data')
const recovery = scheduler.syncNow()
await flush()
acceptSync({ last_sync_at: '2026-09-07T00:00:00Z' })
await recovery
assert.equal(scheduler.syncState().autoPaused, false, 'successful manual recovery must resume automatic sync')
scheduler.stopAutoSync()

console.log('Android LAN sync error classification: OK')
