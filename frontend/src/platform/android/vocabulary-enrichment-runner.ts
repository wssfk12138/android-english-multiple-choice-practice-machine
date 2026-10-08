import { row, rows, run } from './database'
import { optionalAppSetting, writeAppSetting } from './app-settings'
import { LocalApiError } from './errors'
import { morphologyLabel, safeObject } from '../../vocabulary-context'
import { requestVocabularyRun, startVocabularyRequestWorker } from './vocabulary-request-runner'
import { pauseVocabularyRequests, vocabularyRequestStatus } from './vocabulary-request-store'

export let vocabularyEnrichmentError = ''
export function reportVocabularyEnrichmentError(_cause: unknown) { vocabularyEnrichmentError = '词汇任务已停止，请查看任务状态' }
const migrationKey = 'vocabulary-enrichment-v4'
async function setting(key: string) { return optionalAppSetting(key) }
export async function pauseVocabularyEnrichment() { await pauseVocabularyRequests() }
export async function resumeVocabularyEnrichment(commandId?: string) {
  await requestVocabularyRun('enrichment', undefined, { explicit: true, commandId, source: 'continue' })
}
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
  for (const item of items) if (item.state in progress) progress[item.state as keyof typeof progress] = Number(item.count) || 0
  const profile = await row<{name:string;default_model:string}>("SELECT name,default_model FROM ai_profiles WHERE enabled=1 AND TRIM(default_model)<>'' ORDER BY is_default DESC,id LIMIT 1")
  const scheduler = await vocabularyRequestStatus()
  return { ...progress, paused: Boolean(scheduler.reason), scheduler, waiting_configuration: !profile,
    profile: profile ? profile.name + ' · ' + profile.default_model : '', inventoried: await setting(migrationKey) === 'done' }
}
export async function queueVocabularyEnrichment(id: number, contextChanged = false): Promise<void> {
  await run("INSERT INTO vocabulary_enrichment_jobs(entry_id) VALUES (?) ON CONFLICT(entry_id) DO UPDATE SET state='queued', error='', updated_at=CURRENT_TIMESTAMP WHERE vocabulary_enrichment_jobs.state = 'ready' OR (vocabulary_enrichment_jobs.state = 'queued' AND ? = 1)", [id, contextChanged ? 1 : 0])
}
export function startVocabularyEnrichmentWorker(): Promise<void> {
  return requestVocabularyRun('enrichment', undefined, { source: 'maintenance' }).then(() => startVocabularyRequestWorker())
}
export async function requestVocabularyEnrichment(id: number, commandId?: string): Promise<void> {
  if (!await row('SELECT id FROM vocabulary_entries WHERE id=?', [id])) throw new LocalApiError(404, '单词不存在')
  // An explicit detail action creates a job only for this word.
  await run('INSERT OR IGNORE INTO vocabulary_enrichment_jobs(entry_id) VALUES(?)', [id])
  await requestVocabularyRun('enrichment', [id], { explicit: true, retry: true, commandId, source: 'detail' })
}
export async function retryPendingVocabularyEnrichments(ids?: number[], commandId?: string): Promise<void> {
  const selected = ids || (await rows<{entry_id:number}>("SELECT entry_id FROM vocabulary_enrichment_jobs WHERE state='failed' ORDER BY entry_id")).map(item => Number(item.entry_id))
  await requestVocabularyRun('enrichment', selected, { explicit: true, retry: true, commandId, source: 'retry' })
}
