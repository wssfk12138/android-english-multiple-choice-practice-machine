import { row, run } from './database'

type RecordValue = Record<string, any>

export function readSnapshot(raw: string): RecordValue {
  const snapshot = JSON.parse(raw || '{}')
  const record = (v: any) => v && typeof v === 'object' && !Array.isArray(v)
  if (!record(snapshot)) throw new Error('练习内容快照格式不兼容，请升级应用后重试')
  if (!Object.keys(snapshot).length) return {}
  if (snapshot.version !== 1 || !Array.isArray(snapshot.units)) throw new Error('练习内容快照格式不兼容，请升级应用后重试')
  const keys = new Set<string>()
  if (typeof snapshot.revision !== 'string' || !snapshot.revision || snapshot.units.length > 1000) throw new Error('练习内容快照格式无效')
  for (const unit of snapshot.units) {
    if (!record(unit) || typeof unit.unit_key !== 'string' || !unit.unit_key || keys.has(unit.unit_key) || !record(unit.payload) || !Array.isArray(unit.questions)) throw new Error('练习内容快照篇目无效')
    keys.add(unit.unit_key)
    const questions = new Set<string>()
    for (const q of unit.questions) {
      if (!record(q) || typeof q.question_key !== 'string' || !q.question_key || questions.has(q.question_key) || !record(q.payload)
        || typeof q.answer !== 'string' || !Number.isFinite(q.payload.score) || q.payload.score < 0 || !Array.isArray(q.payload.options) || !Array.isArray(q.payload.option_order)) throw new Error('练习内容快照评分依据无效')
      questions.add(q.question_key)
    }
  }
  return snapshot
}

// Content package metadata and revision identify the installed package, not the
// scoring material. Numeric JSON representation is normalized, while all text,
// options, ordering and scoring fields remain strict.
export function snapshotsEquivalent(left: RecordValue, right: RecordValue): boolean {
  const normalize = (value: any, path: string[] = []): any => {
    if (typeof value === 'number') return Number(value)
    if (Array.isArray(value)) return value.map((item, index) => normalize(item, [...path, String(index)]))
    if (value && typeof value === 'object') {
      const out: RecordValue = {}
      for (const key of Object.keys(value).sort()) {
        if (path.length === 0 && key === 'revision') continue
        if (path[path.length - 1] === 'shared_data' && (key === 'content_package_id' || key === 'content_version')) continue
        out[key] = normalize(value[key], [...path, key])
      }
      return out
    }
    return value
  }
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

// Invoke in the content-upgrade transaction before changing any question.
export async function captureSession(sessionId: number, revision: string): Promise<void> {
  const session = await row<RecordValue>('SELECT * FROM practice_sessions WHERE id=?', [sessionId])
  if (Object.keys(readSnapshot(session!.content_snapshot)).length) return
  const { getSession } = await import('./practice')
  const response = await getSession(sessionId)
  const units = []
  for (const unit of response.units) {
    const original = await row<RecordValue>('SELECT external_key FROM units WHERE id=?', [unit.id])
    const {id, paper_id, questions: displayed, submission, ...payload} = unit
    const questions = []
    for (const question of displayed) {
      const originalQuestion = await row<RecordValue>('SELECT external_key,answer FROM questions WHERE id=?', [question.id])
      const {id, user_answer, is_correct, answer, ...questionPayload} = question
      questions.push({question_key: originalQuestion!.external_key, answer: originalQuestion!.answer, payload: questionPayload})
    }
    units.push({unit_key: original!.external_key, payload, questions})
  }
  await run('UPDATE practice_sessions SET content_snapshot=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [JSON.stringify({version: 1, revision, units}), sessionId])
}

export async function restoreUnit(snapshot: RecordValue, unitId: number): Promise<RecordValue | null> {
  if (!Object.keys(snapshot).length) return null
  const unit = await row<RecordValue>('SELECT external_key,paper_id FROM units WHERE id=?', [unitId])
  const saved = snapshot.units.find((item: RecordValue) => item.unit_key === unit!.external_key)
  if (!saved) throw new Error('练习内容快照缺少篇目，无法安全恢复')
  const payload = structuredClone(saved.payload)
  Object.assign(payload, {id: unitId, paper_id: unit!.paper_id, questions: []})
  for (const item of saved.questions) {
    const question = await row<RecordValue>('SELECT id FROM questions WHERE unit_id=? AND external_key=?', [unitId, item.question_key])
    if (!question) throw new Error('练习内容快照缺少题目映射，无法安全恢复')
    payload.questions.push({...structuredClone(item.payload), id: question.id})
  }
  return payload
}

// A retry of a historical round keeps only the selected questions from its source.
export async function historicalRetrySnapshot(roundId: number, selected: Map<number, Set<number>>): Promise<RecordValue> {
  const source = await row<RecordValue>('SELECT s.content_snapshot FROM wrong_retry_rounds r JOIN practice_sessions s ON s.id=r.session_id WHERE r.id=? AND r.deleted_at IS NULL', [roundId])
  if (!source) throw new Error('重做记录的原练习不存在，无法安全恢复')
  const snapshot = readSnapshot(source.content_snapshot)
  if (!snapshot.revision) return {}
  const units = []
  for (const [unitId, ids] of selected) {
    const restored = await restoreUnit(snapshot, unitId)
    const key = await row<RecordValue>('SELECT external_key FROM units WHERE id=?', [unitId])
    const saved = structuredClone(snapshot.units.find((item: RecordValue) => item.unit_key === key!.external_key))
    saved.questions = saved.questions.filter((_: RecordValue, index: number) => ids.has(Number(restored!.questions[index].id)))
    if (saved.questions.length !== ids.size) throw new Error('重做记录的快照缺少题目，无法安全恢复')
    units.push(saved)
  }
  return {...snapshot, units}
}

export async function snapshotGrade(answerRow: RecordValue, query: <T>(sql: string, values: unknown[]) => Promise<T | null>): Promise<{answer: string; score: number}> {
  const session = await query<RecordValue>('SELECT content_snapshot FROM practice_sessions WHERE id=?', [answerRow.session_id])
  const snapshot = readSnapshot(session!.content_snapshot)
  if (!Object.keys(snapshot).length) return {answer: answerRow.answer, score: Number(answerRow.score)}
  const keys = await query<RecordValue>('SELECT q.external_key AS question_key,u.external_key AS unit_key FROM questions q JOIN units u ON u.id=q.unit_id WHERE q.id=?', [answerRow.question_id])
  const unit = snapshot.units.find((item: RecordValue) => item.unit_key === keys!.unit_key)
  const item = unit?.questions.find((item: RecordValue) => item.question_key === keys!.question_key)
  if (!item) throw new Error('练习内容快照缺少评分依据，已停止提交')
  return {answer: item.answer, score: Number(item.payload.score)}
}

// Batched form of snapshotGrade for one submission: the session snapshot is
// read and parsed once, question/unit stable keys are fetched in batches, and
// every validation rule (including the missing-scoring-evidence throw) stays
// identical to the single-row version.
export async function snapshotGradeMany(
  answerRows: RecordValue[],
  query: <T>(sql: string, values: unknown[]) => Promise<T | null>,
  queryMany: <T>(sql: string, values: unknown[]) => Promise<T[]>,
): Promise<Map<number, {answer: string; score: number}>> {
  const result = new Map<number, {answer: string; score: number}>()
  if (!answerRows.length) return result
  const sessionIds = [...new Set(answerRows.map(row => Number(row.session_id)))]
  const snapshots = new Map<number, RecordValue>()
  for (const sessionId of sessionIds) {
    const session = await query<RecordValue>('SELECT content_snapshot FROM practice_sessions WHERE id=?', [sessionId])
    snapshots.set(sessionId, readSnapshot(session!.content_snapshot))
  }
  const pending = answerRows.filter(row => Object.keys(snapshots.get(Number(row.session_id)) || {}).length)
  const chunk = <T,>(list: T[], size: number): T[][] => {
    const parts: T[][] = []
    for (let index = 0; index < list.length; index += size) parts.push(list.slice(index, index + size))
    return parts
  }
  const keysByQuestion = new Map<number, {question_key: string; unit_key: string}>()
  for (const part of chunk(pending.map(row => Number(row.question_id)).filter(id => !keysByQuestion.has(id)), 400)) {
    if (!part.length) continue
    const placeholders = part.map(() => '?').join(',')
    const keys = await queryMany<RecordValue>(`SELECT q.id AS question_id, q.external_key AS question_key,u.external_key AS unit_key FROM questions q JOIN units u ON u.id=q.unit_id WHERE q.id IN (${placeholders})`, part)
    for (const item of keys) keysByQuestion.set(Number(item.question_id), {question_key: String(item.question_key), unit_key: String(item.unit_key)})
  }
  for (const row of answerRows) {
    const snapshot = snapshots.get(Number(row.session_id))!
    if (!Object.keys(snapshot).length) {
      result.set(Number(row.question_id), {answer: row.answer, score: Number(row.score)})
      continue
    }
    const keys = keysByQuestion.get(Number(row.question_id))
    const unit = snapshot.units.find((item: RecordValue) => item.unit_key === keys?.unit_key)
    const item = unit?.questions.find((item: RecordValue) => item.question_key === keys?.question_key)
    if (!item) throw new Error('练习内容快照缺少评分依据，已停止提交')
    result.set(Number(row.question_id), {answer: item.answer, score: Number(item.payload.score)})
  }
  return result
}

export function snapshotChoiceRequired(session: RecordValue): boolean {
  const snapshot = readSnapshot(session.content_snapshot)
  return session.status === 'active' && Boolean(snapshot.revision) && session.snapshot_accepted_revision !== snapshot.revision
}

export function requireSnapshotChoice(session: RecordValue): void {
  if (snapshotChoiceRequired(session)) throw new Error('题库内容已修正，请先选择继续旧内容或用修正版重开')
}

export async function chooseSnapshot(sessionId: number, choice: string): Promise<{id: number}> {
  if (!['continue', 'restart'].includes(choice)) throw new Error('请选择有效的续练方式')
  const {transaction, rows} = await import('./database')
  const {serializeUnit} = await import('./practice')
  return transaction(async () => {
    const session = await row<RecordValue>('SELECT * FROM practice_sessions WHERE id=?', [sessionId])
    if (!session || session.status !== 'active') throw new Error('练习已结束，请刷新后重试')
    const snapshot = readSnapshot(session.content_snapshot)
    if (!snapshot.revision) throw new Error('当前练习没有待确认的内容修正')
    if (choice === 'continue') {
      await run('UPDATE practice_sessions SET snapshot_accepted_revision=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [snapshot.revision,sessionId])
      return {id:sessionId}
    }
    const created = await run('INSERT INTO practice_sessions(mode,paper_id,unit_ids,shuffle_options,candidate_policy_version,sync_id,updated_at) VALUES(?,?,?,?,1,lower(hex(randomblob(16))),CURRENT_TIMESTAMP)',[session.mode,session.paper_id,session.unit_ids,session.shuffle_options])
    const newId = Number(created.lastId)
    // A missing id must fail loudly: a silent 0 would insert an orphan session.
    if (!Number.isInteger(newId) || newId <= 0) throw new Error('练习会话创建失败，请重试')
    await run('UPDATE practice_sessions SET content_revisions=? WHERE id=?',[await currentContentRevisions(JSON.parse(session.unit_ids)),newId])
    for (const unitId of JSON.parse(session.unit_ids)) {
      const selected = await rows<RecordValue>('SELECT a.question_id FROM practice_answers a JOIN questions q ON q.id=a.question_id WHERE a.session_id=? AND q.unit_id=?',[sessionId,unitId])
      const unit = await serializeUnit(unitId,{shuffleOptions:Boolean(session.shuffle_options),onlyQuestionIds:new Set(selected.map(item=>Number(item.question_id)))})
      // 50 rows per multi-row statement keeps the bridge round trips bounded;
      // plain INSERT (no OR IGNORE) so an unexpected duplicate question fails
      // loudly instead of being silently skipped.
      const questions: RecordValue[] = unit.questions
      for (let offset = 0; offset < questions.length; offset += 50) {
        const batch = questions.slice(offset, offset + 50)
        const values: unknown[] = []
        const rowsSql = batch.map(question => {
          values.push(newId, question.id, JSON.stringify(question.option_order))
          return "(?,?,'',?,lower(hex(randomblob(16))),CURRENT_TIMESTAMP)"
        }).join(',')
        await run(`INSERT INTO practice_answers(session_id,question_id,user_answer,option_order,sync_id,updated_at) VALUES ${rowsSql}`, values)
      }
    }
    await run("UPDATE practice_sessions SET status='abandoned',updated_at=CURRENT_TIMESTAMP WHERE id=?",[sessionId])
    return {id:newId}
  })
}

// Stable per-unit revisions prove which content a new session was created from.
export async function currentContentRevisions(unitIds: number[]): Promise<string> {
  const revisions: RecordValue = {}
  for (const id of unitIds) {
    const unit = await row<RecordValue>('SELECT external_key,shared_data FROM units WHERE id=?',[id])
    const revision = JSON.parse(unit?.shared_data || '{}').content_revision
    if (revision) revisions[unit!.external_key] = revision
  }
  return JSON.stringify(revisions)
}

export async function validateIncomingSessionContent(session: RecordValue, query: (sql: string, values: unknown[]) => Promise<RecordValue | null>): Promise<void> {
  const snapshot = readSnapshot(session.content_snapshot)
  const revisions = JSON.parse(session.content_revisions || '{}')
  if (!revisions || typeof revisions !== 'object' || Array.isArray(revisions)) throw new Error('练习内容版本格式无效')
  for (const id of JSON.parse(session.unit_ids || '[]')) {
    const unit = await query('SELECT external_key,shared_data FROM units WHERE id=?',[id])
    const revision = JSON.parse(unit?.shared_data || '{}').content_revision
    if (!revision) continue
    const saved = snapshot.units?.find((item: RecordValue) => item.unit_key === unit!.external_key)
    if (!saved && revisions[unit!.external_key] !== revision) throw new Error('旧设备的练习缺少修正前内容快照，请先升级来源设备后同步')
  }
}
