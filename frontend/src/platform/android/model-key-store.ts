import { secureStore } from "../secure-store"
import { baseIdentity, emptyKeys, keyIdentity, keySummary, type KeySet } from "../model-keys"
import { row } from "./database"

export type Vault = { version: 1; profiles: Record<string, KeySet>; suppressed: Record<string, string[]> }
const STORAGE = "ai-named-keys-v1"
let pending: Promise<unknown> = Promise.resolve()
export function withKeys<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation)
  pending = result.catch(() => undefined)
  return result
}
export async function loadKeys(): Promise<Vault> {
  const raw = await secureStore.get(STORAGE)
  if (!raw) return { version: 1, profiles: {}, suppressed: {} }
  try {
    const state = JSON.parse(raw)
    if (state.version !== 1 || !state.profiles || !state.suppressed) throw new Error()
    return state
  } catch { throw new Error("密钥安全存储不可用，未自动重置") }
}
export async function saveKeys(state: Vault) {
  await secureStore.set(STORAGE, JSON.stringify(state))
}
export async function migrateKeys(id: number): Promise<Vault> {
  if (!await row("SELECT id FROM ai_profiles WHERE id = ?", [id])) throw new Error("API 配置不存在")
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
  await secureStore.remove(legacyName)
  return state
}
export async function namedKeySummary(id: number) {
  return withKeys(async () => keySummary((await migrateKeys(id)).profiles[id]))
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
