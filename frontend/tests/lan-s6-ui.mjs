import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const android = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).dependencies['@capacitor/core'] !== undefined
const output = process.env.LAN_UI_OUTPUT
if (output) await mkdir(output, { recursive: true })
const main = await readFile(join(root, 'src/main.ts'), 'utf8')
assert.ok(main.indexOf("import './study-theme.css'") > main.indexOf("import './styles.css'"))
const stubs = {
  api: 'export const get=(p)=>globalThis.mockApi(p);export const post=(p,b)=>globalThis.mockApi(p,b);export const put=post;export const del=post;',
  router: 'export const useRouter=()=>({push:async()=>{}});',
  profiles: 'export const questionBankProfilesState={items:[{id:1,name:"Synthetic study bank"}]};export const loadQuestionBankProfiles=async()=>{};',
  diagnostics: 'export const listDiagnosticLogs=async()=>[];export const clearDiagnosticLogs=async()=>{};export const copyIssueReportTemplate=async()=>{};export const copyDiagnosticLogs=async()=>{};export const shareDiagnosticLogs=async()=>{};',
  history: 'export const copyLearningHistoryDiagnostics=async()=>{};export const shareLearningHistoryDiagnostics=async()=>{};',
  banks: 'export const checkLanQuestionBanks=async()=>({hostId:"fixture",packages:[{packageId:"test",title:"Synthetic-long-question-bank-title-".repeat(4),years:[2025,2026],size:1024,license:"Test-only"}]});export const downloadLanQuestionBank=async()=>({skipped:true});',
  scanner: 'export default {render:()=>null};',
}
const fixture = function () {
  const categories = ['practice', 'models', 'question_bank', 'vocabulary', 'wrong']
  let keys = [{ id: 'fixture-key', name: 'Synthetic key' }]
  globalThis.mockApi = async (path, body) => {
    if (path.includes('/keys')) {
      if (body.action === 'add') keys.push({ id: 'added', name: body.name })
      if (body.action === 'rename') keys = keys.map(k => k.id === body.identity ? { ...k, name: body.name } : k)
      if (body.action === 'delete') keys = keys.filter(k => k.id !== body.identity)
      return { keys: [...keys], selected_key_id: body.action === 'select' ? body.identity : 'fixture-key', has_api_key: true }
    }
    if (path.includes('/permissions')) return { categories, effective_categories: categories }
    if (path.includes('/devices?')) return { items: [{ device_id: 'synthetic-device-'.repeat(7) }], total: 1 }
    if (path.includes('/sharing')) return { enabled: true, profileIds: [1], choices: [{ id: 1, name: 'Synthetic-question-bank-'.repeat(5), papers: 3 }] }
    if (path.includes('/pairing')) return { host: 'https://192.0.2.1:8767', host_id: 'fixture', certificate_pem: 'TEST'.repeat(100), certificate_pin: 'a'.repeat(64), pairing_code: 'fixture-only', expires_at: Date.now() / 1000 + 300 }
    if (path.includes('/lan-sync/status')) return { enabled: true, listening: true, host_urls: ['https://192.0.2.1:8767'], host: 'https://192.0.2.1:8767', host_id: 'fixture-'.repeat(15), configured: true, auto: true, categories, effective_categories: categories, runtime: { online: true, lastSyncAt: '2026-01-01', lastError: 'Synthetic-long-status-'.repeat(8) } }
    if (path.includes('/diagnostics')) return { entries: [] }
    if (path === '/updates/status') return { currentVersion: 'fixture', currentVersionCode: 1, source: 'Test-only' }
    if (path.includes('/settings')) return { current_version: 'fixture', current_version_code: 1, mirror_urls: [], manifest_url: '', question_bank_catalog_url: '' }
    throw new Error('Unexpected mock API: ' + path)
  }
}
const entry = '(' + fixture.toString() + ')();' +
  'import {createApp,reactive,h} from "vue";import View from "/src/views/' + (android ? 'AndroidSyncView' : 'UpdatesView') + '.vue";' +
  'import Keys from "/src/components/NamedModelKeys.vue";import "/src/styles.css";import "/src/remediation-foundations.css";import "/src/study-theme.css";' +
  'const profile=reactive({id:1,keys:[{id:"fixture-key",name:"Synthetic key"}],selected_key_id:"fixture-key",has_api_key:true});' +
  'createApp({render:()=>h("main",[h(View),h("section",{class:"page"},[h(Keys,{profile})])])}).mount("#app");'
const server = await createServer({ configFile: false, root, optimizeDeps: { noDiscovery: true, include: ['vue', 'lucide-vue-next', ...(android ? [] : ['qrcode'])] }, plugins: [
  { name: 'isolated-lan-ui', enforce: 'pre',
    resolveId(id) {
      if (id === 'virtual:lan-ui') return id
      if (id === 'vue-router') return 'virtual:stub:router'
      if (id === '../api') return 'virtual:stub:api'
      if (id.endsWith('/services/questionBankProfiles')) return 'virtual:stub:profiles'
      if (id.endsWith('/android/diagnostics')) return 'virtual:stub:diagnostics'
      if (id.endsWith('/android/learning-history-diagnostics')) return 'virtual:stub:history'
      if (id.endsWith('/android/lan-question-banks')) return 'virtual:stub:banks'
      if (id.endsWith('/LanSyncScanner.vue')) return 'virtual:stub:scanner'
    },
    load(id) { if (id === 'virtual:lan-ui') return entry; if (id.startsWith('virtual:stub:')) return stubs[id.slice(13)] },
    configureServer(server) { server.middlewares.use((req, res, next) => {
      if (req.url !== '/__s6') return next()
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end('<!doctype html><html data-platform="' + (android ? 'android' : 'windows') + '"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><script type="module" src="/@id/virtual:lan-ui"></script></body></html>')
    }) },
  }, vue()], server: { host: '127.0.0.1', port: 0 } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const viewports = android ? [[360,640],[640,360],[800,1280],[1280,800]] : [[800,900],[1440,900]]
  for (const [width,height] of viewports) for (const dark of [false,true]) for (const scale of [1,1.35]) {
    const page = await browser.newPage({ viewport: { width,height } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
    await page.goto(server.resolvedUrls.local[0] + '__s6')
    await page.evaluate(() => { document.documentElement.dataset.orientation = innerWidth > innerHeight ? 'landscape' : 'portrait' })
    await page.locator('.named-keys').waitFor()
    assert.equal(await page.getByRole('textbox',{name:'新密钥名称',exact:true}).count(),0)
    if (android && width > height) await page.getByRole('button',{name:'添加',exact:true}).click()
    else await page.getByRole('button',{name:'管理密钥',exact:true}).click()
    await page.evaluate(dark => document.documentElement.classList.toggle('dark',dark), dark)
    if (android) await page.getByRole('button',{name:'检查电脑共享题库',exact:true}).click()
    else await page.locator('.lan-permissions').waitFor()
    await page.evaluate(async () => {
      const urls = [...getComputedStyle(document.body).backgroundImage.matchAll(/url\("?([^"\)]+)"?\)/g)].map(m=>m[1])
      await Promise.all(urls.map(src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=reject;image.src=src})))
      if (!urls.length) throw new Error('Missing background')
    })
    await page.evaluate(scale => {
      const elements = [...document.querySelectorAll('body,body *')].filter(el=>el instanceof HTMLElement)
      const sizes = elements.map(el=>parseFloat(getComputedStyle(el).fontSize))
      elements.forEach((el,index)=>el.style.fontSize=sizes[index]*scale+'px')
    },scale)
    const geometry = await page.evaluate(() => {
      const overflow = [...document.querySelectorAll('main *')].filter(el=>{
        const r=el.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left < -1)
      }).map(el=>el.tagName+'.'+el.className)
      return { overflow, bg:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() }
    })
    assert.deepEqual(geometry.overflow,[],JSON.stringify({width,height,dark,scale,...geometry}))
    assert.equal(geometry.bg,dark?'#191b20':'#edf2f6')
    assert.equal(await page.getByText('模型配置（含密钥）',{exact:true}).count(),1)
    if (dark) assert.equal(await page.locator('.button:not(.secondary):not(.ghost):not(.danger)').first().evaluate(el=>getComputedStyle(el).color),'rgb(25, 27, 32)')
    for (const button of await page.locator('.named-keys button, .lan-sync-host-row button, .lan-devices button, .lan-sync-qr-copy > button').all()) {
      const b=await button.boundingBox();assert.ok(b.width>=44&&b.height>=44)
    }
    if (!android) {
      const frame=page.locator('.lan-sync-qr-frame')
      const before=await frame.boundingBox()
      await page.getByRole('button',{name:'刷新安全配对码',exact:true}).click()
      await page.waitForFunction(()=>{
        const c=document.querySelector('.lan-sync-qr-frame canvas');return c.width>220
      })
      const after=await frame.boundingBox()
      assert.equal(after.width,before.width);assert.equal(after.height,before.height)
      assert.ok(Math.abs(after.width-after.height)<=1)
      assert.ok(await page.locator('.lan-sync-qr-frame canvas').evaluate(c=>{
        const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data
        let black=0,white=0;for(let i=0;i<data.length;i+=4){if(data[i]<20)black++;if(data[i]>230)white++}return black>100&&white>100
      }))
    }
    await page.getByRole('textbox',{name:'新密钥名称',exact:true}).fill('Test addition')
    await page.getByLabel('新 API 密钥',{exact:true}).fill('synthetic-value-not-a-secret')
    await page.getByRole('button',{name:'添加密钥',exact:true}).click()
    if (android && width > height) {
      const selector = page.locator('.key-select')
      await selector.waitFor()
      assert.equal(await selector.getAttribute('aria-expanded'), 'false')
      await selector.click()
    }
    await page.waitForFunction(()=>document.querySelectorAll('.key-row').length===2)
    assert.equal(await page.getByRole('radio', {name: '选用 Test addition', exact: true}).count(), 1)
    assert.deepEqual(errors,[])
    const label=[width+'x'+height,dark?'dark':'light','font-'+scale].join('-')
    if(output) await page.screenshot({path:join(output,label+'.png'),fullPage:true})
    console.log(label+': theme, assets, bounds, controls, key-add'+(android?'':', fixed QR pixels')+' passed')
    await page.close()
  }
} finally { await browser?.close();await server.close() }
