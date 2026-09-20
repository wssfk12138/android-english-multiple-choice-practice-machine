import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const source=readFileSync(new URL('../src/platform/android/document-import.ts',import.meta.url),'utf8')
const context={exports:{},require:()=>({})}
vm.runInNewContext(ts.transpileModule(source+'\nexport { ensureBlanks, parseReading, parsePartB, unlabeledQuestionGroups }',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
const {ensureBlanks,parseReading,parsePartB,unlabeledQuestionGroups}=context.exports
assert.equal(ensureBlanks('sharing 1% and 1.5 units x1 then 1 word',1,1),'sharing 1% and 1.5 units x1 then 1 ______ word')
const reading=parseReading(['Text 1','Passage body.','24. Several','American cities are mentioned to show that','[A] first policy','[B] second policy','[C] third policy','[D] fourth policy','Part B'],{})[0]
assert.equal(reading.questions[0].stem,'Several American cities are mentioned to show that')
assert.equal(reading.questions[0].options.map(o=>o.key).join(''),'ABCD')
const blocks=['Passage body.']
for(let n=0;n<5;n++)blocks.push('The author suggests that','.','first choice','second choice','third choice','fourth choice')
const bare=unlabeledQuestionGroups(blocks,21)
assert.equal(bare.passage,'Passage body.')
assert.equal(bare.questions.length,5)
assert.ok(bare.questions.every(q=>q.stem==='The author suggests that.'&&q.options[3].content==='fourth choice'))
const missing=parsePartB(['Part B','Directions:','For questions 41-45 choose subheadings from list A.',...Array.from({length:12},(_,i)=>'Body paragraph '+i),'Part C'],{})
assert.equal(Object.keys(missing.shared_data.candidates).length,0)
assert.ok(missing.passage.includes('Body paragraph 11'))
const partB=parsePartB(['Part B','Directions:','For questions 41-45 choose subheadings from list A.','[A] First heading','[B] Second','heading continued',...'CDEFG'.split('').map(c=>'['+c+'] Heading '+c),'41. Body paragraph','Section III Translation'],{})
assert.equal(partB.shared_data.candidates.B,'Second heading continued')
assert.ok(partB.passage.includes('Body paragraph'))
assert.ok(!partB.passage.includes('Section III'))
console.log('5 document parser remediation scenarios passed')

const combined=['Text 4','Reading body.']
for(let n=36;n<=40;n++) combined.push(n+'. What does L.A. policy require?','[A] first','[B] second','[C] third','[D] fourth')
combined.push('Part B Directions:','Match the left column to the right column. There are two extra choices.','Source body.', `[A] First opinion
41. Alice
[B] Second opinion
42. Bob
[C] Third opinion
43. Carol
[D] Fourth opinion
44. Dan
[E] Fifth opinion
45. Eve
[F] Sixth opinion
[G] Last opinion
continues here.`,'46. Directions:','Section IIITranslation')
const combinedReading=parseReading(combined,{})[0]
assert.equal(combinedReading.questions.length,5)
assert.equal(combinedReading.questions[0].stem,'What does L.A. policy require?')
assert.ok(combinedReading.questions.every(q=>q.options.length===4))
const combinedPart=parsePartB(combined,{})
assert.equal(combinedPart.questions.map(q=>q.stem).join(','),'Alice,Bob,Carol,Dan,Eve')
assert.equal(combinedPart.shared_data.candidates.G,'Last opinion continues here.')
assert.equal(combinedPart.passage,'Source body.')
console.log('Multiline table, combined header, abbreviation and final candidate passed')
