import { enrichVocabularyEntry } from './ai'
import { row, rows, run } from './database'
import { optionalAppSetting, writeAppSetting } from './app-settings'
import { LocalApiError } from './errors'
import { morphologyLabel, safeObject } from '../../vocabulary-context'

// Device-local work. Never serialize jobs as learning results over LAN.
let worker: Promise<void> | null = null
export let vocabularyEnrichmentError = ''
export function reportVocabularyEnrichmentError(cause: unknown) { vocabularyEnrichmentError = String(cause).slice(0, 600) }
const pauseKey = 'vocabulary-enrichment-paused'
const migrationKey = 'vocabulary-enrichment-v4'
async function setting(key: string) { return optionalAppSetting(key) }
export async function pauseVocabularyEnrichment() { await writeAppSetting(pauseKey, '1') }
export async function resumeVocabularyEnrichment() { await writeAppSetting(pauseKey, '0') }
export async function queueMissingVocabularyEnrichment(limit = 200): Promise<number> {
  const result = await run(
    "INSERT INTO vocabulary_enrichment_jobs(entry_id) " +
    "SELECT id FROM vocabulary_entries WHERE translation_status = 'ready' " +
    "AND (COALESCE(phonetic,'')='' OR COALESCE(part_of_speech,'')='' OR COALESCE(common_meaning,'')='' OR COALESCE(memory_hint,'')='' " +
    "OR COALESCE(synonyms,'[]')='[]' OR COALESCE(antonyms,'[]')='[]' OR COALESCE(similar_forms,'[]')='[]' " +
    "OR NOT json_valid(morphology) OR COALESCE(json_extract(CASE WHEN json_valid(morphology) THEN morphology ELSE '{}' END,'$.currentForm'),'')='' " +
    "OR COALESCE(json_extract(CASE WHEN json_valid(morphology) THEN morphology ELSE '{}' END,'$.lemma'),'')='' " +
    "OR json_type(CASE WHEN json_valid(morphology) THEN morphology ELSE '{}' END,'$.forms') IS NULL " +
    "OR json_type(CASE WHEN json_valid(morphology) THEN morphology ELSE '{}' END,'$.note') IS NULL " +
    "OR COALESCE(json_extract(CASE WHEN json_valid(generated_example) THEN generated_example ELSE '{}' END,'$.sentence'),'')='' " +
    "OR COALESCE(json_extract(CASE WHEN json_valid(generated_example) THEN generated_example ELSE '{}' END,'$.translation'),'')='') " +
    "AND id NOT IN (SELECT entry_id FROM vocabulary_enrichment_jobs) " +
    "ORDER BY updated_at, id LIMIT ?", [limit])
  return result.changes
}
let inventory: Promise<void> | null = null
export function inventoryVocabularyEnrichment(): Promise<void> {
  if (!inventory) inventory = (async () => {
    if (await setting(migrationKey) === 'done') return
    while (await queueMissingVocabularyEnrichment(200) === 200) { await new Promise(resolve => setTimeout(resolve, 0)) }
    // Unknown labels need one controlled repair too. Existing jobs (including
    // checked empty results and failures) remain authoritative and are not reset.
    let afterId = 0
    while (true) {
      const batch = await rows<{id:number;morphology:string}>("SELECT id,morphology FROM vocabulary_entries WHERE id>? AND translation_status='ready' AND id NOT IN (SELECT entry_id FROM vocabulary_enrichment_jobs) ORDER BY id LIMIT 200", [afterId])
      for (const entry of batch) {
        const morphology = safeObject(entry.morphology)
        const labels = [morphology.currentForm, ...(Array.isArray(morphology.forms) ? morphology.forms.map((item: any) => item?.label) : [])]
        if (labels.some(label => morphologyLabel(label) === '词形待确认')) await queueVocabularyEnrichment(entry.id)
        afterId = entry.id
      }
      if (batch.length < 200) break
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    await writeAppSetting(migrationKey, 'done')
  })().finally(() => { inventory = null })
  return inventory
}
export async function vocabularyEnrichmentProgress() {
  const items = await rows<{ state: string; count: number }>('SELECT state, COUNT(*) AS count FROM vocabulary_enrichment_jobs GROUP BY state')
  const progress = { queued: 0, inflight: 0, ready: 0, failed: 0 }
  for (const item of items) {
    if (item.state in progress) progress[item.state as keyof typeof progress] = Number(item.count) || 0
  }
  const profile = await row<{name:string;default_model:string}>("SELECT name,default_model FROM ai_profiles WHERE enabled=1 AND TRIM(default_model)<>'' ORDER BY is_default DESC,id LIMIT 1")
  return { ...progress, paused: await setting(pauseKey) === '1', waiting_configuration: !profile, profile: profile ? `${profile.name} · ${profile.default_model}` : '', inventoried: await setting(migrationKey) === 'done' }
}
export async function queueVocabularyEnrichment(id: number, contextChanged = false): Promise<void> {
  await run("INSERT INTO vocabulary_enrichment_jobs(entry_id) VALUES (?) ON CONFLICT(entry_id) DO UPDATE SET state='queued', error='', updated_at=CURRENT_TIMESTAMP WHERE vocabulary_enrichment_jobs.state NOT IN ('queued','inflight') OR ? = 1", [id, contextChanged ? 1 : 0])
}
async function work(): Promise<void> {
  while (true) {
    if (await setting(pauseKey) === '1') return
    if (!await row("SELECT id FROM ai_profiles WHERE enabled=1 AND TRIM(default_model)<>'' ORDER BY is_default DESC,id LIMIT 1")) return
    const job = await row<{entry_id:number}>("SELECT entry_id FROM vocabulary_enrichment_jobs WHERE state='queued' ORDER BY updated_at,entry_id LIMIT 1")
    if (!job) return
    const claimed = await run("UPDATE vocabulary_enrichment_jobs SET state='inflight', error='', updated_at=CURRENT_TIMESTAMP WHERE entry_id=? AND state='queued'", [job.entry_id])
    if (!claimed.changes) continue
    try {
      await enrichVocabularyEntry(job.entry_id)
      await run("UPDATE vocabulary_enrichment_jobs SET state='ready', error='', updated_at=CURRENT_TIMESTAMP WHERE entry_id=? AND state='inflight'", [job.entry_id])
    } catch (cause) {
      reportVocabularyEnrichmentError(cause)
      await run("UPDATE vocabulary_enrichment_jobs SET state='failed', error=?, updated_at=CURRENT_TIMESTAMP WHERE entry_id=? AND state='inflight'", [String(cause).slice(0,600),job.entry_id])
      // Configuration/provider failures must not fan out across the remaining queue.
      if (!(cause instanceof LocalApiError) || cause.status === 400 || cause.status === 401 || cause.status === 429 || cause.status >= 500) return
    }
  }
}
export function startVocabularyEnrichmentWorker(): Promise<void> {
  if (!worker) {
    vocabularyEnrichmentError = ''
    worker = work().finally(() => { worker = null })
  }
  return worker
}
export async function requestVocabularyEnrichment(id: number): Promise<void> {
  await queueVocabularyEnrichment(id)
  await startVocabularyEnrichmentWorker()
  const job = await row<{state:string;error:string}>('SELECT state,error FROM vocabulary_enrichment_jobs WHERE entry_id=?', [id])
  if (job?.state === 'failed') throw new LocalApiError(502, job.error)
  if (job?.state !== 'ready') throw new LocalApiError(409, '补全已排队，请检查默认模型配置或恢复后台补全')
}

export async function retryPendingVocabularyEnrichments(): Promise<void> {
  // Retry existing requests only; never enrol every old ready word for paid enrichment.
  await run("UPDATE vocabulary_enrichment_jobs SET state='queued',error='',updated_at=CURRENT_TIMESTAMP WHERE state='failed'")
  await startVocabularyEnrichmentWorker()
}
