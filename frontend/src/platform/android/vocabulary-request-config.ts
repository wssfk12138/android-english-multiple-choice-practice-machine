import { row } from './database'
import { selectedKey } from './model-key-store'
import { LocalApiError } from './errors'

/** Only a digest and non-secret display fields are persisted; never persist the URL or key. */
export async function vocabularyConfigurationFrom(profile: Record<string, any>, key: string) {
  const fields = [profile.id, profile.adapter, profile.base_url, profile.default_model, profile.temperature,
    profile.reasoning_effort, profile.system_prompt, profile.enabled, key]
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(fields)))
  return { hash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
    summary: JSON.stringify({ profileId: profile.id, adapter: profile.adapter, model: profile.default_model,
      temperature: profile.temperature, reasoningEffort: profile.reasoning_effort }) }
}
export async function vocabularyConfiguration() {
  const profile = await row<Record<string, any>>("SELECT * FROM ai_profiles WHERE enabled=1 AND TRIM(default_model)<>'' ORDER BY is_default DESC,id LIMIT 1")
  if (!profile) throw new LocalApiError(400, '请先配置并启用用于词汇的默认模型')
  return vocabularyConfigurationFrom(profile, await selectedKey(profile.id))
}
