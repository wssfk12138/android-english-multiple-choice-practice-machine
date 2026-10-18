import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
const root=fileURLToPath(new URL('../../',import.meta.url))
function fixture() {
  const orient = () => { document.documentElement.dataset.orientation = innerWidth > innerHeight ? 'landscape' : 'portrait' }
  orient(); window.addEventListener('resize', orient)
  globalThis.calls = []; globalThis.revision = 1; globalThis.count = 1203
  globalThis.failCatalog = false; globalThis.failDetail = 0; globalThis.missing = 0; globalThis.delayDetail = 0
  globalThis.failSave = false; globalThis.longContent = true; globalThis.extra = false
  globalThis.detailOverride = null; globalThis.mismatch = 0
  globalThis.reviewFields = { review_count: 5, next_review_at: '2026-10-10', study_status: 'learning', review_stage: 2 }
  const originalSet = Storage.prototype.setItem
  Storage.prototype.setItem = function(key, value) {
    if (key === 'daily-study:v1' && globalThis.failSave) throw Error('synthetic quota')
    return originalSet.call(this, key, value)
  }
  const member = id => ({ id, term: id === 1203 ? 'pneumonoultramicroscopicsilicovolcanoconiosis' : 'evidence' + id, identity: 'stable-' + id })
  const detail = id => ({ ...member(id), daily_study_identity: 'stable-' + id, ...globalThis.reviewFields,
    translation_status: 'ready', common_meaning: '证据；根据 · revision ' + globalThis.revision,
    phonetic: '/ˈevɪdəns/', part_of_speech: 'n.', contextual_meaning: '用于判断与推理的事实依据',
    latest_sentence: 'Researchers compare evidence and revise their explanations when new observations become available. '.repeat(globalThis.longContent ? 12 : 1),
    occurrences: [{ year: 2026, unit_title: 'Synthetic reading' }],
    generated_example: globalThis.extra ? { sentence: 'An existing model example.', translation: '已有模型例句。' } : undefined,
    synonyms: [{ word: 'proof', note: '强调可以证明结论的依据。' }],
    morphology: { currentForm: '名词', forms: [{ word: 'evident', label: '形容词' }] },
    memory_hint: '结合上下文记忆。', note: '已有笔记。\n'.repeat(96),
    ...globalThis.detailOverride,
  })
  globalThis.mockApi = async (path, body) => {
    globalThis.calls.push({ path, write: body !== undefined })
    if (path.startsWith('/vocabulary/daily-study/catalog')) {
      if (globalThis.failCatalog) throw Error('synthetic database error')
      const status = new URLSearchParams(path.split('?')[1] || '').get('status') || 'all'
      return { scope_key: 'synthetic-db:' + status, revision: 'v2:' + globalThis.revision, items: Array.from({ length: globalThis.count }, (_, i) => member(i + 1)) }
    }
    if (path.startsWith('/vocabulary/daily-study/status')) return { scope_key: 'synthetic-db:' + (new URLSearchParams(path.split('?')[1] || '').get('status') || 'all'), revision: 'v2:' + globalThis.revision }
    const match = path.match(/^\/vocabulary\/(\d+)$/)
    if (match) {
      const id = Number(match[1])
      if (id === globalThis.delayDetail) await new Promise(resolve => globalThis.releaseDetail = resolve)
      if (id === globalThis.failDetail) throw Error('synthetic detail error')
      if (id === globalThis.missing) throw Object.assign(Error('synthetic deleted'), { status: 404 })
      globalThis.detailReadRevision = globalThis.revision
      return { ...detail(id), daily_study_identity: id === globalThis.mismatch ? 'reused-id' : 'stable-' + id }
    }
    if (path.startsWith('/vocabulary?')) {
      const query = new URLSearchParams(path.split('?')[1]), offset = Number(query.get('offset') || 0)
      return { items: Array.from({ length: Math.min(Number(query.get('limit') || 20), Math.max(0, 1203 - offset)) }, (_, i) => detail(offset + i + 1)),
        revision: 'v2:' + globalThis.revision, counts: { total: 1203, frequent: 0, review: 1203, pending: 0, mastered: 0 } }
    }
    if (path.startsWith('/vocabulary/status')) return { revision: 'v2:' + globalThis.revision, counts: { total: 1203, review: 1203 } }
    if (path === '/vocabulary/translation-runs' || path === '/vocabulary/enrichment-runs') return { workerStarted: false }
    if (path.endsWith('-status')) return { queued: 0, translating: 0, inflight: 0, failed: 0, paused: true }
    throw Error('Unexpected synthetic API: ' + path)
  }
}
const entry = '(' + fixture.toString() + ')();' +
  'import {createApp,h} from "vue";import {createRouter,createMemoryHistory,RouterView} from "vue-router";' +
  'import Vocabulary from "/src/views/VocabularyView.vue";import Study from "/src/views/DailyStudyView.vue";' +
  'import "/src/styles.css";import "/src/study-theme.css";' +
  'const router=createRouter({history:createMemoryHistory(),routes:[{path:"/vocabulary",component:Vocabulary},{path:"/vocabulary/daily-study",component:Study}]});' +
  'globalThis.router=router;await router.push("/vocabulary");await router.isReady();createApp({render:()=>h(RouterView)}).use(router).mount("#app");'
// Keep this fixture's optimized modules separate from other browser-test plugins.
export const server = await createServer({ configFile: false, root, cacheDir: join(root, 'node_modules/.vite-daily-study-browser'), optimizeDeps: { noDiscovery: true, include: ['vue', 'vue-router', 'lucide-vue-next'] }, plugins: [{
  name: 'isolated-daily-study', enforce: 'pre',
  resolveId(id) {
    if (id === 'virtual:daily-study') return id
    if (id === '../api' || id === './api') return 'virtual:study-api'
    if (id.endsWith('/platform/runtime')) return 'virtual:study-runtime'
    if (id.endsWith('/platform/dialogs')) return 'virtual:study-dialogs'
  },
  load(id) {
    if (id === 'virtual:daily-study') return entry
    if (id === 'virtual:study-api') return 'export const get=p=>globalThis.mockApi(p);export const post=(p,b)=>globalThis.mockApi(p,b);export const put=post;export const del=p=>post(p,{});'
    if (id === 'virtual:study-runtime') return 'export const platformRuntime={isAndroid:true};'
    if (id === 'virtual:study-dialogs') return 'export const confirmDialog=async()=>false;'
  },
  configureServer(server) { server.middlewares.use((req, res, next) => {
    if (req.url !== '/__daily-study') return next()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html data-platform="android"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><script type="module" src="/@id/virtual:daily-study"></script></body></html>')
  }) },
}, vue()], server: { host: '127.0.0.1', port: 0 } })
