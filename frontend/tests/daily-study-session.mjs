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
  return { id, sync_id: members[id - 1].identity, common_meaning: revision, review_count: 0 }
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
assert.equal(studySwipe(-73, 10), -1); assert.equal(studySwipe(73, 10), 1)
assert.equal(studySwipe(72, 0), 0); assert.equal(studySwipe(73, 50), 0)
const window = studyNavigationWindow(1100, members.length)
assert.ok(window.end-window.start <= 41 && window.start <= 1100 && window.end > 1100)
assert.ok(records.get(DAILY_STUDY_STORAGE))
console.log('PASS daily study session: persistence, deletion, identity reuse, frozen order, revisions, bounded cache, disposal and gestures')
