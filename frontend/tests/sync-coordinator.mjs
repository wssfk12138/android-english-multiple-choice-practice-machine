import assert from 'node:assert/strict'
import { createSyncCoordinator } from '../src/platform/android/sync-coordinator.ts'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const runs = []
const coordinator = createSyncCoordinator(() => {
  const current = deferred()
  runs.push(current)
  return current.promise
})

const first = coordinator.runNow()
const joined = coordinator.runNow()
coordinator.requestAuto()
assert.equal(runs.length, 1, 'concurrent manual and automatic triggers must share one run')
runs[0].resolve('first-result')
assert.equal(await first, 'first-result')
assert.equal(await joined, 'first-result')

const second = coordinator.runNow()
coordinator.requestAuto(true)
coordinator.requestAuto(true)
assert.equal(runs.length, 2, 'local changes during a run must not start concurrently')
runs[1].resolve('second-result')
await second
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(runs.length, 3, 'multiple local changes during a run must queue one follow-up')
runs[2].resolve('follow-up-result')
await new Promise(resolve => setTimeout(resolve, 0))

const failed = coordinator.runNow()
runs[3].reject(new Error('expected failure'))
await assert.rejects(failed, /expected failure/)
const afterFailure = coordinator.runNow()
assert.equal(runs.length, 5, 'a failed run must release the coordinator')
runs[4].resolve('recovered')
assert.equal(await afterFailure, 'recovered')

console.log('Android LAN sync coordinator: OK')
