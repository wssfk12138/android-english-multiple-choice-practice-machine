// Content identities and merge policy contain no storage or transport effects.
export type NamedKey = { id: string; name: string; value: string }
export type KeySet = { keys: NamedKey[]; selected: string; suppressed: string[] }
export const emptyKeys = (): KeySet => ({ keys: [], selected: "", suppressed: [] })
export const AUTH: Record<string, string> = { "openai-chat": "bearer", "openai-responses": "bearer", anthropic: "anthropic", google: "google", kiro: "kiro", "command-code": "command-code" }

export function baseIdentity(raw: string): string {
  const value = raw.trim()
  if (/[\x00-\x20\x7f\\?#]/.test(value)) throw new Error("API 地址无效")
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("API 地址无效")
  // Preserve the path, explicit port, and trailing slash; only host case is normalized.
  const match = /^(https?):\/\/([^/]+)(.*)$/i.exec(value)
  if (!match || !/^[A-Za-z0-9.:[\]\-]+$/.test(match[2])) throw new Error("API 地址无效")
  return match[1].toLowerCase() + "://" + match[2].toLowerCase() + match[3]
}

export function mergeKeys(local: KeySet, incoming: NamedKey[]): KeySet {
  const result = structuredClone(local)
  for (const key of incoming) {
    if (!result.suppressed.includes(key.id) && !result.keys.some(item => item.id === key.id)) result.keys.push({ ...key })
  }
  return result
}

export async function keyIdentity(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
}

export function mergeConflict(local: { adapter: string }[], incoming: string): string {
  if (!AUTH[incoming] || local.some(item => !AUTH[item.adapter] || AUTH[item.adapter] !== AUTH[incoming])) return "认证方式不兼容，已暂停此配置同步"
  return ""
}

export function keySummary(state: KeySet) {
  return { keys: state.keys.map(({ id, name }) => ({ id, name })), selected_key_id: state.selected, has_api_key: state.keys.some(key => key.id === state.selected) }
}
