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
  if (path === '/ai/profiles') return [structuredClone(profile)];
  throw new Error('Unexpected mock GET: ' + path);
}
export async function post(path) {
  if (path === '/ai/profiles') return structuredClone(profile);
  if (path.endsWith('/models/sync')) return { models: structuredClone(profile.models) };
  if (path.endsWith('/test')) return { message: '合成连接成功' };
  throw new Error('Unexpected mock POST: ' + path);
}
export async function put() { return {}; }
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
      },
      load(id) {
        if (id === 'virtual:settings-layout') return entry
        if (id === 'virtual:settings-api') return apiStub
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
      await page.locator('.api-profile-card').waitFor()
      await page.getByRole('button', { name: '添加 API 配置', exact: true }).click()
      await page.locator('.new-profile .api-profile-body').waitFor()
      await page.locator('.api-profile-expand').click()
      await page.locator('.api-profile-card:not(.new-profile) .api-profile-body').waitFor()
      await page.evaluate(({ width, height, fontScale }) => {
        document.documentElement.dataset.orientation = width > height ? 'landscape' : 'portrait'
        if (fontScale === 1) return
        const elements = [...document.querySelectorAll('body, body *')].filter(element => element instanceof HTMLElement)
        const sizes = elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize))
        elements.forEach((element, index) => { element.style.fontSize = `${sizes[index] * fontScale}px` })
      }, { width, height, fontScale })

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
        return { overflow, saveButtons, details, creation, viewport: innerWidth }
      })

      assert.deepEqual(geometry.overflow, [], JSON.stringify({ width, height, fontScale, geometry }))
      assert.equal(geometry.saveButtons.length, 4, JSON.stringify({ width, height, fontScale, geometry }))
      for (const button of geometry.saveButtons) {
        assert.ok(button.left >= -1 && button.right <= geometry.viewport + 1, JSON.stringify({ width, height, fontScale, button }))
        assert.ok(button.width > 0, JSON.stringify({ width, height, fontScale, button }))
      }
      assert.ok(geometry.details.width <= geometry.viewport + 1)
      assert.ok(geometry.creation.width <= geometry.viewport + 1)
      assert.deepEqual(errors, [])
      console.log(`${width}x${height}-font-${fontScale}: create, details and save bounds passed`)
      await page.close()
    }
  }
} finally {
  await browser?.close()
  await server.close()
}
