import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parse } = createRequire(require.resolve('vite'))('postcss')
const theme = parse(await readFile(new URL('../src/study-theme.css', import.meta.url), 'utf8'))
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.ok(main.indexOf("import './study-theme.css'") > main.indexOf("import './styles.css'"))
const dashboard = await readFile(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8')
assert.match(dashboard, /<StudyTodos/)
assert.doesNotMatch(dashboard, /class="page-head study-hero"/)
const todos = await readFile(new URL('../src/components/StudyTodos.vue', import.meta.url), 'utf8')
assert.match(todos, /var\(--surface\)/)
assert.match(todos, /var\(--ink\)/)

for (const [selector, rgb, asset] of [
  ['html:root .study-hero', '250,252,255', 'morning'],
  ['html:root.dark .study-hero', '37,40,47', 'dusk'],
]) {
  const rules = []
  theme.walkRules(selector, rule => rules.push(rule))
  assert.equal(rules.length, 1, selector + ' must override the legacy forest hero')
  assert.equal(rules[0].parent.type, 'root', 'Theme must apply in either orientation')
  const declarations = new Map(rules[0].nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]))
  const background = declarations.get('background-image').replace(/\s/g, '')
  assert.ok(background.includes('rgba(' + rgb + ',.98)'))
  assert.ok(background.includes('rgba(' + rgb + ',.86)'))
  assert.ok(background.includes('rgba(' + rgb + ',.15)'))
  assert.ok(background.includes('/assets/backgrounds/study-coast-' + asset + '-v1.webp'))
  assert.ok(!background.includes('forest-study-hero'))
}
console.log('Android dashboard light/dark theme regression passed')
