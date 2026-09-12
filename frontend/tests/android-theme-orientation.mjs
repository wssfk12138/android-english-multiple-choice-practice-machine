import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parse } = createRequire(require.resolve('vite'))('postcss')
const css = parse(await readFile(new URL('../src/study-theme.css', import.meta.url), 'utf8'))
const android = 'html:root'
const palette = new Map()
css.walkRules(rule => {
  if (![android, android + '.dark', android + ' body', android + '.dark body'].includes(rule.selector)) return
  rule.walkDecls(decl => {
    const isTheme = /^--(?:bg|surface|ink|muted|line|primary|lavender|apricot|blue|danger|success|focus|shadow)/.test(decl.prop)
      || decl.prop === 'color-scheme' || decl.prop === 'background-image'
    if (!isTheme) return
    for (let parent = rule.parent; parent; parent = parent.parent) {
      assert.notEqual(parent.type, 'atrule', rule.selector + ' ' + decl.prop + ' must not depend on viewport')
    }
    palette.set(rule.selector + ' ' + decl.prop, decl.value)
  })
})
assert.equal(palette.get(android + ' --bg'), '#edf2f6')
assert.equal(palette.get(android + '.dark --bg'), '#191b20')
assert.equal(palette.get(android + '.dark --surface-solid'), '#25282f')
assert.match(palette.get(android + ' body background-image'), /study-coast-morning-v1/)
assert.match(palette.get(android + '.dark body background-image'), /study-coast-dusk-v1/)
for (const name of ['morning', 'dusk']) {
  const bytes = await readFile(new URL('../public/assets/backgrounds/study-coast-' + name + '-v1.webp', import.meta.url))
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP')
  assert.ok(bytes.length > 10000)
}
const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
assert.ok(app.includes("dark.value = !document.documentElement.classList.contains('dark')"))
console.log('Android shared light/dark orientation theme tests passed')
