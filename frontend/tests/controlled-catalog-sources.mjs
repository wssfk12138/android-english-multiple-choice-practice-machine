import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const official = 'https://official.example/catalog.json'
const mirror = 'https://mirror.example/catalog.json'
const thirdParty = 'https://third-party.example/catalog.json'
const publishedOfficial = 'https://raw.githubusercontent.com/wssfk12138/english-question-banks/main/question-bank-catalog.json'
const oldOfficial = 'https://github.com/wssfk12138/english-multiple-choice-practice-machine/releases/download/question-banks-v1.2.0/question-bank-catalog.json'
const legacyOfficial = 'https://github.com/wssfk12138/english-multiple-choice-practice-machine/releases/latest/download/question-bank-catalog.json'
const catalog = { catalogVersion: 1, packages: [] }

test('default public proxies continue through catalog failures in order', async () => {
  const last = 'https://gh-proxy.com/' + publishedOfficial
  const f = fixture({ respond: url => ({ status: url === last ? 200 : 503, url, data: catalog }) })
  assert.equal((await f.api.checkQuestionBankCatalog()).sourceUrl, last)
  assert.deepEqual(f.requests, [publishedOfficial, 'https://ghfast.top/' + publishedOfficial, last])
})

for (const importFails of [false, true]) {
  test('package fallback preserves verification and imports only once; importFails=' + importFails, async () => {
    const item = {
      packageId: 'sample', contentVersion: '1.0.0', title: 'Sample', fileName: 'bank.esq',
      downloadUrl: 'https://github.com/wssfk12138/english-question-banks/releases/download/question-banks-2026-09-20/bank.esq',
      sha256: 'a'.repeat(64), size: 1234, years: [2026], license: 'redistributable',
    }
    const downloads = [], cleanup = []
    let imports = 0
    const f = fixture({
      respond: url => ({ status: 200, url, data: { catalogVersion: 1, packages: [item] } }),
      native: {
        async downloadQuestionBank(options) {
          downloads.push(options)
          if (downloads.length < 3) throw new Error('transport unavailable')
          return { packageData: '{}', cleanupToken: 'verified-package' }
        },
        async resolveQuestionBankAssets(options) { cleanup.push(options) },
      },
      importer: { async createEsqImportFromNativePackage() {
        imports += 1
        if (importFails) throw new Error('import failed')
        return { id: 1 }
      } },
    })
    const operation = f.api.downloadQuestionBankPackage({ package_id: 'sample', content_version: '1.0.0', new_profile_name: 'Sample' })
    if (importFails) await assert.rejects(operation, /import failed/)
    else assert.equal((await operation).id, 1)
    assert.deepEqual(downloads.map(item => item.url), [item.downloadUrl, 'https://ghfast.top/' + item.downloadUrl, 'https://gh-proxy.com/' + item.downloadUrl])
    assert.ok(downloads.every(options => options.sha256 === item.sha256 && options.expectedSize === item.size && options.fileName === item.fileName))
    assert.equal(imports, 1)
    assert.equal(cleanup.length, 1)
    assert.equal(cleanup[0].delete, importFails)
  })
}

function fixture({ stored, env = {}, respond, native = {}, importer = {} } = {}) {
  const settings = new Map(stored === undefined ? [] : [['question_bank_catalog_url', stored]])
  const requests = []
  const cache = new Map()
  const database = {
    async row(_sql, [key]) { return settings.has(key) ? { value: settings.get(key) } : undefined },
    async run(sql, [key, value]) {
      if (!sql.includes('INSERT OR IGNORE') || !settings.has(key)) settings.set(key, value)
    },
  }
  const capacitor = {
    registerPlugin: () => native,
    CapacitorHttp: {
      async get({ url }) {
        requests.push(url)
        return respond ? respond(url) : { status: 200, url, data: catalog }
      },
    },
  }
  function load(path) {
    if (cache.has(path)) return cache.get(path)
    const exports = {}
    cache.set(path, exports)
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      transformers: { before: [context => {
        const visit = node => {
          if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression)
            && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === 'env') {
            return context.factory.createIdentifier('__buildEnv')
          }
          return ts.visitEachChild(node, visit, context)
        }
        return node => ts.visitNode(node, visit)
      }] },
    }).outputText
    vm.runInNewContext(code, {
      exports, __buildEnv: env, URL, TextEncoder, Error,
      require(name) {
        if (name === '@capacitor/app') return { App: {} }
        if (name === '@capacitor/core') return capacitor
        if (name === './database') return database
        if (name === './question-bank') return importer
        return load(new URL(name.endsWith('.ts') ? name : name + '.ts', path))
      },
    }, { filename: path.pathname })
    return exports
  }
  return { api: load(new URL('../src/platform/android/app-update.ts', import.meta.url)), settings, requests }
}

test('build official source falls back without persisting itself as a user override', async () => {
  const f = fixture({
    env: { VITE_QUESTION_BANK_CATALOG_URL: official, VITE_QUESTION_BANK_CATALOG_MIRROR_URLS: mirror },
    respond: url => {
      if (url === official) throw new Error('connection unavailable')
      return { status: 200, url, data: catalog }
    },
  })
  assert.equal((await f.api.readUpdateSettings()).question_bank_catalog_url, '')
  assert.equal(f.settings.has('question_bank_catalog_url'), false)
  const result = await f.api.checkQuestionBankCatalog()
  assert.equal(result.sourceUrl, mirror)
  assert.equal(result.checkedSources, 2)
  assert.deepEqual(f.requests, [official, mirror])
})

for (const stored of [publishedOfficial, oldOfficial, legacyOfficial]) {
  test('stored official alias joins the fallback chain without rewriting its setting: ' + stored, async () => {
    const f = fixture({
      stored,
      env: { VITE_QUESTION_BANK_CATALOG_MIRROR_URLS: mirror },
      respond: url => {
        if (url !== mirror) throw new Error('official connection unavailable')
        return { status: 200, url, data: catalog }
      },
    })
    assert.equal((await f.api.readUpdateSettings()).question_bank_catalog_url, stored)
    const result = await f.api.checkQuestionBankCatalog()
    assert.equal(result.sourceUrl, mirror)
    assert.equal(result.checkedSources, 2)
    assert.deepEqual(f.requests, [publishedOfficial, mirror])
    assert.equal(f.settings.get('question_bank_catalog_url'), stored)
    assert.equal((await f.api.readUpdateSettings()).question_bank_catalog_url, stored)
  })
}

test('an exact current build official URL joins its configured mirror chain without changing stored data', async () => {
  const f = fixture({
    stored: official,
    env: { VITE_QUESTION_BANK_CATALOG_URL: official, VITE_QUESTION_BANK_CATALOG_MIRROR_URLS: mirror },
    respond: url => {
      if (url === official) throw new Error('official connection unavailable')
      return { status: 200, url, data: catalog }
    },
  })
  assert.equal((await f.api.checkQuestionBankCatalog()).sourceUrl, mirror)
  assert.deepEqual(f.requests, [official, mirror])
  assert.equal(f.settings.get('question_bank_catalog_url'), official)
})

test('a release pin distinct from the current build official source remains independent', async () => {
  const f = fixture({
    stored: publishedOfficial,
    env: { VITE_QUESTION_BANK_CATALOG_URL: official, VITE_QUESTION_BANK_CATALOG_MIRROR_URLS: mirror },
    respond: url => ({ status: url === publishedOfficial ? 404 : 200, url, data: catalog }),
  })
  await assert.rejects(f.api.checkQuestionBankCatalog(), error => error.code === 'HTTP_404')
  assert.deepEqual(f.requests, [publishedOfficial])
  assert.equal(f.settings.get('question_bank_catalog_url'), publishedOfficial)
})

for (const stored of [
  'https://github.com.example.invalid/wssfk12138/english-multiple-choice-practice-machine/releases/latest/download/question-bank-catalog.json',
  'https://github.com/wssfk12138/english-multiple-choice-practice-machine/releases/download/question-banks-v1.1.0/question-bank-catalog.json',
  'https://historical-build.example/catalog.json',
  publishedOfficial + '?pinned=1',
]) {
  test('a similar host, pinned release or unknown historic build remains an independent override: ' + stored, async () => {
    const f = fixture({
      stored,
      env: { VITE_QUESTION_BANK_CATALOG_MIRROR_URLS: mirror },
      respond: url => ({ status: url === stored ? 404 : 200, url, data: catalog }),
    })
    await assert.rejects(f.api.checkQuestionBankCatalog(), error => error.code === 'HTTP_404')
    assert.deepEqual(f.requests, [stored])
    assert.equal(f.settings.get('question_bank_catalog_url'), stored)
  })
}

test('explicit third-party source never falls back, while clearing it selects official sources', async () => {
  const f = fixture({
    stored: thirdParty,
    env: { VITE_QUESTION_BANK_CATALOG_URL: official, VITE_QUESTION_BANK_CATALOG_MIRROR_URLS: mirror },
    respond: url => ({ status: url === thirdParty ? 404 : 200, url, data: catalog }),
  })
  await assert.rejects(f.api.checkQuestionBankCatalog(), error => error.code === 'HTTP_404')
  assert.deepEqual(f.requests, [thirdParty])
  await f.api.updateSettings({ question_bank_catalog_url: '' })
  assert.equal((await f.api.checkQuestionBankCatalog()).sourceUrl, official)
  assert.deepEqual(f.requests, [thirdParty, official])
})

test('deduplicated configured mirrors preserve order and report mixed failures', async () => {
  const f = fixture({
    env: {
      VITE_QUESTION_BANK_CATALOG_URL: official,
      VITE_QUESTION_BANK_CATALOG_MIRROR_URLS: `${mirror},${mirror}\nhttps://mirror-two.example/catalog.json`,
    },
    respond: url => {
      if (url === official) throw new Error('request timed out')
      return { status: 404, url, data: {} }
    },
  })
  await assert.rejects(f.api.checkQuestionBankCatalog(), error => error.code === 'REMOTE_SOURCES_FAILED')
  assert.deepEqual(f.requests, [official, mirror, 'https://mirror-two.example/catalog.json'])
})

test('HTTP downgrade redirects and malformed hashes are rejected before exposing packages', async () => {
  const f = fixture({
    env: { VITE_QUESTION_BANK_CATALOG_URL: official, VITE_QUESTION_BANK_CATALOG_MIRROR_URLS: mirror },
    respond: url => url === official
      ? { status: 200, url: 'http://official.example/catalog.json', data: catalog }
      : { status: 200, url, data: { catalogVersion: 1, packages: [{
        packageId: 'test-bank', contentVersion: '1.0.0', title: 'Test bank', fileName: 'test.esq',
        downloadUrl: 'https://mirror.example/test.esq', sha256: 'invalid', size: 1,
        license: 'test fixture', years: [2026],
      }] } },
  })
  await assert.rejects(f.api.checkQuestionBankCatalog(), error => error.code === 'REMOTE_JSON_SCHEMA')
  assert.deepEqual(f.requests, [official, mirror])
})

test('default public source uses the dedicated bank catalog', async () => {
  const f = fixture()
  assert.equal((await f.api.checkQuestionBankCatalog()).configured, true)
  assert.deepEqual(f.requests, [
    publishedOfficial,
  ])
  assert.equal(f.settings.has('question_bank_catalog_url'), false)
})
