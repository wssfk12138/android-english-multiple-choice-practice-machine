// 单词本显示配置的唯一权威定义：键、中文名和默认值。
// 设置中枢、单词本详情和复习答案共用这里，不再各自维护副本。
export const VOCAB_DISPLAY_STORAGE_KEY = 'vocab-display-config'

export type VocabDisplayKey =
  | 'common_meaning'
  | 'contextual'
  | 'sentence'
  | 'memory_hint'
  | 'synonyms'
  | 'antonyms'
  | 'similar_forms'
  | 'morphology'

export type VocabDisplayOption = { key: VocabDisplayKey; label: string }

export const VOCAB_DISPLAY_OPTIONS: VocabDisplayOption[] = [
  { key: 'common_meaning', label: '常用释义' },
  { key: 'contextual', label: '语境释义' },
  { key: 'sentence', label: '真题例句' },
  { key: 'memory_hint', label: '记忆提示' },
  { key: 'synonyms', label: '同义词辨析' },
  { key: 'antonyms', label: '反义词辨析' },
  { key: 'similar_forms', label: '形近词辨析' },
  { key: 'morphology', label: '显示单词词形' },
]

export const VOCAB_DISPLAY_DEFAULTS: Record<VocabDisplayKey, boolean> = {
  common_meaning: true,
  contextual: true,
  sentence: true,
  memory_hint: false,
  synonyms: false,
  antonyms: false,
  similar_forms: false,
  morphology: true,
}

export type VocabDisplayConfig = Record<VocabDisplayKey, boolean>

export function loadVocabDisplayConfig(): VocabDisplayConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(VOCAB_DISPLAY_STORAGE_KEY) || '{}')
    if (saved && typeof saved === 'object') {
      return { ...VOCAB_DISPLAY_DEFAULTS, ...saved }
    }
  } catch {
    // 旧数据无效时回退默认值。
  }
  return { ...VOCAB_DISPLAY_DEFAULTS }
}

export function saveVocabDisplayConfig(config: VocabDisplayConfig) {
  localStorage.setItem(VOCAB_DISPLAY_STORAGE_KEY, JSON.stringify(config))
  window.dispatchEvent(new CustomEvent('vocab-display-change', { detail: { ...config } }))
}
