import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/services/vocabularySnapshots.ts', import.meta.url), 'utf8')
const values = new Map()
const localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
}
const context = { exports: {}, localStorage, JSON, Date, Map, String }
vm.createContext(context)
vm.runInContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context)
const snapshots = context.exports

const list = {
  revision: 'v2:12', scope: 'all', filter: 'mastered', search: 'Evidence',
  items: [{ id: 1, term: 'evidence' }], counts: { total: 1 }, hasMore: true,
  selectedId: 1, selected: { id: 1, common_meaning: '证据' }, scrollTop: 486,
}
assert.equal(snapshots.saveVocabularyListSnapshot(list), true)
const restoredList = snapshots.loadVocabularyListSnapshot('all', 'mastered', ' evidence ')
assert.equal(restoredList.revision, 'v2:12')
assert.equal(restoredList.scrollTop, 486)
assert.equal(restoredList.selectedId, 1)
assert.equal(restoredList.selected.common_meaning, '证据')
assert.deepEqual(Array.from(restoredList.items, item => item.id), [1])
assert.equal(snapshots.loadVocabularyListSnapshot('profile:1', 'mastered', 'evidence'), null, 'scope must isolate caches')
assert.equal(snapshots.loadVocabularyListSnapshot('all', 'all', 'evidence'), null, 'filter must isolate caches')
assert.equal(snapshots.loadVocabularyListSnapshot('all', 'mastered', 'other'), null, 'search must isolate caches')

const listKey = [...values.keys()].find(key => key.includes(':list:all:mastered:evidence'))
values.set(listKey, '{broken json')
assert.equal(snapshots.loadVocabularyListSnapshot('all', 'mastered', 'evidence'), null)
values.set(listKey, JSON.stringify({ ...list, schemaVersion: 1, savedAt: 1 }))
assert.equal(snapshots.loadVocabularyListSnapshot('all', 'mastered', 'evidence'), null)

const review = {
  revision: 'v2:13', scope: 'profile:2', kind: 'scheduled',
  items: [{ id: 11 }, { id: 12 }], reviewIndex: 1,
  reviewDetails: { 11: { common_meaning: 'one' }, 12: { common_meaning: 'two' } },
  counts: { review: 2 },
  dueQueue: { version: 1, main: ['word11', 'word12'], relearning: [], ordinarySinceRelearning: 2 },
}
assert.equal(snapshots.saveVocabularyReviewSnapshot(review), true)
const restored = snapshots.loadVocabularyReviewSnapshot('profile:2', 'scheduled')
assert.equal(restored.revision, 'v2:13')
assert.deepEqual(Array.from(restored.items, item => item.id), [11, 12])
assert.equal(restored.reviewIndex, 1)
assert.equal(restored.reviewDetails['12'].common_meaning, 'two')
assert.deepEqual(Array.from(restored.dueQueue.main), ['word11', 'word12'])
assert.equal(restored.dueQueue.ordinarySinceRelearning, 2)
assert.equal(snapshots.loadVocabularyReviewSnapshot('profile:2', 'reinforcement'), null, 'review modes must be isolated')

const reviewKey = [...values.keys()].find(key => key.includes(':scheduled:profile:2:'))
values.set(reviewKey, JSON.stringify({ ...review, kind: 'reinforcement', schemaVersion: snapshots.VOCABULARY_SNAPSHOT_SCHEMA }))
assert.equal(snapshots.loadVocabularyReviewSnapshot('profile:2', 'scheduled'), null, 'kind mismatch must be rejected')

localStorage.setItem = () => { throw new Error('quota') }
assert.equal(snapshots.saveVocabularyListSnapshot({ ...list, search: 'quota' }), false, 'storage failures are optional and fail soft')
assert.equal(snapshots.saveVocabularyReviewSnapshot({ ...review, kind: 'reinforcement' }), false)
console.log('PASS vocabulary snapshots: schema, corruption, scope/filter/search, list position, review queue/details and storage failure')
