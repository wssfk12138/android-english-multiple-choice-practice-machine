import { secureStore } from "../secure-store"
import { baseIdentity, emptyKeys, keyIdentity, keySummary, type KeySet } from "../model-keys"
import { row } from "./database"

export type Vault = { version: 1; profiles: Record<string, KeySet>; suppressed: Record<string, string[]> }
const STORAGE = "ai-named-keys-v1"
let pending: Promise<unknown> = Promise.resolve()
// 每次 secureStore.get/remove 都要跨一次原生桥（平板上单次约 8ms）。配置页按配置数量
// 反复读同一份密钥库、并反复删除同一个旧版条目，跨桥次数随配置数线性增长，是模型
// 配置页首屏的主要开销。这里缓存“未解析的原文”，读取时仍重新解析：每次 loadKeys()
// 依旧返回独立对象，语义与未缓存时一致，写入成功后同步更新缓存。
let vaultRaw = ""
let vaultLoaded = false
let vaultReading: Promise<void> | null = null
// 旧版单密钥条目已确认删除后不再重复跨桥；只有删除成功才记账，失败仍会抛出并重试。
const purgedLegacy = new Set<string>()
export function withKeys<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation)
  pending = result.catch(() => undefined)
  return result
}
export async function loadKeys(): Promise<Vault> {
  if (!vaultLoaded) {
    if (!vaultReading) vaultReading = secureStore.get(STORAGE).then(raw => {
      vaultRaw = raw || ""
      vaultLoaded = true
    }, error => {
      vaultReading = null
      throw error
    })
    await vaultReading
  }
  if (!vaultRaw) return { version: 1, profiles: {}, suppressed: {} }
  try {
    const state = JSON.parse(vaultRaw)
    if (state.version !== 1 || !state.profiles || !state.suppressed) throw new Error()
    return state
  } catch { throw new Error("密钥安全存储不可用，未自动重置") }
}
export async function saveKeys(state: Vault) {
  const raw = JSON.stringify(state)
  await secureStore.set(STORAGE, raw)
  vaultRaw = raw
  vaultLoaded = true
}
export async function migrateKeys(id: number): Promise<Vault> {
  if (!await row("SELECT id FROM ai_profiles WHERE id = ?", [id])) throw new Error("API 配置不存在")
  return migrateExistingKeys(id)
}
// 清单类调用方已经把 ai_profiles 行取回（/ai/profiles 用一条 SELECT p.* 拿到全部配置），
// 再按配置数逐个回查存在性只是重复跨桥；这条路径复用“调用方已确认配置存在”的事实。
async function migrateExistingKeys(id: number): Promise<Vault> {
  const state = await loadKeys()
  const legacyName = `ai-profile-${id}-api-key`
  if (!state.profiles[id]) {
    const item = emptyKeys()
    const legacy = await secureStore.get(legacyName)
    if (legacy) {
      const identity = await keyIdentity(legacy)
      item.keys = [{ id: identity, name: "默认密钥", value: legacy }]
      item.selected = identity
    }
    state.profiles[id] = item
    await saveKeys(state)
  }
  if (!purgedLegacy.has(legacyName)) {
    await secureStore.remove(legacyName)
    purgedLegacy.add(legacyName)
  }
  return state
}
// knownExists 只允许清单类调用方使用：它们已经在同一批读取里确认过配置行存在。
// 单配置入口（selectedKey/editUnlocked/同步）继续走带校验的 migrateKeys，报错文案不变。
export async function namedKeySummary(id: number, knownExists = false) {
  return withKeys(async () => keySummary((await (knownExists ? migrateExistingKeys(id) : migrateKeys(id))).profiles[id]))
}
export async function selectedKey(id: number): Promise<string> {
  return withKeys(async () => {
    const item = (await migrateKeys(id)).profiles[id]
    return item.keys.find(key => key.id === item.selected)?.value || ""
  })
}
async function editUnlocked(id: number, body: Record<string, any>) {
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || ['name', 'value', 'identity'].some(field => body[field] !== undefined && typeof body[field] !== 'string')) throw new Error("密钥操作无效")
    if (!await row("SELECT id FROM ai_profiles WHERE id = ?", [id])) throw new Error("API 配置不存在")
    const state = await migrateKeys(id)
    const item = state.profiles[id]
    const name = String(body.name || "").trim()
    const value = String(body.value || "").trim()
    const identity = String(body.identity || "")
    if (body.action === "add") {
      if (!name || name.length > 100 || !value || value.length > 8192) throw new Error("密钥名称或内容无效")
      const keyId = await keyIdentity(value)
      if (item.keys.length >= 128 && !item.keys.some(key => key.id === keyId)) throw new Error("模型密钥数量超过上限")
      if (!item.keys.some(key => key.id === keyId)) item.keys.push({ id: keyId, name, value })
      item.suppressed = item.suppressed.filter(key => key !== keyId)
    } else if (body.action === "select") {
      if (identity && !item.keys.some(key => key.id === identity)) throw new Error("密钥不存在")
      item.selected = identity
    } else if (body.action === "rename") {
      if (!name || name.length > 100) throw new Error("密钥名称无效")
      const key = item.keys.find(key => key.id === identity)
      if (!key) throw new Error("密钥不存在")
      key.name = name
    } else if (body.action === "delete") {
      if (!/^[a-f0-9]{64}$/.test(identity)) throw new Error("密钥标识无效")
      item.keys = item.keys.filter(key => key.id !== identity)
      if (!item.suppressed.includes(identity)) item.suppressed.push(identity)
      if (item.selected === identity) item.selected = ""
    } else throw new Error("密钥操作无效")
    await saveKeys(state)
    return keySummary(item)
}
export async function editNamedKey(id: number, body: Record<string, any>) {
  return withKeys(() => editUnlocked(id, body))
}
export async function writeLegacyKey(id: number, value: unknown, clear = false) {
  return withKeys(async () => {
  if (clear) {
    const current = keySummary((await migrateKeys(id)).profiles[id])
    if (current.selected_key_id) await editUnlocked(id, { action: "delete", identity: current.selected_key_id })
  } else if (value) {
    await editUnlocked(id, { action: "add", name: "默认密钥", value })
    await editUnlocked(id, { action: "select", identity: await keyIdentity(String(value).trim()) })
  }
  })
}
export async function suppressProfileKeys(id: number, baseUrl: string, removeProfile: () => Promise<void>) {
  await withKeys(async () => {
    const state = await migrateKeys(id)
    const item = state.profiles[id]
    const identity = baseIdentity(baseUrl)
    state.suppressed[identity] = [...new Set([...(state.suppressed[identity] || []), ...item.suppressed, ...item.keys.map(key => key.id)])]
    delete state.profiles[id]
    await saveKeys(state)
    await removeProfile()
  })
}
