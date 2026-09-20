import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = process.env.VOCAB_LAYOUT_OUTPUT
if (output) await mkdir(output, { recursive: true })
const stylesOverride = process.env.VOCAB_LAYOUT_STYLES
  ? await readFile(process.env.VOCAB_LAYOUT_STYLES, 'utf8') : null
const themeOverride = process.env.VOCAB_LAYOUT_THEME
  ? await readFile(process.env.VOCAB_LAYOUT_THEME, 'utf8') : null
const longWord = 'interdisciplinary'
const veryLongWord = 'pneumonoultramicroscopicsilicovolcanoconiosis'

function fixture() {
  localStorage.setItem('linjian-android-onboarding-v1', 'done')
  const sentence = 'Researchers compare evidence and revise their explanations when new observations become available. '
  const words = ['evidence', 'interdisciplinary', 'pneumonoultramicroscopicsilicovolcanoconiosis'].map((term, index) => ({
    id: index + 1, term, translation_status: 'ready', study_status: 'learning', encounter_count: index + 2,
    phonetic: '/synthetic/', part_of_speech: 'n.', common_meaning: 'Synthetic definition',
    contextual_meaning: 'Synthetic contextual meaning', latest_sentence: sentence,
    occurrences: [{ id: index + 1, context_sentence: sentence, year: 2026, unit_title: 'Synthetic reading' }],
  }))
  globalThis.fixtureWords = words
  globalThis.mockApi = async (path, body) => {
    if (path === '/vocabulary/translation-runs') return { workerStarted: false }
    if (path.startsWith('/vocabulary?')) return { items: words.filter(word=>!path.includes('status=review')||!word.rated), counts: { total: 3, frequent: 0, mastered: 0, pending: 0, review: 3 } }
    const match = path.match(/^\/vocabulary\/(\d+)(?:\/review)?$/)
    if (match) {
      const word = words.find(word => word.id === Number(match[1]))
      if (body && path.endsWith('/review')) {
        await new Promise(resolve=>{globalThis.releaseRating=resolve})
        word.rated=true
      }
      return body ? Object.assign(word, body) : { ...word }
    }
    throw new Error('Unexpected synthetic API: ' + path)
  }
}
const stubs = {
  api: 'export const get=(p)=>globalThis.mockApi(p);export const post=(p,b)=>globalThis.mockApi(p,b);export const put=post;export const del=post;',
  router: 'export const route={path:"/vocabulary",query:{}};export const useRoute=()=>route;export const useRouter=()=>({push:async()=>{},replace:async()=>{}});',
  runtime: 'export const platformRuntime={isAndroid:true};',
  update: 'export const checkAppUpdate=async()=>({available:false});export const pendingInstallerCleanup=async()=>({pending:false});export const resolveInstallerCleanup=async()=>{};',
  native: 'export const App={addListener:async()=>({remove:()=>{}})};',
  translations: 'export const resumeVocabularyTranslations=()=>{};',
  scheduler: 'export const startAutoSync=()=>{};export const stopAutoSync=()=>{};',
}
const entry = '(' + fixture.toString() + ')();' +
  'import {createApp,h} from "vue";import App from "/src/App.vue";import View from "/src/views/VocabularyView.vue";' +
  'import "/src/styles.css";import "/src/remediation-foundations.css";import "/src/study-theme.css";' +
  'const app=createApp(App);app.component("RouterView",View);app.component("RouterLink",{props:["to"],setup:(p,{slots})=>()=>h("a",{href:p.to,class:p.to==="/vocabulary"?"router-link-active":""},slots.default())});app.mount("#app");'
const server = await createServer({ configFile: false, root, optimizeDeps: { noDiscovery: true, include: ['vue', 'lucide-vue-next'] }, plugins: [
  { name: 'isolated-vocabulary-layout', enforce: 'pre',
    resolveId(id) {
      if (id === 'virtual:vocabulary-layout') return id
      if (id === 'vue-router') return 'virtual:stub:router'
      if (id === '../api' || id === './api') return 'virtual:stub:api'
      if (id === './platform/runtime') return 'virtual:stub:runtime'
      if (id.endsWith('/android/app-update')) return 'virtual:stub:update'
      if (id === '@capacitor/app') return 'virtual:stub:native'
      if (id.endsWith('/android/vocabulary-translation-runner')) return 'virtual:stub:translations'
      if (id.endsWith('/android/sync-scheduler')) return 'virtual:stub:scheduler'
    },
    load(id) {
      if (id === 'virtual:vocabulary-layout') return entry
      if (id.startsWith('virtual:stub:')) return stubs[id.slice(13)]
      if (stylesOverride !== null && id.replaceAll('\\', '/').endsWith('/src/styles.css')) return stylesOverride
      if (themeOverride !== null && id.replaceAll('\\', '/').endsWith('/src/study-theme.css')) return themeOverride
    },
    configureServer(server) { server.middlewares.use((req, res, next) => {
      if (req.url !== '/__vocabulary-layout') return next()
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end('<!doctype html><html data-platform="android"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><script type="module" src="/@id/virtual:vocabulary-layout"></script></body></html>')
    }) },
  }, vue()], server: { host: '127.0.0.1', port: 0 } })

async function inspectDetail(page) {
  return page.evaluate(() => {
    const root = [...document.querySelectorAll('.desktop-vocab-detail, .portrait-vocab-detail')]
      .find(element => element.getBoundingClientRect().width > 0)
    const box = element => { const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height} }
    const header = root.querySelector('.vocab-detail-head')
    const title = header.querySelector('h2')
    const tools = header.querySelector('.vocab-tools')
    const padding = parseFloat(getComputedStyle(root).paddingRight)
    const layout = document.querySelector('.vocabulary-layout')
    return {
      card:box(root),header:box(header),title:box(title),tools:box(tools),padding,
      buttons:[...tools.querySelectorAll('button')].map(box),
      scrollWidth:root.scrollWidth,clientWidth:root.clientWidth,
      layout:box(layout),columns:getComputedStyle(layout).gridTemplateColumns,
      theme:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      orientation:document.documentElement.dataset.orientation,
    }
  })
}
async function inspectReview(page) {
  return page.evaluate(() => {
    const box = selector => { const element=document.querySelector(selector);if(!element)return null;const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height} }
    const content=document.querySelector('.review-content')
    return {card:box('.vocabulary-review-card'),term:box('.review-term'),header:box('.review-header'),actions:box('.review-actions'),close:box('.review-close'),content:box('.review-content'),scrollHeight:content.scrollHeight,clientHeight:content.clientHeight}
  })
}
let browser
const evidence=[]
let cases=0
try {
  await server.listen()
  browser=await chromium.launch({headless:true})
  for (const [width,height] of [[1280,800],[1120,700],[960,600],[800,1280],[390,844],[844,390]]) for (const dark of [false,true]) for (const fontScale of [1,1.35]) {
    const page=await browser.newPage({viewport:{width,height},colorScheme:dark?'dark':'light'})
    const errors=[]
    page.on('pageerror',error=>errors.push(error.message))
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
    await page.addInitScript(()=>Object.defineProperty(screen.orientation,'type',{get:()=>innerHeight>innerWidth?'portrait-primary':'landscape-primary'}))
    await page.addInitScript(value=>localStorage.setItem('linjian-theme',value?'dark':'light'),dark)
    await page.goto(server.resolvedUrls.local[0]+'__vocabulary-layout')
    await page.locator('.vocab-list-item').first().waitFor()
    await page.evaluate(scale=>{document.documentElement.style.fontSize=16*scale+'px'},fontScale)
    if(fontScale===1.35) await page.addStyleTag({content:'.vocab-detail-head h2 {font-size:40.5px!important}.review-term {font-size:64.8px!important}'})
    const label=width+'x'+height+'-'+(dark?'dark':'light')+'-font-'+fontScale
    const filterToggle=page.locator('.vocab-filter-toggle')
    assert.equal(await filterToggle.getAttribute('aria-expanded'),'false')
    await filterToggle.click()
    await page.locator('.vocab-filter-options label').filter({hasText:'已掌握'}).click()
    assert.match(await filterToggle.innerText(),/已掌握/)
    assert.equal(await filterToggle.getAttribute('aria-expanded'),'false')
    await filterToggle.click()
    assert.equal(await page.getByRole('radio',{name:'已掌握'}).isChecked(),true)
    assert.match(await filterToggle.innerText(),/0/)
    await filterToggle.click()
    assert.equal(await page.locator('.vocab-filter-options').count(),0)
    for (const word of ['evidence',longWord,veryLongWord]) {
      // 首次进入不再自动展开第一个词条（窄屏信息架构），由用例显式点击目标词。
      await page.locator('.vocab-list-item').filter({hasText:word}).click()
      await page.locator('.vocab-detail-head h2:visible').scrollIntoViewIfNeeded()
      await page.waitForFunction(()=>[...document.querySelectorAll('.vocab-detail-head h2 .vocabulary-term-fit')].filter(el=>el.clientWidth).every(el=>el.scrollWidth<=el.clientWidth+1))
      const titleLine=await page.locator('.vocab-detail-head h2:visible .vocabulary-term-text').evaluate(el=>({height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight)}))
      assert.ok(titleLine.height <= titleLine.line+1, 'long word remains on one line')
      const measured=await inspectDetail(page)
      evidence.push({label,word,...measured})
      if(output) await page.screenshot({path:join(output,label+'-'+word+'.png')})
      assert.equal(measured.theme,dark?'#191b20':'#edf2f6')
      assert.ok(measured.tools.right <= measured.card.right-measured.padding+1, JSON.stringify({label,word,reason:'tools outside detail content',...measured}))
      assert.ok(measured.scrollWidth <= measured.clientWidth+1, JSON.stringify({label,word,reason:'detail horizontal overflow',...measured}))
      assert.ok(measured.title.right <= measured.card.right-measured.padding+1)
      assert.ok(measured.title.bottom <= measured.tools.top+1 || measured.title.right <= measured.tools.left+1, 'word and tools must not overlap')
      if(width===1280&&word==='evidence') assert.ok(measured.tools.top < measured.title.bottom, 'short-word header retains its existing single row')
      if((width===1120||width===960)&&word==='evidence') assert.ok(measured.card.top>measured.layout.top+100, 'legacy narrow-window detail placement remains unchanged')
      const visibleDetail=page.locator('.desktop-vocab-detail:visible, .portrait-vocab-detail:visible')
      await visibleDetail.getByRole('button',{name:'编辑',exact:true}).click()
      await visibleDetail.locator('.vocab-edit').waitFor()
      await visibleDetail.getByRole('button',{name:'取消',exact:true}).click()
      cases++
    }
    await page.locator('.page-head button').click()
    for (const state of ['hidden','revealed']) {
      if(state==='revealed') await page.locator('.reveal-button').click()
      if(state==='revealed') {
        assert.equal(await page.locator('.review-answer .review-meaning-block').first().getAttribute('class'),'review-meaning-block detail-section')
        assert.equal(await page.locator('.review-answer .review-part-of-speech').innerText(),'n.')
        assert.deepEqual(await page.locator('.review-actions button').allTextContents(),['不认识','认识','熟练'])
        const tops=await page.locator('.review-actions button').evaluateAll(buttons=>buttons.map(button=>button.getBoundingClientRect().top))
        assert.ok(Math.max(...tops)-Math.min(...tops)<2,'rating buttons stay in one row')
      }
      const measured=await inspectReview(page)
      evidence.push({label,state,...measured})
      if(output) await page.screenshot({path:join(output,label+'-compact-'+state+'.png')})
      if(width>height && height>=600 && fontScale===1) {
        assert.ok(measured.card.width<=720, 'landscape review uses desktop card width')
        assert.ok(measured.card.top>=16&&measured.card.bottom<=height-16, 'review leaves space around its border')
        assert.ok(Math.abs(measured.card.left-(width-measured.card.width)/2)<2, 'review card is centered')
        if(state==='revealed') {
          const hidden=evidence.findLast(item=>item.label===label&&item.state==='hidden')
          assert.ok(Math.abs(measured.card.height-hidden.card.height)<1,'revealing reserves actual content without card jump')
          const widths=await page.locator('.review-actions button').evaluateAll(items=>items.map(el=>el.getBoundingClientRect().width))
          assert.ok(widths.every(value=>Math.abs(value-156)<1),'landscape buttons use approved 156px width')
        }
      }
      cases++
    }
    const layers=page.locator('.review-answer .memory-layer')
    assert.ok(await page.locator('.review-answer .memory-layer-static').filter({hasText:'真题原句'}).count() >= 1)
    const before=await page.locator('.review-actions button').evaluateAll(items=>items.map(el=>({x:el.offsetLeft,y:el.offsetTop,width:el.offsetWidth})))
    await page.getByRole('button',{name:'认识',exact:true}).click()
    await page.waitForFunction(()=>typeof globalThis.releaseRating==='function')
    assert.equal(await page.locator('.review-actions').getAttribute('aria-busy'),'true')
    assert.equal(await page.locator('.review-actions button:disabled').count(),3)
    assert.deepEqual(await page.locator('.review-actions button').allTextContents(),['不认识','认识','熟练'])
    assert.deepEqual(await page.locator('.review-actions button').evaluateAll(items=>items.map(el=>({x:el.offsetLeft,y:el.offsetTop,width:el.offsetWidth}))),before)
    await page.evaluate(()=>globalThis.releaseRating())
    await page.waitForFunction(()=>document.querySelector('.review-term')?.textContent.includes('interdisciplinary'))
    await page.locator('.reveal-button').click()
    // Rotate with long title and multiple open layers, then narrow to one layer.
    if(width===1280 && !dark && fontScale===1) {
      const collapsible = page.locator('.review-answer .memory-layer details')
      if (await collapsible.count() >= 2) {
        await collapsible.nth(0).locator('summary').click()
        await collapsible.nth(1).locator('summary').click()
        await page.waitForFunction(()=>document.querySelectorAll('.review-answer details[open]').length===2)
      }
      await page.setViewportSize({width:390,height:844})
      await page.waitForFunction(()=>document.querySelectorAll('.review-answer details[open]').length<=1)
      await page.waitForFunction(()=>{const el=document.querySelector('.review-term .vocabulary-term-fit');return el.scrollWidth<=el.clientWidth+1})
      await page.setViewportSize({width,height})
    }
    await page.getByRole('button',{name:'退出复习',exact:true}).click()
    await page.evaluate(()=>{
      fixtureWords[0].rated=false
      fixtureWords[0].common_meaning='Synthetic long definition for layout regression. '.repeat(80)
      fixtureWords[0].latest_sentence=fixtureWords[0].latest_sentence.repeat(30)
      for (const word of fixtureWords) word.common_meaning=fixtureWords[0].common_meaning
    })
    for (const kind of ['scheduled','reinforcement']) {
      if(kind==='scheduled') await page.locator('.page-head button').click()
      else await page.locator('.vocab-reinforcement-actions button').first().click()
      await page.locator('.reveal-button').click()
      const measured=await inspectReview(page)
      evidence.push({label,kind,...measured})
      if(output) await page.screenshot({path:join(output,label+'-'+kind+'.png')})
      assert.ok(measured.card.top>=-1&&measured.card.bottom<=height+1)
      assert.ok(measured.actions.top>=0&&measured.actions.bottom<=height+1)
      assert.ok(measured.close.top>=0&&measured.close.bottom<=height+1)
      assert.ok(measured.scrollHeight>measured.clientHeight, 'long answer scrolls inside review content')
      await page.locator('.review-content').evaluate(element=>{element.scrollTop=element.scrollHeight})
      assert.ok(await page.locator('.review-content').evaluate(element=>element.scrollTop>0))
      await page.getByRole('button',{name:'退出复习',exact:true}).click()
      await page.locator('.vocabulary-layout').waitFor()
      cases++
    }
    assert.deepEqual(errors,[])
    console.log(label+': word containment, edit reachability, theme and both scrolling review modes passed')
    await page.close()
  }
  console.log('Vocabulary layout: '+cases+' scenarios passed')
} finally {
  if(output) await writeFile(join(output,'geometry.json'),JSON.stringify(evidence,null,2))
  await browser?.close()
  await server.close()
}
