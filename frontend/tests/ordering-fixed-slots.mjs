import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/platform/android/ordering-fixed-slots.ts', import.meta.url), 'utf8')
const expected = {
  2010: "[41, 42, 43, 44, 'E', 45]",
  2011: "['G', 41, 42, 'E', 43, 44, 45]",
  2014: "[41, 'A', 42, 'E', 43, 44, 45]",
  2017: "['D', 41, 42, 43, 44, 'B', 45]",
  2018: "[41, 'C', 42, 43, 'F', 44, 45]",
  2019: "[41, 42, 'F', 43, 44, 'C', 45]",
  2023: "[41, 'A', 42, 'E', 43, 'H', 44, 45]",
}

for (const [year, order] of Object.entries(expected)) {
  assert.match(source, new RegExp(`${year}: ${order.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
}
assert.match(source, /unit\.type \|\| unit\.unit_type/)
assert.match(fs.readFileSync(new URL('../src/views/PracticeView.vue', import.meta.url), 'utf8'), /ordering-fixed-slots/)
console.log('ordering fixed-position registry and UI hook verified')
