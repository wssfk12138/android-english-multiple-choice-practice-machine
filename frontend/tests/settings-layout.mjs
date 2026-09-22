import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))

const fixtureProfile = {
  id: 7,
  name: '合成测试长名称 API 配置',
  adapter: 'openai-chat',
  base_url: 'https://synthetic.example.test/openai-compatible/very-long-path/v1',
  has_api_key: true,
  keys: [{ id: 'fixture-key', name: '合成已选密钥', mask: 'sk-f****k9d2' }],
  selected_key_id: 'fixture-key',
  enabled: true,
  is_default: true,
  default_model: 'synthetic-provider/long-model-name-for-layout-validation',
  temperature: 0.2,
  max_tokens: 0,
  reasoning_effort: 'high',
  system_prompt: '仅用于合成布局测试，不发出网络请求。',
  models: Array.from({ length: 8 }, (_, index) => ({
    model_id: `synthetic-provider/long-model-name-${index + 1}-for-layout-validation`,
    display_name: `合成模型 ${index + 1} · 较长的模型显示名称`,
    owned_by: 'synthetic-provider',
    provider: 'fixture',
    is_visible: true,
    is_available: true,
  })),
}

const apiStub = `
const profile = ${JSON.stringify(fixtureProfile)};
export async function get(path) {
  if (path === '/ai/profiles') { const n=window.modelCount ?? 8; const models=Array.from({length:n},(_,i)=>({...profile.models[i%8],model_id:'model-'+i,is_visible:i%2===0})); return [{...structuredClone(profile),models},{...structuredClone(profile),id:8,name:'第二配置',adapter:'anthropic',models}]; }
  throw new Error('Unexpected mock GET: ' + path);
}
export async function post(path, body) {
  if (path.endsWith('/keys')) {
    window.keyActions = [...(window.keyActions || []), body.action];
    if (body.action === 'rename') profile.keys.find(key => key.id === body.identity).name = body.name;
    if (body.action === 'add') profile.keys.push({id:'added-key-'+(profile.keys.length+1),name:body.name,mask:'sk-a****t987'});
    if (body.action === 'select') profile.selected_key_id = body.identity;
    if (body.action === 'delete') {
      profile.keys = profile.keys.filter(key => key.id !== body.identity);
      if (profile.selected_key_id === body.identity) profile.selected_key_id = '';
    }
    return structuredClone({keys:profile.keys,selected_key_id:profile.selected_key_id,has_api_key:!!profile.selected_key_id});
  }
  if (path === '/ai/profiles') return structuredClone(profile);
  if (path.endsWith('/models/sync')) return { models: structuredClone(profile.models) };
  if (path.endsWith('/test')) return { message: '合成连接成功' };
  throw new Error('Unexpected mock POST: ' + path);
}
export async function put(path,body) { window.savedProfile=body; return {}; }
export async function del() { return {}; }
`

const entry = `
import { createApp, h } from 'vue';
import View from '/src/views/SettingsView.vue';
import '/src/styles.css';
import '/src/study-theme.css';
const app = createApp({ render: () => h(View) });
app.component('RouterLink', { props: ['to'], render() { return h('a', { href: String(this.to || '#') }, this.$slots.default?.()); } });
app.mount('#app');
`

const server = await createServer({
  configFile: false,
  root,
  optimizeDeps: { noDiscovery: true, include: ['vue', 'lucide-vue-next'] },
  plugins: [
    {
      name: 'isolated-settings-layout',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'virtual:settings-layout') return id
        if (id === '../api') return 'virtual:settings-api'
        if (id === '../platform/dialogs') return 'virtual:settings-dialogs'
      },
      load(id) {
        if (id === 'virtual:settings-layout') return entry
        if (id === 'virtual:settings-api') return apiStub
        if (id === 'virtual:settings-dialogs') return 'export async function confirmDialog() { window.confirmations=(window.confirmations||0)+1; return true }'
      },
      configureServer(viteServer) {
        viteServer.middlewares.use((request, response, next) => {
          if (request.url !== '/__settings-layout') return next()
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          response.end('<!doctype html><html data-platform="android"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><script type="module" src="/@id/virtual:settings-layout"></script></body></html>')
        })
      },
    },
    vue(),
  ],
  server: { host: '127.0.0.1', port: 0 },
})

let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const viewports = [[390, 844], [800, 1280], [1280, 800]]
  for (const [width, height] of viewports) {
    for (const fontScale of [1, 1.35]) {
      const page = await browser.newPage({ viewport: { width, height } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
      await page.goto(server.resolvedUrls.local[0] + '__settings-layout')
      await page.locator('.api-profile-card').first().waitFor()
      await page.getByRole('button', { name: '添加 API 配置', exact: true }).click()
      await page.locator('.new-profile .api-profile-body').waitFor()
      await page.locator('.api-profile-expand').first().click()
      await page.locator('.api-profile-card:not(.new-profile) .api-profile-body').waitFor()
      const keyBox = page.locator('.named-keys').first()
      assert.equal(await keyBox.getByPlaceholder('密钥名称').count(), 0)
      await keyBox.getByRole('button', { name: '管理密钥', exact: true }).click()
      assert.equal(await keyBox.getByPlaceholder('密钥名称').count(), 1)
      assert.equal(await keyBox.getByLabel('新 API 密钥').getAttribute('type'), 'password')
      await keyBox.getByLabel('密钥名称', {exact:true}).fill('重新命名的密钥')
      await keyBox.getByRole('button', {name:'保存名称',exact:true}).click()
      await page.waitForFunction(()=>window.keyActions?.includes('rename'))
      assert.match(await keyBox.locator('.key-summary').innerText(),/重新命名的密钥/)
      await keyBox.getByLabel('新密钥名称', {exact:true}).fill('新增合成密钥')
      await keyBox.getByLabel('新 API 密钥', {exact:true}).fill('synthetic-secret-for-ui-test')
      await keyBox.getByRole('button',{name:'添加密钥',exact:true}).click()
      await page.waitForFunction(()=>window.keyActions?.includes('add'))
      if (width > height) {
        await page.evaluate(() => { document.documentElement.dataset.orientation = 'landscape' })
        await keyBox.locator('.key-heading').waitFor()
        assert.match(await keyBox.locator('.key-heading > strong').innerText(), /API Key/)
        assert.equal(await keyBox.locator('.key-select').count(), 0)
        assert.equal(await keyBox.locator('.key-summary').count(), 0)
        assert.equal(await keyBox.locator('.key-row').count(), 2)
        const keyText = await keyBox.innerText()
        assert.match(keyText, /重新命名的密钥/)
        assert.match(keyText, /新增合成密钥/)
        assert.ok(keyText.includes('···· k9d2'), keyText)
        assert.ok(keyText.includes('···· t987'), keyText)
        assert.equal(await keyBox.locator('.key-more').count(), 0)
        const connection = await page.evaluate(() => {
          const box = selector => { const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height} }
          return { url: box('#profile-url'), defaultRow: box('.default-config-switch-row'), keys: box('.named-keys') }
        })
        const defaultRowGap = Math.abs((connection.url.top+connection.url.bottom)/2-(connection.defaultRow.top+connection.defaultRow.bottom)/2)
        assert.ok(defaultRowGap <= 8, JSON.stringify(connection))
        assert.ok(connection.defaultRow.left >= connection.keys.left-1, JSON.stringify(connection))
        assert.ok(connection.keys.top < connection.url.top, JSON.stringify(connection))
        for (const index of [1, 2]) {
          await keyBox.locator('.key-add').click()
          await keyBox.getByLabel('新密钥名称', { exact: true }).fill('横屏补充密钥 ' + index)
          await keyBox.getByLabel('新 API 密钥', { exact: true }).fill('synthetic-landscape-secret-' + index)
          await keyBox.getByRole('button', { name: '添加密钥', exact: true }).click()
          await page.waitForFunction(total => (window.keyActions || []).filter(action => action === 'add').length === total, 1+index)
        }
        assert.equal(await keyBox.locator('.key-more').count(), 1)
        assert.match(await keyBox.locator('.key-more').innerText(), /查看全部 4 个密钥/)
        const shownRows = await keyBox.locator('.key-row:visible').count()
        assert.ok(shownRows === 1 || shownRows === 2, '页内密钥应只显示一到两条，实际 ' + shownRows)
        await keyBox.locator('.key-more').click()
        const keySheet = page.locator('.key-sheet')
        await keySheet.waitFor()
        assert.equal(await keySheet.locator('.app-sheet-option').count(), 4)
        assert.ok((await keySheet.innerText()).includes('···· k9d2'))
        await keySheet.locator('.app-sheet-option').nth(3).getByRole('button', { name: '删除密钥', exact: true }).click()
        await page.waitForFunction(() => document.querySelectorAll('.key-sheet .app-sheet-option').length === 3)
        await keySheet.locator('.app-sheet-option').nth(2).getByRole('button', { name: '删除密钥', exact: true }).click()
        await page.waitForFunction(() => document.querySelectorAll('.key-sheet .app-sheet-option').length === 2)
        assert.equal(await keyBox.locator('.key-more').count(), 0)
        await keySheet.getByRole('button', { name: '完成', exact: true }).click()
        await page.waitForFunction(() => !document.querySelector('.key-sheet'))
        await page.evaluate(() => { window.keyActions = [] })
        await page.evaluate(() => { document.documentElement.dataset.orientation = 'portrait' })
        await keyBox.getByRole('button', { name: '收起管理', exact: true }).waitFor()
      }
      await keyBox.getByRole('radio',{name:'选用 新增合成密钥',exact:true}).check()
      await page.waitForFunction(()=>window.keyActions?.includes('select'))
      assert.match(await keyBox.locator('.key-summary').innerText(),/新增合成密钥/)
      assert.equal(await keyBox.getByLabel('新 API 密钥').inputValue(),'')
      assert.equal((await keyBox.innerText()).includes('synthetic-secret-for-ui-test'),false)
      await keyBox.getByRole('button', { name: '收起管理', exact: true }).click()
      assert.equal(await keyBox.getByPlaceholder('密钥名称').count(), 0)
      assert.match(await keyBox.locator('.key-summary').innerText(),/新增合成密钥/)
      await keyBox.getByRole('button', {name:'管理密钥',exact:true}).click()
      await keyBox.locator('.key-row').last().getByRole('button',{name:'删除密钥',exact:true}).click()
      await page.waitForFunction(()=>window.keyActions?.includes('delete'))
      assert.match(await keyBox.locator('.key-summary').innerText(),/不使用密钥/)
      const newProtocol = page.locator('.new-profile .option-sheet-trigger').first()
      const newReasoning = page.locator('.new-profile .option-sheet-trigger').last()
      assert.equal(await newReasoning.isEnabled(),true)
      await newProtocol.click()
      await page.getByRole('option',{name:/Anthropic Messages/}).click()
      assert.equal(await newReasoning.isDisabled(),true)
      await newProtocol.click()
      await page.getByRole('option',{name:/OpenAI Chat 兼容/}).click()
      assert.equal(await newReasoning.isEnabled(),true)
      const reasoning = page.locator('.api-advanced-section .option-sheet-trigger')
      assert.equal(await reasoning.isEnabled(),true)
      await reasoning.click()
      await page.getByRole('option',{name:'低',exact:true}).click()
      assert.equal(await reasoning.innerText(),'低')
      await page.evaluate(({ width, height, fontScale }) => {
        document.documentElement.dataset.orientation = width > height ? 'landscape' : 'portrait'
        if (fontScale === 1) return
        const elements = [...document.querySelectorAll('body, body *')].filter(element => element instanceof HTMLElement)
        const sizes = elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize))
        elements.forEach((element, index) => { element.style.fontSize = `${sizes[index] * fontScale}px` })
      }, { width, height, fontScale })

      for (const advanced of await page.locator('.api-advanced-section').all()) {
        assert.equal(await advanced.locator('summary').count(),0)
        assert.match(await advanced.innerText(),/推理强度/)
      }
      const catalog = page.locator('.api-model-management')
      const catalogToggle = catalog.locator('.api-model-list-toggle')
      assert.equal(await catalogToggle.getAttribute('aria-expanded'),'false')
      assert.equal(await catalog.locator('.api-model-list').count(),0)
      assert.equal(await page.getByPlaceholder('搜索模型').count(),0)
      assert.equal((await catalog.innerText()).includes('整个配置全部显示'),false)
      assert.equal((await catalog.innerText()).includes('整个配置全部隐藏'),false)
      assert.ok(await catalog.getByRole('button',{name:'全部显示',exact:true}).count())
      assert.ok(await catalog.getByRole('button',{name:'全部隐藏',exact:true}).count())
      await catalogToggle.click()
      if (width > height) await page.locator('.model-sheet').waitFor()
      else await catalog.locator('.api-model-list').waitFor()
      const geometry = await page.evaluate(() => {
        const visible = element => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
        }
        const overflow = [...document.querySelectorAll('.ai-settings-page *')].filter(element => {
          if (!(element instanceof HTMLElement) || !visible(element)) return false
          const rect = element.getBoundingClientRect()
          return rect.left < -1 || rect.right > innerWidth + 1
        }).map(element => `${element.tagName.toLowerCase()}.${element.className}`)
        const saveButtons = [...document.querySelectorAll('.api-create-actions .button, .api-actions .button')].filter(visible).map(element => {
          const rect = element.getBoundingClientRect()
          return { text: element.textContent?.trim(), left: rect.left, right: rect.right, width: rect.width }
        })
        const details = document.querySelector('.api-profile-card:not(.new-profile) .api-profile-body')?.getBoundingClientRect()
        const creation = document.querySelector('.new-profile .api-profile-body')?.getBoundingClientRect()
        const modelToggle = document.querySelector('.api-model-list-toggle').getBoundingClientRect()
        const modelListBox = document.querySelector('.api-model-list')
        const modelList = modelListBox ? modelListBox.getBoundingClientRect() : null
        const modelArrow = document.querySelector('.api-model-list-toggle svg').getBoundingClientRect()
        const modelControlZ = Number.parseInt(getComputedStyle(document.querySelector('.api-model-list-control')).zIndex || '0',10)
        const testButton = document.querySelector('.api-test-connection')
        const testButtonZ = testButton ? Number.parseInt(getComputedStyle(testButton).zIndex || '0',10) : 0
        const defaultSwitch = document.querySelector('.default-config-switch-row')
        const defaultTrack = defaultSwitch.querySelector('i').getBoundingClientRect()
        const enableSwitch = document.querySelector('.api-profile-card:not(.new-profile) .api-enable').getBoundingClientRect()
        return { overflow, saveButtons, details, creation, viewport: innerWidth,
          modelToggle, modelList, modelArrow, modelControlZ, testButtonZ,
          defaultRole:defaultSwitch.getAttribute('role'),defaultText:defaultSwitch.textContent.trim(),defaultTrack,enableSwitch }
      })

      assert.deepEqual(geometry.overflow, [], JSON.stringify({ width, height, fontScale, geometry }))
      assert.equal(geometry.saveButtons.length, width>height?2:4, JSON.stringify({ width, height, fontScale, geometry }))
      for (const button of geometry.saveButtons) {
        assert.ok(button.left >= -1 && button.right <= geometry.viewport + 1, JSON.stringify({ width, height, fontScale, button }))
        assert.ok(button.width > 0, JSON.stringify({ width, height, fontScale, button }))
      }
      assert.ok(geometry.details.width <= geometry.viewport + 1)
      assert.ok(geometry.creation.width <= geometry.viewport + 1)
      assert.ok(geometry.modelArrow.right>=geometry.modelToggle.right-16, JSON.stringify(geometry))
      if (width > height) {
        assert.equal(geometry.modelList, null)
        assert.equal(await page.getByPlaceholder('搜索模型').count(), 1)
        assert.equal(await page.locator('.model-sheet .api-model-row').count(), 8)
      } else {
        assert.ok(Math.abs(geometry.modelToggle.width-geometry.modelList.width)<1, JSON.stringify(geometry))
      }
      assert.equal(geometry.defaultRole,'switch')
      assert.equal(geometry.defaultText,'设置为默认配置')
      assert.ok(Math.abs(geometry.defaultTrack.width-geometry.enableSwitch.width)<=2, JSON.stringify(geometry))
      assert.ok(Math.abs(geometry.defaultTrack.height-geometry.enableSwitch.height)<=2, JSON.stringify(geometry))
      if(width>height) {
        assert.equal(await catalog.getByRole('button',{name:'测试连接',exact:true}).count(),1)
        assert.ok(geometry.modelControlZ>geometry.testButtonZ, JSON.stringify(geometry))
        const modelSheet = page.locator('.model-sheet')
        await modelSheet.getByRole('button',{name:'全部隐藏',exact:true}).click()
        assert.equal(await modelSheet.locator('.api-model-row [role=switch][aria-checked=true]').count(),0)
        await modelSheet.getByRole('button',{name:'全部显示',exact:true}).click()
        assert.equal(await modelSheet.locator('.api-model-row [role=switch][aria-checked=true]').count(),8)
        await modelSheet.getByRole('button',{name:'完成',exact:true}).click()
        await page.waitForFunction(()=>!document.querySelector('.model-sheet'))
        assert.equal(await page.getByPlaceholder('搜索模型').count(),0)
        assert.equal(await catalogToggle.getAttribute('aria-expanded'),'false')
      } else {
        await catalogToggle.click()
        assert.equal(await catalog.locator('.api-model-list').count(),0)
      }
      assert.deepEqual(errors, [])
      console.log(`${width}x${height}-font-${fontScale}: create, details and save bounds passed`)
      await page.close()
    }
  }
  for (const count of [0,1,100,1000]) {
    const page=await browser.newPage({viewport:{width:1280,height:800}})
    await page.addInitScript(n=>window.modelCount=n,count)
    await page.goto(server.resolvedUrls.local[0]+'__settings-layout')
    await page.locator('.api-profile-expand').first().click()
    const catalog=page.locator('.api-model-management')
    await catalog.waitFor()
    const toggle=catalog.locator('.api-model-list-toggle')
    assert.equal(await toggle.getAttribute('aria-expanded'),'false')
    assert.equal(await catalog.locator('.api-model-list').count(),0)
    assert.equal(await page.getByPlaceholder('搜索模型').count(),0)
    assert.equal((await toggle.innerText()).trim(),'模型显示列表 · '+count+' 个')
    await toggle.click()
    assert.equal(await page.locator('.api-model-row').count(),count)
    const boxes=await page.evaluate(()=>{const a=document.querySelector('.api-model-list-toggle').getBoundingClientRect(),b=document.querySelector('.api-model-list').getBoundingClientRect();return {toggle:a,list:b}})
    assert.ok(Math.abs(boxes.toggle.width-boxes.list.width)<1,JSON.stringify(boxes))
    if(count) assert.ok(boxes.list.height<=322,JSON.stringify(boxes))
    await page.getByRole('button',{name:'全部隐藏',exact:true}).click()
    assert.equal(await page.locator('.api-model-row [role=switch][aria-checked=true]').count(),0)
    await page.getByRole('button',{name:'全部显示',exact:true}).click()
    assert.equal(await page.locator('.api-model-row [role=switch][aria-checked=true]').count(),count)
    await toggle.click()
    assert.equal(await catalog.locator('.api-model-list').count(),0)
    await page.getByRole('button',{name:'保存配置',exact:true}).click()
    await page.waitForFunction(()=>window.savedProfile)
    const saved=await page.evaluate(()=>window.savedProfile)
    assert.equal(saved.temperature,fixtureProfile.temperature)
    assert.equal(saved.system_prompt,fixtureProfile.system_prompt)
    await page.locator('.api-profile-expand').nth(1).click()
    assert.equal(await page.locator('.api-profile-body').count(),1)
    assert.equal(await page.locator('.api-profile-card').nth(0).locator('.api-profile-body').count(),0)
    assert.equal(await page.locator('.api-profile-card').nth(1).locator('.api-advanced-section .option-sheet-trigger').isDisabled(), true)
    console.log('PASS collapsed model directory width/visibility/preservation/single-open',count)
    await page.close()
  }
  {
    const page=await browser.newPage({viewport:{width:1280,height:800}})
    await page.addInitScript(n=>window.modelCount=n,1000)
    await page.goto(server.resolvedUrls.local[0]+'__settings-layout')
    await page.locator('.api-profile-expand').first().click()
    await page.evaluate(()=>{document.documentElement.dataset.orientation='landscape'})
    const catalog=page.locator('.api-model-management')
    const toggle=catalog.locator('.api-model-list-toggle')
    const sheet=page.locator('.model-sheet')
    assert.equal(await toggle.getAttribute('aria-expanded'),'false')
    assert.equal(await catalog.locator('.api-model-list').count(),0)
    await toggle.click()
    await sheet.waitFor()
    assert.equal(await toggle.getAttribute('aria-expanded'),'true')
    assert.equal(await sheet.locator('.api-model-row').count(),1000)
    const metrics=await page.evaluate(()=>{
      const list=document.querySelector('.model-sheet .app-sheet-list'),rect=list.getBoundingClientRect(),frame=document.querySelector('.model-sheet').getBoundingClientRect()
      return {scrollHeight:list.scrollHeight,clientHeight:list.clientHeight,top:rect.top,bottom:rect.bottom,left:frame.left,right:frame.right,viewportHeight:innerHeight,viewportWidth:innerWidth}
    })
    assert.ok(metrics.scrollHeight>metrics.clientHeight,JSON.stringify(metrics))
    assert.ok(metrics.top>=-1&&metrics.bottom<=metrics.viewportHeight+1,JSON.stringify(metrics))
    assert.ok(metrics.left>=-1&&metrics.right<=metrics.viewportWidth+1,JSON.stringify(metrics))
    await sheet.getByPlaceholder('搜索模型').fill('model-999')
    assert.equal(await sheet.locator('.api-model-row').count(),1)
    assert.match(await sheet.locator('.api-model-row').innerText(),/合成模型/)
    await sheet.getByPlaceholder('搜索模型').fill('没有这个模型')
    assert.equal(await sheet.locator('.api-model-row').count(),0)
    assert.equal(await sheet.locator('.app-sheet-empty').count(),1)
    await sheet.getByPlaceholder('搜索模型').fill('')
    assert.equal(await sheet.locator('.api-model-row').count(),1000)
    await sheet.getByRole('button',{name:'完成',exact:true}).click()
    await page.waitForFunction(()=>!document.querySelector('.model-sheet'))
    assert.equal(await toggle.getAttribute('aria-expanded'),'false')
    assert.equal(await page.getByPlaceholder('搜索模型').count(),0)
    console.log('PASS landscape model sheet overflow/search/close')
    await page.close()
  }
} finally {
  await browser?.close()
  await server.close()
}
