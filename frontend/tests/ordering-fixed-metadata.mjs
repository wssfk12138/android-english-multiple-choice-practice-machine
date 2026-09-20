import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const source=readFileSync(new URL('../src/platform/android/ordering-fixed-slots.ts',import.meta.url),'utf8')
const context={exports:{}}
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context)
const resolve=context.exports.orderingFixedSlotsForPaperUnit
const paper={subject:'英语一',year:2023},unit={type:'part_b',subtype:'paragraph_reordering'}
assert.deepEqual(JSON.parse(JSON.stringify(resolve(paper,unit))).map(s=>s.number||s.label),[41,'A',42,'E',43,'H',44,45])
const explicit=[{type:'question',number:41},{type:'fixed',label:'B'}]
for(const metadata of [{fixed_slots:explicit},{fixedSlots:explicit},{shared_data:{fixed_slots:explicit}},{shared_data:{fixedSlots:explicit}}]){
 assert.equal(resolve(paper,{...unit,...metadata}),explicit)
}
assert.equal(resolve(paper,{...unit,fixed_slots:[]}).length,0)
assert.equal(resolve({subject:'英语二',year:2023},unit).length,0)
assert.equal(resolve(paper,{...unit,subtype:'heading_matching'}).length,0)
console.log('PASS fixed slot metadata: explicit chain and explicit empty override registry, subject and subtype guards')

const validate=context.exports.validateOrderingFixedSlots
const candidate={candidates:[{key:'A'}],questions:[{number:41},{number:42}]}
for(const spelling of ['fixed_slots','fixedSlots']) {
 validate({...candidate,[spelling]:[]})
 validate({...candidate,[spelling]:[{type:'question',number:41},{type:'fixed',label:'A'},{type:'question',number:42}]})
 for(const invalid of [[{type:'fixed',label:'Z'}],[{type:'question',number:41},{type:'question',number:41}],{},[{type:'question',number:41}]]) {
  assert.throws(()=>validate({...candidate,[spelling]:invalid}),/固定段/)
 }
}
console.log('PASS fixed slot validation: complete chain, aliases, empty, unknown labels and duplicate/missing questions')
