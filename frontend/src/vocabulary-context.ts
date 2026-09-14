/** A conservative source projection. Encounter history stays in storage. */
type RecordValue = Record<string, any>
export function validSourceSentence(occurrence: RecordValue): boolean {
  if (['question', 'fragment'].includes(String(occurrence.source_kind || ''))) return false
  const sentence = String(occurrence.context_sentence || '').trim()
  const term = String(occurrence.surface_form || '').trim().toLowerCase()
  if (!term || sentence.length > 1500 || !/[.!?]["'”’)]*$/.test(sentence)) return false
  const words = sentence.toLowerCase().replaceAll('’', "'").match(/[a-z]+(?:['-][a-z]+)*/g) || []
  if (words.length < 3 || /^(?:directions|section|part [ab])\b/i.test(sentence)) return false
  return (' ' + words.join(' ') + ' ').includes(' ' + term.replace(/[’]/g, "'") + ' ')
}
function encounterTime(value: unknown): number {
  const raw = String(value || '')
  const stamp = Date.parse(raw.includes('T') ? (/Z$|[+-]\d\d:\d\d$/.test(raw) ? raw : raw + 'Z') : raw.replace(' ', 'T') + 'Z')
  return Number.isFinite(stamp) ? stamp : 0
}
export function occurrenceKey(value: RecordValue): string {
  return String(value.sync_id || JSON.stringify([value.created_at || '', value.context_sentence || '', value.year || '', value.unit_title || '']))
}
export function latestSourceOccurrence(history: RecordValue[]): RecordValue | null {
  return history.filter(validSourceSentence).sort((a, b) => encounterTime(b.created_at) - encounterTime(a.created_at)
    || (occurrenceKey(a) < occurrenceKey(b) ? 1 : occurrenceKey(a) > occurrenceKey(b) ? -1 : 0))[0] || null
}
export function safeObject(value: unknown): RecordValue {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} } catch { return {} }
}
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().slice(0, limit) : ''

/** Keep model supplied morphology labels readable and consistent in the UI. */
export function morphologyLabel(value: unknown): string {
  const label = text(value, 40)
  if (!label) return ''
  const key = label.toLowerCase().replace(/[\s_-]+/g, ' ').trim()
  const labels: Record<string, string> = {
    base: '原形',
    'base form': '原形',
    infinitive: '原形',
    'infinitive form': '原形',
    lemma: '原形',
    present: '现在式',
    'present tense': '现在式',
    'present form': '现在式',
    past: '过去式',
    'past tense': '过去式',
    'past form': '过去式',
    'past participle': '过去分词',
    'present participle': '现在分词',
    gerund: '动名词',
    'third person singular': '第三人称单数',
    'third person singular present': '第三人称单数',
    plural: '复数',
    singular: '单数',
    'singular form': '单数',
    'plural form': '复数',
    comparative: '比较级',
    superlative: '最高级',
  }
  return labels[key] || '词形待确认'
}

export function vocabularyEnhancements(value: RecordValue, hasSource: boolean) {
  const source = safeObject(value.morphology)
  const forms = Array.isArray(source.forms) ? source.forms.filter((item: any) => item && typeof item === 'object')
    .map((item: any) => ({ label: morphologyLabel(item.label), word: text(item.word, 100) })).filter((item: any) => item.label && item.word).slice(0, 10) : []
  const morphology = { lemma: text(source.lemma || value.lemma, 120), currentForm: morphologyLabel(source.currentForm), ambiguous: source.ambiguous === true, note: text(source.note, 200), forms }
  const example = safeObject(value.generatedExample || value.generated_example)
  const generatedExample = { sentence: text(example.sentence, 500), translation: text(example.translation, 500) }
  return { morphology, generatedExample }
}

/** Reject incomplete responses before marking a paid translation successful. */
export function validVocabularyEnhancements(value: RecordValue, term: string, hasSource: boolean): boolean {
  const { morphology, generatedExample } = vocabularyEnhancements(value, hasSource)
  if (!morphology.lemma || !morphology.currentForm || (morphology.ambiguous && !morphology.note)) return false
  if (!generatedExample.translation || !generatedExample.sentence) return false
  return validSourceSentence({ surface_form: term, context_sentence: generatedExample.sentence })
}

/** Guard values as well as timestamps: two edits may share a SQLite second. */
export function vocabularyWriteGuard(entry: RecordValue) {
  const fields = ['term', 'user_edited', 'common_meaning', 'contextual_meaning', 'morphology', 'generated_example', 'contextual_occurrence_key']
  return { sql: fields.map(field => field + ' IS ?').join(' AND '), values: fields.map(field => entry[field] ?? null) }
}

export function projectVocabulary(entry: RecordValue, history: RecordValue[]): RecordValue {
  const latest = latestSourceOccurrence(history)
  const contextKey = latest ? occurrenceKey(latest) : ''
  return { ...entry, ...{ morphology: safeObject(entry.morphology), generated_example: safeObject(entry.generated_example) },
    occurrences: latest ? [latest] : [], latest_sentence: latest?.context_sentence || '', context_key: contextKey,
    contextual_meaning: contextKey && entry.contextual_occurrence_key === contextKey ? entry.contextual_meaning : '' }
}

/** Range offsets and text must come from the same DOM Range serialization. */
export function selectedSourceSentence(text: string, term: string, start: number): string {
  if (!Number.isInteger(start) || start < 0 || start > text.length) return ''
  const selected = text.slice(start, start + term.length)
  if (selected.toLowerCase() !== term.toLowerCase()) return ''
  const left = Math.max(text.lastIndexOf('.', start - 1), text.lastIndexOf('!', start - 1), text.lastIndexOf('?', start - 1))
  const endings = ['.', '!', '?'].map(mark => text.indexOf(mark, start + term.length)).filter(index => index >= 0)
  let right = endings.length ? Math.min(...endings) + 1 : text.length
  while (right < text.length && /["'”’)]/.test(text[right]!)) right++
  const sentence = text.slice(left + 1, right).replace(/\s+/g, ' ').trim()
  return sentence.length <= 1500 ? sentence : ''
}
