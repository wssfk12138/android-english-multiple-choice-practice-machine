import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const code = ts.transpileModule(readFileSync(new URL('../src/services/dailyStudy.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const context = { exports: {} }; vm.runInNewContext(code, context)
const { DailyStudySession, restoredStudyIndex, studySwipe, studyNavigationWindow, DAILY_STUDY_STORAGE } = context.exports
const members = Array.from({ length: 1203 }, (_, index) => ({ id: index + 1, term: 'word' + index, identity: 'stable' + index }))
const records = new Map()
let fail = false, revision = 'v2:1', scope = 'db1:bank1', catalogReads = 0, missing = new Set(), delayed = null
const storage = { getItem: key => records.get(key), setItem: (key, value) => { if (fail) throw Error('quota'); records.set(key, value) } }
const detail = async id => {
  if (delayed?.id === id) await delayed.promise
  if (missing.has(id)) throw Object.assign(Error('deleted'), { status: 404 })
  return { id, daily_study_identity: members[id - 1].identity, common_meaning: revision, review_count: 0 }
}
const dependencies = { catalog: async () => { catalogReads++; return { scope_key: scope, revision, items: [...members] } },
  status: async () => ({ scope_key: scope, revision }), detail, storage, changed() {} }
const session = new DailyStudySession(dependencies)
await session.open(); assert.equal(session.state.phase, 'ready')
await session.select(1202); assert.equal(session.state.entry.id, 1203)
session.save(83)
session.dispose()
const restored = new DailyStudySession(dependencies); await restored.open()
assert.equal(restored.state.index, 1202); assert.equal(restored.scrollTop, 83)
await restored.select(1203); assert.equal(restored.state.index, 1202, 'no wrap')
revision = 'v2:2'; await restored.refresh()
assert.equal(restored.state.entry.common_meaning, revision); assert.equal(catalogReads, 2, 'content refresh never rebuilds directory')
assert.equal(restored.scrollTop, 83)
missing.add(1203); revision = 'v2:3'; await restored.refresh()
assert.equal(restored.state.entry.id, 1202, 'deleted current falls to nearest member')
assert.equal(restored.state.items.length, 1202)
fail = true; restored.save(22); assert.equal(restored.state.saveFailed, true)
await restored.select(100); assert.equal(restored.state.entry.id, 101, 'storage errors never block movement')
fail = false; restored.save(); assert.equal(restored.state.saveFailed, false)
for (let index = 101; index < 130; index++) await restored.select(index)
assert.ok(restored.cacheSize <= 5)
scope = 'db2:bank1'; await restored.refresh()
assert.equal(restored.state.index, 0, 'database/scope identity separates resume records')
assert.equal(restoredStudyIndex(members, { id: 2, identity: 'reused', index: 50 }), 50, 'ID reuse never restores by numeric ID alone')
let release; delayed = { id: 800, promise: new Promise(resolve => release = resolve) }
const pending = restored.select(799); restored.dispose(); release(); await pending
assert.notEqual(restored.state.entry.id, 800, 'late completion cannot update disposed page')
assert.equal(studySwipe(-73, 10), 1); assert.equal(studySwipe(73, 10), -1)
assert.equal(studySwipe(72, 0), 0); assert.equal(studySwipe(73, 50), 0)
const window = studyNavigationWindow(1100, members.length)
assert.ok(window.end-window.start <= 41 && window.start <= 1100 && window.end > 1100)
assert.ok(records.get(DAILY_STUDY_STORAGE))
let invalid = true, retries = 0
const invalidSession = new DailyStudySession({ ...dependencies, catalog: async () => {
  retries++; return { scope_key: 'invalid', revision, items: invalid ? [{ id: 1, term: 'invalid', identity: '' }] : [...members] }
} })
await invalidSession.open(); assert.equal(invalidSession.state.phase, 'error')
invalid = false; await invalidSession.retry()
assert.equal(retries, 2); assert.equal(invalidSession.state.phase, 'ready', 'invalid directory retry must reload directory')
invalidSession.dispose()
const bounded = new DailyStudySession(dependencies); await bounded.open()
for (let index = 0; index < 205; index++) { await bounded.select(index); bounded.save(index) }
const boundedReading = JSON.parse(records.get(DAILY_STUDY_STORAGE))[scope]
assert.equal(Object.keys(boundedReading.positions).length, 200, 'long-term reading positions are bounded')
assert.equal(boundedReading.positions[members[204].identity], 204, 'current position retained')
bounded.dispose()
// Navigation commits only a successfully validated detail, never a requested index.
let finishRead, readFails = false, wrongIdentity = false
const navigationStorage = new Map()
const transactional = new DailyStudySession({ ...dependencies,
  catalog: async () => ({ scope_key: 'navigation', revision: 'v1', items: members.slice(0, 4) }),
  storage: { getItem: key => navigationStorage.get(key), setItem: (key, value) => navigationStorage.set(key, value) },
  detail: async id => {
    if (id === 4) { await new Promise(resolve => finishRead = resolve); if (readFails) throw Error('offline') }
    return { id, daily_study_identity: wrongIdentity && id === 4 ? 'reused' : members[id - 1].identity }
  },
})
await transactional.open(); transactional.save(91)
const slow = transactional.select(3)
assert.equal(transactional.state.index, 0); assert.equal(transactional.state.entry.id, 1)
transactional.save(91)
assert.equal(JSON.parse(navigationStorage.get(DAILY_STUDY_STORAGE)).navigation.id, 1, 'pending reads preserve stable reading identity')
readFails = true; finishRead(); await slow
assert.equal(transactional.state.index, 0); assert.equal(transactional.state.phase, 'ready')
assert.equal(transactional.scrollTop, 91); assert.match(transactional.state.error, /读取失败/)
readFails = false
const retryPending = transactional.retry(); finishRead(); await retryPending
assert.equal(transactional.state.entry.id, 4); assert.equal(transactional.state.index, 3, 'retry remembers failed target')
assert.equal(transactional.peek(3).id, 4); assert.equal(transactional.peek(5), null)
transactional.dispose()
const mismatchSession = new DailyStudySession({ ...dependencies, catalog: async () => ({ scope_key: 'mismatch', revision: 'v1', items: members.slice(0, 4) }),
  detail: async id => ({ id, daily_study_identity: id === 4 ? 'reused' : members[id - 1].identity }),
})
await mismatchSession.open(); await mismatchSession.select(3)
assert.equal(mismatchSession.state.entry.id, 3); assert.equal(mismatchSession.state.items.length, 3)
assert.equal(mismatchSession.peek(3), null, 'reused identity never enters adjacent display cache')
mismatchSession.dispose()
// A slow catalogue from an earlier filter must never replace the newly chosen
// range. The real page relies on this when two filters are tapped quickly.
const pendingCatalog = []
const raceSession = new DailyStudySession({
  ...dependencies,
  catalog: () => new Promise(resolve => pendingCatalog.push(resolve)),
  detail: async id => ({ id, daily_study_identity: 'race-' + id }),
  storage: { getItem: () => null, setItem: () => undefined },
})
const firstOpen = raceSession.open()
const secondOpen = raceSession.open()
pendingCatalog[1]({ scope_key: 'race-second', revision: 'v1', items: [{ id: 2, term: 'second', identity: 'race-2' }] })
await secondOpen
pendingCatalog[0]({ scope_key: 'race-first', revision: 'v1', items: [{ id: 1, term: 'first', identity: 'race-1' }] })
await firstOpen
assert.equal(raceSession.state.items[0].term, 'second', 'late catalogue cannot overwrite the active filter')
assert.equal(raceSession.state.entry.id, 2)
assert.equal(raceSession.state.busy, false)
raceSession.dispose()
console.log('PASS daily study session: persistence, deletion, identity reuse, frozen order, revisions, bounded cache, disposal and gestures')
