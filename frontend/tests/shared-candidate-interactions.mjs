// 共享候选题型在候选包中的交互契约：同一组字母、各题按钮与判分身份一致。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const practiceView = await readFile(new URL('../src/views/PracticeView.vue', import.meta.url), 'utf8')
const practiceApi = await readFile(new URL('../src/platform/android/practice.ts', import.meta.url), 'utf8')
const policyApi = await readFile(new URL('../src/platform/android/candidate-order-policy.ts', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

// 候选包沿用 selectMatching 作为三种共享候选题型的统一入口。
assert.ok(practiceView.includes('function selectMatching(question: any, stableKey: string)'))
assert.ok(practiceView.includes('@click="selectMatching(question, option.stable_key)"'))
assert.ok(practiceView.includes('v-for="option in candidateOptions"'))
assert.ok(practiceView.includes('v-for="option in question.options"'))
assert.ok(practiceView.includes('class="paragraph-candidate-bank"'))
assert.ok(practiceView.includes('candidateOptions = computed(() => activeUnit.value?.questions?.[0]?.options'))

// 共享候选题型清单收敛到 candidate-order-policy.ts，practice.ts 通过
// usesSharedCandidates + sharedPreserve 消费它（策略 v2 保留原标签与原顺序）。
assert.ok(policyApi.includes("['part_b', 'word_bank', 'paragraph_matching']"))
assert.ok(practiceApi.includes('usesSharedCandidates(unit.unit_type)'))
assert.ok(practiceApi.includes('const sharedPreserve = (options.candidatePolicyVersion ?? 1) >= 2 && usesShared'))
assert.ok(practiceApi.includes('options.answerOrders?.get(question.id) || sharedCandidateOrder'))
assert.ok(styles.includes('.paragraph-candidate-bank ~ .question-card.compact-match'))

console.log('PASS shared candidate interactions')
