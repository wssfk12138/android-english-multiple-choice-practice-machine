import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { server } from './helpers/daily-study-browser-fixture.mjs'


const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url)), output = process.env.DAILY_STUDY_OUTPUT
if (output) await mkdir(output, { recursive: true })
let browser
const evidence = [], errors = []
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', error => errors.push(error.message))
  const ready = async id => {
    await page.waitForFunction(id => document.querySelector('.study-scroll[data-identity]')?.dataset.identity === 'stable-' + id
      && document.querySelector('.daily-study-shell')?.dataset.switching === 'false'
      && document.querySelector('.study-card')?.getAttribute('aria-busy') !== 'true', id)
  }
  const waitStatus = status => page.waitForFunction(status => {
    const call = globalThis.calls.filter(call => call.path.includes('/daily-study/catalog')).at(-1)
    return call && new URLSearchParams(call.path.split('?')[1] || '').get('status') === status
  }, status)
  const waitScroll = top => page.waitForFunction(top => {
    const element = document.querySelector('.study-scroll[data-identity]')
    return element && element.scrollTop === top
  }, top)
  const writes = () => page.evaluate(() => globalThis.calls.filter(call => call.write).length)
  const current = () => page.locator('.study-scroll[data-identity]').getAttribute('data-identity')
  const next = () => page.locator('.study-footer .next').click()
  const previous = () => page.locator('.study-footer .previous').click()
  const reopen = async () => {
    await page.locator('.study-top .back').click(); await page.locator('.daily-study-entry').waitFor()
    assert.equal(await page.evaluate(() => globalThis.router.currentRoute.value.query.studyStatus), 'all', 'new maps back to the visible all filter')
    await page.locator('.daily-study-entry').click()
  }
  const swipe = async (dx, dy = 0, mode = 'normal', selector = '.study-scroll[data-identity]') => page.locator(selector).first().evaluate((element, { dx, dy, mode }) => {
    const fire = (target, type, id, x, y, primary = true) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, clientX: x, clientY: y, button: 0, isPrimary: primary, pointerType: 'touch' }))
    fire(element, 'pointerdown', 1, 300, 140)
    if (mode === 'multi') fire(element, 'pointerdown', 2, 310, 140, false)
    fire(element, 'pointermove', 1, 300 + dx, 140 + dy)
    fire(mode === 'outside' ? document.body : element, mode === 'cancel' ? 'pointercancel' : 'pointerup', 1, 300 + dx, 140 + dy)
    if (mode === 'multi') fire(element, 'pointerup', 2, 310, 140, false)
  }, { dx, dy, mode })
  await page.addInitScript(() => localStorage.setItem('vocab-display-config', JSON.stringify({common_meaning:false,contextual:false,phonetic:false,part_of_speech:false,source_sentence:false,model_sentence:false,memory_hint:false,note:false,morphology:false,similar_forms:false,synonyms:false,antonyms:false})))
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/__daily-study')
  await page.locator('.daily-study-entry').waitFor(); await page.waitForTimeout(300)
  await page.setViewportSize({ width: 800, height: 1280 }); await page.locator('.daily-study-entry').waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 1280, height: 800 }); await page.locator('.daily-study-entry').waitFor()
  const writeBaseline = await writes(), reviewBefore = await page.evaluate(() => JSON.stringify(globalThis.reviewFields))
  await page.locator('.daily-study-entry').click(); await ready(1)
  assert.equal(await page.evaluate(() => globalThis.calls.filter(call => call.path.includes('/daily-study/catalog')).at(-1).path.includes('status=new')), true, 'daily study entry is fixed to new')
  await page.locator('.study-filter-trigger').click()
  await page.locator('.study-filter-panel button').filter({ hasText: '全部单词' }).click(); await waitStatus('all'); await ready(1)
  assert.equal(await page.evaluate(() => new URLSearchParams(globalThis.calls.filter(call => call.path.includes('/daily-study/catalog')).at(-1).path.split('?')[1]).get('status')), 'all', 'filter switch requests the chosen range')
  assert.match(await page.locator('.study-filter-trigger').innerText(), /全部单词/)
  await page.locator('.study-filter-trigger').click()
  await page.locator('.study-filter-panel button').filter({ hasText: '新词（尚未学习）' }).click(); await waitStatus('new'); await ready(1)
  assert.equal(await page.evaluate(() => new URLSearchParams(globalThis.calls.filter(call => call.path.includes('/daily-study/catalog')).at(-1).path.split('?')[1]).get('status')), 'new')
  assert.match(await page.locator('.study-filter-trigger').innerText(), /新词（尚未学习）/)
  assert.equal(await page.locator('.vocabulary-page').count(), 0, 'independent route unmounts vocabulary side effects')
  assert.match(await page.locator('.study-count').innerText(), /1 \/ 1203/)
  assert.ok(await page.locator('.word-nav-list button').count() <= 41)
  assert.equal(await page.locator('.study-footer .previous').isDisabled(), true)
  assert.equal(await page.locator('textarea,input,.review-rating').count(), 0)
  assert.equal(await page.locator('.study-card details,.study-card summary,.expand-all').count(), 0)
  assert.deepEqual(await page.locator('.study-card [data-study-section]').evaluateAll(es=>es.map(e=>e.dataset.studySection)), ['memory_hint','common_meaning','contextual','source_sentence','note','morphology','synonyms'])
  await page.locator('.study-scroll[data-identity]').evaluate(element => element.scrollTop = 250); await page.waitForTimeout(180)
  const top = await page.locator('.study-scroll[data-identity]').evaluate(element => element.scrollTop)
  await next(); await ready(2); await previous(); await ready(1)
  assert.equal(await page.locator('.study-scroll[data-identity]').evaluate(element => element.scrollTop), top)
  await reopen(); await ready(1)
  assert.equal(await page.locator('.study-scroll[data-identity]').evaluate(element => element.scrollTop), top)
  // Reopening VocabularyView is allowed its existing maintenance calls; the study interval itself is read-only.
  const studyWriteBaseline = await writes()
  await swipe(120)
  await page.waitForFunction(()=>document.querySelector('.study-deck').dataset.gesture==='idle')
  assert.equal(await current(),'stable-1','right swipe at the first word rebounds')
  await page.keyboard.press('ArrowRight'); await ready(2)
  await swipe(100); await ready(1); await swipe(-100); await ready(2)
  for (const args of [[72,0], [100,100], [100,0,'cancel'], [100,0,'multi'], [100,0,'normal','.study-footer button']]) {
    await swipe(...args); await page.waitForTimeout(100); assert.equal(await current(), 'stable-2', 'gesture exclusion ' + args)
  }
  await page.locator('.word-heading h1').evaluate(element => { const range=document.createRange();range.selectNodeContents(element);getSelection().removeAllRanges();getSelection().addRange(range) })
  await swipe(100); assert.equal(await current(), 'stable-2'); await page.evaluate(() => getSelection().removeAllRanges())
  await swipe(-100); await ready(3) // outside release did not leave a stuck pointer
  // Chromium's native touch input, not dispatchEvent, proves the actual pointer chain.
  const cdp = await page.context().newCDPSession(page)
  const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints:points})
  const origin = await page.locator('.study-card').first().boundingBox()
  const point = {x:origin.x + origin.width * .6,y:origin.y + 35,id:1}
  await touch('touchStart',[point]); await touch('touchMove',[{...point,x:point.x + 45}])
  await page.waitForFunction(()=>Number(document.querySelector('.study-deck').dataset.offset)>30)
  assert.equal(await current(), 'stable-3', 'native drag moves before releasing without committing')
  assert.equal(await page.locator('.adjacent-card[aria-hidden="true"][inert]').count(),1)
  assert.equal(await page.locator('.adjacent-card .word-heading h1').innerText(),'evidence2','right drag previews the previous word')
  const previewBox=await page.locator('.adjacent-card').boundingBox()
  assert.ok(previewBox.x<origin.x,'previous word enters from the left')
  const nativeOffset = await page.locator('.study-deck').getAttribute('data-offset')
  const requestsDuringDrag = await page.evaluate(()=>globalThis.calls.length)
  await touch('touchMove',[{...point,x:point.x + 60}])
  assert.equal(await page.evaluate(()=>globalThis.calls.length),requestsDuringDrag,'drag never loads detail on pointer moves')
  await touch('touchEnd',[])
  await page.waitForFunction(()=>document.querySelector('.study-deck').dataset.gesture==='idle')
  assert.equal(await current(),'stable-3','native short drag rebounds')
  await touch('touchStart',[point]);await touch('touchMove',[{...point,x:point.x - 140}]);await touch('touchEnd',[]);await ready(4)
  await touch('touchStart',[point]);await touch('touchMove',[{...point,x:point.x + 140}]);await touch('touchEnd',[]);await ready(3)
  await touch('touchStart',[point]);await touch('touchMove',[{...point,x:point.x + 100}]);await touch('touchCancel',[])
  await page.waitForFunction(()=>document.querySelector('.study-deck').dataset.gesture==='idle');assert.equal(await current(),'stable-3')
  await touch('touchStart',[point]);await touch('touchMove',[{...point,y:point.y + 90}]);await touch('touchEnd',[])
  assert.equal(await current(),'stable-3','native vertical input does not navigate')
  await swipe(-120,0,'outside');await ready(4);await previous();await ready(3)
  // Blur/capture loss/rotation interrupt a drag without leaving an offset or lock.
  for(const cancel of ['blur','lostpointercapture','resize']) {
    await page.locator('.study-card').first().evaluate((el,cancel)=>{
      const fire=(type,x)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:7,clientX:x,clientY:200,button:0,isPrimary:true}))
      fire('pointerdown',300);fire('pointermove',410)
      if(cancel==='blur') window.dispatchEvent(new Event('blur'))
      else if(cancel==='resize') {document.documentElement.dataset.orientation='portrait'}
      else fire('lostpointercapture',410)
      fire('pointerup',410)
    },cancel)
    if(cancel==='resize')await page.evaluate(()=>document.documentElement.dataset.orientation='landscape')
    await page.waitForFunction(()=>document.querySelector('.study-deck')?.dataset.gesture==='idle'&&Number(document.querySelector('.study-deck').dataset.offset)===0)
    assert.equal(await current(),'stable-3')
  }
  evidence.push({scenario:'native Chromium touch: follow before release, short rebound, both directions, cancel, vertical priority',nativeOffset, requestsOnMove:0})
  await page.locator('.study-scroll[data-identity]').evaluate(element => element.scrollTop = 190)
  await page.waitForFunction(() => {
    try { return Object.values(JSON.parse(localStorage.getItem('daily-study:v1') || '{}')).some(record => record?.positions?.['stable-3'] === 190) }
    catch { return false }
  })
  await page.setViewportSize({ width: 800, height: 1280 }); await page.getByText('请横屏继续学习').waitFor()
  await page.setViewportSize({ width: 1280, height: 800 }); await ready(3)
  await waitScroll(190)
  assert.equal(await page.locator('.study-scroll[data-identity]').evaluate(element => element.scrollTop), 190)
  const catalogs = await page.evaluate(() => globalThis.calls.filter(call => call.path.includes('/daily-study/catalog')).length)
  await page.evaluate(() => { globalThis.revision++;globalThis.extra = true;document.dispatchEvent(new Event('visibilitychange')) })
  await page.getByText('证据；根据 · revision 2').waitFor()
  assert.equal(await page.evaluate(() => globalThis.calls.filter(call => call.path.includes('/daily-study/catalog')).length), catalogs)
  await waitScroll(190)
  assert.equal(await page.locator('.study-scroll[data-identity]').evaluate(element => element.scrollTop), 190)
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
  await page.evaluate(() => localStorage.setItem('daily-study:v1', JSON.stringify({ 'synthetic-db:new': { id: 1203, identity: 'stable-1203', index: 1202, positions: {} } })))
  await page.locator('.daily-study-entry').click(); await ready(1203)
  assert.equal(await page.locator('.study-footer .next').isDisabled(), true)
  assert.ok(await page.locator('.word-nav-list button').count() <= 41)
  await page.keyboard.press('ArrowRight'); assert.equal(await current(), 'stable-1203')
  // Edge fields must survive even when their usual leading field is absent.
  await page.evaluate(()=>{globalThis.detailOverride={latest_sentence:'',common_meaning:'',contextual_meaning:'',memory_hint:'',note:'',synonyms:[],generated_example:{translation:'只有译文也保留'},morphology:{forms:[{label:'复数',word:'forms-only'}],note:'词形说明保留'},similar_forms:[],local_similar:[{word:'local-only',note:'本地辨析保留'}],antonyms:[{word:'opposite',note:'反义词保留'}]};globalThis.revision++;document.dispatchEvent(new Event('visibilitychange'))})
  await page.getByText('只有译文也保留',{exact:true}).waitFor()
  assert.deepEqual(await page.locator('.study-card [data-study-section]').evaluateAll(es=>es.map(e=>e.dataset.studySection)),['model_sentence','morphology','similar_forms','antonyms'])
  for(const text of ['forms-only','词形说明保留','local-only','本地辨析保留','反义词保留'])assert.ok((await page.locator('.study-card').innerText()).includes(text))
  assert.equal(await page.locator('.study-card details,.study-card summary').count(),0)
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('vocab-display-config')).memory_hint),false,'daily study leaves saved vocabulary preferences intact')
  await page.evaluate(()=>{globalThis.detailOverride=null;globalThis.revision++;document.dispatchEvent(new Event('visibilitychange'))})
  await page.getByText('结合上下文记忆。',{exact:true}).waitFor()
  await page.emulateMedia({ reducedMotion: 'reduce' }); await previous(); await ready(1202)
  await page.locator('.study-top .back').click(); await page.locator('.daily-study-entry').waitFor()
  await page.evaluate(() => globalThis.failCatalog = true)
  await page.locator('.daily-study-entry').click(); await page.getByText('单词目录读取失败').waitFor()
  await page.evaluate(() => { globalThis.failCatalog = false;globalThis.count = 0 })
  await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.getByText('暂无未学习单词').waitFor()
  await page.getByRole('button', { name: '查看全部单词', exact: true }).click(); await page.getByText('当前范围没有可学习的单词').waitFor()
  assert.equal(await page.evaluate(() => new URLSearchParams(globalThis.calls.filter(call => call.path.includes('/daily-study/catalog')).at(-1).path.split('?')[1]).get('status')), 'all', 'empty new range can switch to all')
  await page.locator('.study-top .back').click(); await page.locator('.daily-study-entry').waitFor()
  await page.evaluate(() => { globalThis.count = 1203;globalThis.delayDetail = 1202 })
  await page.locator('.daily-study-entry').click(); await page.getByText('正在读取单词详情…').waitFor()
  await page.locator('.study-top .back').click(); await page.evaluate(() => globalThis.releaseDetail())
  await page.locator('.daily-study-entry').waitFor(); assert.equal(await page.locator('.daily-study-shell').count(), 0)
  assert.deepEqual(errors, [], 'real Vue runtime has no page errors')
  if (output) await writeFile(join(output, 'daily-study-browser-evidence.json'), JSON.stringify(evidence, null, 2))
  console.log('PASS daily study real Vue/Chromium: actual entry, 1203 members, bounded navigation, swipe exclusions, scroll/resume/rotation, revision, read-only, error/retry/empty/disposal and static complete content')
} catch (error) {
  console.error('Daily study browser page errors:', errors)
  throw error
} finally { await browser?.close(); await server.close() }
