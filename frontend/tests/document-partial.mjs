import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/platform/android/document-import.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const context = { exports: {}, require: () => ({}) }
vm.runInNewContext(compiled, context)
const { parseExtractedExam } = context.exports
const parse = blocks => parseExtractedExam('QA-2026-reading.docx', {
  format: 'docx', blocks, text: blocks.join('\n'), hasTextLayer: true,
})
const question = number => [`${number}. What is the passage about?`,
  '[A] First choice', '[B] Second choice', '[C] Third choice', '[D] Fourth choice']
const header = ['Section II Reading Comprehension', 'Part A', 'Text 1', 'A synthetic passage for testing.']
const partial = parse([...header, ...question(21)])
assert.equal(partial.units.filter(unit => unit.unit_type === 'cloze').length, 0, 'Absent cloze must not fabricate a unit')
const reading = partial.units.find(unit => unit.unit_type === 'reading')
assert.equal(reading.questions.length, 1, 'Retain an explicitly identified question')
assert.equal(reading.questions[0].number, 21)
assert.equal(reading.questions[0].options.length, 4)
assert.ok(partial.warnings.length > 0, 'Incomplete-paper publishing remains guarded')
const four = parse([...header, ...[21, 22, 23, 24].flatMap(question)])
assert.equal(four.units[0].questions.length, 4)
const brokenOptions = parse([...header, '21. Test stem', '[A] First choice', '[B] Second choice'])
assert.equal(brokenOptions.units[0].questions.length, 1)
assert.equal(brokenOptions.units[0].questions[0].options.length, 2)
assert.ok(brokenOptions.warnings.some(warning => warning.includes('21') && warning.includes('选项')))
const partialCloze = parse(['Section I Use of English', 'Synthetic blank 1 passage.',
  '1. [A] first [B] second [C] third [D] fourth'])
assert.equal(partialCloze.units[0].questions.length, 1, 'Do not pad partial cloze to twenty questions')
assert.ok(partialCloze.warnings.some(warning => warning.includes('20题')))
const emptyCloze = parse(['Section I Use of English', 'No identifiable options.'])
assert.equal(emptyCloze.units[0].questions.length, 0)
const completeBlocks = ['Section I Use of English', 'Synthetic cloze passage.']
for (let n = 1; n <= 20; n++) completeBlocks.push(`${n}. [A] first [B] second [C] third [D] fourth`)
completeBlocks.push('Section II Reading Comprehension', 'Part A')
for (let text = 1; text <= 4; text++) {
  completeBlocks.push(`Text ${text}`, 'Synthetic reading passage.')
  for (let n = 21 + (text - 1) * 5; n <= 25 + (text - 1) * 5; n++) completeBlocks.push(...question(n))
}
const complete = parse(completeBlocks)
assert.equal(complete.units.find(unit => unit.unit_type === 'cloze').questions.length, 20)
assert.deepEqual(Array.from(complete.units.filter(unit => unit.unit_type === 'reading'), unit => unit.questions.length), [5, 5, 5, 5])
assert.ok(complete.warnings.some(warning => warning.includes('缺少标准答案')))
console.log('Document parser: absent cloze, single/four questions, incomplete options and complete synthetic paper passed')
