import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { LocalApiError } from './helpers/vocabulary-request-fixture.mjs'
const code=ts.transpileModule(readFileSync(new URL('../src/platform/android/vocabulary-native-http.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function fixture(){
  const calls=[];let response={status:200,headers:{'x-request-id':'synthetic'},body:Buffer.from('{"output_text":"合成"}').toString('base64')}
  const context={exports:{},atob,TextDecoder,Uint8Array,require:name=>name==='@capacitor/core'?{registerPlugin:name=>{
    assert.equal(name,'VocabularyHttp');return {request:async options=>{calls.push(options);if(response instanceof Error)throw response;return response}}
  }}:{LocalApiError}}
  vm.runInNewContext(code,context)
  return {request:context.exports.vocabularyNativeRequest,calls,set:value=>response=value}
}
const options={url:'https://synthetic.invalid/responses',method:'POST',headers:{Authorization:'Bearer synthetic-key'},data:{synthetic:true},connectTimeout:15000,readTimeout:180000,totalTimeout:240000}
test('vocabulary bridge converts UTF-8 JSON/text/bytes and preserves status before parsing',async()=>{
  const f=fixture(),seen=[]
  const data=await f.request(options,'json',(...args)=>seen.push(args));assert.equal(data.output_text,'合成')
  assert.equal(f.calls[0].data,'{"synthetic":true}');assert.equal(f.calls[0].totalTimeout,240000)
  assert.equal(seen[0][0],200)
  assert.match(await f.request(options,'text',()=>{}),/合成/)
  assert.equal(Buffer.from(await f.request(options,'bytes',()=>{})).toString(),'{"output_text":"合成"}')
})
test('HTTP rejection, corrupt JSON and transport failure never fall back or expose body/key',async()=>{
  const f=fixture();let observed=0
  f.set({status:400,headers:{},body:Buffer.from('synthetic-key private provider body').toString('base64')})
  await assert.rejects(f.request(options,'json',()=>observed++),error=>error.detail.httpStatus===400&&!/private|synthetic-key/.test(error.message))
  assert.equal(observed,1);assert.equal(f.calls.length,1)
  f.set({status:200,headers:{},body:Buffer.from('{invalid').toString('base64')})
  await assert.rejects(f.request(options,'json',()=>observed++),/完整 JSON/);assert.equal(observed,2);assert.equal(f.calls.length,2)
  f.set(Error('Bearer synthetic-key private URL/body'))
  await assert.rejects(f.request(options,'json',()=>observed++),error=>/结果未知/.test(error.message)&&!/synthetic-key|private/.test(error.message))
  assert.equal(observed,2);assert.equal(f.calls.length,3)
})
