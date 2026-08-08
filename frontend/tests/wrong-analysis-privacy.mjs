import assert from 'node:assert/strict'
import fs from 'node:fs'

const practiceSource = fs.readFileSync(
  new URL('../src/platform/android/practice.ts', import.meta.url),
  'utf8',
)
const practiceView = fs.readFileSync(
  new URL('../src/views/PracticeView.vue', import.meta.url),
  'utf8',
)
const analysisSource = fs.readFileSync(
  new URL('../src/platform/android/ai.ts', import.meta.url),
  'utf8',
)

assert.match(practiceSource, /includeAnswers:\s*false/)
assert.doesNotMatch(practiceView, /displayedAnswer|正确答案/)
assert.match(
  practiceView,
  /question\.user_answer === option\.stable_key && question\.is_correct === false/,
)
assert.match(analysisSource, /pa\.is_correct = 0/)
assert.match(analysisSource, /ps\.mode = 'wrong'/)
assert.match(analysisSource, /practice_unit_submissions/)
assert.doesNotMatch(analysisSource, /ps\.status = 'submitted'/)

console.log('wrong-answer privacy and retry-analysis lock contract verified')
