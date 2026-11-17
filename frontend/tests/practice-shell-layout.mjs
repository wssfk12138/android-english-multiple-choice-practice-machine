import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const passage = 'A quiet library gives students room to read, reflect, and learn.'
const session = { id: 1, mode: 'custom', status: 'active', units: [{
  id: 1, title: 'Practice shell regression', year: 2026, unit_type: 'reading', passage,
  questions: [{ id: 1, number: 1, stem: 'What is the passage about?', options: [
    { label: 'A', content: 'A quiet library.' }, { label: 'B', content: 'A train station.' },
  ] }],
}] }
const entry = `
import {createApp,h} from 'vue'
import {createRouter,createMemoryHistory} from 'vue-router'
import App from '/src/App.vue'
import PracticeView from '/src/views/PracticeView.vue'
import '/src/styles.css'
import '/src/study-theme.css'
const query=new URLSearchParams(location.search)
const router=createRouter({history:createMemoryHistory(),routes:[
 {path:'/practice/:id',component:PracticeView},
 {path:'/library',component:{render:()=>h('div',{class:'page'},'Library')}}
]})
localStorage.setItem('linjian-practice-timer-1',JSON.stringify({choice:'off',elapsedMs:0}))
await router.push(query.get('navigation')?'/library':'/practice/1')
await router.isReady()
createApp(App).use(router).mount('#app')
`
const server = await createServer({
  root, configFile: false, define: { __CONTENT_REMEDIATION_HEADER__: 'null' },
  plugins: [{
    name: 'practice-shell-regression', enforce: 'pre',
    resolveId(id) {
      if (id === 'virtual:shell-regression') return id
      if (id === '../api' || id === './api') return 'virtual:shell-regression-api'
    },
    load(id) {
      if (id === 'virtual:shell-regression') return entry
      if (process.env.PRACTICE_SHELL_STYLES && id.replaceAll('\\', '/').endsWith('/src/styles.css')) return readFileSync(process.env.PRACTICE_SHELL_STYLES, 'utf8')
      if (id === 'virtual:shell-regression-api') return `
export const get=async p=>p.startsWith('/practice/sessions/')?${JSON.stringify(session)}:[]
export const post=async()=>({})
export const put=post
export const del=post
`
    },
    configureServer(s) { s.middlewares.use((req, res, next) => {
      if (!req.url.startsWith('/__practice-shell')) return next()
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end('<!doctype html><html data-platform="android" class="native-app"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="app"></div><script type="module" src="/@id/virtual:shell-regression"></script></body></html>')
    }) },
  }, vue()],
  server: { host: '127.0.0.1', port: 0 },
})

async function measure(page) {
  return page.evaluate(() => {
    const main = document.querySelector('.main-content')
    const shell = main.parentElement
    const footer = document.querySelector('.practice-footer')
    return {
      viewport: innerWidth + 'x' + innerHeight,
      orientation: document.documentElement.dataset.orientation,
      shellDisplay: getComputedStyle(shell).display,
      main: Math.round(main.getBoundingClientRect().width),
      passage: document.querySelector('.passage')?.textContent?.trim() || '',
      passageWidth: Math.round(document.querySelector('.passage')?.getBoundingClientRect().width || 0),
      panes: ['.passage-pane', '.question-pane'].map(selector => Math.round(document.querySelector(selector).getBoundingClientRect().width)),
      footerDisplay: footer ? getComputedStyle(footer).display : 'missing',
      footer: footer ? Math.round(footer.getBoundingClientRect().width) : 0,
      portraitTop: document.querySelector('.portrait-practice-top') ? getComputedStyle(document.querySelector('.portrait-practice-top')).display : 'missing',
      options: document.querySelectorAll('.option').length,
      overflowX: document.documentElement.scrollWidth - innerWidth,
    }
  })
}

let browser
try {
  await server.listen()
  const url = 'http://127.0.0.1:' + server.httpServer.address().port + '/__practice-shell'
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1152, height: 720 } })
  await page.addInitScript(() => {
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      get: () => ({
        type: innerHeight > innerWidth ? 'portrait-primary' : 'landscape-primary',
        angle: 0,
        addEventListener() {},
        removeEventListener() {},
      }),
    })
  })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(url)
  await page.locator('.passage').waitFor({ state: 'attached' })
  await page.waitForFunction(() => document.querySelector('.practice-layout')?.getBoundingClientRect().width > 0)

  const cases = [
    { width: 599, height: 400 }, { width: 600, height: 400 },
    { width: 839, height: 600 }, { width: 840, height: 600 },
    { width: 1152, height: 720 }, { width: 1199, height: 720 }, { width: 1200, height: 800 },
  ]
  const evidence = []
  for (const viewport of cases) {
    await page.setViewportSize(viewport)
    await page.waitForFunction(() => document.querySelector('.main-content')?.getBoundingClientRect().width > 0)
    await page.waitForTimeout(80)
    const state = await measure(page)
    assert.equal(state.orientation, 'landscape', 'landscape orientation at ' + state.viewport)
    assert.equal(state.shellDisplay, 'block', 'practice must not inherit the navigation rail grid at ' + state.viewport)
    assert.ok(state.main >= viewport.width - 2, 'practice main uses the full viewport at ' + state.viewport)
    assert.equal(state.passage, passage, 'the actual reading passage is present at ' + state.viewport)
    assert.ok(state.passageWidth > 180, 'reading passage has usable width at ' + state.viewport)
    assert.ok(state.panes.every(width => width > 180), 'both reading panes have usable width at ' + state.viewport)
    assert.equal(state.footerDisplay, 'flex', 'landscape submission footer remains visible at ' + state.viewport)
    assert.ok(state.footer > 180, 'landscape submission footer remains usable at ' + state.viewport)
    assert.ok(state.options >= 2, 'answer options are rendered at ' + state.viewport)
    assert.ok(state.overflowX <= 1, 'no horizontal overflow at ' + state.viewport)
    assert.ok(await page.getByRole('button', { name: '提交练习' }).isVisible(), 'submit entry is visible at ' + state.viewport)
    evidence.push(state)
    if (viewport.width === 600 || viewport.width === 840) {
      await page.goto(url + '?navigation=1')
      await page.locator('.sidebar').waitFor()
      const navigation = await page.evaluate(() => ({
        shell: getComputedStyle(document.querySelector('.app-shell')).display,
        columns: getComputedStyle(document.querySelector('.app-shell')).gridTemplateColumns,
      }))
      assert.equal(navigation.shell, 'grid', 'ordinary navigation retains its rail grid at ' + viewport.width)
      assert.ok(navigation.columns.startsWith('76px '), 'ordinary tablet navigation retains the 76px rail at ' + viewport.width)
      await page.goto(url)
      await page.locator('.passage').waitFor({ state: 'attached' })
    }
  }

  await page.setViewportSize({ width: 1152, height: 720 })
  await page.waitForFunction(() => document.documentElement.dataset.orientation === 'landscape')
  const landscape = await measure(page)
  await page.setViewportSize({ width: 720, height: 1152 })
  await page.waitForFunction(() => document.documentElement.dataset.orientation === 'portrait')
  const portrait = await measure(page)
  await page.setViewportSize({ width: 1152, height: 720 })
  await page.waitForFunction(() => document.documentElement.dataset.orientation === 'landscape')
  const rotatedBack = await measure(page)
  assert.equal(portrait.footerDisplay, 'none', 'portrait keeps the existing hidden practice footer')
  assert.equal(portrait.portraitTop, 'flex', 'portrait toolbar is present')
  assert.ok(portrait.main >= 718, 'portrait practice uses the full viewport')
  assert.equal(portrait.passage, passage, 'portrait keeps the reading passage')
  assert.ok(portrait.passageWidth > 180, 'portrait passage has usable width')
  assert.ok(portrait.options >= 2, 'portrait keeps answer options')
  assert.ok(portrait.overflowX <= 1, 'portrait has no horizontal overflow')
  assert.equal(rotatedBack.orientation, 'landscape')
  assert.equal(rotatedBack.shellDisplay, 'block')
  assert.ok(rotatedBack.panes.every(width => width > 180), 'panes recover after returning to landscape')
  assert.equal(rotatedBack.footerDisplay, 'flex', 'landscape footer recovers after rotation')
  assert.ok(rotatedBack.overflowX <= 1, 'returning to landscape has no horizontal overflow')
  evidence.push({ step: 'rotation', landscape, portrait, rotatedBack })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify(evidence, null, 2))
  console.log('PASS practice shell: public DOM, 600-1199 breakpoint, 1152x720, rotation and ordinary navigation')
} finally {
  await browser?.close()
  await server.close()
}
