const STORAGE_KEY = 'vocab-translation-enrichment'
export function loadVocabularyEnrichment(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'false' } catch { return true }
}
export function saveVocabularyEnrichment(enabled: boolean) {
  localStorage.setItem(STORAGE_KEY, String(enabled))
}
