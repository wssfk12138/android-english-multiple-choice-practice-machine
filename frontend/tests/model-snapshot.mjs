import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/platform/android/model-key-sync.ts', import.meta.url),'utf8')
const profile = { id: 7, name:'Tablet', adapter:'openai-chat', base_url:'https://example.test/v1', default_model:'first',temperature:0.2,max_tokens:0,reasoning_effort:'',system_prompt:'',enabled:1,is_default:1 }
const models=[{model_id:'first',display_name:'First',owned_by:'Owner',provider:'Provider',is_visible:0,is_available:1}]
const item={keys:[{id:'a'.repeat(64),name:'Synthetic',value:'synthetic-only'}],selected:'a'.repeat(64)}
let calls=[], response={status:200,data:{version:1,snapshot_version:1,applied_profiles:1}}, empty=false
const db={rows:async(sql,args)=>sql.includes('ai_profile_models')?(assert.equal(args[0],7),structuredClone(models)):empty?[]:[structuredClone(profile)]}
const vault={withKeys:async f=>f(),migrateKeys:async()=>({profiles:{7:structuredClone(item)}})}
const transport={LanTransport:{post:async request=>{calls.push(request);return response}}}
const context={exports:{},require:name=>name==='./database'?db:name==='./model-key-store'?vault:name==='./lan-transport'?transport:{}}
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
const tls={hostId:'test-host',certificateSha256:'a'.repeat(64)}
const send=()=>context.exports.authoritativePushModelKeys('https://192.168.1.2:8767','synthetic-token',tls)
assert.equal(await send(),1)
assert.equal(calls.length,1)
const packet=calls[0]
assert.equal(packet.tls,tls)
assert.equal(packet.data.snapshot_version,1)
assert.equal(packet.data.operation,'authoritative_push')
assert.deepEqual(JSON.parse(JSON.stringify(packet.data.profiles[0])),{
  ...Object.fromEntries(Object.entries(profile).filter(([k])=>!['id','enabled','is_default'].includes(k))),
  enabled:true,is_default:true,models:[{...models[0],is_visible:false,is_available:true}],...item,
})
for(const data of [{version:1,applied_profiles:1},{version:1,snapshot_version:1,applied_profiles:0},{version:1,snapshot_version:1,applied_profiles:2}]){
  response={status:200,data};await assert.rejects(send())
}
response={status:403};await assert.rejects(send(),/403/)
const count=calls.length;empty=true;await assert.rejects(send());assert.equal(calls.length,count)
const lan=readFileSync(new URL('../src/platform/android/lan-sync.ts',import.meta.url),'utf8')
const standalone=lan.slice(lan.indexOf('export async function pushAuthoritativeModelConfiguration'),lan.indexOf('/**',lan.indexOf('export async function pushAuthoritativeModelConfiguration')))
assert.match(standalone,/serializeSync/);assert.match(standalone,/session.modelSnapshot/);assert.ok(standalone.includes("categories.includes('models')"))
assert.ok(!standalone.includes('runLanSyncInternal'))
const api=readFileSync(new URL('../src/platform/android/local-api.ts',import.meta.url),'utf8')
assert.ok(api.includes('body?.confirm !== true'))
console.log('authoritative snapshot export, exact acknowledgement, TLS, empty rejection and independent entry: passed')
