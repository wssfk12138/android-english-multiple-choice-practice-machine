import { AUTH, baseIdentity, keyIdentity, mergeConflict, mergeKeys, type NamedKey } from '../model-keys'
import { loadKeys, migrateKeys, saveKeys, withKeys } from './model-key-store'
import { row, rows, run, transaction } from './database'
import { LanTransport } from './lan-transport'
import type { LanTlsIdentity } from './lan-transport'

type Profile = { name: string; adapter: string; base_url: string; default_model: string; temperature: number; max_tokens: number; reasoning_effort: string; system_prompt: string; keys: NamedKey[]; selected: string }
const fields = ['name', 'adapter', 'base_url', 'default_model', 'temperature', 'max_tokens', 'reasoning_effort', 'system_prompt'] as const
const list = () => rows<any>('SELECT * FROM ai_profiles ORDER BY id')

async function inventory() {
  const known: Record<string, string[]> = {}
  for (const profile of await list()) {
    const item = (await migrateKeys(profile.id)).profiles[profile.id]
    const url = baseIdentity(profile.base_url)
    const ids = [...new Set([...item.suppressed, ...item.keys.map(k => k.id)])]
    known[url] = known[url] ? known[url].filter(id => ids.includes(id)) : ids
  }
  for (const [url, ids] of Object.entries((await loadKeys()).suppressed)) known[url] = [...new Set([...(known[url] || []), ...ids])]
  return known
}

async function exported(known: Record<string, string[]>) {
  const result = []
  for (const profile of await list()) {
    const item = (await migrateKeys(profile.id)).profiles[profile.id]
    result.push({ ...Object.fromEntries(fields.map(field => [field, profile[field]])),
      keys: item.keys.filter(key => !(known[baseIdentity(profile.base_url)] || []).includes(key.id)), selected: item.selected })
  }
  return result
}

async function exportedAll() {
  const result = []
  for (const profile of await list()) {
    const item = (await migrateKeys(profile.id)).profiles[profile.id]
    const models = await rows<any>('SELECT model_id, display_name, owned_by, provider, is_visible, is_available FROM ai_profile_models WHERE profile_id = ? ORDER BY model_id', [profile.id])
    result.push({ ...Object.fromEntries(fields.map(field => [field, profile[field]])),
      enabled: Boolean(profile.enabled), is_default: Boolean(profile.is_default),
      models: models.map(model => ({ ...model, is_visible: Boolean(model.is_visible), is_available: Boolean(model.is_available) })),
      keys: item.keys, selected: item.selected })
  }
  return result
}

export async function validateProfiles(input: unknown): Promise<Profile[]> {
  const invalid = () => { throw new Error('模型同步数据无效') }
  if (!Array.isArray(input) || input.length > 256) return invalid()
  for (const p of input) {
    if (!p || typeof p !== 'object' || Object.keys(p).some(k => ![...fields, 'keys', 'selected'].includes(k as any))) return invalid()
    for (const [field, max] of Object.entries({ name: 100, adapter: 32, base_url: 2048, default_model: 512, reasoning_effort: 32, system_prompt: 100000, selected: 64 })) {
      if (typeof p[field] !== 'string' || p[field].length > max) return invalid()
    }
    if (!p.name.trim() || !AUTH[p.adapter] || !Number.isFinite(p.temperature) || p.temperature < 0 || p.temperature > 2
      || !Number.isInteger(p.max_tokens) || p.max_tokens < 0 || p.max_tokens > 1000000) return invalid()
    baseIdentity(p.base_url)
    if (!Array.isArray(p.keys) || p.keys.length > 128) return invalid()
    for (const key of p.keys) {
      if (!key || Object.keys(key).some(field => !['id', 'name', 'value'].includes(field))
        || typeof key.name !== 'string' || !key.name.trim() || key.name.length > 100
        || typeof key.value !== 'string' || !key.value || key.value.length > 8192
        || key.id !== await keyIdentity(key.value)) return invalid()
    }
  }
  return input
}

async function receive(incoming: Profile[]) {
  const conflicts: string[] = []
  for (const remote of incoming) {
    const identity = baseIdentity(remote.base_url)
    let current = (await list()).filter(p => baseIdentity(p.base_url) === identity)
    const peers = incoming.filter(p => baseIdentity(p.base_url) === identity)
    const reason = mergeConflict([...current, ...peers], remote.adapter)
    if (reason) { conflicts.push(current.length ? current.map(p => String(p.id)).join(',') : '新增配置'); continue }
    if (!current.length && identity in (await loadKeys()).suppressed) continue
    if (!current.length) {
      let name = remote.name
      let suffix = 1
      while (await row('SELECT id FROM ai_profiles WHERE name = ?', [name])) name = `${remote.name} (${++suffix})`
      await transaction(async () => {
        await run(`INSERT INTO ai_profiles (${fields.join(',')}, is_default) VALUES (${fields.map(() => '?').join(',')}, 0)`, fields.map(f => f === 'name' ? name : remote[f]))
        current = [await row<any>('SELECT * FROM ai_profiles WHERE name = ?', [name])]
        if (remote.default_model) await run('INSERT OR IGNORE INTO ai_profile_models(profile_id, model_id, display_name) VALUES (?, ?, ?)', [current[0].id, remote.default_model, remote.default_model])
      })
    }
    for (const profile of current) {
      const state = await migrateKeys(profile.id)
      const item = state.profiles[profile.id]
      item.suppressed = [...new Set([...item.suppressed, ...(state.suppressed[identity] || [])])]
      const merged = mergeKeys(item, remote.keys)
      if (merged.keys.length > 128) throw new Error('模型密钥数量超过上限')
      state.profiles[profile.id] = merged
      await saveKeys(state)
    }
  }
  return conflicts
}

export async function syncModelKeys(base: string, token: string, tls: LanTlsIdentity) {
  const post = async (data: Record<string, unknown>) => {
    const response = await LanTransport.post({ url: `${base}/api/lan-sync/model-keys`, tls, data: { token, ...data } })
    if (response.status !== 200) throw new Error(`模型密钥同步失败 (${response.status})`)
    const result = response.data as any
    if (result?.version !== 1) throw new Error('模型密钥同步版本不兼容')
    return result
  }
  const known = await withKeys(inventory)
  const pulled = await post({ operation: 'pull', known })
  const incoming = await validateProfiles(pulled.profiles)
  if (!pulled.known || typeof pulled.known !== 'object' || Array.isArray(pulled.known) || Object.keys(pulled.known).length > 256) throw new Error('模型密钥清单无效')
  for (const [url, ids] of Object.entries(pulled.known)) {
    if (url.length > 2048 || baseIdentity(url) !== url || !Array.isArray(ids) || ids.length > 4096
      || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) throw new Error('模型密钥清单无效')
  }
  const conflicts = await withKeys(() => receive(incoming))
  const profiles = await withKeys(() => exported(pulled.known))
  const pushed = await post({ operation: 'push', profiles })
  if (!Array.isArray(pushed.conflicts) || pushed.conflicts.length > 256
    || pushed.conflicts.some((c: any) => c?.reason !== 'authentication_incompatible' || !Array.isArray(c.profile_ids)
      || c.profile_ids.length > 256 || c.profile_ids.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) < 1))) throw new Error('模型密钥同步结果无效')
  if (conflicts.length || pushed.conflicts.length) {
    const remoteIds = pushed.conflicts.flatMap((c: any) => c.profile_ids).join(',') || '新增配置'
    throw new Error('认证方式不兼容，已暂停冲突配置同步：' + [
      conflicts.length ? '本机配置 #' + conflicts.join(',') : '',
      pushed.conflicts.length ? '电脑配置 #' + remoteIds : '',
    ].filter(Boolean).join('；'))
  }
}

export async function authoritativePushModelKeys(base: string, token: string, tls: LanTlsIdentity) {
  const profiles = await withKeys(exportedAll)
  if (!profiles.length || profiles.length > 256) throw new Error('本机模型配置数量无效，未发送')
  const response = await LanTransport.post({
    url: `${base}/api/lan-sync/model-keys`, tls,
    data: { token, operation: "authoritative_push", snapshot_version: 1, profiles },
  })
  if (response.status !== 200) throw new Error(`模型密钥覆盖失败 (${response.status})`)
  const result = response.data as any
  if (result?.version !== 1 || result?.snapshot_version !== 1
    || result.applied_profiles !== profiles.length) throw new Error("模型密钥覆盖结果无效")
  return Number(result.applied_profiles)
}
