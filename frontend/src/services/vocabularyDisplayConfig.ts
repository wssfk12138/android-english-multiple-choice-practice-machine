// 单词本显示配置的唯一权威定义：键、中文名和默认值。
// 设置中枢、单词本详情和复习答案共用这里，不再各自维护副本。
export const VOCAB_DISPLAY_STORAGE_KEY = 'vocab-display-config'

export type VocabDisplayKey =
  | 'common_meaning'
  | 'phonetic'
  | 'part_of_speech'
  | 'source_sentence'
  | 'model_sentence'
  | 'memory_hint'
  | 'synonyms'
  | 'antonyms'
  | 'similar_forms'
  | 'morphology'
  | 'note'

export type VocabDisplayOption = { key: VocabDisplayKey; label: string }

export const VOCAB_DISPLAY_OPTIONS: VocabDisplayOption[] = [
  { key: 'common_meaning', label: '常用释义' },
  { key: 'phonetic', label: '音标' },
  { key: 'part_of_speech', label: '词性' },
  { key: 'source_sentence', label: '真题原句' },
  { key: 'model_sentence', label: '模型例句' },
  { key: 'memory_hint', label: '记忆提示' },
  { key: 'synonyms', label: '同义词辨析' },
  { key: 'antonyms', label: '反义词辨析' },
  { key: 'similar_forms', label: '形近词辨析' },
  { key: 'morphology', label: '显示单词词形' },
  { key: 'note', label: '我的笔记' },
]

export const VOCAB_DISPLAY_DEFAULTS: Record<VocabDisplayKey, boolean> = {
  common_meaning: true,
  phonetic: true,
  part_of_speech: true,
  source_sentence: true,
  model_sentence: false,
  memory_hint: false,
  synonyms: false,
  antonyms: false,
  similar_forms: false,
  morphology: true,
  note: true,
}

export type VocabDisplayConfig = Record<VocabDisplayKey, boolean>

export function loadVocabDisplayConfig(): VocabDisplayConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(VOCAB_DISPLAY_STORAGE_KEY) || '{}')
    if (saved && typeof saved === 'object') {
      const config = { ...VOCAB_DISPLAY_DEFAULTS }
      if (typeof saved.sentence === 'boolean' && typeof saved.source_sentence !== 'boolean') config.source_sentence = saved.sentence
      for (const { key } of VOCAB_DISPLAY_OPTIONS) {
        if (typeof saved[key] === 'boolean') config[key] = saved[key]
      }
      return config
    }
  } catch {
    // 旧数据无效时回退默认值。
  }
  return { ...VOCAB_DISPLAY_DEFAULTS }
}

export function saveVocabDisplayConfig(config: VocabDisplayConfig) {
  config = Object.fromEntries(VOCAB_DISPLAY_OPTIONS.map(({ key }) => [key, typeof config[key] === 'boolean' ? config[key] : VOCAB_DISPLAY_DEFAULTS[key]])) as VocabDisplayConfig
  localStorage.setItem(VOCAB_DISPLAY_STORAGE_KEY, JSON.stringify(config))
  window.dispatchEvent(new CustomEvent('vocab-display-change', { detail: { ...config } }))
}
