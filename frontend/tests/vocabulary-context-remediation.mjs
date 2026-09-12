import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const context = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/vocabulary-context.ts', import.meta.url),'utf8'), { compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022} }).outputText, context)
const { projectVocabulary, vocabularyEnhancements, validSourceSentence } = context.exports
const a = {id:100,sync_id:'z',created_at:'2026-09-01 12:00:00',surface_form:'went',context_sentence:'She went home after school.'}
const b = {...a,id:1,sync_id:'a',created_at:'2026-09-02T12:00:00Z',context_sentence:'They went to the park.'}
assert.equal(projectVocabulary({},[a,b]).latest_sentence,b.context_sentence)
assert.equal(projectVocabulary({},[b,{...a,id:1000}]).occurrences.length,1)
assert.equal(projectVocabulary({},[a,{...b,context_sentence:'went'}]).latest_sentence,a.context_sentence)
assert.equal(projectVocabulary({contextual_meaning:'old',contextual_occurrence_key:'z'},[a,b]).contextual_meaning,'')
assert.equal(projectVocabulary({contextual_meaning:'bound',contextual_occurrence_key:'a'},[a,b]).contextual_meaning,'bound')
assert.equal(projectVocabulary({},[{...a,sync_id:'a'},a]).context_key,'z')
assert.equal(validSourceSentence({...a,context_sentence:'A. went'}),false)
assert.equal(validSourceSentence({...a,context_sentence:'Unlike'}),false)
const result = vocabularyEnhancements({lemma:'go',morphology:{currentForm:'过去式',forms:[{label:'过去分词',word:'gone'},null,{label:2,word:'bad'}]},generatedExample:{sentence:'She went home.',translation:'她回家了。'}},false)
assert.equal(result.morphology.forms.length,1)
assert.equal(result.generatedExample.sentence,'She went home.')
assert.equal(Object.keys(vocabularyEnhancements({generatedExample:{sentence:'fake'}},true).generatedExample).length,0)
console.log('PASS latest encounter time, sync ties, isolated options, context binding, bounded model fields')


const { selectedSourceSentence } = context.exports
const repeated = 'She went home. Later they went to school.'
assert.equal(selectedSourceSentence(repeated, 'went', repeated.lastIndexOf('went')), 'Later they went to school.')
assert.equal(selectedSourceSentence(repeated, 'went', -1), '')
assert.equal(selectedSourceSentence(repeated, 'went', 0), '')
assert.equal(validSourceSentence({...a, context_sentence:'She went home.', source_kind:'passage'}), true)
assert.equal(validSourceSentence({...a, context_sentence:'She went home.', source_kind:'question'}), false)
assert.equal(validSourceSentence({...a, context_sentence:'She went home.', source_kind:'option'}), true)
assert.equal(validSourceSentence({...a, context_sentence:'went.', source_kind:'option'}), false)
assert.equal(validSourceSentence({surface_form:'well-known',context_sentence:'She is well-known.'}), true)
assert.equal(validSourceSentence({surface_form:"don't",context_sentence:'They don’t care.'}), true)
console.log('PASS selected occurrence offset, explicit source categories, short full sentences and punctuation')
