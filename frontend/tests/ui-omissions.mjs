import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
const root=fileURLToPath(new URL('../',import.meta.url))
const mocks={
  router:'export const useRoute=()=>({query:{}});export const useRouter=()=>({push:async()=>{}})',
  dialogs:'export const confirmDialog=async()=>false;export const promptDialog=async()=>null',
  runtime:'export const platformRuntime={isAndroid:true}',
  history:'export const pushOverlayHistory=()=>({close(){},dispose(){}})',
  profiles:'import {reactive} from "vue";export const questionBankProfilesState=reactive({items:[{id:1,name:"合成题库配置",paper_count:1,question_count:20}],activeId:1,loading:false});export const loadQuestionBankProfiles=async()=>{};export const activateQuestionBankProfile=async()=>{};export const createQuestionBankProfile=async()=>{};export const deleteQuestionBankProfile=async()=>{};export const renameQuestionBankProfile=async()=>{}',
  api:'export async function get(p){if(p==="/papers")return [{id:1,title:"合成题库",year:2026,subject:"英语",status:"published",unit_count:1,question_count:20}];if(p.startsWith("/wrong?"))return [{unit_id:1,unit_title:"完型填空与长标题的布局测试",unit_type:"cloze",year:2026,current_count:2,retry_count:0,current_question_ids:[1,2],rounds:[]}];if(p==="/ai/wrong-analysis-status")return {units:[]};throw Error(p)};export async function post(p){if(p==="/ai/analyze-wrong")return {analysis:"合成分析结果",report_id:1};throw Error(p)};export const del=async()=>{throw Error("Unexpected delete")};',
}
const server=await createServer({configFile:false,root,optimizeDeps:{noDiscovery:true,include:['vue','lucide-vue-next']},plugins:[{
  name:'ui-omissions',enforce:'pre',
  resolveId(id){
    if(id==='virtual:ui-omissions')return id
    const key=id==='vue-router'?'router':id==='../api'?'api':id.endsWith('/platform/dialogs')?'dialogs':id.endsWith('/platform/runtime')?'runtime':id.endsWith('/platform/overlay-history')?'history':id.endsWith('/services/questionBankProfiles')?'profiles':null
    if(key)return 'virtual:mock:'+key
  },
  load(id){
    if(id.startsWith('virtual:mock:'))return mocks[id.slice(13)]
    if(id==='virtual:ui-omissions')return 'import {createApp,h} from "vue";import Library from "/src/views/LibraryView.vue";import Wrong from "/src/views/WrongView.vue";import Settings from "/src/views/MobileSettingsView.vue";import "/src/styles.css";import "/src/study-theme.css";const view=new URL(location.href).searchParams.get("view");const app=createApp(view==="wrong"?Wrong:view==="settings"?Settings:Library);app.component("RouterLink",{props:["to"],setup:(p,{slots})=>()=>h("a",{href:p.to},slots.default())});app.mount("#app")'
  },
  configureServer(s){s.middlewares.use((req,res,next)=>{if(!req.url.startsWith('/__omissions'))return next();res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html data-platform="android"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/@id/virtual:ui-omissions"></script></html>')})},
},vue()],server:{host:'127.0.0.1',port:0}})
let browser
try{
 await server.listen();browser=await chromium.launch({headless:true})
 for(const [width,height] of [[390,844],[844,390],[800,1280],[1280,800]]) for(const scale of [1,1.35]){
  const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
  const open=async view=>{
    await page.goto(server.resolvedUrls.local[0]+'__omissions?view='+view)
    await page.locator('.page').waitFor()
    await page.evaluate(({scale,width,height})=>{document.documentElement.dataset.orientation=width>height?'landscape':'portrait';const elements=[...document.querySelectorAll('body,body *')].filter(el=>el instanceof HTMLElement);const sizes=elements.map(el=>parseFloat(getComputedStyle(el).fontSize));elements.forEach((el,i)=>el.style.fontSize=sizes[i]*scale+'px')},{scale,width,height})
  }
  const bounds=async()=>assert.deepEqual(await page.locator('.page').evaluate(root=>[...root.querySelectorAll('*')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&(r.left < -1 || r.right>innerWidth+1)}).map(el=>el.className)),[],width+'x'+height+' font '+scale)
  await open('library');await page.locator('.paper-card').waitFor()
  assert.equal(await page.getByRole('link',{name:'查看全部题库'}).count(),1)
  await bounds()
  const boxes=await page.locator('.bank-switcher-main > *').evaluateAll(items=>items.map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,center:(r.top+r.bottom)/2}}))
  if(width>900&&width>height)assert.ok(Math.max(...boxes.map(b=>b.center))-Math.min(...boxes.map(b=>b.center))<3)
  else assert.ok(boxes.slice(1).every(b=>b.top>=boxes[0].bottom))
  await page.getByRole('button',{name:'批量管理'}).click()
  const choice=page.getByRole('checkbox',{name:'选择题库'})
  await choice.check();assert.equal(await choice.isChecked(),true)
  assert.match(await page.locator('.bank-batch-status').innerText(),/1/)
  await choice.uncheck();assert.match(await page.locator('.bank-batch-status').innerText(),/0/)
  await bounds()
  await open('wrong');await page.locator('.wrong-unit-row').waitFor()
  const filter=page.getByRole('radio',{name:'高频错题'})
  await page.locator('.selection-option').filter({hasText:'高频错题'}).click();await filter.focus();assert.equal(await filter.isChecked(),true)
  assert.notEqual(await filter.evaluate(el=>getComputedStyle(el.parentElement).outlineStyle),'none')
  assert.equal(await page.getByRole('menu').count(),0)
  if(width>height) {
    assert.equal(await page.locator('.wrong-scope-actions > button').count(),3)
    await bounds()
  } else {
  await page.getByRole('button',{name:/更多操作/}).click()
  const analyze=page.getByRole('menuitem',{name:'分析',exact:true})
  await analyze.waitFor()
  await analyze.scrollIntoViewIfNeeded()
  assert.equal(await analyze.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}),true,'menu is not clipped')
  await bounds();await analyze.click()
  await page.getByText('合成分析结果',{exact:true}).waitFor();assert.equal(await page.getByRole('menu').count(),0)
  }
  await open('settings')
  assert.equal(await page.getByRole('checkbox').count(),0)
  assert.equal(await page.getByRole(width>height?'switch':'link',{name:width>height?/深色模式/:/外观与显示/}).count(),1)
  assert.equal(await page.getByRole('link',{name:width>height?/单词本设置/:/单词显示/}).count(),1)
  await bounds()
  assert.deepEqual(errors,[]);await page.close()
  console.log(width+'x'+height+' font '+scale+': library batch, menu, radio focus, translation preference passed')
 }
}finally{await browser?.close();await server.close()}
