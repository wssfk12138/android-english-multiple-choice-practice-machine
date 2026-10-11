import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url)), output = process.env.DAILY_STUDY_OUTPUT
if (output) await mkdir(output, { recursive: true })
function fixture() {
  const orient = () => { document.documentElement.dataset.orientation = innerWidth > innerHeight ? 'landscape' : 'portrait' }
  orient(); window.addEventListener('resize', orient)
  globalThis.calls = []; globalThis.revision = 1; globalThis.count = 1203
  globalThis.failCatalog = false; globalThis.failDetail = 0; globalThis.missing = 0; globalThis.delayDetail = 0
  globalThis.failSave = false; globalThis.longContent = true; globalThis.extra = false
  globalThis.reviewFields = { review_count: 5, next_review_at: '2026-10-10', study_status: 'learning', review_stage: 2 }
  const originalSet = Storage.prototype.setItem
  Storage.prototype.setItem = function(key, value) {
    if (key === 'daily-study:v1' && globalThis.failSave) throw Error('synthetic quota')
    return originalSet.call(this, key, value)
  }
  const member = id => ({ id, term: id === 1203 ? 'pneumonoultramicroscopicsilicovolcanoconiosis' : 'evidence' + id, identity: 'stable-' + id })
  const detail = id => ({ ...member(id), daily_study_identity: 'stable-' + id, ...globalThis.reviewFields,
    translation_status: 'ready', common_meaning: '证据；根据 · revision ' + globalThis.revision,
    phonetic: '/ˈevɪdəns/', part_of_speech: 'n.', contextual_meaning: '用于判断与推理的事实依据',
    latest_sentence: 'Researchers compare evidence and revise their explanations when new observations become available. '.repeat(globalThis.longContent ? 12 : 1),
    occurrences: [{ year: 2026, unit_title: 'Synthetic reading' }],
    generated_example: globalThis.extra ? { sentence: 'An existing model example.', translation: '已有模型例句。' } : undefined,
    synonyms: [{ word: 'proof', note: '强调可以证明结论的依据。' }],
    morphology: { currentForm: '名词', forms: [{ word: 'evident', label: '形容词' }] },
    memory_hint: '结合上下文记忆。', note: '已有笔记。\n'.repeat(24),
  })
  globalThis.mockApi = async (path, body) => {
    globalThis.calls.push({ path, write: body !== undefined })
    if (path.startsWith('/vocabulary/daily-study/catalog')) {
      if (globalThis.failCatalog) throw Error('synthetic database error')
      return { scope_key: 'synthetic-db:all', revision: 'v2:' + globalThis.revision, items: Array.from({ length: globalThis.count }, (_, i) => member(i + 1)) }
    }
    if (path.startsWith('/vocabulary/daily-study/status')) return { scope_key: 'synthetic-db:all', revision: 'v2:' + globalThis.revision }
    const match = path.match(/^\/vocabulary\/(\d+)$/)
    if (match) {
      const id = Number(match[1])
      if (id === globalThis.delayDetail) await new Promise(resolve => globalThis.releaseDetail = resolve)
      if (id === globalThis.failDetail) throw Error('synthetic detail error')
      if (id === globalThis.missing) throw Object.assign(Error('synthetic deleted'), { status: 404 })
      return detail(id)
    }
    if (path.startsWith('/vocabulary?')) {
      const query = new URLSearchParams(path.split('?')[1]), offset = Number(query.get('offset') || 0)
      return { items: Array.from({ length: Math.min(Number(query.get('limit') || 20), Math.max(0, 1203 - offset)) }, (_, i) => detail(offset + i + 1)),
        revision: 'v2:' + globalThis.revision, counts: { total: 1203, frequent: 0, review: 1203, pending: 0, mastered: 0 } }
    }
    if (path.startsWith('/vocabulary/status')) return { revision: 'v2:' + globalThis.revision, counts: { total: 1203, review: 1203 } }
    if (path === '/vocabulary/translation-runs' || path === '/vocabulary/enrichment-runs') return { workerStarted: false }
    if (path.endsWith('-status')) return { queued: 0, translating: 0, inflight: 0, failed: 0, paused: true }
    throw Error('Unexpected synthetic API: ' + path)
  }
}
const entry = '(' + fixture.toString() + ')();' +
  'import {createApp,h} from "vue";import {createRouter,createMemoryHistory,RouterView} from "vue-router";' +
  'import Vocabulary from "/src/views/VocabularyView.vue";import Study from "/src/views/DailyStudyView.vue";' +
  'import "/src/styles.css";import "/src/study-theme.css";' +
  'const router=createRouter({history:createMemoryHistory(),routes:[{path:"/vocabulary",component:Vocabulary},{path:"/vocabulary/daily-study",component:Study}]});' +
  'globalThis.router=router;await router.push("/vocabulary");await router.isReady();createApp({render:()=>h(RouterView)}).use(router).mount("#app");'
// Keep this fixture's optimized modules separate from other browser-test plugins.
const server = await createServer({ configFile: false, root, cacheDir: join(root, 'node_modules/.vite-daily-study-browser'), optimizeDeps: { noDiscovery: true, include: ['vue', 'vue-router', 'lucide-vue-next'] }, plugins: [{
  name: 'isolated-daily-study', enforce: 'pre',
  resolveId(id) {
    if (id === 'virtual:daily-study') return id
    if (id === '../api' || id === './api') return 'virtual:study-api'
    if (id.endsWith('/platform/runtime')) return 'virtual:study-runtime'
    if (id.endsWith('/platform/dialogs')) return 'virtual:study-dialogs'
  },
  load(id) {
    if (id === 'virtual:daily-study') return entry
    if (id === 'virtual:study-api') return 'export const get=p=>globalThis.mockApi(p);export const post=(p,b)=>globalThis.mockApi(p,b);export const put=post;export const del=p=>post(p,{});'
    if (id === 'virtual:study-runtime') return 'export const platformRuntime={isAndroid:true};'
    if (id === 'virtual:study-dialogs') return 'export const confirmDialog=async()=>false;'
  },
  configureServer(server) { server.middlewares.use((req, res, next) => {
    if (req.url !== '/__daily-study') return next()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html data-platform="android"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><script type="module" src="/@id/virtual:daily-study"></script></body></html>')
  }) },
}, vue()], server: { host: '127.0.0.1', port: 0 } })
let browser
const evidence = [], errors = []
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', error => errors.push(error.message))
  const ready = async id => {
    await page.waitForFunction(id => document.querySelector('.study-scroll')?.dataset.identity === 'stable-' + id
      && document.querySelector('.daily-study-shell')?.dataset.switching === 'false'
      && document.querySelector('.study-card')?.getAttribute('aria-busy') !== 'true', id)
  }
  const writes = () => page.evaluate(() => globalThis.calls.filter(call => call.write).length)
  const current = () => page.locator('.study-scroll').getAttribute('data-identity')
  const next = () => page.locator('.study-footer .next').click()
  const previous = () => page.locator('.study-footer .previous').click()
  const reopen = async () => {
    await page.locator('.study-top .back').click(); await page.locator('.daily-study-entry').waitFor()
    await page.locator('.daily-study-entry').click()
  }
  const swipe = async (dx, dy = 0, mode = 'normal', selector = '.study-scroll') => page.locator(selector).first().evaluate((element, { dx, dy, mode }) => {
    const fire = (target, type, id, x, y, primary = true) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, clientX: x, clientY: y, button: 0, isPrimary: primary, pointerType: 'touch' }))
    fire(element, 'pointerdown', 1, 300, 140)
    if (mode === 'multi') fire(element, 'pointerdown', 2, 310, 140, false)
    fire(element, 'pointermove', 1, 300 + dx, 140 + dy)
    fire(mode === 'outside' ? document.body : element, mode === 'cancel' ? 'pointercancel' : 'pointerup', 1, 300 + dx, 140 + dy)
    if (mode === 'multi') fire(element, 'pointerup', 2, 310, 140, false)
  }, { dx, dy, mode })
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/__daily-study')
  await page.locator('.daily-study-entry').waitFor(); await page.waitForTimeout(300)
  await page.setViewportSize({ width: 800, height: 1280 }); await page.locator('.daily-study-entry').waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 1280, height: 800 }); await page.locator('.daily-study-entry').waitFor()
  const writeBaseline = await writes(), reviewBefore = await page.evaluate(() => JSON.stringify(globalThis.reviewFields))
  await page.locator('.daily-study-entry').click(); await ready(1)
  assert.equal(await page.locator('.vocabulary-page').count(), 0, 'independent route unmounts vocabulary side effects')
  assert.match(await page.locator('.study-count').innerText(), /1 \/ 1203/)
  assert.ok(await page.locator('.word-nav-list button').count() <= 41)
  assert.equal(await page.locator('.study-footer .previous').isDisabled(), true)
  assert.equal(await page.locator('textarea,input,.review-rating').count(), 0)
  await page.locator('[data-study-section="synonyms"] summary').click()
  await page.locator('.study-scroll').evaluate(element => element.scrollTop = 250); await page.waitForTimeout(180)
  const top = await page.locator('.study-scroll').evaluate(element => element.scrollTop)
  await next(); await ready(2); await previous(); await ready(1)
  assert.equal(await page.locator('.study-scroll').evaluate(element => element.scrollTop), top)
  assert.equal(await page.locator('[data-study-section="synonyms"] details').getAttribute('open'), null)
  await reopen(); await ready(1)
  assert.equal(await page.locator('[data-study-section="synonyms"] details').getAttribute('open'), '')
  assert.equal(await page.locator('.study-scroll').evaluate(element => element.scrollTop), top)
  // Reopening VocabularyView is allowed its existing maintenance calls; the study interval itself is read-only.
  const studyWriteBaseline = await writes()
  await page.keyboard.press('ArrowRight'); await ready(2)
  await swipe(-100); await ready(1); await swipe(100); await ready(2)
  for (const args of [[72,0], [100,100], [100,0,'cancel'], [100,0,'multi'], [100,0,'outside'], [100,0,'normal','summary']]) {
    await swipe(...args); await page.waitForTimeout(100); assert.equal(await current(), 'stable-2', 'gesture exclusion ' + args)
  }
  await page.locator('.word-heading h1').evaluate(element => { const range=document.createRange();range.selectNodeContents(element);getSelection().removeAllRanges();getSelection().addRange(range) })
  await swipe(100); assert.equal(await current(), 'stable-2'); await page.evaluate(() => getSelection().removeAllRanges())
  await swipe(100); await ready(3) // outside release did not leave a stuck pointer
  await page.locator('.study-scroll').evaluate(element => element.scrollTop = 190); await page.waitForTimeout(180)
  await page.setViewportSize({ width: 800, height: 1280 }); await page.getByText('请横屏继续学习').waitFor()
  await page.setViewportSize({ width: 1280, height: 800 }); await ready(3)
  assert.equal(await page.locator('.study-scroll').evaluate(element => element.scrollTop), 190)
  const catalogs = await page.evaluate(() => globalThis.calls.filter(call => call.path.includes('/daily-study/catalog')).length)
  await page.evaluate(() => { globalThis.revision++;globalThis.extra = true;document.dispatchEvent(new Event('visibilitychange')) })
  await page.getByText('证据；根据 · revision 2').waitFor()
  assert.equal(await page.evaluate(() => globalThis.calls.filter(call => call.path.includes('/daily-study/catalog')).length), catalogs)
  assert.equal(await page.locator('.study-scroll').evaluate(element => element.scrollTop), 190)
  await page.evaluate(() => globalThis.failSave = true); await next(); await ready(4)
  await page.getByText('续看未保存').waitFor(); await page.evaluate(() => globalThis.failSave = false)
  // A cold non-adjacent read fails and must unlock for retry.
  await page.evaluate(() => globalThis.failDetail = 20)
  await page.locator('.word-nav-list button').nth(19).click(); await page.getByText('单词详情读取失败').waitFor()
  await page.evaluate(() => globalThis.failDetail = 0); await page.getByRole('button', { name: '重新读取', exact: true }).click(); await ready(20)
  await page.evaluate(() => { globalThis.missing = 35 })
  await page.locator('.word-nav-list button').filter({ hasText: /^35evidence35$/ }).click(); await ready(36)
  assert.match(await page.locator('.study-count').innerText(), /1202/)
  // Seed the saved stable member, then reopen through the actual entry to reach the final member.
  assert.equal(await writes(), studyWriteBaseline, 'study adds zero mutation/translation/enrichment requests')
  assert.equal(await page.evaluate(() => JSON.stringify(globalThis.reviewFields)), reviewBefore)
  evidence.push({ scenario: 'actual entry, read-only requests and unchanged review fields', initialWrites: writeBaseline, studyWrites: 0, catalogMembers: 1203 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let groups = 0
  while (await page.getByRole('button', { name: '后一组单词', exact: true }).count()) {
    await page.getByRole('button', { name: '后一组单词', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.daily-study-shell')?.dataset.switching === 'false' && document.querySelector('.study-card')?.getAttribute('aria-busy') !== 'true')
    assert.ok(await page.locator('.word-nav-list button').count() <= 41)
    assert.ok(++groups < 65, 'complete directory reachable in bounded groups')
  }
  await page.locator('.word-nav-list button').last().click(); await ready(1203)
  evidence.push({ scenario: 'all navigation groups to last word', groups, lastId: 1203, maxNavigationNodes: 41 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.locator('.study-top .back').click(); await page.locator('.daily-study-entry').waitFor()
  await page.evaluate(() => localStorage.setItem('daily-study:v1', JSON.stringify({ 'synthetic-db:all': { id: 1203, identity: 'stable-1203', index: 1202, positions: {} } })))
  await page.locator('.daily-study-entry').click(); await ready(1203)
  assert.equal(await page.locator('.study-footer .next').isDisabled(), true)
  assert.ok(await page.locator('.word-nav-list button').count() <= 41)
  await page.keyboard.press('ArrowRight'); assert.equal(await current(), 'stable-1203')
  for (const [width, height, dark, scale] of [[1280,800,false,1],[1280,800,true,1],[844,390,false,1],[960,600,true,2],[640,360,false,1.35]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(({ dark, scale }) => { document.documentElement.classList.toggle('dark', dark);document.documentElement.style.fontSize = 16 * scale + 'px' }, { dark, scale })
    await ready(1203); await page.waitForTimeout(100)
    const geometry = await page.evaluate(() => {
      const box = selector => { const r=document.querySelector(selector).getBoundingClientRect();return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom } }
      const scroll=document.querySelector('.study-scroll')
      return { shell:box('.daily-study-shell'), card:box('.study-card'), scroll:box('.study-scroll'), next:box('.study-footer .next'), previous:box('.study-footer .previous'), currentNav:box('[aria-current="true"]'), nav:box('.word-nav-list'), overflow:scroll.scrollWidth > scroll.clientWidth + 1, rootOverflow:document.documentElement.scrollWidth > innerWidth + 1 }
    })
    assert.equal(geometry.overflow, false, 'content horizontal overflow ' + width)
    assert.equal(geometry.rootOverflow, false); assert.ok(geometry.scroll.height >= 45, 'reading region remains reachable')
    assert.ok(geometry.next.bottom <= height && geometry.next.right <= width && geometry.previous.x >= 0)
    assert.ok(geometry.currentNav.right <= geometry.nav.right + 1 && geometry.currentNav.right > geometry.nav.x, 'current navigation visible after resize/font growth')
    await page.locator('.study-scroll').evaluate(element => element.scrollTop = element.scrollHeight)
    assert.ok(await page.locator('.study-scroll').evaluate(element => element.scrollTop > 0))
    if (output) await page.screenshot({ path: join(output, 'daily-study-' + width + '-' + scale + (dark ? '-dark' : '') + '.png') })
    evidence.push({ scenario: 'long word/content, font size, fixed controls and scroll', width, height, dark, scale, geometry })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' }); await previous(); await ready(1202)
  await page.locator('.study-top .back').click(); await page.locator('.daily-study-entry').waitFor()
  await page.evaluate(() => globalThis.failCatalog = true)
  await page.locator('.daily-study-entry').click(); await page.getByText('单词目录读取失败').waitFor()
  await page.evaluate(() => { globalThis.failCatalog = false;globalThis.count = 0 })
  await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.getByText('当前范围没有可学习的单词').waitFor()
  await page.locator('.study-top .back').click(); await page.locator('.daily-study-entry').waitFor()
  await page.evaluate(() => { globalThis.count = 1203;globalThis.delayDetail = 1202 })
  await page.locator('.daily-study-entry').click(); await page.getByText('正在读取单词详情…').waitFor()
  await page.locator('.study-top .back').click(); await page.evaluate(() => globalThis.releaseDetail())
  await page.locator('.daily-study-entry').waitFor(); assert.equal(await page.locator('.daily-study-shell').count(), 0)
  assert.deepEqual(errors, [], 'real Vue runtime has no page errors')
  if (output) await writeFile(join(output, 'daily-study-browser-evidence.json'), JSON.stringify(evidence, null, 2))
  console.log('PASS daily study real Vue/Chromium: actual entry, 1203 members, bounded navigation, swipe exclusions, scroll/resume/rotation, revision, read-only, error/retry/empty/disposal and responsive layouts')
} catch (error) {
  console.error('Daily study browser page errors:', errors)
  throw error
} finally { await browser?.close(); await server.close() }
