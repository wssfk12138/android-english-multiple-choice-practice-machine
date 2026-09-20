import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

// Constrained sheets must scroll; multi-line choices must retain their content height.
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
const browser = await chromium.launch({ headless: true })
try {
  for (const [width, height] of [[350, 700], [780, 350], [800, 1280], [1280, 800]]) {
    for (const scale of [1, 1.35]) {
      const page = await browser.newPage({ viewport: { width, height } })
      await page.setContent(`<style>${css}</style><section class="app-sheet-overlay"><section class="app-sheet">
        <header class="app-sheet-head"><h3>选择接口协议</h3><button class="app-sheet-close">×</button></header>
        <div class="app-sheet-search"><input placeholder="搜索"></div><div class="app-sheet-list">
        ${Array.from({ length: 8 }, (_, i) => `<button class="app-sheet-option"><span class="app-sheet-option-copy"><strong>兼容协议 ${i}</strong><small>适用于多种兼容接口。这段说明需要在小屏幕和系统大字体下换行，仍然完整保留在当前选项的点击区域内。</small></span></button>`).join('')}
        </div></section></section>`)
      await page.evaluate(scale => {
        const elements = [...document.querySelectorAll('body *')]
        const sizes = elements.map(el => parseFloat(getComputedStyle(el).fontSize))
        elements.forEach((el, i) => { el.style.fontSize = `${sizes[i] * scale}px` })
      }, scale)
      const result = await page.evaluate(() => {
        const list = document.querySelector('.app-sheet-list')
        const options = [...list.children]
        return {
          scrolls: list.scrollHeight > list.clientHeight,
          contained: options.every(el => {
            const box = el.getBoundingClientRect()
            const copy = el.firstElementChild.getBoundingClientRect()
            return copy.top >= box.top && copy.bottom <= box.bottom + 1
          }),
          close: document.querySelector('.app-sheet-close').getBoundingClientRect().toJSON(),
        }
      })
      assert.ok(result.contained, `${width}x${height} @${scale}: option text exceeds hit area`)
      assert.ok(result.scrolls, 'long list must scroll')
      assert.ok(result.close.top >= 0 && result.close.bottom <= height, 'close remains reachable')
      await page.close()
      console.log(`${width}x${height} @${scale}: contained text, scrolling and close passed`)
    }
  }
} finally { await browser.close() }
