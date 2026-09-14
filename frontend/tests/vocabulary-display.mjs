import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
const root = fileURLToPath(new URL('../', import.meta.url))
const entry = `
import {createApp, h, reactive, ref} from 'vue';
import {createRouter,createWebHashHistory} from 'vue-router';
import Settings from '/src/views/AndroidVocabularyDisplayView.vue';
import Content from '/src/components/VocabularyMemoryContent.vue';
import {loadVocabDisplayConfig} from '/src/services/vocabularyDisplayConfig';
import '/src/styles.css';
const config=reactive(loadVocabDisplayConfig());
window.addEventListener('vocab-display-change',()=>Object.assign(config,loadVocabDisplayConfig()));
const word=reactive({id:1,term:'went',common_meaning:'常用测试',phonetic:'/went/',part_of_speech:'v.',latest_sentence:'She went home yesterday.',generated_example:{sentence:'They went to school.',translation:'他们去上学。'},morphology:{lemma:'go',currentForm:'过去式',forms:[{label:'原形',word:'go'}]},synonyms:[{word:'left',note:'同义测试'}],antonyms:[{word:'came',note:'反义测试'}],similar_forms:[{word:'want',note:'形近测试'}],memory_hint:'记忆测试',note:'笔记测试'});
const token=ref(0);window.expand=()=>token.value++;window.nextWord=()=>word.id++;
const app=createApp({render:()=>h('div',[h(Settings),h(Content,{entry:word,config,expanded:true,expansionToken:token.value})])});
app.use(createRouter({history:createWebHashHistory(),routes:[{path:'/:pathMatch(.*)*',component:{render:()=>null}}]}));app.mount('#app');
`
const server=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,include:['vue','vue-router','lucide-vue-next']},plugins:[{name:'display-fixture',resolveId(id){if(id==='virtual:display')return id},load(id){if(id==='virtual:display')return entry},configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=='/__display')return next();res.setHeader('Content-Type','text/html');res.end('<html data-platform="android"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/@id/virtual:display"></script></html>')})}},vue()],server:{host:'127.0.0.1',port:0}})
let browser
try {
 await server.listen();browser=await chromium.launch({headless:true})
 const page=await browser.newPage({viewport:{width:1280,height:800}})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(server.resolvedUrls.local[0]+'__display')
 const toggles=page.locator('.selection-option input');await toggles.first().waitFor();assert.equal(await toggles.count(),11)
 for(const toggle of await toggles.all())await toggle.uncheck()
 const content=page.locator('.vocab-memory-content')
 const expected=['常用测试','/went/','v.','She went home yesterday.','They went to school.','记忆测试','同义测试','反义测试','形近测试','过去式','笔记测试']
 for(let i=0;i<11;i++){
   await toggles.nth(i).check();assert.match(await content.innerText(),new RegExp(expected[i].replace(/[.*+?^${}()|[]\]/g,'\$&')))
   await toggles.nth(i).uncheck();assert.equal((await content.innerText()).trim(),'')
 }
 for(const toggle of await toggles.all())await toggle.check()
 assert.equal(await content.locator('details:not([open])').count(),0)
 assert.equal(await content.locator('.memory-layer-static').count(),1)
 await content.getByText('模型例句',{exact:true}).click();assert.equal(await content.locator('details:not([open])').count(),1)
 await page.evaluate(()=>window.expand());await page.waitForFunction(()=>!document.querySelector('.vocab-memory-content details:not([open])'))
 await content.getByText('模型例句',{exact:true}).click();await page.evaluate(()=>window.nextWord());await page.waitForFunction(()=>!document.querySelector('.vocab-memory-content details:not([open])'))
 await page.setViewportSize({width:800,height:1280});assert.equal(await content.locator('details:not([open])').count(),0)
 await toggles.nth(4).uncheck();await page.evaluate(()=>window.expand());assert.equal(await content.getByText('模型例句',{exact:true}).count(),0)
 await page.reload();await toggles.first().waitFor();assert.equal(await toggles.nth(4).isChecked(),false);assert.equal(await toggles.nth(0).isChecked(),true)
 assert.deepEqual(errors,[]);console.log('PASS all 11 independent switches, source/model coexistence, persisted settings, explicit expansion, word switch and rotation')
} finally {await browser?.close();await server.close()}
