import assert from 'node:assert/strict'
import { preservesCandidateOrder } from '../src/platform/android/candidate-order-policy.ts'
assert.equal(preservesCandidateOrder({ unit_type: 'part_b', subtype: 'paragraph_reordering' }, {}), true)
assert.equal(preservesCandidateOrder({ unit_type: 'part_b', subtype: 'paragraph_insertion', passage: 'Paragraph E has been correctly placed.' }, {}), true)
assert.equal(preservesCandidateOrder({ unit_type: 'part_b', subtype: 'paragraph_insertion' }, { fixed_slots: [{ type: 'fixed', label: 'E' }] }), true)
assert.equal(preservesCandidateOrder({ unit_type: 'part_b', subtype: 'heading_matching' }, {}), false)
assert.equal(preservesCandidateOrder({ unit_type: 'part_b', subtype: 'paragraph_insertion' }, {}), false)
assert.equal(preservesCandidateOrder({ unit_type: 'cloze', subtype: 'paragraph_reordering' }, {}), false)
console.log('PASS candidate order policy')
