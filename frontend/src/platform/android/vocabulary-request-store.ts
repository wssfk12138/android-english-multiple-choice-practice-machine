import type { SQLiteDBConnection } from '@capacitor-community/sqlite'
import { dbExecutor, rows, row, transaction } from './database'
import { LocalApiError } from './errors'
import type { VocabularyBatchResult, VocabularyTask } from './vocabulary-request-result'

export const VOCABULARY_REQUEST_LIMIT = 4
export const VOCABULARY_RUN_MS = 10 * 60_000
export const VOCABULARY_REQUEST_MS = 240_000
export const VOCABULARY_TRANSLATION_BATCH = 8
export interface VocabularyConfiguration { hash: string; summary: string }
type RecordValue = Record<string, any>
type Executor = ReturnType<typeof dbExecutor>
const atomic = <T>(operation: (sql: Executor) => Promise<T>) => transaction(db => operation(dbExecutor(db)), { exclusive: true })
const placeholders = (ids: number[]) => ids.map(() => '?').join(',')
const safeIds = (ids: number[]) => [...new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0))]
const runClocks = new Map<string, { wall: number; monotonic: number }>()
async function contentFingerprint(sql: Executor, id: number) {
  const entry = await sql.row('SELECT * FROM vocabulary_entries WHERE id=?', [id])
  const occurrences = await sql.rows('SELECT * FROM vocabulary_occurrences WHERE entry_id=? ORDER BY id', [id])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([entry, occurrences])))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
export interface VocabularyClaim { id: string; runId: string; task: VocabularyTask; ids: number[]; configHash: string }
type VocabularyPreSendReason = 'configuration' | 'content_changed' | 'stopped'
export class VocabularyPreSendAbort extends LocalApiError {
  constructor(readonly reason: VocabularyPreSendReason, message: string) { super(409, message) }
}

async function eligible(sql: Executor, task: VocabularyTask, ids?: number[], retry = false): Promise<number[]> {
  if (ids && !ids.length) return []
  const selection = ids ? ` AND v.id IN (${placeholders(ids)})` : ''
  const query = task === 'translation'
    ? `SELECT v.id FROM vocabulary_entries v WHERE v.user_edited=0 AND v.translation_status IN (${retry ? "'pending','failed','queued'" : "'pending','queued'"})${selection} ORDER BY v.updated_at,v.id`
    : `SELECT v.id FROM vocabulary_entries v JOIN vocabulary_enrichment_jobs j ON j.entry_id=v.id WHERE j.state IN (${retry ? "'failed','queued'" : "'queued'"})${selection} ORDER BY j.updated_at,v.id`
  return (await sql.rows<{id:number}>(query, ids || [])).map(item => Number(item.id))
}

export async function vocabularyRequestStatus() {
  const gate = await row<RecordValue>('SELECT * FROM vocabulary_request_gate WHERE id=1')
  const unknown = await rows<RecordValue>("SELECT id,task,ids,created_at,category FROM vocabulary_request_attempts WHERE state='unknown' ORDER BY created_at")
  const runs = await rows<RecordValue>("SELECT r.id,r.task,r.state,r.used,r.explicit,COUNT(m.entry_id) AS remaining FROM vocabulary_request_runs r LEFT JOIN vocabulary_request_members m ON m.run_id=r.id AND m.state='queued' WHERE r.state IN ('running','stopped') GROUP BY r.id ORDER BY r.started_at")
  const retryTranslation = (await rows<{id:number}>("SELECT id FROM vocabulary_entries WHERE user_edited=0 AND translation_status='failed' ORDER BY id")).map(item => Number(item.id))
  const retryEnrichment = (await rows<{entry_id:number}>("SELECT entry_id FROM vocabulary_enrichment_jobs WHERE state='failed' ORDER BY entry_id")).map(item => Number(item.entry_id))
  const pendingTranslation = await eligible(dbExecutor(), 'translation')
  const pendingEnrichment = await eligible(dbExecutor(), 'enrichment')
  return { reason: String(gate?.reason || ''), used: Number(gate?.used || 0), limit: VOCABULARY_REQUEST_LIMIT,
    active: Boolean(gate?.allowed_run || runs.some(item => item.state === 'running' && !gate?.reason)),
    unknown: unknown.map(item => ({ ...item, ids: JSON.parse(item.ids) as number[] })), runs,
    pending: { translation: pendingTranslation.length, enrichment: pendingEnrichment.length },
    pendingIds: { translation: pendingTranslation, enrichment: pendingEnrichment },
    retryIds: { translation: retryTranslation, enrichment: retryEnrichment } }
}

// The frequently polled progress notice needs a small, read-only snapshot,
// not all pending IDs or diagnostic history.
export async function vocabularyRequestQueueState() {
  const gate = await row<RecordValue>('SELECT reason,allowed_run FROM vocabulary_request_gate WHERE id=1')
  const current = await row<{task:string}>("SELECT task FROM vocabulary_request_runs WHERE state='running' AND (?='' OR id=?) ORDER BY started_at,id LIMIT 1", [gate?.reason || '', gate?.allowed_run || ''])
  const unknown = await row("SELECT 1 FROM vocabulary_request_attempts WHERE state='unknown' LIMIT 1")
  const profile = await row("SELECT id FROM ai_profiles WHERE enabled=1 AND TRIM(default_model)<>'' LIMIT 1")
  return { reason: unknown ? 'unknown' : String(gate?.reason || ''), active: Boolean(current), task: current?.task || '', waitingConfiguration: !profile }
}

/** A command freezes the validated member set. Automatic events never expand a live run. */
export async function createVocabularyRun(task: VocabularyTask, ids: number[] | undefined, config: VocabularyConfiguration,
  source: string, explicit = false, retry = false, commandId: string = crypto.randomUUID(), transmissionActive = false): Promise<string | null> {
  return atomic(async sql => {
    const signature = JSON.stringify([task, ids === undefined ? null : safeIds(ids), source, explicit, retry])
    const prior = await sql.row<{id:string;command_signature:string}>('SELECT id,command_signature FROM vocabulary_request_runs WHERE command_id=?', [commandId])
    if (prior) {
      if (signature !== prior.command_signature) throw new LocalApiError(409, '该操作标识已用于其他范围')
      return prior.id
    }
    const bulkRetry = explicit && retry && task === 'translation' && source === 'retry-all' && ids === undefined
    if (bulkRetry) {
      const gate = (await sql.row<RecordValue>('SELECT * FROM vocabulary_request_gate WHERE id=1'))!
      const active = await sql.row<RecordValue>("SELECT * FROM vocabulary_request_runs WHERE state='running' AND (?='' OR id=?) ORDER BY started_at,id LIMIT 1", [gate.reason, gate.allowed_run || ''])
      if (active) {
        if (active.config_hash !== config.hash) throw new LocalApiError(409, '模型配置已变化，请先停止当前任务')
        if (await sql.row("SELECT 1 FROM vocabulary_request_attempts WHERE state='unknown' LIMIT 1")) throw new LocalApiError(409, '上次请求结果未知，请先核查费用和结果')
        const members = await eligible(sql, task, undefined, true)
        const receipt = crypto.randomUUID()
        // Record each explicit command without renewing the live segment's budget.
        // Translation joins its current run; enrichment keeps its transmission slot
        // and the translation run follows it under the same shared budget.
        const target = active.task === task ? active.id : receipt
        await sql.run('INSERT INTO vocabulary_request_runs(id,command_id,command_signature,task,config_hash,config_summary,source,started_at,explicit,state) VALUES(?,?,?,?,?,?,?,?,?,?)',
          [receipt, commandId, signature, task, config.hash, config.summary, source, active.started_at, 0, active.task === task ? 'done' : 'running'])
        for (const entryId of members) {
          await sql.run("UPDATE vocabulary_request_members SET state='superseded' WHERE entry_id=? AND state='queued' AND run_id<>? AND run_id IN (SELECT id FROM vocabulary_request_runs WHERE task=?)", [entryId, target, task])
          await sql.run("INSERT INTO vocabulary_request_members(run_id,entry_id) VALUES(?,?) ON CONFLICT(run_id,entry_id) DO UPDATE SET state='queued'", [target, entryId])
          await sql.run("UPDATE vocabulary_entries SET translation_status='queued',translation_error='' WHERE id=? AND user_edited=0", [entryId])
        }
        await sql.run("UPDATE vocabulary_request_gate SET reason='' WHERE id=1")
        return target
      }
    }
    if (transmissionActive) {
      if (explicit) throw new LocalApiError(409, '当前请求尚未结束，请稍后操作')
      return null
    }
    const gate = (await sql.row<RecordValue>('SELECT * FROM vocabulary_request_gate WHERE id=1'))!
    if (await sql.row("SELECT 1 FROM vocabulary_request_attempts WHERE state IN ('intent','inflight') LIMIT 1")) {
      if (explicit) throw new LocalApiError(409, '当前请求尚未结束，请稍后重试')
      return null
    }
    const scopedRetry = explicit && retry && (ids !== undefined || bulkRetry)
    const unknown = await sql.rows<{id:string;task:string;ids:string}>("SELECT id,task,ids FROM vocabulary_request_attempts WHERE state='unknown'")
    if (unknown.length && !scopedRetry) {
      if (explicit) throw new LocalApiError(409, '上次请求结果未知，已停止；如需重发，请点击重试按钮，可能重复产生费用')
      return null
    }
    if (gate.reason && !explicit) return null
    if (await sql.row("SELECT 1 FROM vocabulary_request_runs WHERE state='running' LIMIT 1")) {
      if (explicit) throw new LocalApiError(409, '已有本段任务正在运行，请先暂停或等待结束')
      return null
    }
    const members = await eligible(sql, task, ids === undefined ? undefined : safeIds(ids), retry)
    if (!members.length) return null
    // An existing retry button is explicit consent to resend only its scope.
    // Acknowledge the old batch as a record, never requeue its other members.
    // Unrelated unknown batches remain blocked for automatic work/continue.
    if (scopedRetry) for (const attempt of unknown) {
      if (attempt.task === task && JSON.parse(attempt.ids).some((id: number) => members.includes(id))) {
        await sql.run("UPDATE vocabulary_request_attempts SET state='acknowledged',finished_at=? WHERE id=? AND state='unknown'", [Date.now(), attempt.id])
      }
    }
    const now = Date.now()
    if (!explicit && (gate.used >= VOCABULARY_REQUEST_LIMIT || (gate.started_at && (now < gate.started_at || now - gate.started_at >= VOCABULARY_RUN_MS)))) {
      await sql.run("UPDATE vocabulary_request_gate SET reason='budget',allowed_run=NULL WHERE id=1")
      return null
    }
    const id = crypto.randomUUID()
    await sql.run('INSERT INTO vocabulary_request_runs(id,command_id,command_signature,task,config_hash,config_summary,source,started_at,explicit) VALUES(?,?,?,?,?,?,?,?,?)',
      [id, commandId, signature, task, config.hash, config.summary, source, now, explicit ? 1 : 0])
    for (const entryId of members) {
      // Supersede only unsent memberships of this task and this explicit scope.
      await sql.run("UPDATE vocabulary_request_members SET state='superseded' WHERE entry_id=? AND state='queued' AND run_id IN (SELECT id FROM vocabulary_request_runs WHERE task=?)", [entryId, task])
      await sql.run('INSERT INTO vocabulary_request_members(run_id,entry_id) VALUES(?,?)', [id, entryId])
      if (task === 'translation') await sql.run("UPDATE vocabulary_entries SET translation_status='queued',translation_error='' WHERE id=? AND user_edited=0", [entryId])
      else await sql.run("UPDATE vocabulary_enrichment_jobs SET state='queued',error='' WHERE entry_id=?", [entryId])
    }
    if (explicit) await sql.run('UPDATE vocabulary_request_gate SET allowed_run=?,used=0,started_at=? WHERE id=1', [id, now])
    else await sql.run('UPDATE vocabulary_request_gate SET started_at=CASE WHEN started_at=0 THEN ? ELSE started_at END WHERE id=1', [now])
    return id
  })
}

export async function pauseVocabularyRequests() {
  await atomic(async sql => {
    await sql.run("UPDATE vocabulary_request_gate SET reason='user',allowed_run=NULL WHERE id=1")
    await sql.run("UPDATE vocabulary_request_runs SET state='stopped' WHERE state='running'")
  })
}
export async function invalidateVocabularyConfiguration() {
  await atomic(async sql => {
    const active = await sql.row("SELECT 1 FROM vocabulary_request_runs WHERE state='running' LIMIT 1")
    if (!active) return
    await sql.run("UPDATE vocabulary_request_runs SET state='stopped' WHERE state='running'")
    await sql.run("UPDATE vocabulary_request_gate SET reason=CASE WHEN reason IN ('user','unknown') THEN reason ELSE 'configuration' END,allowed_run=NULL WHERE id=1")
  })
}
async function stop(sql: Executor, runId: string, reason: string) {
  // Both tasks can share this segment after an explicit bulk retry. A shared
  // gate stop must also stop the deferred run, so a later retry can renew it.
  runClocks.clear()
  await sql.run("UPDATE vocabulary_request_runs SET state='stopped' WHERE state='running' OR id=?", [runId])
  await sql.run("UPDATE vocabulary_request_gate SET reason=CASE WHEN reason='user' THEN reason ELSE ? END,allowed_run=NULL WHERE id=1", [reason])
}

export async function claimVocabularyBatch(config: VocabularyConfiguration): Promise<VocabularyClaim | null> {
  const result = await atomic(async sql => {
    const gate = (await sql.row<RecordValue>('SELECT * FROM vocabulary_request_gate WHERE id=1'))!
    if (await sql.row("SELECT 1 FROM vocabulary_request_attempts WHERE state IN ('intent','inflight') LIMIT 1")) return null
    const current = await sql.row<RecordValue>("SELECT * FROM vocabulary_request_runs WHERE state='running' AND (?='' OR id=?) ORDER BY started_at,id LIMIT 1", [gate.reason, gate.allowed_run || ''])
    if (!current) return null
    const scopedRetry = current.explicit && gate.allowed_run === current.id && JSON.parse(current.command_signature)[4] === true
    if (!scopedRetry && await sql.row("SELECT 1 FROM vocabulary_request_attempts WHERE state='unknown' LIMIT 1")) return null
    const now = Date.now()
    const clock = runClocks.get(current.id) || { wall: now, monotonic: performance.now() }
    runClocks.set(current.id, clock)
    const elapsed = Math.max(now - current.started_at, now - gate.started_at,
      clock.wall - Math.min(current.started_at, gate.started_at) + performance.now() - clock.monotonic)
    if (config.hash !== current.config_hash) { await stop(sql, current.id, 'configuration'); return null }
    if (now < current.started_at || elapsed > VOCABULARY_RUN_MS - VOCABULARY_REQUEST_MS
      || gate.used >= VOCABULARY_REQUEST_LIMIT || current.used >= VOCABULARY_REQUEST_LIMIT) { await stop(sql, current.id, 'budget'); return null }
    const candidates = (await sql.rows<{entry_id:number}>("SELECT entry_id FROM vocabulary_request_members WHERE run_id=? AND state='queued' ORDER BY entry_id", [current.id])).map(item => Number(item.entry_id))
    const ids = await eligible(sql, current.task, candidates)
    for (const id of candidates.filter(id => !ids.includes(id))) await sql.run("UPDATE vocabulary_request_members SET state='skipped' WHERE run_id=? AND entry_id=?", [current.id, id])
    if (!ids.length) {
      await sql.run("UPDATE vocabulary_request_runs SET state='done',finished_at=? WHERE id=?", [now, current.id])
      await sql.run('UPDATE vocabulary_request_gate SET allowed_run=NULL WHERE allowed_run=?', [current.id])
      runClocks.delete(current.id)
      return 'next' as const
    }
    const claimed = ids.slice(0, current.task === 'translation' ? VOCABULARY_TRANSLATION_BATCH : 1)
    const id = crypto.randomUUID()
    for (const entryId of claimed) {
      await sql.run("UPDATE vocabulary_request_members SET state='intent' WHERE run_id=? AND entry_id=? AND state='queued'", [current.id, entryId])
      await sql.run('INSERT OR REPLACE INTO vocabulary_request_heads(task,entry_id,attempt_id) VALUES(?,?,?)', [current.task, entryId, id])
      if (current.task === 'translation') await sql.run("UPDATE vocabulary_entries SET translation_status='translating',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_edited=0 AND translation_status='queued'", [entryId])
      else await sql.run("UPDATE vocabulary_enrichment_jobs SET state='inflight',error='' WHERE entry_id=? AND state='queued'", [entryId])
    }
    const fingerprints: Record<number, string> = {}
    for (const entryId of claimed) fingerprints[entryId] = await contentFingerprint(sql, entryId)
    await sql.run("INSERT INTO vocabulary_request_attempts(id,run_id,task,state,ids,fingerprints,created_at) VALUES(?,?,?,'intent',?,?,?)", [id, current.id, current.task, JSON.stringify(claimed), JSON.stringify(fingerprints), now])
    await sql.run('UPDATE vocabulary_request_runs SET used=used+1 WHERE id=?', [current.id])
    await sql.run('UPDATE vocabulary_request_gate SET used=used+1 WHERE id=1')
    return { id, runId: current.id, task: current.task as VocabularyTask, ids: claimed, configHash: current.config_hash }
  })
  return result === 'next' ? claimVocabularyBatch(config) : result
}

export async function markVocabularySent(claim: VocabularyClaim, config: VocabularyConfiguration) {
  await atomic(async sql => {
    const gate = (await sql.row<RecordValue>('SELECT * FROM vocabulary_request_gate WHERE id=1'))!
    const activeRun = await sql.row<RecordValue>('SELECT state FROM vocabulary_request_runs WHERE id=?', [claim.runId])
    if (config.hash !== claim.configHash || activeRun?.state !== 'running' || (gate.reason && gate.allowed_run !== claim.runId)) {
      throw new VocabularyPreSendAbort(config.hash !== claim.configHash ? 'configuration' : 'stopped', '请求发送前已停止或配置发生变化')
    }
    const attempt = await sql.row<{fingerprints:string}>('SELECT fingerprints FROM vocabulary_request_attempts WHERE id=?', [claim.id])
    const fingerprints = JSON.parse(attempt?.fingerprints || '{}')
    for (const id of claim.ids) if (fingerprints[id] !== await contentFingerprint(sql, id)) throw new VocabularyPreSendAbort('content_changed', '词条或语境在发送前发生变化')
    const updated = await sql.run("UPDATE vocabulary_request_attempts SET state='inflight' WHERE id=? AND state='intent'", [claim.id])
    if (!updated.changes) throw new LocalApiError(409, '请求尝试已经结束')
  })
}

/** Only a live worker can prove this intent never reached transport; crash recovery stays conservative. */
export async function abortVocabularyBeforeSend(claim: VocabularyClaim, reason: VocabularyPreSendReason) {
  await atomic(async sql => {
    const attempt = await sql.row<{state:string}>('SELECT state FROM vocabulary_request_attempts WHERE id=?', [claim.id])
    if (attempt?.state !== 'intent') throw new LocalApiError(409, '无法确认请求尚未发送，保持停止')
    for (const id of claim.ids) {
      const head = await sql.row<{attempt_id:string}>('SELECT attempt_id FROM vocabulary_request_heads WHERE task=? AND entry_id=?', [claim.task, id])
      if (head?.attempt_id !== claim.id) throw new LocalApiError(409, '请求尝试已变化，保持停止')
    }
    const gate = (await sql.row<RecordValue>('SELECT * FROM vocabulary_request_gate WHERE id=1'))!
    const stopReason = gate.reason || (reason === 'stopped' ? 'configuration' : reason)
    // Do not refund the reserved request, or repeated pause/continue could bypass the limit.
    await sql.run("UPDATE vocabulary_request_attempts SET state='done',category=?,finished_at=? WHERE id=?",
      [`not_sent_${reason === 'stopped' && gate.reason === 'user' ? 'user' : reason}`, Date.now(), claim.id])
    for (const id of claim.ids) {
      await sql.run("UPDATE vocabulary_request_members SET state='queued' WHERE run_id=? AND entry_id=? AND state='intent'", [claim.runId, id])
      if (claim.task === 'translation') await sql.run("UPDATE vocabulary_entries SET translation_status='queued',translation_error='' WHERE id=? AND user_edited=0 AND translation_status='translating'", [id])
      else await sql.run("UPDATE vocabulary_enrichment_jobs SET state='queued',error='' WHERE entry_id=? AND state='inflight'", [id])
    }
    await stop(sql, claim.runId, stopReason)
  })
}

export async function currentVocabularyAttempt(db: SQLiteDBConnection, claim: VocabularyClaim): Promise<boolean> {
  const sql = dbExecutor(db)
  const attempt = await sql.row<{state:string}>('SELECT state FROM vocabulary_request_attempts WHERE id=?', [claim.id])
  if (!attempt || !['intent','inflight','unknown','acknowledged'].includes(attempt.state)) return false
  for (const id of claim.ids) {
    if ((await sql.row<{attempt_id:string}>('SELECT attempt_id FROM vocabulary_request_heads WHERE task=? AND entry_id=?', [claim.task, id]))?.attempt_id !== claim.id) return false
  }
  return true
}

/** Called in the same transaction as content writes: durable confirmation cannot lag content. */
export async function commitVocabularyResult(db: SQLiteDBConnection, claim: VocabularyClaim, result: VocabularyBatchResult) {
  const sql = dbExecutor(db)
  if (!await currentVocabularyAttempt(db, claim)) {
    // Superseded responses leave only controlled metadata; duplicate completed callbacks are ignored.
    await sql.run("UPDATE vocabulary_request_attempts SET result=?,category='superseded_response',finished_at=? WHERE id=? AND state IN ('unknown','acknowledged')",
      [JSON.stringify(result), Date.now(), claim.id])
    return
  }
  const bad = Object.keys(result.invalid).length > 0 || Boolean(result.failure)
  await sql.run('UPDATE vocabulary_request_attempts SET state=?,result=?,category=?,finished_at=? WHERE id=?',
    [result.failure === 'unknown' ? 'unknown' : bad ? 'failed' : 'done', JSON.stringify(result), result.failure || (bad ? 'validation' : ''), Date.now(), claim.id])
  for (const id of claim.ids) {
    const state = result.writtenIds.includes(id) ? 'done' : result.skipped[id] ? 'skipped' : 'failed'
    await sql.run('UPDATE vocabulary_request_members SET state=? WHERE run_id=? AND entry_id=?', [state, claim.runId, id])
    if (claim.task === 'translation' && state !== 'done') await sql.run("UPDATE vocabulary_entries SET translation_status='failed',translation_error=? WHERE id=? AND user_edited=0 AND translation_status='translating'", [result.invalid[id] || '词条状态变化或结果未知，请检查任务状态', id])
    if (claim.task === 'enrichment') await sql.run('UPDATE vocabulary_enrichment_jobs SET state=?,error=? WHERE entry_id=? AND state=\'inflight\'', [state === 'done' ? 'ready' : 'failed', state === 'done' ? '' : result.invalid[id] || '词条已修改或请求结果未知', id])
  }
  if (bad) await stop(sql, claim.runId, result.failure || 'validation')
  else {
    const gate = await sql.row<RecordValue>('SELECT * FROM vocabulary_request_gate WHERE id=1')
    if (gate?.used >= VOCABULARY_REQUEST_LIMIT) await stop(sql, claim.runId, 'budget')
    else if (!await sql.row("SELECT 1 FROM vocabulary_request_members WHERE run_id=? AND state='queued' LIMIT 1", [claim.runId])) {
      await sql.run("UPDATE vocabulary_request_runs SET state='done',finished_at=? WHERE id=?", [Date.now(), claim.runId])
      runClocks.delete(claim.runId)
      await sql.run('UPDATE vocabulary_request_gate SET allowed_run=NULL WHERE allowed_run=?', [claim.runId])
    }
  }
}

export async function failVocabularyAttempt(claim: VocabularyClaim, result: VocabularyBatchResult) {
  await transaction(db => commitVocabularyResult(db, claim, result), { exclusive: true })
}

export async function acknowledgeVocabularyUnknown(attemptId: string) {
  await atomic(async sql => {
    const result = await sql.run("UPDATE vocabulary_request_attempts SET state='acknowledged',finished_at=? WHERE id=? AND state='unknown'", [Date.now(), attemptId])
    if (!result.changes) throw new LocalApiError(409, '该未知批次已处理，请刷新状态')
    // Other unknown batches remain blocking; acknowledging never starts a worker.
    if (!await sql.row("SELECT 1 FROM vocabulary_request_attempts WHERE state='unknown' LIMIT 1")) await sql.run("UPDATE vocabulary_request_gate SET reason=CASE WHEN reason='unknown' THEN 'user' ELSE reason END,allowed_run=NULL WHERE id=1")
  })
}

export async function cleanVocabularyRequestDiagnostics() {
  await atomic(async sql => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60_000
    await sql.run(`UPDATE vocabulary_request_attempts SET result=NULL WHERE state IN ('done','failed','acknowledged')
      AND (created_at<? OR id NOT IN (SELECT id FROM vocabulary_request_attempts ORDER BY created_at DESC LIMIT 2000))`, [cutoff])
    await sql.run(`DELETE FROM vocabulary_request_attempts WHERE state IN ('done','failed','acknowledged')
      AND id NOT IN (SELECT attempt_id FROM vocabulary_request_heads)
      AND (created_at<? OR id NOT IN (SELECT id FROM vocabulary_request_attempts ORDER BY created_at DESC LIMIT 2000))
      AND (run_id IS NULL OR run_id IN (SELECT id FROM vocabulary_request_runs WHERE state='done'))`, [cutoff])
  })
}
