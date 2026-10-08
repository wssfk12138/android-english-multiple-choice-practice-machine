import { requestVocabularyRun, startVocabularyRequestWorker } from './vocabulary-request-runner'
import { queueTranslations } from './vocabulary'

export const startVocabularyTranslationWorker = startVocabularyRequestWorker
export async function queueAndStartVocabularyTranslations(entryIds: number[], source = 'automatic') {
  const queued = await queueTranslations(entryIds)
  try {
    const started = await requestVocabularyRun('translation', entryIds.length ? entryIds : undefined, { source })
    return { ...queued, ...started }
  } catch {
    // Unconfigured automatic work stays queued. Explicit actions report errors.
    return { ...queued, workerStarted: false }
  }
}
export function resumeVocabularyTranslations() { void startVocabularyRequestWorker() }
