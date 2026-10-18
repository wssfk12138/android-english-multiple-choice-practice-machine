import assert from 'node:assert/strict'
import { planReviewGroups, similarReviewTerms, spellingDiff } from '../src/vocabulary-review-groups.ts'

const word = (term, extra = {}) => ({ term, normalized_term: term.toLowerCase(), ...extra })
assert.equal(similarReviewTerms('affect', 'effect'), true)
assert.equal(similarReviewTerms('adapt', 'adopt'), true)
assert.equal(similarReviewTerms('quiet', 'quite'), true)
assert.equal(similarReviewTerms('cat', 'cut'), true)
assert.equal(similarReviewTerms('cat', 'dog'), false)
assert.equal(similarReviewTerms('ab', 'ad'), false)
assert.equal(similarReviewTerms('interdisciplinary', 'interdisciplinarian'), false, 'long words stay bounded')

const groups = planReviewGroups([
  word('affect'),
  word('effect'),
  word('quiet'),
  word('quite'),
  word('cat'),
  word('dog'),
])
assert.deepEqual(groups.map(group => group.terms), [['affect', 'effect'], ['quiet', 'quite']])
assert.equal(new Set(groups.flatMap(group => group.keys)).size, 4, 'a word appears in at most one group')
assert.deepEqual(planReviewGroups([word('affect'), word('effect')])[0].keys, ['affect', 'effect'])
assert.deepEqual(planReviewGroups([word('effect'), word('affect')])[0].id, 'affect|effect', 'group id is order-independent')

assert.equal(planReviewGroups([word('affect', { last_reviewed_at: '2026-01-01' }), word('effect')]).length, 0, 'new and reviewed priorities never mix')
assert.equal(planReviewGroups([
  word('affect', { last_reviewed_at: '2026-01-01 00:00:00', next_review_at: '2026-10-17 08:00:00' }),
  word('effect', { last_reviewed_at: '2026-01-01 00:00:00', next_review_at: '2026-10-17 20:00:00' }),
]).length, 1, 'same due day stays comparable')
assert.equal(planReviewGroups([
  word('affect', { last_reviewed_at: '2026-01-01 00:00:00', next_review_at: '2026-10-17 08:00:00' }),
  word('effect', { last_reviewed_at: '2026-01-01 00:00:00', next_review_at: '2026-10-18 08:00:00' }),
]).length, 0, 'different due days keep their existing order and are not paired')
assert.equal(planReviewGroups([word('affect'), ...Array.from({ length: 10 }, (_, i) => word('other' + i)), word('effect')]).length, 0, 'pairing is limited to the bounded window')

const diff = spellingDiff('affect', 'effect')
assert.equal(diff.left.map(item => item.char + (item.changed ? '*' : '')).join(''), 'a*ffect')
assert.equal(diff.right.map(item => item.char + (item.changed ? '*' : '')).join(''), 'e*ffect')
assert.equal(spellingDiff('quiet', 'quite').left.filter(item => item.changed).length >= 1, true)
console.log('PASS review groups: bounded shape matching, stable ids, priority bands and spelling diff')
