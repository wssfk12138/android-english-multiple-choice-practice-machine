import { VOCAB_DISPLAY_OPTIONS, type VocabDisplayKey } from './vocabularyDisplayConfig'

export const STUDY_CONTENT_ORDER: VocabDisplayKey[] = ['memory_hint', 'common_meaning', 'contextual', 'source_sentence', 'model_sentence', 'note', 'morphology', 'similar_forms', 'synonyms', 'antonyms']
export function hasStudyField(entry: Record<string, any>, key: VocabDisplayKey): boolean {
  if (key === 'contextual') return Boolean(entry.contextual_meaning)
  if (key === 'source_sentence') return Boolean(entry.latest_sentence)
  if (key === 'model_sentence') return Boolean(entry.generated_example?.sentence || entry.generated_example?.translation)
  if (key === 'morphology') return Boolean(entry.morphology?.forms?.length || entry.morphology?.note || (entry.morphology?.currentForm && entry.morphology.currentForm !== '词形待确认'))
  if (key === 'similar_forms') return Boolean(entry.local_similar?.length || entry.similar_forms?.length)
  return Boolean(Array.isArray(entry[key]) ? entry[key].length : entry[key])
}
export const STUDY_FIELD_CONFIGS = Object.fromEntries(VOCAB_DISPLAY_OPTIONS.map(option => [option.key, Object.fromEntries(VOCAB_DISPLAY_OPTIONS.map(item => [item.key, item.key === option.key]))]))
