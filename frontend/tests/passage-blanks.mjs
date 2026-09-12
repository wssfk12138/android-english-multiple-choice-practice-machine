import assert from 'node:assert/strict'
import { splitPassageBlanks } from '../src/passage-blanks.ts'

const blanks = (text, numbers) => splitPassageBlanks(text, numbers).filter(part => part.type === 'blank').map(part => part.number)
assert.deepEqual(blanks('word 1 ______ end (12)____ end {{blank:20}}', [1, 12, 20]), [1, 12, 20])
assert.deepEqual(blanks('2016 has 1 child and 12 friends; 25 ____ unknown', [1, 12]), [])
assert.deepEqual(blanks('1 ____ remains literal without cloze scope'), [])
assert.deepEqual(blanks('{{blank:41}}', []), [41])
assert.deepEqual(blanks('item1___ and 2011___ and _ 1 and (1)', [1]), [])
assert.deepEqual(blanks('word 1＿＿＿ end ___(2)___ end', [1, 2]), [1, 2])
assert.equal(splitPassageBlanks('In 2016, 1 person paid 12 dollars.', [1, 12]).map(part => part.text).join(''), 'In 2016, 1 person paid 12 dollars.')
console.log('PASS scoped passage blanks: canonical, legacy, Unicode, ordinary numbers')
