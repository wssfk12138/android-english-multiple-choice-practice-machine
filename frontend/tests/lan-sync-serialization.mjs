import assert from 'node:assert/strict'
import {
  buildSerializationLookup,
  lookupProfile,
  lookupStableKey,
} from '../src/platform/android/lan-sync-serialization.ts'

const lookup = buildSerializationLookup({
  paper: [{ id: 1, stable_key: 'paper-1', profile_name: '考研英语一' }],
  unit: [{ id: 2, stable_key: 'unit-2', profile_name: '考研英语一' }],
  question: [{ id: 3, stable_key: 'question-3', profile_name: '考研英语一' }],
  session: [{ id: 4, stable_key: 'session-4' }],
  round: [{ id: 5, stable_key: 'round-5' }],
  entry: [{ id: 6, stable_key: 'word' }],
})

assert.equal(lookupStableKey(lookup, 'paper', 1), 'paper-1')
assert.equal(lookupStableKey(lookup, 'unit', 2), 'unit-2')
assert.equal(lookupStableKey(lookup, 'question', 3), 'question-3')
assert.equal(lookupStableKey(lookup, 'session', 4), 'session-4')
assert.equal(lookupStableKey(lookup, 'round', 5), 'round-5')
assert.equal(lookupStableKey(lookup, 'entry', 6), 'word')
assert.equal(lookupStableKey(lookup, 'question', 999), '')
assert.equal(lookupProfile(lookup, 'paper', 1), '考研英语一')
assert.equal(lookupProfile(lookup, 'unit', 2), '考研英语一')
assert.equal(lookupProfile(lookup, 'question', 3), '考研英语一')
assert.equal(lookupProfile(lookup, 'question', null), '')

console.log('Android LAN sync serialization lookup: OK')
