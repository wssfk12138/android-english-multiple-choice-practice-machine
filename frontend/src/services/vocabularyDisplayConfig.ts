export const VOCAB_DISPLAY_STORAGE_KEY = 'vocab-display-config'
export const VOCAB_DISPLAY_OPTIONS = [
  { key: 'common_meaning', label: '常用释义', group: '核心信息', initial: true },
  { key: 'contextual', label: '语境释义', group: '核心信息', initial: true },
  { key: 'phonetic', label: '音标', group: '核心信息', initial: true },
  { key: 'part_of_speech', label: '词性', group: '核心信息', initial: true },
  { key: 'source_sentence', label: '真题原句', group: '核心信息', initial: true },
  { key: 'model_sentence', label: 'AI 生成例句', group: '补充学习', initial: false },
  { key: 'memory_hint', label: '记忆提示', group: '补充学习', initial: false },
  { key: 'synonyms', label: '同义词辨析', group: '补充学习', initial: false },
  { key: 'antonyms', label: '反义词辨析', group: '补充学习', initial: false },
  { key: 'similar_forms', label: '形近词辨析', group: '补充学习', initial: false },
  { key: 'morphology', label: '词形变化', group: '补充学习', initial: true },
  { key: 'note', label: '我的笔记', group: '个人记录', initial: true },
] as const
export type VocabDisplayKey = typeof VOCAB_DISPLAY_OPTIONS[number]['key']
export type VocabDisplayConfig = Record<VocabDisplayKey, boolean>
// 复习卡契约：每日一背与额外巩固只显示「常用释义 + 真题原句」。
// 这是与用户设置并列的另一份权威值，设置页的开关（含以后新增的栏目）不参与复习卡；
// 复习入口必须读这里，不得传 loadVocabDisplayConfig() 的结果。
export const VOCAB_REVIEW_DISPLAY_CONFIG: Readonly<VocabDisplayConfig> = Object.freeze({
  common_meaning: true,
  contextual: false,
  phonetic: false,
  part_of_speech: false,
  source_sentence: true,
  model_sentence: false,
  memory_hint: false,
  synonyms: false,
  antonyms: false,
  similar_forms: false,
  morphology: false,
  note: false,
})
export const VOCAB_DISPLAY_DEFAULTS = Object.fromEntries(VOCAB_DISPLAY_OPTIONS.map(o => [o.key, o.initial])) as VocabDisplayConfig
export function loadVocabDisplayConfig(): VocabDisplayConfig {
  const config = { ...VOCAB_DISPLAY_DEFAULTS }
  try {
    const saved = JSON.parse(localStorage.getItem(VOCAB_DISPLAY_STORAGE_KEY) || '{}')
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      if (typeof saved.sentence === 'boolean' && typeof saved.source_sentence !== 'boolean') config.source_sentence = saved.sentence
      for (const { key } of VOCAB_DISPLAY_OPTIONS) if (typeof saved[key] === 'boolean') config[key] = saved[key]
    }
  } catch { /* Invalid older preferences use defaults. */ }
  return config
}
export function saveVocabDisplayConfig(config: VocabDisplayConfig) {
  const saved = Object.fromEntries(VOCAB_DISPLAY_OPTIONS.map(o => [o.key, typeof config[o.key] === 'boolean' ? config[o.key] : o.initial]))
  localStorage.setItem(VOCAB_DISPLAY_STORAGE_KEY, JSON.stringify(saved))
  window.dispatchEvent(new Event('vocab-display-change'))
}
