import assert from 'node:assert/strict'
import { LAN_SYNC_RETRY_DELAYS_MS, getLanSyncRetryDelayMs } from '../src/platform/android/sync-retry-policy.ts'

assert.deepEqual([...LAN_SYNC_RETRY_DELAYS_MS], [5000, 15000, 30000, 60000, 120000, 300000])
assert.equal(getLanSyncRetryDelayMs(0), 5000)
assert.equal(getLanSyncRetryDelayMs(1), 15000)
assert.equal(getLanSyncRetryDelayMs(2), 30000)
assert.equal(getLanSyncRetryDelayMs(3), 60000)
assert.equal(getLanSyncRetryDelayMs(4), 120000)
assert.equal(getLanSyncRetryDelayMs(5), 300000)
assert.equal(getLanSyncRetryDelayMs(99), 300000)
assert.equal(getLanSyncRetryDelayMs(-3), 5000)
assert.equal(getLanSyncRetryDelayMs(Number.NaN), 5000)

console.log('LAN sync retry policy: OK')
