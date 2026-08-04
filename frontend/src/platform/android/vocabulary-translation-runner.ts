import { translateVocabularyEntries } from './ai'
import { rows, run } from './database'
import { queueTranslations } from './vocabulary'

let worker: Promise<void> | null = null

async function pendingIds(limit = 40): Promise<number[]> {
  return (await rows<{ id: number }>(
    `SELECT id FROM vocabulary_entries
     WHERE user_edited = 0 AND translation_status = 'queued'
     ORDER BY updated_at, id LIMIT ?`,
    [limit],
  )).map(item => Number(item.id))
}

async function work() {
  while (true) {
    const ids = await pendingIds()
    if (!ids.length) return
    try {
      const translated = await translateVocabularyEntries(ids)
      if (!translated) return
      // A partial model response must not spin indefinitely. Keep unmatched
      // entries visible as failed so the user can retry them explicitly.
      await run(
        `UPDATE vocabulary_entries SET translation_status = 'failed',
          translation_error = '模型没有返回该单词的有效翻译',
          updated_at = CURRENT_TIMESTAMP
         WHERE id IN (${ids.map(() => '?').join(',')})
           AND translation_status = 'queued'`,
        ids,
      )
    } catch (cause) {
      await run(
        `UPDATE vocabulary_entries SET translation_status = 'failed',
          translation_error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id IN (${ids.map(() => '?').join(',')})
           AND translation_status = 'queued'`,
        [String(cause).slice(0, 600), ...ids],
      )
      return
    }
  }
}

export function startVocabularyTranslationWorker(): Promise<void> {
  if (!worker) {
    worker = work().finally(() => { worker = null })
  }
  return worker
}

export async function queueAndStartVocabularyTranslations(entryIds: number[]) {
  const queued = await queueTranslations(entryIds)
  void startVocabularyTranslationWorker()
  return queued
}

export function resumeVocabularyTranslations() {
  void startVocabularyTranslationWorker()
}
