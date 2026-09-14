import { morphologyLabel, safeObject } from '../../vocabulary-context'

type Entry = Record<string, any>
const strings = { lemma: 'lemma', phonetic: 'phonetic', part_of_speech: 'partOfSpeech', common_meaning: 'commonMeaning', memory_hint: 'memoryHint' } as const
const lists = { synonyms: 'synonyms', antonyms: 'antonyms', similar_forms: 'similarForms' } as const
function list(value: unknown): any[] {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : [] } catch { return [] }
}

/** Only fill missing values; an edited entry owns its meaning and spelling fields. */
export function mergeVocabularyEnrichment(entry: Entry, result: Entry, morphology: Entry, example: Entry) {
  const merged: Entry = {}
  for (const [field, source] of Object.entries(strings)) {
    const protectedField = entry.user_edited && ['lemma', 'phonetic', 'part_of_speech', 'common_meaning'].includes(field)
    merged[field] = protectedField || String(entry[field] || '').trim() ? entry[field] : String(result[source] || '').trim().slice(0, 1000)
  }
  for (const [field, source] of Object.entries(lists)) {
    merged[field] = list(entry[field]).length ? entry[field] : JSON.stringify(list(result[source]).filter(item => item && typeof item.word === 'string').slice(0, 3).map(item => ({ word: item.word.slice(0, 60), note: String(item.note || '').slice(0, 80) })))
  }
  const existingMorphology = safeObject(entry.morphology)
  const existingExample = safeObject(entry.generated_example)
  const existingForms = Array.isArray(existingMorphology.forms) ? existingMorphology.forms : []
  const knownCurrentForm = existingMorphology.currentForm && morphologyLabel(existingMorphology.currentForm) !== '词形待确认'
  merged.morphology = JSON.stringify({
    ...morphology,
    ...existingMorphology,
    lemma: existingMorphology.lemma || morphology.lemma,
    note: existingMorphology.note || morphology.note,
    ambiguous: knownCurrentForm && typeof existingMorphology.ambiguous === 'boolean' ? existingMorphology.ambiguous : morphology.ambiguous,
    currentForm: knownCurrentForm ? morphologyLabel(existingMorphology.currentForm) : morphology.currentForm,
    rawCurrentForm: existingMorphology.rawCurrentForm || existingMorphology.currentForm || morphology.rawCurrentForm,
    forms: Array.isArray(existingMorphology.forms) && existingForms.every((item: any) => item?.label && item?.word && morphologyLabel(item.label) !== '词形待确认')
      ? existingForms.map((item: any) => ({ ...item, rawLabel: item.rawLabel || item.label, label: morphologyLabel(item.label) })) : morphology.forms,
  })
  merged.generated_example = JSON.stringify(existingExample.sentence && existingExample.translation ? existingExample : example)
  return merged
}
