import { enrichVocabularyEntry } from './ai'
import { row, rows, run } from './database'
import { LocalApiError } from './errors'

// Device-local work. Never serialize jobs as learning results over LAN.
let worker: Promise<void> | null = null
let paused = false
export function pauseVocabularyEnrichment() { paused = true }
export function resumeVocabularyEnrichment() { paused = false; void startVocabularyEnrichmentWorker() }
export async function queueMissingVocabularyEnrichment(limit = 200): Promise<number> {
  const result = await run(
    "INSERT INTO vocabulary_enrichment_jobs(entry_id) " +
    "SELECT id FROM vocabulary_entries WHERE user_edited = 0 AND translation_status = 'ready' " +
    "AND (morphology IS NULL OR morphology = '' OR generated_example IS NULL OR generated_example = '') " +
    "AND id NOT IN (SELECT entry_id FROM vocabulary_enrichment_jobs) " +
    "ORDER BY updated_at, id LIMIT ?", [limit])
  return result.changes
}
export async function vocabularyEnrichmentProgress(): Promise<{ queued: number; inflight: number; ready: number; failed: number }> {
  const items = await rows<{ state: string; count: number }>('SELECT state, COUNT(*) AS count FROM vocabulary_enrichment_jobs GROUP BY state')
  const progress = { queued: 0, inflight: 0, ready: 0, failed: 0 }
  for (const item of items) {
    if (item.state in progress) progress[item.state as keyof typeof progress] = Number(item.count) || 0
  }
  return progress
}
export async function queueVocabularyEnrichment(id: number, contextChanged = false): Promise<void> {
  await run("INSERT INTO vocabulary_enrichment_jobs(entry_id) VALUES (?) ON CONFLICT(entry_id) DO UPDATE SET state='queued', error='', updated_at=CURRENT_TIMESTAMP WHERE vocabulary_enrichment_jobs.state NOT IN ('queued','inflight') OR ? = 1", [id, contextChanged ? 1 : 0])
}
async function work(): Promise<void> {
  while (true) {
    if (paused) return
    const job = await row<{entry_id:number}>("SELECT entry_id FROM vocabulary_enrichment_jobs WHERE state='queued' ORDER BY updated_at,entry_id LIMIT 1")
    if (!job) return
    const claimed = await run("UPDATE vocabulary_enrichment_jobs SET state='inflight', error='', updated_at=CURRENT_TIMESTAMP WHERE entry_id=? AND state='queued'", [job.entry_id])
    if (!claimed.changes) continue
    try {
      await enrichVocabularyEntry(job.entry_id)
      await run("UPDATE vocabulary_enrichment_jobs SET state='ready', error='', updated_at=CURRENT_TIMESTAMP WHERE entry_id=? AND state='inflight'", [job.entry_id])
    } catch (cause) {
      await run("UPDATE vocabulary_enrichment_jobs SET state='failed', error=?, updated_at=CURRENT_TIMESTAMP WHERE entry_id=? AND state='inflight'", [String(cause).slice(0,600),job.entry_id])
      // Configuration/provider failures must not fan out across the remaining queue.
      if (!(cause instanceof LocalApiError) || cause.status === 400 || cause.status === 401 || cause.status === 429 || cause.status >= 500) return
    }
  }
}
export function startVocabularyEnrichmentWorker(): Promise<void> {
  if (!worker) worker = work().finally(() => { worker = null })
  return worker
}
export async function requestVocabularyEnrichment(id: number): Promise<void> {
  await queueVocabularyEnrichment(id)
  await startVocabularyEnrichmentWorker()
  const job = await row<{state:string;error:string}>('SELECT state,error FROM vocabulary_enrichment_jobs WHERE entry_id=?', [id])
  if (job?.state === 'failed') throw new LocalApiError(502, job.error)
}

export async function retryPendingVocabularyEnrichments(): Promise<void> {
  // Retry existing requests only; never enrol every old ready word for paid enrichment.
  await run("UPDATE vocabulary_enrichment_jobs SET state='queued',error='',updated_at=CURRENT_TIMESTAMP WHERE state='failed'")
  await startVocabularyEnrichmentWorker()
}
