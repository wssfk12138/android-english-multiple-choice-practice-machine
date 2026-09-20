import { reactive } from 'vue'
import { put } from '../api'
import { baseIdentity } from '../platform/model-keys'
import { createAutosave } from './configAutosave'
import { forgetKeyDraft } from './keyDrafts'

export const profileDrafts = reactive<Record<number, any>>({})
export const profileSaveStates = reactive<Record<number, string>>({})
export const visibilitySaveStates = reactive<Record<number, { busy: boolean; message: string }>>({})
type VisibilityDraft = { is_visible: boolean; model_id?: string }
const visibilityDrafts = new Map<number, VisibilityDraft[]>()
const queues = new Map<number, ReturnType<typeof createAutosave<any>>>()
// Defaults span all profiles, so even writes from different cards are serialized.
let writes: Promise<unknown> = Promise.resolve()
let preferredDefault: number | undefined
export function preferDefaultProfile(id: number) {
  preferredDefault = id
  for (const queue of queues.values()) queue.resetSaved()
}
function queue(id: number) {
  if (!queues.has(id)) queues.set(id, createAutosave(async value => {
    const next = writes.catch(() => {}).then(() => put(`/ai/profiles/${id}`, { ...value, is_default: preferredDefault === undefined ? value.is_default : id === preferredDefault }))
    writes = next
    await next
    window.dispatchEvent(new CustomEvent('linjian-ai-config-changed'))
  }, state => { profileSaveStates[id] = state }))
  return queues.get(id)!
}
export function saveProfileDraft(id: number, value: any, immediate = false) {
  try {
    if (!value.name.trim()) throw new Error('请输入配置名称')
    baseIdentity(value.base_url)
  } catch { queue(id).invalidate('草稿未保存：请填写名称和有效的 http(s) 地址'); return false }
  queue(id).schedule(value, immediate)
  return true
}
export async function flushProfileDraft(id: number) { return queues.has(id) ? queues.get(id)!.flush() : true }
export function profileHasDraft(id: number) { return queues.get(id)?.pending || false }
export function serializeProfileOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = writes.catch(() => {}).then(operation)
  writes = next
  return next
}
export async function saveModelVisibility(id: number, visible: boolean, modelId?: string) {
  const drafts = visibilityDrafts.get(id) || []
  drafts.push({ is_visible: visible, ...(modelId ? { model_id: modelId } : {}) })
  visibilityDrafts.set(id, drafts)
  if (!visibilitySaveStates[id]?.busy) await retryModelVisibility(id)
}
export function intendedModelVisibility(id: number, model: { model_id: string; is_visible: boolean }) {
  const drafts = visibilityDrafts.get(id) || []
  for (let index = drafts.length - 1; index >= 0; index--) {
    const draft = drafts[index]!
    if (!draft.model_id || draft.model_id === model.model_id) return draft.is_visible
  }
  return model.is_visible
}
export async function retryModelVisibility(id: number) {
  if (!visibilityDrafts.has(id) || visibilitySaveStates[id]?.busy) return
  visibilitySaveStates[id] ||= { busy: false, message: '' }
  const state = visibilitySaveStates[id]!
  state.busy = true; state.message = '模型显示设置保存中…'
  try {
    while (visibilityDrafts.has(id)) {
      const drafts = visibilityDrafts.get(id)!
      const draft = drafts[0]!
      await serializeProfileOperation(() => put(`/ai/profiles/${id}/models${draft.model_id ? '' : '/visibility'}`, draft))
      for (const model of profileDrafts[id]?.models || []) {
        if (!draft.model_id || model.model_id === draft.model_id) model.is_visible = draft.is_visible
      }
      drafts.shift()
      if (!drafts.length) visibilityDrafts.delete(id)
    }
    state.message = '模型显示设置已保存'
    window.dispatchEvent(new CustomEvent('linjian-ai-config-changed'))
  } catch { state.message = '模型显示设置保存失败，点击重试' }
  finally { state.busy = false }
}
export function forgetProfileDraft(id: number) {
  if (preferredDefault === id) preferredDefault = undefined
  delete profileDrafts[id]; delete profileSaveStates[id]; queues.delete(id); forgetKeyDraft(id)
  delete visibilitySaveStates[id]; visibilityDrafts.delete(id)
}
