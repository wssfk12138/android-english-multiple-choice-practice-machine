import assert from 'node:assert/strict'
import { test } from 'node:test'
import { vocabularyNetworkPolicy } from '../src/platform/android/vocabulary-network-policy.ts'
import { adapterFor } from '../src/platform/android/ai-adapters.ts'
test('provider and protocol select only vocabulary wait policy',()=>{
  const fast=vocabularyNetworkPolicy('https://www.fastaitoken.com/v1','openai-responses')
  assert.deepEqual(fast,{connectTimeout:15000,readTimeout:180000,totalTimeout:240000})
  for(const [url,adapter] of [['https://www.fastaitoken.com/v1','openai-chat'],['https://fastaitoken.com.evil.invalid/v1','openai-responses'],['https://api.deepseek.com/v1','openai-chat'],['https://synthetic.invalid/v1','openai-responses']]) {
    assert.equal(vocabularyNetworkPolicy(url,adapter).readTimeout,60000)
  }
})
test('Responses maps JSON object/schema to text.format, without changing ordinary serialization',()=>{
  const a=adapterFor('openai-responses'),base={temperature:.2}
  assert.equal(a.serialize('m',[],base).text,undefined)
  const body=a.serialize('m',[],{...base,responseFormat:{type:'json_object'}})
  assert.deepEqual(body.text,{format:{type:'json_object'}});assert.equal(body.response_format,undefined)
  const schema={type:'object',properties:{x:{type:'string'}}}
  assert.deepEqual(a.serialize('m',[],{...base,responseFormat:{type:'json_schema',json_schema:{name:'sample',schema,strict:true}}}).text,{format:{type:'json_schema',name:'sample',schema,strict:true}})
  assert.throws(()=>a.serialize('m',[],{...base,responseFormat:{type:'unsupported'}}),/格式/)
})
