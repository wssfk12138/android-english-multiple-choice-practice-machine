import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Layout-only harness: native camera behavior is covered separately on Android.
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const source = await readFile(new URL('../src/components/LanSyncScanner.vue', import.meta.url), 'utf8')
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1]
const browser = await chromium.launch({ headless: true })
const output = new URL('../../.codex-local/scanner-layout/', import.meta.url)
await mkdir(output, { recursive: true })
try {
  for (const [width, height] of [[360, 640], [640, 360], [800, 1280], [1280, 800]]) {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.setContent(
      '<html class="lan-scanner-active"><head><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}' + css +
      '</style></head><body><div id="app">HIDDEN APP</div><section class="lan-scanner">' +
      '<header class="lan-scanner-toolbar"><h2>扫码绑定</h2><button class="icon-button" aria-label="关闭扫描">X</button></header>' +
      '<div class="lan-scanner-stage"><div class="lan-scanner-viewfinder"></div></div>' +
      '<footer class="lan-scanner-controls"><button class="icon-button" aria-label="闪光灯">F</button></footer></section></body></html>',
    )
    const rect = selector => page.locator(selector).boundingBox()
    const frame = await rect('.lan-scanner-viewfinder')
    const header = await rect('header')
    const footer = await rect('footer')
    assert.ok(frame.width >= 100)
    assert.ok(Math.abs(frame.width - frame.height) < 1)
    assert.ok(frame.y >= header.y + header.height)
    assert.ok(frame.y + frame.height <= footer.y)
    assert.ok(footer.y + footer.height <= height)
    assert.equal(await page.locator('#app').evaluate(el => getComputedStyle(el).visibility), 'hidden')
    await page.screenshot({ path: fileURLToPath(new URL(width + 'x' + height + '.png', output)) })
    console.log(width + 'x' + height + ': frame and controls fit')
    await page.close()
  }
} finally { await browser.close() }
