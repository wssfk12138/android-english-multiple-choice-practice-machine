import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const practice = await readFile(new URL('../src/views/PracticeView.vue', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
const practiceApi = await readFile(new URL('../src/platform/android/practice.ts', import.meta.url), 'utf8')

assert.ok(practice.includes("|| unit?.unit_type === 'word_bank'"))
assert.ok(practice.includes('function wordBankAnswerForBlank(number?: number)'))
assert.ok(practice.includes('async function selectWordBank(question: any, letter: string)'))
assert.ok(practice.includes("const nextAnswer = question.user_answer === letter ? '' : letter"))
assert.ok(practice.includes('const usedWordBankLetters = computed'))
assert.ok(practice.includes('function syncCurrentWordBankQuestion()'))
assert.ok(practice.includes('class="passage-blank word-bank-passage-blank"'))
assert.ok(practice.includes("'word-bank-current': currentWordBankQuestionId === question.id"))
assert.ok(practice.includes('usedWordBankLetters.has(option.stable_key)'))
assert.ok(styles.includes('html[data-platform="android"] .word-bank-passage-blank'))
assert.ok(styles.includes('html[data-platform="android"] .word-bank-current'))
assert.match(styles.replace(/\s+/g, ''), /grid-template-columns:repeat\(auto-fit,minmax\(120px,1fr\)\)/)
assert.ok(styles.includes('min-height: 44px'))
assert.ok(practiceApi.includes("['part_b', 'word_bank', 'paragraph_matching']"))
assert.ok(practiceApi.includes('options.answerOrders?.get(question.id) || sharedCandidateOrder'))

console.log('PASS word-bank passage interaction contract')
