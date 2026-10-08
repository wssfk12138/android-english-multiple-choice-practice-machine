import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
const root=fileURLToPath(new URL('../',import.meta.url))
const api=`
export async function get(path){window.calls.push(path);
 if(path==='/android/updates/settings')return {question_bank_catalog_url:'https://fixture.test/catalog.json'};
 if(path==='/android/lan-sync/status')return {host:'http://fixture.test:8080',host_id:window.configured?'synthetic-long-host-identifier-for-layout-checking':'',configured:window.configured,auto:true,categories:[],runtime:{}};
 throw Error('Unexpected '+path);
}
export async function put(path,body){window.saved=body;return body}
export async function post(path){
 if(path.endsWith('/app/check'))return {available:true,current_version:'fixture',manifest:{versionName:'next',releaseNotes:'长更新说明。'.repeat(150)}};
 if(path.endsWith('/question-banks/check'))return {configured:true,packages:Array.from({length:window.count},(_,i)=>({packageId:'p'+i,contentVersion:'1',title:'合成题库'+i,years:[2026],size:1000,license:'fixture'}))};
 throw Error('Unexpected '+path);
}`
const modules={
 '../api':api,
 '../platform/android/diagnostics':`export async function listDiagnosticLogs(){window.calls.push('logs');return [{createdAt:'2026-09-14T00:00:00Z',event:'fixture',module:'startup',symptom:'合成日志'}]} export async function clearDiagnosticLogs(){};export async function copyDiagnosticLogs(){};export async function shareDiagnosticLogs(){};export async function copyIssueReportTemplate(){}`,
 '../platform/android/database-export':`export function databaseExportAvailable(){return true};export async function readDatabaseInfo(){window.calls.push('database-info');return {exists:true,fileName:'fixture.db',size:10}};export function formatDatabaseSize(){return '10 B'};export async function exportDatabaseSnapshot(){};export async function shareDatabaseSnapshot(){}`,
 '../platform/android/learning-history-diagnostics':'export async function copyLearningHistoryDiagnostics(){};export async function shareLearningHistoryDiagnostics(){}',
 '../platform/dialogs':'export async function confirmDialog(){return window.allowClear===true}',
 '../services/questionBankProfiles':'export const questionBankProfilesState={items:[],activeId:0};export async function loadQuestionBankProfiles(){window.calls.push("profiles")}',
 '../platform/android/lan-question-banks':'export async function checkLanQuestionBanks(){throw Error("unexpected")};export async function downloadLanQuestionBank(){throw Error("unexpected")}',
 '../components/LanSyncScanner.vue':'<template><div /></template>',
}
const entry=`
import {createApp,h} from 'vue';import {createRouter,createWebHashHistory} from 'vue-router';
import Sync from '/src/views/AndroidSyncView.vue';import Updates from '/src/views/AndroidUpdatesView.vue';import Diagnostics from '/src/views/AndroidDiagnosticsView.vue';
import '/src/styles.css';import '/src/study-theme.css';
window.calls=[];window.count=0;window.configured=new URLSearchParams(location.search).get('configured')==='1';
const name=new URLSearchParams(location.search).get('page');
const app=createApp({render:()=>h({sync:Sync,updates:Updates,diagnostics:Diagnostics}[name])});
app.use(createRouter({history:createWebHashHistory(),routes:[{path:'/:pathMatch(.*)*',component:{render:()=>null}}]}));app.mount('#app');`
const server=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,include:['vue','vue-router','lucide-vue-next']},plugins:[{name:'maintenance-fixtures',enforce:'pre',resolveId(id){if(id==='virtual:entry'||id in modules)return id==='virtual:entry'?id:'virtual:'+id},load(id){if(id==='virtual:entry')return entry;if(id.startsWith('virtual:'))return modules[id.slice(8)]},configureServer(s){s.middlewares.use((req,res,next)=>{if(!req.url.startsWith('/__fixture'))return next();res.setHeader('Content-Type','text/html');res.end('<html data-platform="android"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="app"></div><script type="module" src="/@id/virtual:entry"></script></html>')})}},vue()],server:{host:'127.0.0.1',port:0}})
let browser
try{
 await server.listen();browser=await chromium.launch({headless:true})
 for(const [width,height] of [[390,844],[800,1280],[1280,800]])for(const scale of [1,1.35])for(const name of ['sync','updates','diagnostics']){
  const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
  await page.goto(server.resolvedUrls.local[0]+'__fixture?page='+name+'&configured=1');await page.locator('h1').waitFor()
  await page.evaluate(async scale=>{document.documentElement.dataset.orientation=innerWidth>innerHeight?'landscape':'portrait';await new Promise(r=>setTimeout(r,100));if(scale!==1){const es=[...document.querySelectorAll('body *')];const sizes=es.map(e=>parseFloat(getComputedStyle(e).fontSize));es.forEach((e,i)=>e.style.fontSize=sizes[i]*scale+'px')}},scale)
  assert.deepEqual(await page.evaluate(()=>window.calls),name==='sync'?['/android/lan-sync/status']:name==='updates'?['/android/updates/settings','profiles']:['logs','database-info'])
  assert.equal(await page.getByRole('link',{name:'返回设置'}).getAttribute('href'),'#/mobile-settings')
  if(name==='sync'){
   assert.equal(await page.locator('.sync-connection').getAttribute('open'),null)
   await page.getByLabel('自动同步',{exact:true}).uncheck();assert.deepEqual(await page.evaluate(()=>window.saved),{auto:false})
   await page.locator('.sync-connection > summary').click()
   if(width===1280){const a=await page.locator('#lan-sync-host').boundingBox();const b=await page.getByRole('button',{name:'保存并测试连接'}).boundingBox();assert.ok(b.x>a.x+a.width-1);assert.ok(Math.abs(a.y+a.height-b.y-b.height)<4,JSON.stringify({a,b}))}
  }
  if(name==='updates'){
   assert.equal(await page.locator('#android-catalog-url').inputValue(),'https://fixture.test/catalog.json')
   for(const count of [0,1,25]){await page.evaluate(n=>window.count=n,count);await page.getByRole('button',{name:'检查远程题库',exact:true}).click();await page.waitForFunction(n=>document.querySelectorAll('.catalog-item').length===n,count)}
   await page.getByRole('button',{name:'检查程序更新',exact:true}).click()
   await page.locator('.app-band .update-summary').filter({hasText:'检测到可用的新版本'}).waitFor()
   assert.equal(await page.locator('.version-list .available-version strong').innerText(),'next')
   assert.equal(await page.locator('.version-list .version-row').nth(1).innerText(),'fixture\n已安装')
   assert.equal(await page.locator('.release-notes').innerText(),'长更新说明。'.repeat(150))
   const cards=await page.locator('.maintenance-update-grid > section').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,b:r.bottom}}))
   assert.equal(cards.length,2);assert.ok(cards[1].y>=cards[0].b);assert.ok(Math.abs(cards[0].x-cards[1].x)<2);assert.ok(Math.abs(cards[0].w-cards[1].w)<2)
   const catalog=await page.locator('.catalog-content').boundingBox();assert.ok(catalog.y>=cards[0].y&&catalog.y+catalog.height<=cards[0].b)
   const packages=await page.locator('.catalog-item').evaluateAll(es=>es.slice(0,2).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,b:r.bottom}}))
   if(width>650){assert.ok(Math.abs(packages[0].y-packages[1].y)<2);assert.ok(packages[1].x>packages[0].x)}else assert.ok(packages[1].y>=packages[0].b)
   const notes=await page.locator('.release-notes').evaluate(e=>{e.scrollTop=e.scrollHeight;return {overflow:getComputedStyle(e).overflowY,height:e.clientHeight,scroll:e.scrollHeight,top:e.scrollTop}})
   assert.equal(notes.overflow,'auto');assert.ok(notes.scroll>notes.height);assert.ok(notes.top>0)
  }
  if(name==='diagnostics'){
   assert.equal(await page.locator('.diagnostic-group').nth(1).getByRole('button',{name:'导出应用数据库副本'}).count(),1)
   assert.equal(await page.locator('.diagnostic-group .diagnostic-clear').count(),0)
   await page.getByRole('button',{name:'清空日志',exact:true}).click();assert.equal(await page.locator('.diagnostic-list details').count(),1)
   await page.evaluate(()=>window.allowClear=true);await page.getByRole('button',{name:'清空日志',exact:true}).click();assert.equal(await page.locator('.diagnostic-list details').count(),0)
  }
  const bounds=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));assert.ok(bounds.scroll<=bounds.width+1,JSON.stringify({name,width,scale,bounds}));assert.deepEqual(errors,[])
  await page.close();console.log('PASS maintenance',name,width,height,scale)
 }
 const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]+'__fixture?page=sync');await page.locator('.sync-connection[open]').waitFor();assert.equal(await page.getByLabel('自动同步',{exact:true}).isDisabled(),true);await page.close()
}finally{await browser?.close();await server.close()}
