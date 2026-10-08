import assert from 'node:assert/strict'
import { test } from 'node:test'
import ts from 'typescript'
import { fixture, read, plain, LocalApiError } from './helpers/vocabulary-request-fixture.mjs'
test('production chat wrapper preserves HTTP/request/finish/usage metadata without changing ordinary calls',async()=>{
  const f=fixture()
  const ast=ts.createSourceFile('ai.ts',read('platform/android/ai.ts'),ts.ScriptTarget.Latest,true)
  const functions=ast.statements.filter(s=>ts.isFunctionDeclaration(s)&&['chatCompletion','apiHeaders','normalizeReasoningEffort'].includes(s.name?.text)).map(s=>s.getText(ast)).join('\n')
  let payload={choices:[{message:{content:'synthetic text'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:40,total_tokens:140,prompt_tokens_details:{cached_tokens:60},completion_tokens_details:{reasoning_tokens:25}}}
  let sent=0;let ordinary=0;let headers;let lastRequest
  const native=async(request,_label,observed)=>{sent++;headers=request.headers;lastRequest=request;observed?.(200,{'X-Request-Id':'synthetic-request'});return payload}
  const adapters=f.load('platform/android/ai-adapters')
  const profile={id:1,adapter:'openai-chat',base_url:'https://synthetic.invalid/v1',default_model:'synthetic',temperature:.2,reasoning_effort:'',system_prompt:'',enabled:1}
  const api=f.evaluate('production-chat-metadata',functions+'\nexport {chatCompletion}',{
    Headers,profileOr404:async()=>profile,selectedKey:async()=>f.state.key,adapterFor:adapters.adapterFor,
    nativeJson:async(...args)=>{ordinary++;return native(...args)},nativeText:native,nativeBytes:native,vocabularyNativeRequest:native,LocalApiError,
    vocabularyNetworkPolicy:f.load('platform/android/vocabulary-network-policy').vocabularyNetworkPolicy,URL,
    vocabularyConfigurationFrom:f.load('platform/android/vocabulary-request-config').vocabularyConfigurationFrom,
  })
  const seen=[];let hash
  const text=await api.chatCompletion(1,'synthetic',[{role:'user',content:'synthetic'}],{execution:{beforeSend:async value=>{hash=value},response:metadata=>seen.push(plain(metadata))}})
  assert.equal(text,'synthetic text');assert.match(hash,/^[a-f0-9]{64}$/)
  assert.equal(headers.authorization,'Bearer synthetic-key')
  assert.equal(lastRequest.readTimeout,60000);assert.equal(lastRequest.totalTimeout,240000);assert.equal(ordinary,0)
  const meta=seen.at(-1);assert.equal(meta.httpStatus,200);assert.equal(meta.requestId,'synthetic-request');assert.equal(meta.finishReason,'stop')
  assert.equal(meta.usage.total_tokens,140);assert.equal(meta.usage.reasoning_tokens,25);assert.equal(meta.usage.cached_tokens,60)
  assert.equal(JSON.stringify(meta).includes('synthetic-key'),false)
  payload={choices:[{message:{content:'second text'}}]};seen.length=0
  await api.chatCompletion(1,'synthetic',[],{execution:{beforeSend:async()=>{},response:metadata=>seen.push(plain(metadata))}})
  assert.equal(seen.at(-1).usage,undefined)
  assert.equal(await api.chatCompletion(1,'synthetic',[]),'second text');assert.equal(sent,3);assert.equal(ordinary,1)
  assert.equal(lastRequest.readTimeout,undefined);assert.equal(lastRequest.totalTimeout,undefined)
  profile.base_url='https://www.fastaitoken.com/v1';profile.adapter='openai-responses'
  payload={status:'incomplete',output_text:'partial',usage:{input_tokens:100,output_tokens:40,total_tokens:140,output_tokens_details:{reasoning_tokens:25},input_tokens_details:{cached_tokens:60}}}
  await assert.rejects(api.chatCompletion(1,'synthetic',[],{responseFormat:{type:'json_object'},execution:{beforeSend:async()=>{},response:metadata=>seen.push(plain(metadata))}}),cause=>{
    assert.match(cause.message,/截断/);assert.deepEqual(plain(cause.detail),{code:'vocabulary_response_truncated'});return true
  })
  assert.equal(sent,4);assert.equal(lastRequest.readTimeout,180000)
  assert.deepEqual(plain(lastRequest.data.text),{format:{type:'json_object'}})
  assert.equal(seen.at(-1).finishReason,'incomplete');assert.equal(seen.at(-1).usage.total_tokens,140)
  profile.adapter='openai-chat'
  for(const finish of ['length','content_filter','max_tokens']){
    payload={choices:[{message:{content:'private-provider-body'},finish_reason:finish}]}
    const before=sent
    await assert.rejects(api.chatCompletion(1,'synthetic',[],{execution:{beforeSend:async()=>{},response:metadata=>seen.push(plain(metadata))}}),cause=>{
      assert.deepEqual(plain(cause.detail),{code:'vocabulary_response_truncated'});assert.equal(cause.message.includes('private-provider-body'),false);return true
    })
    assert.equal(sent,before+1);assert.equal(seen.at(-1).finishReason,finish)
  }
  f.close()
})
