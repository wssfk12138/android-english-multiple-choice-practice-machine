import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = process.env.PRACTICE_TIMER_OUTPUT
if (output) await mkdir(output, { recursive: true })
function fixture() {
  function windowMode() {
    const portrait = innerHeight > innerWidth
    document.documentElement.dataset.orientation = portrait ? 'portrait' : 'landscape'
    document.documentElement.dataset.windowMode = portrait || innerWidth < 600 ? 'compact' : innerWidth < 840 ? 'medium' : 'expanded'
  }
  windowMode();window.addEventListener('resize', windowMode)
  globalThis.clock = 0
  Object.defineProperty(performance, 'now', { value: () => globalThis.clock })
  globalThis.nativeEvents = new Map()
  globalThis.apiCalls = []
  globalThis.failSave = false
  const originalSet = Storage.prototype.setItem
  Storage.prototype.setItem = function (key, value) {
    if (globalThis.failSave && key.startsWith('linjian-practice-timer-')) throw Error('synthetic full storage')
    return originalSet.call(this, key, value)
  }
  globalThis.playEvents = 0
  document.addEventListener('play', () => globalThis.playEvents++, true)
  globalThis.mockApi = async (path, body) => {
    globalThis.apiCalls.push({ path, body, timer: localStorage.getItem('linjian-practice-timer-1') })
    if (path === '/vocabulary/translation-runs') return { queuedCount: 0 }
    if (path.startsWith('/practice/sessions/')) return {
      id: Number(path.split('/')[3]), mode: 'custom', status: 'active', units: [{
        id: 1, title: 'Synthetic listening', year: 2026, unit_type: 'listening',
        shared_data: { audio_tracks: [{ asset_id: 'one', label: 'One', url: '/synthetic.wav?one' }, { asset_id: 'two', label: 'Two', url: '/synthetic.wav?two' }] },
        questions: [{ id: 1, number: 1, stem: 'Synthetic question', user_answer: 'A', options: [{ label: 'A', content: 'Synthetic answer' }, { label: 'B', content: 'Other answer' }] }],
      }],
    }
    throw Error('Unexpected synthetic API: ' + path)
  }
}
const entry = '(' + fixture.toString() + ')();' +
  'import {createApp,h} from "vue";import {createRouter,createMemoryHistory,RouterView} from "vue-router";' +
  'import View from "/src/views/PracticeView.vue";import "/src/styles.css";import "/src/study-theme.css";' +
  'const router=createRouter({history:createMemoryHistory(),routes:[{path:"/practice/:id",component:View},{path:"/library",component:{render:()=>h("p","Library")}}]});' +
  'router.beforeResolve(to=>to.path==="/library"&&globalThis.cancelNavigation?false:undefined);' +
  'globalThis.router=router;await router.push("/practice/1");await router.isReady();createApp({render:()=>h(RouterView)}).use(router).mount("#app");'
const wav = Buffer.alloc(44 + 8000 * 30 * 2)
wav.write('RIFF');wav.writeUInt32LE(wav.length - 8, 4);wav.write('WAVEfmt ', 8);wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20);wav.writeUInt16LE(1, 22);wav.writeUInt32LE(8000, 24);wav.writeUInt32LE(16000, 28)
wav.writeUInt16LE(2, 32);wav.writeUInt16LE(16, 34);wav.write('data', 36);wav.writeUInt32LE(wav.length - 44, 40)
const server = await createServer({ configFile: false, root, optimizeDeps: { noDiscovery: true, include: ['vue', 'vue-router', 'lucide-vue-next'] }, plugins: [{
  name: 'isolated-practice-timer', enforce: 'pre',
  resolveId(id) {
    if (id === 'virtual:practice-timer') return id
    if (id === '../api' || id === './api') return 'virtual:timer-api'
    if (id === '@capacitor/app') return 'virtual:timer-native'
  },
  load(id) {
    if (id === 'virtual:practice-timer') return entry
    if (id === 'virtual:timer-api') return 'export const get=p=>globalThis.mockApi(p);export const post=(p,b)=>globalThis.mockApi(p,b);export const put=post;export const del=post;'
    if (id === 'virtual:timer-native') return 'export const App={getState:async()=>({isActive:true}),addListener:async(n,f)=>{globalThis.nativeEvents.set(n,f);return {remove:async()=>globalThis.nativeEvents.delete(n)}}};'
  },
  configureServer(server) { server.middlewares.use((req, res, next) => {
    if (req.url.startsWith('/synthetic.wav')) { res.setHeader('Content-Type', 'audio/wav');res.end(wav);return }
    if (req.url !== '/__practice-timer') return next()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html data-platform="android"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><script type="module" src="/@id/virtual:practice-timer"></script></body></html>')
  }) },
}, vue()], server: { host: '127.0.0.1', port: 0 } })
let browser
const evidence = []
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = [];page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/__practice-timer')
  const snapshot = () => page.evaluate(() => JSON.parse(localStorage.getItem('linjian-practice-timer-1')))
  const native = (name, active) => page.evaluate(({ name, active }) => globalThis.nativeEvents.get(name)(name === 'appStateChange' ? { isActive: active } : undefined), { name, active })
  const visibility = state => page.evaluate(state => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });document.dispatchEvent(new Event('visibilitychange')) }, state)
  const paused = () => page.waitForFunction(() => document.querySelector('audio')?.paused === true)
  const playing = () => page.waitForFunction(() => document.querySelector('audio')?.paused === false)
  await page.getByRole('button', { name: '开始计时', exact: true }).click()
  await page.waitForFunction(() => globalThis.nativeEvents.size === 3)
  await page.locator('.main-play-button:visible').click();await playing()
  await page.evaluate(() => globalThis.clock = 600000)
  await visibility('hidden');await native('pause');await native('appStateChange', false);await paused()
  assert.equal((await snapshot()).elapsedMs, 600000)
  assert.equal(await page.locator('.timer-pause-overlay').count(), 0)
  const exit = await page.evaluate(() => globalThis.apiCalls.find(call => call.path === '/vocabulary/translation-runs'))
  assert.equal(JSON.parse(exit.timer).elapsedMs, 600000, 'timer persisted before vocabulary exit')
  await page.evaluate(() => globalThis.clock += 86400000)
  await visibility('visible');assert.equal((await snapshot()).elapsedMs, 600000)
  const beforeReturn = await page.evaluate(() => globalThis.playEvents)
  // Changing tracks during automatic pause must not queue an autoplay for foreground return.
  await page.locator('.track-picker select').selectOption('1')
  await native('resume');await page.waitForTimeout(120)
  assert.equal(await page.evaluate(() => globalThis.playEvents), beforeReturn);await paused()
  await page.evaluate(() => globalThis.clock += 300000)
  await page.locator('button[aria-label="暂停计时"]:visible').click()
  assert.equal((await snapshot()).elapsedMs, 900000, '10m + 24h away + 5m = 15m')
  await page.getByRole('button', { name: '继续练习', exact: true }).click()
  await page.locator('.main-play-button:visible').click();await playing()
  await page.locator('button[aria-label="暂停计时"]:visible').click();await paused()
  await page.getByRole('button', { name: '继续练习', exact: true }).click();await playing()
  // A canceled route resumes the timer but leaves audio stopped.
  await page.evaluate(async () => { globalThis.cancelNavigation = true;await globalThis.router.push('/library') })
  await paused();assert.equal(await page.evaluate(() => globalThis.router.currentRoute.value.path), '/practice/1')
  await page.evaluate(() => globalThis.clock += 1000);await visibility('hidden')
  assert.equal((await snapshot()).elapsedMs, 901000)
  evidence.push({ scenario: 'dual foreground, 24h, manual audio resume, paused track change, canceled route', elapsedMs: 901000 })
  // A real reload creates a new monotonic origin and recovers only the saved accumulated value.
  await page.reload();await page.locator('.practice-layout').waitFor()
  assert.equal((await snapshot()).elapsedMs, 901000)
  // Normal pagehide saves an automatic pause; foreground resume persists a recovery checkpoint.
  await page.locator('button[aria-label="暂停计时"]:visible').waitFor()
  assert.equal((await snapshot()).pauseReason, 'recovery')
  await visibility('hidden');await native('pause');await visibility('visible');await native('resume')
  await page.locator('button[aria-label="暂停计时"]:visible').click()
  await page.reload();await page.locator('.timer-pause-overlay').waitFor()
  await native('resume');assert.equal((await snapshot()).pauseReason, 'manual')
  await page.getByRole('button', { name: '继续练习', exact: true }).click()
  // Legacy values are preserved, recovery is explicit, and notices must be reachable on both layouts.
  // Seed after the outgoing pagehide has saved its current state.
  await page.addInitScript(() => localStorage.setItem('linjian-practice-timer-1', JSON.stringify({ mode: 'running', elapsedMs: 600000, startedAt: 1 })))
  await page.reload();await page.locator('.practice-layout').waitFor()
  assert.equal((await snapshot()).pauseReason, 'recovery');assert.equal((await snapshot()).elapsedMs, 600000)
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('linjian-practice-timer-1-legacy-backup')).mode), 'running')
  for (const [width, height, dark] of [[1280,800,false],[390,844,false],[1280,800,true],[390,844,true]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
    const notice = page.getByRole('status').filter({ hasText: '已迁移旧计时记录' })
    await notice.scrollIntoViewIfNeeded();await notice.waitFor({ state: 'visible' })
    const box = await notice.boundingBox();assert.ok(box.width > 100 && box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height < height - 60)
    assert.ok(await notice.evaluate(element => { const r=element.getBoundingClientRect();return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }), 'notice is not obscured')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
    assert.equal(overflow, false, 'no horizontal overflow')
    if (output) await page.screenshot({ path: join(output, 'practice-recovery-' + width + (dark ? '-dark' : '') + '.png') })
    evidence.push({ scenario: 'legacy recovery notice', width, height, dark, box })
  }
  await page.getByRole('button', { name: '关闭计时提示' }).click()
  assert.equal(await page.locator('.timer-status-notice').count(), 0)
  await page.locator('button[aria-label="继续计时"]:visible').click()
  await page.evaluate(() => { globalThis.failSave = true;globalThis.clock += 5000 })
  await page.getByRole('status').filter({ hasText: '保存失败' }).waitFor({ state: 'visible' })
  assert.deepEqual(errors, [], 'real Vue page errors')
  evidence.push({ scenario: 'checkpoint save failure is visible' })
  console.log('PASS practice timer real Vue/Chromium/media: lifecycle, reload, manual/automatic audio, recovery and two layouts')
  if (output) await writeFile(join(output, 'browser-evidence.json'), JSON.stringify(evidence, null, 2))
} finally { await browser?.close();await server.close() }
