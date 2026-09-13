import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const [styles, dashboard, library, switcher] = await Promise.all([
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/LibraryView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/QuestionBankSwitcher.vue', import.meta.url), 'utf8'),
])

assert.match(dashboard, /portrait-dashboard[\s\S]*QuestionBankSwitcher :show-library-link="true"/)
assert.match(dashboard, /desktop-dashboard[\s\S]*QuestionBankSwitcher :show-library-link="true"/)
assert.ok(library.includes('class="library-bank-switcher"'))
assert.ok(library.includes('<template #actions>'))
assert.ok(switcher.includes('<slot name="actions" />'))
assert.ok(!switcher.includes('<LibraryBig'))

const markup = String.raw`<!doctype html><html data-platform="android"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body>
  <main class="page dashboard-page"><div class="desktop-dashboard"><div class="bank-switcher"><div class="bank-switcher-main">
    <button class="option-sheet-trigger"><span class="option-sheet-value">当前题库</span><span>⌄</span></button>
    <button class="button ghost compact">管理</button><a class="button ghost compact">回收站</a><a class="button ghost compact bank-library-link">查看全部题库<span>→</span></a>
  </div></div></div></main>
  <main class="page dashboard-page"><div class="portrait-dashboard"><div class="bank-switcher"><div class="bank-switcher-main">
    <button class="option-sheet-trigger"><span class="option-sheet-value">当前题库</span><span>⌄</span></button>
    <button class="button ghost compact">管理</button><a class="button ghost compact">回收站</a><a class="button ghost compact bank-library-link">查看全部题库<span>→</span></a>
  </div></div></div></main>
  <main class="page"><div class="bank-switcher library-bank-switcher"><div class="bank-switcher-main">
    <button class="option-sheet-trigger"><span class="option-sheet-value">当前题库</span><span>⌄</span></button>
    <button class="button ghost compact">管理</button><a class="button ghost compact">回收站</a><a class="button ghost compact bank-library-link">查看全部题库</a><button class="button secondary compact">批量管理</button>
  </div></div></main>
</body></html>`

let browser
let server
try {
  browser = await chromium.launch({ headless: true })
  for (const [width, height, orientation] of [[800, 1280, 'portrait'], [1280, 800, 'landscape'], [412, 915, 'portrait']]) {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.setContent(markup)
    await page.evaluate(value => { document.documentElement.dataset.orientation = value }, orientation)
    const measured = await page.evaluate(() => {
      const visible = element => getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0
      const boxes = selector => [...document.querySelectorAll(selector)].filter(visible).map(element => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      })
      return {
        dashboard: boxes('.dashboard-page :is(.portrait-dashboard, .desktop-dashboard) .bank-switcher-main > *'),
        library: boxes('.library-bank-switcher .bank-switcher-main > *'),
        bodyWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }
    })
    assert.equal(measured.dashboard.length, 4, `dashboard actions visible at ${width}x${height}`)
    assert.equal(measured.library.length, 5, `library actions visible at ${width}x${height}`)
    assert.ok(measured.dashboard.every(box => box.left >= 0 && box.right <= measured.bodyWidth + 1))
    assert.ok(measured.library.every(box => box.left >= 0 && box.right <= measured.bodyWidth + 1))
    assert.equal(measured.scrollWidth, measured.bodyWidth, `no horizontal overflow at ${width}x${height}`)
    if (orientation === 'landscape') {
      const center = box => (box.top + box.bottom) / 2
      assert.ok(Math.max(...measured.library.map(center)) - Math.min(...measured.library.map(center)) < 3, `library controls share one row at ${width}x${height}: ${JSON.stringify(measured.library)}`)
    }
    await page.close()
  }

  server = await createServer({
    configFile: false,
    root,
    optimizeDeps: { noDiscovery: true, include: ['vue', 'lucide-vue-next'] },
    plugins: [{
      name: 'question-bank-switcher-layout',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'virtual:question-bank-switcher-layout') return id
        if (id === 'vue-router') return 'virtual:stub:router'
        if (id.endsWith('/platform/dialogs')) return 'virtual:stub:dialogs'
        if (id.endsWith('/services/questionBankProfiles')) return 'virtual:stub:profiles'
        if (id.endsWith('/platform/overlay-history')) return 'virtual:stub:history'
      },
      load(id) {
        if (id === 'virtual:question-bank-switcher-layout') return 'import {createApp,h} from "vue";import Switcher from "/src/components/QuestionBankSwitcher.vue";import "/src/styles.css";createApp({render:()=>h("div",{class:"page dashboard-page"},[h("div",{class:"portrait-dashboard"},[h(Switcher,{showLibraryLink:true})])])}).mount("#app")'
        if (id === 'virtual:stub:router') return 'import {h} from "vue";export const RouterLink={props:["to"],setup:(p,{slots})=>()=>h("a",{href:p.to},slots.default())}'
        if (id === 'virtual:stub:dialogs') return 'export const confirmDialog=async()=>false;export const promptDialog=async()=>null'
        if (id === 'virtual:stub:profiles') return 'import {reactive} from "vue";export const questionBankProfilesState=reactive({items:[{id:1,name:"当前题库",paper_count:2,question_count:90}],activeId:1,loading:false});export const loadQuestionBankProfiles=async()=>{};export const activateQuestionBankProfile=async()=>{};export const createQuestionBankProfile=async()=>{};export const deleteQuestionBankProfile=async()=>{};export const renameQuestionBankProfile=async()=>{}'
        if (id === 'virtual:stub:history') return 'export const pushOverlayHistory=()=>({close(){},dispose(){}})'
      },
      configureServer(server) { server.middlewares.use((req, res, next) => {
        if (req.url !== '/__question-bank-switcher-layout') return next()
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end('<!doctype html><html data-platform="android" data-orientation="portrait"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="app"></div><script type="module" src="/@id/virtual:question-bank-switcher-layout"></script></body></html>')
      }) },
    }, vue()],
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } })
  await page.goto(server.resolvedUrls.local[0] + '__question-bank-switcher-layout')
  await page.getByRole('button', { name: '管理', exact: true }).click()
  const manager = page.locator('.bank-manager')
  await manager.waitFor({ state: 'visible' })
  assert.ok(await manager.getByPlaceholder('新题库配置名称').isVisible())
  await page.close()
  console.log('Question bank toolbar layout tests passed')
} finally {
  await server?.close()
  await browser?.close()
}
