import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const practice = await readFile(new URL('../src/views/PracticeView.vue', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

assert.ok(practice.includes("const isParagraphMatching = computed(() => activeUnit.value?.unit_type === 'paragraph_matching')"))
assert.ok(practice.includes('v-else-if="isParagraphMatching"'))
assert.ok(practice.includes('class="paragraph-candidate-bank"'))
assert.ok(practice.includes('v-for="option in candidateOptions"'))
assert.ok(practice.includes('class="candidate-reference paragraph-candidate-reference"'))
assert.ok(practice.includes('function selectMatching(question: any, stableKey: string)'))
assert.ok(practice.includes("const nextAnswer = question.user_answer === stableKey ? '' : stableKey"))
assert.match(practice, /function selectOrdering\(question: any, stableKey: string\) \{[\s\S]*?const nextAnswer = question\.user_answer === stableKey \? '' : stableKey[\s\S]*?select\(question, nextAnswer\)/)
assert.equal(practice.match(/@click="selectMatching\(question, option\.stable_key\)"/g)?.length, 2)
assert.ok(practice.includes('<h1 v-if="!isPartB">'))
assert.ok(practice.includes('@click="select(question, option.stable_key)"'))
assert.ok(!practice.includes('先阅读段落，再为每道题选择对应字母'))
assert.ok(styles.includes('html[data-platform="android"] .paragraph-candidate-bank'))
assert.ok(styles.includes('html[data-platform="android"] .paragraph-candidate-reference'))
assert.ok(styles.replace(/\s+/g, '').includes('grid-template-columns:autominmax(0,1fr)'))
assert.ok(styles.includes('.paragraph-candidate-bank ~ .question-card.compact-match'))
const partBTitleRules = styles.match(/html\[data-platform="android"\]\[data-orientation="portrait"\] \.portrait-practice-card\.part-b strong \{[^}]+\}/g) || []
assert.equal(partBTitleRules.length, 1)
assert.match(partBTitleRules[0], /white-space:\s*normal/)
assert.match(partBTitleRules[0], /word-break:\s*keep-all/)
// The title is inside the shrinking grid cell; min-width belongs to that cell.
assert.match(styles, /\.portrait-practice-card span\s*\{[^}]*min-width:\s*0/)
assert.match(styles, /\.portrait-practice-card\.part-b\s*\{[^}]*grid-template-columns:\s*40px minmax\(0, 1fr\) 16px/)
assert.ok(styles.includes('html[data-platform="android"][data-orientation="portrait"] .portrait-practice-card > svg'))

console.log('PASS paragraph-matching candidate panel contract')
