// C23：错题分析安全 Markdown 渲染。用真实 marked + DOMPurify 在无头浏览器
// 里执行生产 safe-markdown.ts，验证可读性与安全过滤（脚本/危险链接/远程图片）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { chromium } from 'playwright'

const source = readFileSync(new URL('../src/services/safe-markdown.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const root = fileURLToPath(new URL('..', import.meta.url))
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto('about:blank')
  await page.addScriptTag({ path: root + 'node_modules/marked/lib/marked.umd.js' })
  await page.addScriptTag({ path: root + 'node_modules/dompurify/dist/purify.min.js' })
  await page.evaluate(({ code }) => {
    const module = { exports: {} }
    const require = (name) => {
      // TS 编译后的 CJS 访问 dompurify_1.default 与 marked_1.marked。
      if (name === 'marked') return { marked: window.marked }
      if (name === 'dompurify') return { default: window.DOMPurify }
      throw new Error('unexpected require: ' + name)
    }
    new Function('require', 'module', 'exports', code)(require, module, module.exports)
    window.renderSafeMarkdown = module.exports.renderSafeMarkdown
    if (typeof window.renderSafeMarkdown !== 'function') throw new Error('renderSafeMarkdown missing')
  }, { code: compiled })

  const results = await page.evaluate(() => {
    const render = window.renderSafeMarkdown
    const out = {}
    const basic = render('# 诊断结论\n\n**主因**是定位偏差。\n\n- 第 2 题\n- 第 5 题')
    out.basic = {
      hasH1: basic.includes('<h1'),
      hasStrong: basic.includes('<strong>主因</strong>'),
      hasList: basic.includes('<li>第 2 题</li>'),
    }
    const scriptInput = render('前文 <script>alert(1)</script> **加粗** <img src="https://evil.example/x" onerror="alert(1)">')
    out.script = {
      noScriptTag: !scriptInput.includes('<script'),
      noImgTag: !scriptInput.includes('<img'),
      keepsText: scriptInput.includes('前文') && scriptInput.includes('<strong>加粗</strong>'),
    }
    const jsLink = render('[点我](javascript:alert(1))')
    out.jsLink = { noJsHref: !/href\s*=\s*["']?javascript/i.test(jsLink) }
    const external = render('[官方说明](https://example.org/guide)')
    out.external = {
      blank: /target="_blank"/.test(external),
      noopener: /rel="noopener noreferrer"/.test(external),
      hrefKept: external.includes('https://example.org/guide'),
    }
    out.empty = { blankForEmpty: render('') === '', blankForNull: render(null) === '' }
    const cjk = render('长段落：'.repeat(40) + '\n\n**结论**')
    out.cjk = { readable: cjk.includes('长段落：') && cjk.includes('<strong>结论</strong>') }
    const table = render('| 项目 | 数量 |\n| --- | --- |\n| 定位 | 3 |')
    out.table = { rendered: table.includes('<table') && table.includes('定位') }
    return out
  })

  assert.equal(results.basic.hasH1, true)
  assert.equal(results.basic.hasStrong, true)
  assert.equal(results.basic.hasList, true)
  assert.equal(results.script.noScriptTag, true)
  assert.equal(results.script.noImgTag, true)
  assert.equal(results.script.keepsText, true)
  assert.equal(results.jsLink.noJsHref, true)
  assert.equal(results.external.blank, true)
  assert.equal(results.external.noopener, true)
  assert.equal(results.external.hrefKept, true)
  assert.equal(results.empty.blankForEmpty, true)
  assert.equal(results.empty.blankForNull, true)
  assert.equal(results.cjk.readable, true)
  assert.equal(results.table.rendered, true)
  console.log('PASS safe-markdown rendering and sanitization')
} finally {
  await browser.close()
}
