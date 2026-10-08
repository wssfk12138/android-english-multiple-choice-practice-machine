import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const unknownMessage = '上次请求结果未知，已停止；如需重发，请点击重试按钮，可能重复产生费用'
const api = `
export async function get(path) {
  if(path!=='/vocabulary/enrichment-status')throw Error('Unexpected path');
  window.reads++;
  if(window.readFailure)throw Error('synthetic-key https://private.invalid provider-body');
  return structuredClone(window.maintenanceStatus);
}
export async function post(path,body) {
  window.actions.push({path,body});
  if(window.actionFailure==='object')throw {message:'synthetic-key',detail:'provider-body'};
  if(window.actionFailure==='private')throw Error('synthetic-key https://private.invalid provider-body');
  if(window.actionFailure==='safe')throw Error('当前请求尚未结束，请稍后重试');
  if(body.action==='resume'&&window.maintenanceStatus.scheduler.unknown.length)throw Error(${JSON.stringify(unknownMessage)});
  window.maintenanceStatus.paused=body.action==='pause'||body.action==='retry';
  window.maintenanceStatus.scheduler={reason:window.maintenanceStatus.paused?'user':'',unknown:[]};
  if(body.action==='retry')window.maintenanceStatus.failed=0;
  return structuredClone(window.maintenanceStatus);
}`
const entry = `
import {createApp,h} from 'vue';import {createRouter,createWebHashHistory} from 'vue-router';
import Maintenance from '/src/components/VocabularyMaintenance.vue';import '/src/styles.css';
window.reads=0;window.actions=[];
const reason=new URLSearchParams(location.search).get('reason')||'user';
window.maintenanceStatus={ready:2,queued:3,inflight:0,failed:1,paused:true,waiting_configuration:false,scheduler:{reason,unknown:reason==='unknown'?[{id:'synthetic',task:'enrichment',ids:[1]}]:[]}};
const nativeInterval=window.setInterval;
window.setInterval=(callback,delay,...args)=>delay===3000?(window.pollMaintenance=callback,-1):nativeInterval(callback,delay,...args);
const app=createApp({render:()=>h(Maintenance)});
app.use(createRouter({history:createWebHashHistory(),routes:[{path:'/:pathMatch(.*)*',component:{render:()=>null}}]}));app.mount('#app');`
const server = await createServer({root,configFile:false,cacheDir:fileURLToPath(new URL('../node_modules/.vite-vocabulary-maintenance',import.meta.url)),optimizeDeps:{noDiscovery:true,include:['vue','vue-router']},plugins:[{
  name:'maintenance-component-fixture',enforce:'pre',
  resolveId(id){if(id==='virtual:maintenance'||id==='../api')return id==='../api'?'virtual:maintenance-api':id},
  load(id){if(id==='virtual:maintenance')return entry;if(id==='virtual:maintenance-api')return api},
  configureServer(s){s.middlewares.use((req,res,next)=>{if(!req.url.startsWith('/__maintenance'))return next();res.setHeader('Content-Type','text/html');res.end('<html data-platform="android"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/@id/virtual:maintenance"></script></html>')})},
},vue()],server:{host:'127.0.0.1',port:0}})
let browser
try {
  await server.listen();browser=await chromium.launch({headless:true})
  const errors=[]
  const open=async(reason,viewport={width:1280,height:800})=>{
    const page=await browser.newPage({viewport});page.on('pageerror',error=>errors.push(error.message))
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
    await page.goto(server.resolvedUrls.local[0]+'__maintenance?reason='+reason)
    await page.getByRole('button',{name:'继续补缺',exact:true}).waitFor();await page.waitForFunction(()=>window.reads>0)
    return page
  }
  const poll=async page=>{
    const before=await page.evaluate(()=>window.reads);await page.evaluate(()=>window.pollMaintenance())
    await page.waitForFunction(before=>window.reads>before,before)
  }
  const paused=await open('user')
  assert.equal(await paused.getByRole('status').innerText(),'已暂停')
  await paused.getByRole('button',{name:'继续补缺',exact:true}).click()
  await paused.getByRole('button',{name:'暂停补缺',exact:true}).waitFor()
  assert.equal(await paused.getByRole('status').innerText(),'等待补缺')
  await paused.getByRole('button',{name:'暂停补缺',exact:true}).click()
  await paused.getByRole('button',{name:'继续补缺',exact:true}).waitFor()
  assert.deepEqual(await paused.evaluate(()=>window.actions.map(call=>call.body.action)),['resume','pause']);await paused.close()

  for(const viewport of [{width:390,height:844},{width:800,height:1280},{width:1280,height:800}]){
    const page=await open('unknown',viewport)
    assert.match(await page.innerText('.vocabulary-maintenance'),/结果未知.*重试.*重复产生费用/)
    await page.getByRole('button',{name:'继续补缺',exact:true}).click()
    await page.getByText(unknownMessage,{exact:false}).last().waitFor()
    assert.deepEqual(await page.evaluate(()=>window.actions),[{path:'/vocabulary/enrichment-runs',body:{action:'resume'}}])
    await poll(page);assert.match(await page.innerText('.vocabulary-maintenance'),/上次请求结果未知/)
    await page.evaluate(()=>window.maintenanceStatus.scheduler={reason:'user',unknown:[]});await poll(page)
    await page.locator('.maintenance-operation-error').waitFor()
    assert.match(await page.locator('.maintenance-operation-error').innerText(),/上次请求结果未知/)
    await page.evaluate(()=>window.readFailure=true);await poll(page)
    await page.getByText('无法读取补缺状态，请重试',{exact:false}).waitFor()
    await page.evaluate(()=>window.readFailure=false);await poll(page)
    await page.waitForFunction(()=>!document.body.innerText.includes('无法读取补缺状态'))
    assert.match(await page.innerText('.vocabulary-maintenance'),/上次请求结果未知/)
    await page.getByRole('button',{name:'重试失败词条',exact:true}).click()
    await page.waitForFunction(()=>window.actions.length===2&&!document.body.innerText.includes('上次请求结果未知'))
    assert.deepEqual(await page.evaluate(()=>window.actions[1]),{path:'/vocabulary/enrichment-runs',body:{action:'retry'}})
    const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}))
    assert.ok(bounds.scroll<=bounds.width+1,JSON.stringify(bounds));await page.close()
  }
  for(const [reason,label] of [['configuration','配置.*变化'],['budget','预算'],['validation','校验'],['parse','解析'],['truncated','截断'],['save','保存'],['http','供应商']]){
    const page=await open(reason);assert.match(await page.getByRole('status').innerText(),new RegExp(label))
    assert.match(await page.locator('.maintenance-stop-reason').innerText(),new RegExp(label));await poll(page)
    assert.match(await page.locator('.maintenance-stop-reason').innerText(),new RegExp(label));await page.close()
  }
  const privatePage=await open('user')
  for(const mode of ['object','private','safe']){
    await privatePage.evaluate(mode=>window.actionFailure=mode,mode)
    await privatePage.getByRole('button',{name:'继续补缺',exact:true}).click()
    const expected=mode==='safe'?'当前请求尚未结束，请稍后重试':'补缺操作失败，请重试'
    await privatePage.getByText(expected,{exact:false}).waitFor()
    const text=await privatePage.innerText('.vocabulary-maintenance')
    for(const secret of ['synthetic-key','https://private.invalid','provider-body'])assert.equal(text.includes(secret),false)
  }
  await privatePage.close();assert.deepEqual(errors,[])
  console.log('PASS maintenance pause/resume, persistent safe stop reasons, unknown continue/retry, independent read errors and private-error fallback in 3 viewports')
} finally {await browser?.close();await server.close()}
