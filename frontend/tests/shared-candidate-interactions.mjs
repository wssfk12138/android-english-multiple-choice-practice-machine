import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const practiceView = await readFile(new URL('../src/views/PracticeView.vue', import.meta.url), 'utf8')
const practiceApi = await readFile(new URL('../src/platform/android/practice.ts', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

assert.ok(practiceView.includes('function selectParagraphMatch(question: any, stableKey: string)'))
assert.ok(practiceView.includes("const nextAnswer = question.user_answer === stableKey ? '' : stableKey"))
assert.ok(practiceView.includes('@click="selectParagraphMatch(question, option.stable_key)"'))
assert.ok(!practiceView.includes('先阅读段落，再为每道题选择对应字母'))
assert.ok(practiceView.includes('<h1 v-if="!isPartB">'))
assert.ok(practiceApi.includes("['part_b', 'word_bank', 'paragraph_matching']"))
assert.ok(practiceApi.includes('options.answerOrders?.get(question.id) || sharedCandidateOrder'))
assert.ok(styles.includes('.paragraph-candidate-bank ~ .question-card.compact-match'))

console.log('PASS shared candidate interaction contract')
