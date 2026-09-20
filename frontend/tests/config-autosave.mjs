import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const exports = {}
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/services/configAutosave.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, { exports, structuredClone, setTimeout, clearTimeout })
const states=[], writes=[]
let release, fail=false
const queue=exports.createAutosave(async value=>{writes.push(value);await new Promise(resolve=>release=resolve);if(fail)throw Error('disk')}, state=>states.push(state), 5)
queue.schedule({name:'first'},true)
queue.schedule({name:'obsolete'})
queue.schedule({name:'latest'})
release();await new Promise(resolve=>setTimeout(resolve,0));release();assert.equal(await queue.flush(),true)
assert.deepEqual(writes,[{name:'first'},{name:'latest'}])
queue.schedule({name:'latest'});await queue.flush();assert.equal(writes.length,2)
fail=true;queue.schedule({name:'failed'},true);release();assert.equal(await queue.flush(),false)
assert.equal(queue.pending,true);assert.match(states.at(-1),/失败/)
fail=false;const retry=queue.flush();release();assert.equal(await retry,true)
queue.schedule({name:'running'},true);queue.invalidate('invalid draft');release();assert.equal(await queue.flush(),false);assert.equal(states.at(-1),'invalid draft')
queue.schedule({name:'cancelled'});queue.invalidate('invalid draft');await new Promise(resolve=>setTimeout(resolve,10));assert.equal(writes.at(-1).name,'running')
console.log('PASS serialized latest-write, deduplication, failure retry, invalid drafts and in-flight completion')
