import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { after, test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const databaseSource = ts.createSourceFile('database.ts', read('platform/android/database.ts'), ts.ScriptTarget.Latest, true)
const schema = databaseSource.statements.flatMap(statement => ts.isVariableStatement(statement)
  ? [...statement.declarationList.declarations] : [])
  .find(declaration => declaration.name.getText(databaseSource) === 'SCHEMA')?.initializer.text
assert.ok(schema, 'Use the production vocabulary schema')
const { descriptor } = parse(read('views/VocabularyView.vue'))
const componentSource = compile(compileScript(descriptor, {
  id: 'vocabulary-manual-edit', inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
}).content)
const vocabularyContext = { exports: {} }
vm.runInNewContext(compile(read('vocabulary-context.ts')), vocabularyContext)

// The host stays in memory while Vue runs the production render and v-model hooks.
const domGlobals = ['Document', 'ShadowRoot'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
for (const [name] of domGlobals) globalThis[name] = class {}
after(() => {
  for (const [name, descriptor] of domGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
})
function node(tag, text = '') {
  return {
    tag, text, children: [], parent: null, props: {}, listeners: {}, value: '',
    addEventListener(name, listener) { this.listeners[name] = listener },
    removeEventListener(name) { delete this.listeners[name] },
    getRootNode() { return this.parent ? this.parent.getRootNode() : this },
    dispatchEvent(event) { this.listeners[event.type]?.({ ...event, target: this }) },
  }
}
const renderer = vue.createRenderer({
  createElement: tag => node(tag), createText: text => node('#text', text),
  createComment: text => node('#comment', text),
  setText: (target, text) => { target.text = text },
  setElementText: (target, text) => { target.text = text; target.children = [] },
  parentNode: target => target.parent,
  nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1],
  patchProp: (target, key, _previous, value) => { target.props[key] = value },
  insert(target, parent, anchor = null) {
    if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1)
    target.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(target)
    else parent.children.splice(index, 0, target)
  },
  remove(target) {
    target.parent.children.splice(target.parent.children.indexOf(target), 1)
    target.parent = null
  },
})
const text = target => target.tag === '#comment' ? '' : target.text + target.children.map(text).join('')
const find = (root, predicate) => [root, ...root.children.flatMap(child => find(child, predicate))].filter(predicate)
const byClass = (root, name) => find(root, item => String(item.props.class || '').split(' ').includes(name))
const button = (root, label) => find(root, item => item.tag === 'button' && text(item) === label)[0]
const settle = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve()
    await vue.nextTick()
    await new Promise(resolve => setImmediate(resolve))
  }
}
const editLabel = '\u7f16\u8f91'
const saveLabel = '\u4fdd\u5b58\u4fee\u6539'
const cancelLabel = '\u53d6\u6d88'
const manual = { phonetic: '/manual/', part_of_speech: 'noun', common_meaning: 'Synthetic meaning', note: 'Synthetic note <b>plain text</b>' }

function loadModule(path, modules) {
  const context = { exports: {}, require(name) {
    assert.ok(Object.hasOwn(modules, name), 'Unexpected production dependency: ' + name)
    return modules[name]
  } }
  vm.runInNewContext(compile(read('platform/android/' + path + '.ts')), context)
  return context.exports
}

async function fixture(orientation, initialStatus, { existing = {}, second = false } = {}) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(schema)
  // Runtime migration adds the LAN occurrence projection columns.
  sqlite.exec('ALTER TABLE vocabulary_occurrences ADD COLUMN sync_id TEXT; ALTER TABLE vocabulary_occurrences ADD COLUMN updated_at TEXT')
  sqlite.prepare('INSERT INTO vocabulary_entries(id, term, normalized_term, translation_status) VALUES (1, ?, ?, ?)')
    .run('synthetic', 'synthetic', initialStatus)
  if (second) sqlite.prepare('INSERT INTO vocabulary_entries(id, term, normalized_term, translation_status, encounter_count) VALUES (2, ?, ?, ?, 3)')
    .run('alternate', 'alternate', 'ready')
  for (const [field, value] of Object.entries(existing)) {
    assert.ok([...Object.keys(manual), 'user_edited'].includes(field))
    sqlite.prepare('UPDATE vocabulary_entries SET ' + field + ' = ? WHERE id = 1').run(value)
  }
  const database = {
    rows: async (sql, values = []) => sqlite.prepare(sql).all(...values),
    row: async (sql, values = []) => sqlite.prepare(sql).get(...values),
    run: async (sql, values = []) => sqlite.prepare(sql).run(...values),
  }
  class LocalApiError extends Error { constructor(status, message) { super(message); this.status = status } }
  const errors = { LocalApiError }
  const vocabulary = loadModule('vocabulary', {
    './database': database,
    './errors': errors,
    './study-todos': { vocabularyProfileCondition: '? = 1' },
    './question-bank-profiles': { activeQuestionBankProfileId: async () => 1 },
    '../../vocabulary-context': vocabularyContext.exports,
    './vocabulary-enrichment-runner': { queueVocabularyEnrichment: async () => {} },
  })
  const ai = loadModule('ai', {
    '../../services/vocabularyTranslationConfig': { loadVocabularyEnrichment: () => true },
    './database': database,
    './errors': errors,
    './model-key-store': {},
    './vocabulary-enrichment-fields': {},
    './native-http': {},
    './ai-adapters': {},
    '../../vocabulary-context': {
      projectVocabulary: (entry) => entry,
      vocabularyEnhancements: (entry) => entry,
      validVocabularyEnhancements: () => true,
      vocabularyWriteGuard: () => ({ sql: '1 = 1', values: [] }),
    },
  })
  const runner = loadModule('vocabulary-translation-runner', {
    './database': database,
    './ai': ai,
    './vocabulary': vocabulary,
    './vocabulary-enrichment-runner': { startVocabularyEnrichmentWorker: async () => {} },
  })
  const writes = []
  const readErrors = []
  const api = {
    async get(path) {
      const url = new URL(path, 'https://synthetic.invalid')
      if (url.pathname === '/vocabulary') {
        try { return await vocabulary.listVocabulary(url.searchParams) }
        catch (error) { readErrors.push(error); throw error }
      }
      return vocabulary.serializeEntry(Number(url.pathname.split('/').at(-1)))
    },
    async post(path) { assert.equal(path, '/vocabulary/translation-runs'); return { workerStarted: false } },
    async put(path, body) {
      writes.push({ path, body: { ...body } })
      return vocabulary.updateVocabulary(Number(path.split('/').at(-1)), body)
    },
    async del() { assert.fail('Deletion is outside this test') },
  }
  const context = {
    exports: {}, requestAnimationFrame: callback => setTimeout(callback, 0), document: { querySelector:()=>null, documentElement: { dataset: { platform: 'android', orientation } }, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    setTimeout, clearTimeout,
    localStorage: { getItem: () => null },
    window: { setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, removeEventListener() {} },
    require(name) {
      if (name === 'vue') return vue
      if (name === '../composables/useAndroidLandscape') return { useAndroidLandscape: () => vue.ref(orientation === 'landscape') }
      if (name === 'vue-router') return { useRoute: () => ({ query: {} }) }
      if (name === 'lucide-vue-next') {
        const icon = name => ({ name, setup() { return () => vue.h('span', { 'data-icon': name }) } })
        return Object.fromEntries(['BookOpen', 'Check', 'ChevronDown', 'RefreshCw', 'Search', 'Star', 'Trash2'].map(name => [name, icon(name)]))
      }
      if (name === '../vocabulary-due-queue') return {
        reconcileDueQueue: (...args) => ({ version: 1, main: [], relearning: [], ordinarySinceRelearning: 0 }),
        orderedDueKeys: queue => [...(queue?.main || []), ...(queue?.relearning || [])],
        completeDueWord: (queue, key) => ({ ...queue, main: (queue?.main || []).filter(item => item !== key), relearning: (queue?.relearning || []).filter(item => item !== key) }),
        wordKey: word => word?.normalized_term || String(word?.term || '').toLowerCase(),
      }
      if (name === '../components/VocabularyTerm.vue') return { default: { props:['term'], setup:p=>()=>vue.h('span',p.term) } }
      if (name === '../components/VocabularyMemoryContent.vue') return { default: { props:['entry'], setup:p=>()=>vue.h('div',[p.entry.common_meaning,p.entry.contextual_meaning,p.entry.note]) } }
      if (name === '../components/VocabularyEnrichment.vue') return { default: {
        name: 'VocabularyEnrichmentStub',
        setup() { return () => vue.h('span', { class: 'vocabulary-enrichment-stub' }) },
      } }
      if (name === '../platform/runtime') return { platformRuntime: { isAndroid: false } }
      if (name === '../platform/dialogs') return { confirmDialog: async () => true }
      if (name === '../services/vocabularyDisplayConfig') return {
        loadVocabDisplayConfig: () => ({
          common_meaning: true, contextual: true, sentence: true, memory_hint: true,
          synonyms: true, antonyms: true, similar_forms: true, morphology: true,
        }),
      }
      if (name === '../services/vocabularySnapshots') return {loadVocabularyListSnapshot:()=>null,loadVocabularyReviewSnapshot:()=>null,saveVocabularyListSnapshot:()=>true,saveVocabularyReviewSnapshot:()=>true}
      assert.equal(name, '../api')
      return api
    },
  }
  vm.runInNewContext(componentSource, context)
  const root = node('root')
  const renderErrors = []
  function mount() {
    const app = renderer.createApp(context.exports.default)
    app.config.errorHandler = error => renderErrors.push(error)
    app.mount(root)
    return app
  }
  let app = mount()
  await settle()
  assert.equal(readErrors.length, 0, readErrors.map(String).join('\n'))
  assert.equal(renderErrors.length, 0, renderErrors.map(String).join('\n'))
  assert.ok(byClass(root, 'vocab-list-item').length, 'Vocabulary should load: ' + text(root))
  // 2026-09-12 起窄屏首次进入不再自动展开第一个词条，由用户显式点击；
  // 用例在这里代用户点击第一个词，后续场景语义不变。
  if (orientation === 'portrait') {
    const first = byClass(root, 'vocab-list-item')[0]
    first.props.onClick()
    await settle()
  }
  const detail = () => byClass(root, orientation === 'portrait' ? 'portrait-vocab-detail' : 'desktop-vocab-detail')[0]
  return {
    root, detail, sqlite, vocabulary, runner, writes, renderErrors,
    async click(target) { assert.ok(target, 'Expected an actionable production button'); await target.props.onClick(); await settle() },
    async fill(values) {
      const form = byClass(detail(), 'vocab-edit')[0]
      const fields = find(form, item => ['input', 'textarea'].includes(item.tag))
      assert.equal(fields.length, Object.keys(manual).length)
      for (const [index, key] of Object.keys(manual).entries()) {
        fields[index].value = values[key]
        fields[index].dispatchEvent({ type: 'input' })
      }
      await settle()
    },
    async reopen() {
      app.unmount()
      app = mount()
      await settle()
      // 窄屏重新进入页面后同样需要显式点击词条才会展开详情。
      if (orientation === 'portrait') {
        const first = byClass(root, 'vocab-list-item')[0]
        first.props.onClick()
        await settle()
      }
    },
    close() { app.unmount(); sqlite.close() },
  }
}

for (const orientation of ['portrait', 'landscape']) {
  for (const scenario of ['pending', 'failed', 'queued', 'translating', 'no-model', 'ready']) {
    test(orientation + ': ' + scenario + ' opens, saves and reopens manual content', async () => {
      const f = await fixture(orientation, scenario === 'no-model' ? 'queued' : scenario)
      try {
        if (scenario === 'no-model') {
          await f.runner.startVocabularyTranslationWorker()
          const failed = await f.vocabulary.serializeEntry(1)
          assert.equal(failed.translation_status, 'failed')
          assert.match(failed.translation_error, /\u8bf7\u5148\u914d\u7f6e/)
          await f.click(byClass(f.root, 'vocab-list-item')[0])
          if (orientation === 'portrait') await f.click(byClass(f.root, 'vocab-list-item')[0])
        }
        if (scenario !== 'ready') {
          assert.equal(byClass(f.detail(), 'vocab-pending-panel').length, 1)
          assert.equal(byClass(f.detail(), 'detail-section').length, 0, 'Unedited pending words keep only their status panel')
        }
        await f.click(button(f.detail(), editLabel))
        assert.equal(byClass(f.detail(), 'vocab-edit').length, 1, 'Editing must not require translation success')
        assert.equal(byClass(f.detail(), 'vocab-pending-panel').length, 0)
        await f.fill(manual)
        await f.click(button(f.detail(), saveLabel))
        assert.ok(f.detail(), 'Saving must retain the selected word in both layouts')
        assert.equal(f.writes.length, 1)
        const saved = await f.vocabulary.serializeEntry(1)
        for (const [key, value] of Object.entries(manual)) assert.equal(saved[key], value)
        assert.equal(saved.user_edited, 1)
        assert.equal(saved.translation_status, scenario === 'no-model' ? 'failed' : scenario, 'Manual saving must not claim a model translation succeeded')
        assert.ok(text(f.detail()).includes(manual.common_meaning), 'Saved meaning remains visible')
        assert.ok(text(f.detail()).includes(manual.note), 'Saved note remains visible as text')
        assert.equal(find(f.detail(), item => item.tag === 'b').length, 0, 'Manual content must not become HTML')
        await f.vocabulary.queueTranslations([1])
        assert.equal((await f.vocabulary.serializeEntry(1)).translation_status, saved.translation_status)
        await f.click(button(f.detail(), editLabel))
        const values = find(byClass(f.detail(), 'vocab-edit')[0], item => ['input', 'textarea'].includes(item.tag)).map(item => item.value)
        assert.deepEqual(values, Object.values(manual))
        await f.click(button(f.detail(), cancelLabel))
        assert.ok(text(f.detail()).includes(manual.note))
        await f.reopen()
        assert.ok(text(f.detail()).includes(manual.common_meaning), 'Saved content survives reopening the component')
        assert.ok(text(f.detail()).includes(manual.note))
        assert.deepEqual(f.renderErrors, [])
      } finally { f.close() }
    })
  }
  test(orientation + ': failed words with existing manual content can be browsed immediately', async () => {
    const f = await fixture(orientation, 'failed', { existing: { ...manual, user_edited: 1 } })
    try {
      assert.equal(byClass(f.detail(), 'vocab-pending-panel').length, 1)
      assert.ok(text(f.detail()).includes(manual.common_meaning))
      assert.ok(text(f.detail()).includes(manual.note))
      assert.ok(text(byClass(f.root, 'vocab-list-item')[0]).includes(manual.common_meaning))
      assert.deepEqual(f.renderErrors, [])
    } finally { f.close() }
  })
  test(orientation + ': an existing manual note is visible without a meaning', async () => {
    const f = await fixture(orientation, 'failed', { existing: { note: manual.note, user_edited: 1 } })
    try {
      assert.equal(byClass(f.detail(), 'vocab-pending-panel').length, 1)
      assert.ok(text(f.detail()).includes(manual.note))
      assert.deepEqual(f.renderErrors, [])
    } finally { f.close() }
  })
  test(orientation + ': saving empty content retains the status-only display', async () => {
    const f = await fixture(orientation, 'pending')
    try {
      await f.click(button(f.detail(), editLabel))
      await f.fill(Object.fromEntries(Object.keys(manual).map(key => [key, ''])))
      await f.click(button(f.detail(), saveLabel))
      const saved = await f.vocabulary.serializeEntry(1)
      assert.equal(saved.user_edited, 1)
      assert.equal(saved.translation_status, 'pending')
      assert.equal(byClass(f.detail(), 'vocab-pending-panel').length, 1)
      assert.equal(byClass(f.detail(), 'detail-section').length, 0)
      assert.equal(byClass(f.detail(), 'vocab-edit').length, 0)
      assert.deepEqual(f.renderErrors, [])
    } finally { f.close() }
  })
  test(orientation + ': saving a non-first word retains its selection', async () => {
    const f = await fixture(orientation, 'ready', { second: true })
    try {
      await f.click(byClass(f.root, 'vocab-list-item')[1])
      await f.click(button(f.detail(), editLabel))
      await f.fill(manual)
      await f.click(button(f.detail(), saveLabel))
      assert.equal(f.writes[0].path, '/vocabulary/1')
      assert.ok(text(f.detail()).includes(manual.note))
      assert.deepEqual(f.renderErrors, [])
    } finally { f.close() }
  })
}
