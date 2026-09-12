import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const server = await createServer({ root, configFile: false, plugins: [vue()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto(server.resolvedUrls.local[0])
  const results = await page.evaluate(async () => {
    const { default: JSZip } = await import('/node_modules/.vite/deps/jszip.js')
    const agent = await import('/src/services/documentAgent.ts')
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Original sentence.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table text</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')
    zip.file('word/media/image.png', new Uint8Array([1, 2, 3, 4]))
    const bytes = await zip.generateAsync({ type: 'arraybuffer' })
    const doc = await agent.createDocument(new File([bytes], 'fixture.docx'))
    const progress = []
    const calls = [
      { tool: 'read_document', args: {} },
      { tool: 'replace_paragraph', args: { index: 0, expected: 'WRONG', text: 'Must not apply' } },
      { tool: 'replace_paragraph', args: { index: 0, expected: 'Original sentence.', text: 'Corrected & improved.' } },
      { tool: 'replace_paragraph', args: { index: 1, expected: 'Table text', text: 'Table edited' } },
      { tool: 'export_document', args: {} },
      { answer: 'Done' },
    ]
    let sawError = false
    const answer = await agent.runDocumentAgent(doc, [], async thread => {
      if (thread.some(m => m.content.includes('原文不匹配'))) sawError = true
      return JSON.stringify(calls.shift())
    }, e => progress.push(e), new AbortController().signal)
    const current = await agent.executeDocumentTool(doc, 'read_document', {})
    const original = await JSZip.loadAsync(doc.source)
    const output = await JSZip.loadAsync(doc.working)
    let unknownRejected = false
    try { await agent.executeDocumentTool(doc, 'shell', { command: 'anything' }) } catch { unknownRejected = true }
    const abort = new AbortController()
    let lateRejected = false
    try { await agent.runDocumentAgent(doc, [], async () => { abort.abort(); return JSON.stringify({ tool: 'replace_paragraph', args: { index: 0, expected: 'Corrected & improved.', text: 'Late edit' } }) }, () => {}, abort.signal) } catch { lateRejected = true }
    const { reactive } = await import('/node_modules/.vite/deps/vue.js')
    await agent.documentStorage(123, reactive(doc))
    const restored = await agent.documentStorage(123)
    await agent.documentStorage(123, null)
    return { answer, revision: doc.revision, exported: doc.exported, sawError, unknownRejected, lateRejected, paragraphs: current.paragraphs, original: await original.file('word/document.xml').async('string'), asset: Array.from(await output.file('word/media/image.png').async('uint8array')), restored: restored.revision, deleted: await agent.documentStorage(123), progress }
  })
  assert.equal(results.answer, 'Done')
  assert.equal(results.revision, 2)
  assert.equal(results.exported, 2)
  assert.ok(results.sawError && results.unknownRejected && results.lateRejected)
  assert.equal(results.paragraphs[0].text, 'Corrected & improved.')
  assert.equal(results.paragraphs[1].text, 'Table edited')
  assert.ok(results.original.includes('Original sentence.'))
  assert.deepEqual(results.asset, [1, 2, 3, 4])
  assert.equal(results.restored, 2)
  assert.equal(results.deleted, null)
  // Mount the real component twice around an unresolved request, as RouterView does.
  const navigation = await page.evaluate(async () => {
    const { createApp, h } = await import('/node_modules/.vite/deps/vue.js')
    const { createRouter, createMemoryHistory } = await import('/node_modules/.vite/deps/vue-router.js')
    const { default: Assistant } = await import('/src/components/AiAssistant.vue')
    const { assistantSession: state } = await import('/src/services/assistantSession.ts')
    document.documentElement.dataset.platform = 'web'
    let finish
    window.fetch = async (url) => {
      if (url.endsWith('/ai/chat')) return new Promise(resolve => { finish = () => resolve(new Response(JSON.stringify({ conversation_id: 77, message: { role: 'assistant', content: 'Delayed answer' } }))) })
      const body = url.endsWith('/ai/selector-models') ? { models: [{ profile_id: 1, profile_name: 'Test', model_id: 'test', display_name: 'Test' }] } : []
      return new Response(JSON.stringify(body))
    }
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: Assistant }] })
    const host = document.createElement('div'); document.body.append(host)
    const mount = async () => { const app = createApp({ render: () => h(Assistant) }); app.use(router); app.mount(host); await new Promise(r => setTimeout(r, 80)); return app }
    let app = await mount()
    const input = host.querySelector('textarea'); input.value = 'Delayed question'; input.dispatchEvent(new Event('input', { bubbles: true }))
    host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 80))
    const signal = state.controller.signal
    app.unmount()
    const retained = state.loading.value && state.messages.value[0].content === 'Delayed question' && !signal.aborted
    app = await mount()
    finish()
    await new Promise(r => setTimeout(r, 100))
    const visible = host.textContent.includes('Delayed answer') && state.conversationId.value === 77
    state.input.value = 'Unsent draft'
    app.unmount(); app = await mount()
    const draft = host.querySelector('textarea').value
    app.unmount()
    return { retained, visible, draft }
  })
  assert.ok(navigation.retained && navigation.visible)
  assert.equal(navigation.draft, 'Unsent draft')
  console.log('PASS: real DOCX tool loop, stale text rejection, asset/source preservation, cancellation, durable document storage, pending navigation and draft restoration')
} finally { await browser.close(); await server.close() }
