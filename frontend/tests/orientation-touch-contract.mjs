import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const practice = readFileSync(new URL('../src/views/PracticeView.vue', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

assert.match(app, /dataset\.orientation = portrait \? 'portrait' : 'landscape'/)
assert.match(app, /addEventListener\('orientationchange', updateWindowMode/)
assert.match(app, /addEventListener\('resize', updateWindowMode/)
assert.match(practice, /setPointerCapture\(event\.pointerId\)/)
assert.match(practice, /releasePointerCapture\(event\.pointerId\)/)
assert.match(practice, /@pointercancel="finishPortraitPaneResize"/)
assert.match(practice, /aria-valuemin="25"/)
assert.match(practice, /aria-valuemax="75"/)
assert.match(styles, /\.portrait-pane-divider[\s\S]{0,600}touch-action:\s*none/)
console.log('orientation and touch contract tests passed')
