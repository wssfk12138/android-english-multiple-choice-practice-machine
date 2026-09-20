// 模型配置页首屏读取门禁：/ai/profiles 的配置清单本身就是一条全表读取（模型行已经
// 批量取回后在 JS 分桶），逐个配置再回查“这个配置还存在吗”是纯多余的跨桥。平板上
// 实测这条 `SELECT id FROM ai_profiles WHERE id = ?` 每次 63B，配置页每开一次就要按
// 配置数付一遍（3 个配置 = 30ms / 158ms 首屏）。这里用真实的 model-key-store 与 ai
// 模块配计数型桥桩，断言清单读取不再按配置数回查，同时单配置入口的存在性校验与
// 用户可见报错文案原样保留。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

function load(path, dependencies = {}) {
  const context = {
    exports: {},
    require: key => dependencies[key] ?? {},
    crypto: webcrypto, structuredClone, TextEncoder, URL, setTimeout, clearTimeout,
  }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/platform/' + path + '.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return context.exports
}

const profiles = [
  { id: 1, name: '甲', adapter: 'openai-chat', base_url: 'https://a.test/v1', enabled: 1, is_default: 1, has_models: 1 },
  { id: 2, name: '乙', adapter: 'openai-responses', base_url: 'https://b.test/v1', enabled: 1, is_default: 0, has_models: 0 },
  { id: 3, name: '丙', adapter: 'anthropic', base_url: 'https://c.test/v1', enabled: 0, is_default: 0, has_models: 0 },
]
const models = [
  { profile_id: 1, model_id: 'm-a', is_visible: 1, is_available: 1 },
  { profile_id: 3, model_id: 'm-b', is_visible: 0, is_available: 1 },
]
const identity = 'a'.repeat(64)
let vaultValue = JSON.stringify({
  version: 1,
  profiles: Object.fromEntries(profiles.map(profile => [profile.id, {
    keys: [{ id: identity, name: '默认密钥', value: 'synthetic-secret-' + profile.id }],
    selected: identity,
    suppressed: [],
  }])),
  suppressed: {},
})

const statements = []
const db = {
  row: async (sql, values = []) => {
    statements.push(sql)
    if (/FROM ai_profiles WHERE id = \?/i.test(sql)) {
      return profiles.some(profile => Number(profile.id) === Number(values[0])) ? { id: Number(values[0]) } : null
    }
    return null
  },
  rows: async (sql) => {
    statements.push(sql)
    if (/FROM ai_profiles p/i.test(sql)) return profiles
    if (/FROM ai_profile_models/i.test(sql)) return models
    return []
  },
  run: async () => ({ changes: 0 }),
  transaction: async operation => operation(),
}
const native = []
const secureStore = {
  get: async key => { native.push(['get', key]); return key === 'ai-named-keys-v1' ? vaultValue : null },
  set: async (key, value) => { native.push(['set', key]); if (key === 'ai-named-keys-v1') vaultValue = value },
  remove: async key => { native.push(['remove', key]) },
}
class LocalApiError extends Error { constructor(status, message) { super(message); this.status = status } }

const policy = load('model-keys')
const store = load('android/model-key-store', { '../secure-store': { secureStore }, '../model-keys': policy, './database': db })
const ai = load('android/ai', {
  './database': db,
  './model-key-store': store,
  './errors': { LocalApiError },
  './native-http': { nativeBytes: async () => ({ values: [] }), nativeJson: async () => ({}), nativeText: async () => '' },
  './ai-adapters': { adapterFor: () => ({}), normalizeAdapterId: value => value || 'openai-chat' },
  './vocabulary-enrichment-fields': { mergeVocabularyEnrichment: () => ({}) },
})

const mark = statements.length
const nativeMark = native.length
const listed = await ai.listProfiles()
const calls = statements.slice(mark)
const nativeCalls = native.slice(nativeMark)

assert.deepEqual([...listed].map(profile => profile.id), [1, 2, 3])
assert.deepEqual([...listed].map(profile => profile.has_api_key), [true, true, true], '配置清单必须仍然给出密钥摘要')
assert.deepEqual([...listed].map(profile => [...profile.models].map(model => model.model_id)), [['m-a'], [], ['m-b']], '模型分桶不得变化')
assert.equal(calls.filter(sql => /FROM ai_profiles WHERE id = \?/i.test(sql)).length, 0,
  '配置清单已经读回全部配置行，不得再按配置数逐个回查存在性')
assert.equal(nativeCalls.filter(([verb, key]) => verb === 'get' && key !== 'ai-named-keys-v1').length, 0,
  '清单读取不得为每个配置再读一次旧版单密钥条目')
assert.equal(nativeCalls.filter(([verb, key]) => verb === 'get' && key === 'ai-named-keys-v1').length, 1,
  '密钥库每个进程只允许跨一次原生桥')
assert.equal(calls.length, 2, `配置清单只允许两条语句（配置 + 模型），实际 ${calls.length} 条`)

// 反向控制：按 id 操作密钥的入口仍然必须校验这个配置真的存在，报错文案不变。
await assert.rejects(store.namedKeySummary(999), /API 配置不存在/)
await assert.rejects(store.editNamedKey(999, { action: 'select', identity: '' }), /API 配置不存在/)
assert.equal((await store.namedKeySummary(1)).keys.length, 1)
assert.equal(await store.selectedKey(1), 'synthetic-secret-1', '配置清单之外的密钥读取语义不得变化')

console.log('PASS model-config read path: profile list does not re-validate each profile, single-profile guard kept')
