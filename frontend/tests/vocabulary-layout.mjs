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
  globalThis.vocabRevision = 1
  // 队列投影只回传卡片抬头与复习计划字段；释义、原句、出现记录改由详情按需读取。
  const listRow = word => ({ id:word.id, term:word.term, normalized_term:word.term.toLowerCase(), lemma:'', phonetic:word.phonetic,
    translation_status:word.translation_status, study_status:word.study_status, review_stage:0, lapse_count:0, last_result:'',
    next_review_at:null, last_reviewed_at:null, created_at:'2026-01-01', updated_at:'2026-01-01', is_frequent:0 })
  globalThis.mockApi = async (path, body) => {
    if (path === '/vocabulary/translation-runs') return { workerStarted: false }
    if (path.startsWith('/vocabulary?')) {
      // 首屏延迟用于验证「响应未返回时不得渲染终态」；默认不延迟。
      if (globalThis.__firstListDelay) {
        const delay = globalThis.__firstListDelay
        globalThis.__firstListDelay = 0
        await new Promise(resolve => setTimeout(resolve, delay))
      }
      const query = new URLSearchParams(path.slice(path.indexOf('?') + 1))
      const base = query.get('status') === 'review' ? words.filter(word => !word.rated) : words
      const search = query.get('search')
      const pool = search ? base.filter(word => word.term.includes(search)) : base
      const limit = query.get('limit')
      const rows = !limit || limit === 'all' ? pool : pool.slice(0, Number(limit))
      const items = query.get('projection') === 'queue'
        ? rows.map(listRow)
        : query.get('projection') === 'review'
          // 真实后端的复习卡详情已收窄到「常用释义 + 真题原句」，这里故意仍回传整行字段：
          // 用来证明复习卡渲染与多出来的字段无关，设置项全开也不会多出栏目。
          ? rows.map(word => ({ ...listRow(word), review_detail: structuredClone(word) }))
        : rows
      return { items, revision: 'v2:' + globalThis.vocabRevision,
        counts: { total: 3, frequent: 0, mastered: 0, pending: 0, review: 3 } }
    }
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
  update: 'export const pendingInstallerCleanup=async()=>({pending:false});export const resolveInstallerCleanup=async()=>{};',
  native: 'export const App={addListener:async()=>({remove:()=>{}})};',
  translations: 'export const resumeVocabularyTranslations=()=>{};',
  scheduler: 'export const startAutoSync=()=>{};export const stopAutoSync=()=>{};',
}
const entry = '(' + fixture.toString() + ')();' +
  'import {createApp,h} from "vue";import App from "/src/App.vue";import View from "/src/views/VocabularyView.vue";' +
  'import "/src/styles.css";import "/src/study-theme.css";' +
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
// 复习界面先用骨架卡占位，清单与释义/原句随后落地；布局测量必须等到两者就绪。
const waitReviewCard = page => page.locator('.vocabulary-review-card:not([aria-busy="true"]) .reveal-button').waitFor()
const waitReviewAnswer = page => page.waitForFunction(()=>{
  const skeleton=document.querySelector('.review-answer .muted')
  return !skeleton || !skeleton.textContent.includes('正在读取释义与原句')
})
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
    assert.match(await filterToggle.innerText(),/0/)
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
      if(width>=1200&&width>height) {
        const bounds=await page.evaluate(()=>{
          const list=document.querySelector('.vocab-list').getBoundingClientRect()
          const detail=[...document.querySelectorAll('.desktop-vocab-detail')].find(element=>element.getBoundingClientRect().width>0)?.getBoundingClientRect()
          return detail?{listTop:list.top,listBottom:list.bottom,detailTop:detail.top,detailBottom:detail.bottom}:null
        })
        assert.ok(bounds&&Math.abs(bounds.listTop-bounds.detailTop)<=1&&Math.abs(bounds.listBottom-bounds.detailBottom)<=1,label+': landscape columns share top and bottom bounds '+JSON.stringify(bounds))
      }
      if((width===1120||width===960)&&word==='evidence') assert.ok(measured.card.top>measured.layout.top+100, 'narrow landscape keeps the existing stacked placement')
      const visibleDetail=page.locator('.desktop-vocab-detail:visible, .portrait-vocab-detail:visible')
      await visibleDetail.getByRole('button',{name:'编辑',exact:true}).click()
      await visibleDetail.locator('.vocab-edit').waitFor()
      await visibleDetail.getByRole('button',{name:'取消',exact:true}).click()
      cases++
    }
    // 复习卡与设置里的单词显示项解耦：先把 11 项全部打开，再进入每日一背，用来证明复习卡不受设置影响。
    await page.evaluate(()=>{
      localStorage.setItem('vocab-display-config',JSON.stringify({common_meaning:true,phonetic:true,part_of_speech:true,source_sentence:true,model_sentence:true,memory_hint:true,synonyms:true,antonyms:true,similar_forms:true,morphology:true,note:true}))
      window.dispatchEvent(new CustomEvent('vocab-display-change'))
    })
    await page.locator('.page-head button').filter({ hasText: '每日一背' }).click()
    await waitReviewCard(page)
    await waitReviewAnswer(page)
    for (const state of ['hidden','revealed']) {
      if(state==='revealed') await page.locator('.reveal-button').click()
      if(state==='revealed') {
        await waitReviewAnswer(page)
        assert.equal(await page.locator('.review-answer .review-meaning-block').first().getAttribute('class'),'review-meaning-block detail-section')
        // 显示项全开时复习卡仍只有常用释义与真题原句：唯一栏目是常驻的原句块，其余 9 项既不渲染标题也不渲染内容。
        assert.deepEqual(await page.locator('.review-answer .memory-layer').evaluateAll(items=>items.map(el=>el.querySelector('h4,summary')?.textContent?.trim())),['真题原句'],label+': 每日一背只应渲染真题原句栏目')
        assert.equal(await page.locator('.review-answer details').count(),0,label+': 每日一背不应有可折叠栏目')
        assert.equal(await page.locator('.review-answer .review-part-of-speech').count(),0,label+': 词性不应出现在每日一背内容中')
        const answerText=await page.locator('.review-answer').innerText()
        for (const column of ['音标','词性','模型例句','词形变化','同义词辨析','反义词辨析','形近词辨析','记忆提示','我的笔记']) assert.ok(!answerText.includes(column),label+': 每日一背内容不应包含「'+column+'」')
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
    await waitReviewAnswer(page)
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
      globalThis.vocabRevision += 1
    })
    for (const kind of ['scheduled','reinforcement']) {
      if(kind==='scheduled') await page.locator('.page-head button').filter({ hasText: '每日一背' }).click()
      else await page.locator('.vocab-reinforcement-actions button').first().click()
      await waitReviewCard(page)
      await page.locator('.reveal-button').click()
      await waitReviewAnswer(page)
      const measured=await inspectReview(page)
      evidence.push({label,kind,...measured})
      if(output) await page.screenshot({path:join(output,label+'-'+kind+'.png')})
      assert.ok(measured.card.top>=-1&&measured.card.bottom<=height+1)
      assert.ok(measured.actions.top>=0&&measured.actions.bottom<=height+1)
      assert.ok(measured.close.top>=0&&measured.close.bottom<=height+1)
      assert.ok(measured.scrollHeight>measured.clientHeight, label+' '+kind+': long answer scrolls inside review content '+JSON.stringify(measured))
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
  // Landscape vocabulary home: both columns share one row height and each
  // scrolls on its own. Use a synthetic long list so the check exercises the
  // actual overflow path rather than a short page that never scrolls.
  {
    const page=await browser.newPage({viewport:{width:1280,height:800}})
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
    await page.addInitScript(()=>Object.defineProperty(screen.orientation,'type',{get:()=>innerHeight>innerWidth?'portrait-primary':'landscape-primary'}))
    await page.goto(server.resolvedUrls.local[0]+'__vocabulary-layout')
    await page.locator('.vocab-list-item').first().waitFor()
    await page.evaluate(()=>{const base=globalThis.fixtureWords[0];for(let i=0;i<60;i++)globalThis.fixtureWords.push({...base,id:1000+i,term:'synthetic'+i,common_meaning:'Synthetic long definition for equal-height layout. '.repeat(40),latest_sentence:base.latest_sentence.repeat(20)})})
    await page.locator('.search-field input').fill('synthetic')
    await page.waitForFunction(()=>document.querySelectorAll('.vocab-list-item').length>25)
    await page.locator('.vocab-list-item').filter({hasText:/^synthetic30/}).click()
    await page.locator('.desktop-vocab-detail h2:visible').waitFor()
    await page.locator('.vocab-list').evaluate(element=>{element.scrollTop=element.scrollHeight})
    await page.waitForFunction(()=>document.querySelectorAll('.vocab-list-item').length>50)
    const measured=await page.evaluate(()=>{
      const box=element=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,overflow:getComputedStyle(element).overflowY}}
      return {list:box(document.querySelector('.vocab-list')),detail:box(document.querySelector('.desktop-vocab-detail'))}
    })
    assert.ok(Math.abs(measured.list.top-measured.detail.top)<=1,JSON.stringify(measured))
    assert.ok(Math.abs(measured.list.bottom-measured.detail.bottom)<=1,JSON.stringify(measured))
    assert.ok(measured.list.scrollHeight>measured.list.clientHeight,'left list scrolls inside the shared row')
    assert.ok(measured.detail.scrollHeight>measured.detail.clientHeight,'right detail scrolls independently')
    assert.ok(['auto','scroll'].includes(measured.list.overflow)&&['auto','scroll'].includes(measured.detail.overflow))
    assert.deepEqual(errors,[])
    await page.close()
    console.log('Vocabulary landscape columns: equal top/bottom bounds with independent scrolling')
  }
  // The pronunciation contract uses the text actually shown (term), never a
  // lemma substitution such as further -> far.
  {
    const page=await browser.newPage({viewport:{width:1280,height:800}})
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
    await page.addInitScript(()=>Object.defineProperty(screen.orientation,'type',{get:()=>innerHeight>innerWidth?'portrait-primary':'landscape-primary'}))
    await page.goto(server.resolvedUrls.local[0]+'__vocabulary-layout')
    await page.locator('.vocab-list-item').first().waitFor()
    await page.evaluate(()=>{const base=globalThis.fixtureWords[0];globalThis.fixtureWords.push({...base,id:2000,term:'further',normalized_term:'further',lemma:'far',phonetic:'/ˈfɜːðə/'})})
    await page.locator('.search-field input').fill('further')
    await page.locator('.vocab-list-item').filter({hasText:'further'}).click()
    await page.locator('.desktop-vocab-detail h2:visible').waitFor()
    assert.match(await page.locator('.desktop-vocab-detail h2:visible').innerText(),/further/)
    const labels=await page.locator('.desktop-vocab-detail .voice-button').evaluateAll(items=>items.map(item=>item.getAttribute('aria-label')))
    assert.deepEqual(labels,['美式发音：further','英式发音：further'])
    assert.equal(await page.locator('.vocab-list-item .pronunciation').count(),0,'list rows never carry pronunciation buttons')
    assert.deepEqual(errors,[])
    await page.close()
    console.log('Vocabulary pronunciation: selected term (not lemma) drives both accent buttons')
  }
  // A shape-similar pair is labelled without revealing its partner, then the
  // optional comparison opens only after both words have their own rating.
  {
    const page=await browser.newPage({viewport:{width:1280,height:800}})
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
    await page.addInitScript(()=>Object.defineProperty(screen.orientation,'type',{get:()=>innerHeight>innerWidth?'portrait-primary':'landscape-primary'}))
    await page.goto(server.resolvedUrls.local[0]+'__vocabulary-layout')
    await page.locator('.vocab-list-item').first().waitFor()
    await page.evaluate(()=>{
      const base=globalThis.fixtureWords[0]
      globalThis.fixtureWords.push({...base,id:3001,term:'affect',normalized_term:'affect',common_meaning:'影响',phonetic:'/əˈfekt/'})
      globalThis.fixtureWords.push({...base,id:3002,term:'effect',normalized_term:'effect',common_meaning:'效果',phonetic:'/ɪˈfekt/'})
    })
    await page.locator('.page-head button').filter({hasText:'每日一背'}).click()
    await page.locator('.vocabulary-review-card:not([aria-busy="true"]) .reveal-button').waitFor()
    assert.match(await page.locator('.review-term').innerText(),/affect/)
    assert.equal((await page.locator('.review-group-badge').innerText()).trim(),'形近词组 · 1/2')
    await page.locator('.reveal-button').click()
    await page.evaluate(()=>{globalThis.releaseRating=null})
    await page.getByRole('button',{name:'认识',exact:true}).click()
    await page.waitForFunction(()=>typeof globalThis.releaseRating==='function')
    await page.evaluate(()=>globalThis.releaseRating())
    await page.waitForFunction(()=>document.querySelector('.review-term')?.textContent.includes('effect'))
    assert.equal((await page.locator('.review-group-badge').innerText()).trim(),'形近词组 · 2/2')
    await page.locator('.reveal-button').click()
    await page.evaluate(()=>{globalThis.releaseRating=null})
    await page.getByRole('button',{name:'认识',exact:true}).click()
    await page.waitForFunction(()=>typeof globalThis.releaseRating==='function')
    await page.evaluate(()=>globalThis.releaseRating())
    await page.getByRole('button',{name:'查看辨析',exact:true}).waitFor()
    await page.getByRole('button',{name:'查看辨析',exact:true}).click()
    await page.getByRole('dialog',{name:'形近词辨析'}).waitFor()
    assert.equal(await page.locator('.review-discrimination-grid article').count(),2)
    const dialogText=await page.getByRole('dialog',{name:'形近词辨析'}).innerText()
    for(const text of ['affect','effect','影响','效果'])assert.ok(dialogText.includes(text))
    assert.ok(await page.locator('.review-spelling-diff .changed').count()>=2)
    assert.equal(await page.getByRole('dialog',{name:'形近词辨析'}).locator('.voice-button').count(),4)
    await page.getByRole('button',{name:'返回复习',exact:true}).click()
    await page.waitForFunction(()=>!document.querySelector('.review-discrimination-overlay'))
    assert.equal(await page.getByRole('button',{name:'查看辨析',exact:true}).count(),0)
    assert.equal(await page.locator('.review-group-badge').count(),0,'unrelated next card has no group label')
    assert.deepEqual(errors,[])
    await page.close()
    console.log('Vocabulary review groups: label, per-word ratings, optional comparison and dismissal')
  }
  // 首屏响应尚未返回时不得渲染终态：既不显示“没有单词”，也不把计数显示成 0。
  {
    const page=await browser.newPage({viewport:{width:390,height:844}})
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
    await page.addInitScript(()=>Object.defineProperty(screen.orientation,'type',{get:()=>innerHeight>innerWidth?'portrait-primary':'landscape-primary'}))
    await page.addInitScript(()=>{globalThis.__firstListDelay=700})
    await page.goto(server.resolvedUrls.local[0]+'__vocabulary-layout')
    await page.waitForFunction(()=>document.querySelector('.vocab-list-state'))
    assert.equal(await page.locator('.vocab-list-state').getAttribute('aria-busy'),'true')
    assert.match(await page.locator('.vocab-list-state').innerText(),/正在读取单词/)
    assert.equal(await page.locator('.vocab-list-item').count(),0)
    assert.equal(await page.locator('.vocab-list .empty:not(.vocab-list-state)').count(),0)
    assert.equal(await page.locator('.vocab-stat-chip strong').first().innerText(),'—')
    assert.equal(await page.locator('.vocab-filter-toggle').innerText(),'筛选：全部单词 · —')
    await page.locator('.vocab-list-item').first().waitFor()
    assert.equal(await page.locator('.vocab-list-state').count(),0)
    assert.equal(await page.locator('.vocab-stat-chip strong').first().innerText(),'3')
    // 真的没有结果时仍然要显示终态空列表。
    await page.locator('.search-field input').fill('zzz')
    await page.waitForFunction(()=>[...document.querySelectorAll('.empty')].some(el=>el.textContent.includes('还没有符合条件的单词')))
    assert.equal(await page.locator('.vocab-list-state').count(),0)
    assert.deepEqual(errors,[])
    await page.close()
    console.log('Vocabulary first-load state: a pending response shows a reading state instead of an empty/zero list')
  }
  console.log('Vocabulary layout: '+cases+' scenarios passed')
} finally {
  if(output) await writeFile(join(output,'geometry.json'),JSON.stringify(evidence,null,2))
  await browser?.close()
  await server.close()
}
