import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'
import { reactive, ref } from 'vue'

const source = await readFile(new URL('../src/views/AndroidSyncView.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const ast = ts.createSourceFile('view.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true)
const names = ['refreshLanSync', 'runLanSyncNow', 'saveLanSync']
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
assert.equal(functions.length, names.length)
const script = ts.transpileModule(functions.map(node => node.getText(ast)).join(String.fromCharCode(10)), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText

async function checkFeedback(code, name) {
  let resolveRequest
  let rejectRequest
  const request = () => new Promise((resolve, reject) => {
    resolveRequest = resolve
    rejectRequest = reject
  })
  const context = vm.createContext({
    busy: ref(''), error: ref(''), notice: ref('previous success'),
    scannedPairing: ref(), syncConnectionOpen: ref(false), DEFAULT_CATEGORIES: [],
    lanSync: reactive({ host: 'http://qa.invalid', passcode: '', auto: false, configured: true, runtime: {} }),
    post: request, put: request,
    get: async () => ({ host: 'http://qa.invalid', configured: true, runtime: {} }),
  })
  vm.runInContext(code, context)
  const failed = context[name]()
  assert.equal(context.notice.value, '', `${name} must clear stale success immediately`)
  assert.notEqual(context.busy.value, '')
  rejectRequest(new Error('QA timeout'))
  await failed
  assert.match(context.error.value, /QA timeout/)
  assert.equal(context.notice.value, '')
  assert.equal(context.busy.value, '')
  const retry = context[name]()
  assert.equal(context.error.value, '')
  assert.equal(context.notice.value, '')
  resolveRequest({ last_sync_at: '2026-09-05T10:00:00Z' })
  if (name === 'saveLanSync') {
    await new Promise(resolve => setImmediate(resolve))
    resolveRequest({ last_sync_at: '2026-09-05T10:00:00Z' })
  }
  await retry
  assert.equal(context.error.value, '')
  assert.notEqual(context.notice.value, '')
  assert.equal(context.busy.value, '')
}

for (const name of ['runLanSyncNow', 'saveLanSync']) {
  await checkFeedback(script, name)
  const withoutFix = script.replaceAll("notice.value = '';", '')
  assert.notEqual(withoutFix, script)
  await assert.rejects(checkFeedback(withoutFix, name), /must clear stale success immediately/)
}
console.log('LAN sync feedback: run/save failure, retry and pre-fix regression checks passed')
