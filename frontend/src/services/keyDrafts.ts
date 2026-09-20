import { reactive } from 'vue'
// Session memory only: never persist unsubmitted secrets in browser storage.
const drafts = new Map<number, { state: any; sequence: Promise<void> }>()
export function keyDraft(id: number) {
  if (!drafts.has(id)) drafts.set(id, { state: reactive({ name: '', value: '', busy: false, error: '', drafts: {}, adding: false, retry: null }), sequence: Promise.resolve() })
  return drafts.get(id)!
}
export function forgetKeyDraft(id: number) { drafts.delete(id) }
