export const LEARNING_HISTORY_REBIND_MIGRATION = 'learning-history-rebind-v1'
export const LEARNING_HISTORY_REBIND_V2_MIGRATION = 'learning-history-rebind-v2'
export const LEARNING_HISTORY_REBIND_V3_MIGRATION = 'learning-history-rebind-v3'

type DbResult = { values?: Record<string, any>[] }

export interface LearningHistoryRebindDb {
  query(statement: string, values?: unknown[]): Promise<DbResult>
  run(statement: string, values?: unknown[], transaction?: boolean): Promise<unknown>
  execute(statements: string, transaction?: boolean): Promise<unknown>
}

type IdMap = Map<number, number>
type Row = Record<string, any>

/**
 * How a caller answers "has this migration key been recorded?". The Android
 * bootstrap passes the shared key cache so the three rebind gates stop costing
 * one bridge round trip each; other callers keep the plain query.
 */
export type AppliedMigrationProbe = (migrationKey: string) => Promise<boolean>

const SNAPSHOT_TABLES = [
  'practice_sessions', 'practice_answers', 'practice_answer_events',
  'practice_unit_submissions', 'wrong_stats', 'wrong_retry_rounds',
  'wrong_retry_round_questions', 'wrong_current_questions',
  'vocabulary_occurrences', 'wrong_analysis_states', 'question_ai_labels',
  'question_label_run_items', 'sync_id_aliases',
] as const

async function all<T extends Row>(db: LearningHistoryRebindDb, sql: string, values: unknown[] = []) {
  return ((await db.query(sql, values)).values || []) as T[]
}

async function one<T extends Row>(db: LearningHistoryRebindDb, sql: string, values: unknown[] = []) {
  return (await all<T>(db, sql, values))[0] || null
}

async function exec(db: LearningHistoryRebindDb, sql: string, values: unknown[] = []) {
  await db.run(sql, values, false)
}

function quoted(name: string) {
  return `"${name.replaceAll('\"', '\"\"')}"`
}

function parseIds(value: unknown): number[] {
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : []
  } catch {
    return []
  }
}

function timestamp(row: Row) {
  return String(row.updated_at || row.answered_at || row.submitted_at || row.changed_at || '')
}

function nonEmptyAnswer(row: Row) {
  return String(row.user_answer || '').trim() ? 1 : 0
}

function answerValue(row: Row) {
  return [nonEmptyAnswer(row), timestamp(row), Number(row.id || row._rowid || 0)] as const
}

function preferAnswer(left: Row, right: Row) {
  const a = answerValue(left)
  const b = answerValue(right)
  return a[0] !== b[0] ? (a[0] > b[0] ? left : right)
    : a[1] !== b[1] ? (a[1] > b[1] ? left : right)
      : a[2] >= b[2] ? left : right
}

async function alias(db: LearningHistoryRebindDb, table: string, from: unknown, to: unknown) {
  const source = String(from || '')
  const target = String(to || '')
  if (!source || !target || source === target) return
  await exec(db, `INSERT INTO sync_id_aliases (table_name, alias_sync_id, canonical_sync_id)
    VALUES (?, ?, ?)
    ON CONFLICT(table_name, alias_sync_id) DO UPDATE SET canonical_sync_id = excluded.canonical_sync_id`,
  [table, source, target])
}

async function strictMaps(db: LearningHistoryRebindDb, paperKeys?: ReadonlySet<string>) {
  const referenced = await all<Row>(db, `
    SELECT DISTINCT p.id, p.profile_id, p.external_key
    FROM papers p
    WHERE p.deleted_at IS NOT NULL AND (
      EXISTS (SELECT 1 FROM practice_sessions s WHERE s.paper_id = p.id)
      OR EXISTS (SELECT 1 FROM units u WHERE u.paper_id = p.id AND (
        EXISTS (SELECT 1 FROM practice_unit_submissions x WHERE x.unit_id = u.id)
        OR EXISTS (SELECT 1 FROM wrong_retry_rounds x WHERE x.unit_id = u.id)
        OR EXISTS (SELECT 1 FROM wrong_current_questions x WHERE x.unit_id = u.id)
        OR EXISTS (SELECT 1 FROM vocabulary_occurrences x WHERE x.unit_id = u.id)
        OR EXISTS (SELECT 1 FROM wrong_analysis_states x WHERE x.unit_id = u.id)
        OR EXISTS (SELECT 1 FROM questions q WHERE q.unit_id = u.id AND (
          EXISTS (SELECT 1 FROM practice_answers x WHERE x.question_id = q.id)
          OR EXISTS (SELECT 1 FROM practice_answer_events x WHERE x.question_id = q.id)
          OR EXISTS (SELECT 1 FROM wrong_stats x WHERE x.question_id = q.id)
          OR EXISTS (SELECT 1 FROM wrong_retry_round_questions x WHERE x.question_id = q.id)
          OR EXISTS (SELECT 1 FROM wrong_current_questions x WHERE x.question_id = q.id)
          OR EXISTS (SELECT 1 FROM vocabulary_occurrences x WHERE x.question_id = q.id)
          OR EXISTS (SELECT 1 FROM question_ai_labels x WHERE x.question_id = q.id)
          OR EXISTS (SELECT 1 FROM question_label_run_items x WHERE x.question_id = q.id)
        ))
      ))
    )`)
  const paper = new Map<number, number>()
  const unit = new Map<number, number>()
  const question = new Map<number, number>()
  for (const oldPaper of referenced) {
    if (paperKeys && !paperKeys.has(String(oldPaper.external_key || ''))) continue
    const candidates = await all<Row>(db, `SELECT id FROM papers
      WHERE profile_id = ? AND external_key = ? AND deleted_at IS NULL ORDER BY id`,
    [oldPaper.profile_id, oldPaper.external_key])
    // A deleted paper without an active replacement is not ambiguous: its
    // historical rows must remain attached to the deleted paper. A later ESQ
    // re-import reuses that single deleted paper id, so no rebind is needed.
    if (candidates.length === 0) continue
    if (candidates.length > 1) {
      throw new Error(`题库 ${oldPaper.external_key} 的活动版本候选数为 ${candidates.length}，无法严格迁移`)
    }
    const newPaperId = Number(candidates[0].id)
    paper.set(Number(oldPaper.id), newPaperId)
    for (const oldUnit of await all<Row>(db, 'SELECT id, external_key FROM units WHERE paper_id = ?', [oldPaper.id])) {
      const unitCandidates = await all<Row>(db,
        'SELECT id FROM units WHERE paper_id = ? AND external_key = ? ORDER BY id',
        [newPaperId, oldUnit.external_key])
      if (unitCandidates.length !== 1) {
        throw new Error(`篇目 ${oldUnit.external_key} 的活动版本候选数为 ${unitCandidates.length}，无法严格迁移`)
      }
      const newUnitId = Number(unitCandidates[0].id)
      unit.set(Number(oldUnit.id), newUnitId)
      for (const oldQuestion of await all<Row>(db, 'SELECT id, external_key FROM questions WHERE unit_id = ?', [oldUnit.id])) {
        const questionCandidates = await all<Row>(db,
          'SELECT id FROM questions WHERE unit_id = ? AND external_key = ? ORDER BY id',
          [newUnitId, oldQuestion.external_key])
        if (questionCandidates.length !== 1) {
          throw new Error(`题目 ${oldQuestion.external_key} 的活动版本候选数为 ${questionCandidates.length}，无法严格迁移`)
        }
        question.set(Number(oldQuestion.id), Number(questionCandidates[0].id))
      }
    }
  }
  return { paper, unit, question }
}

async function mergeQuestionRows(db: LearningHistoryRebindDb, map: IdMap) {
  for (const [oldId, newId] of map) {
    for (const oldRow of await all<Row>(db, 'SELECT rowid AS _rowid, * FROM practice_answers WHERE question_id = ?', [oldId])) {
      const current = await one<Row>(db, 'SELECT rowid AS _rowid, * FROM practice_answers WHERE session_id = ? AND question_id = ?', [oldRow.session_id, newId])
      if (!current) {
        await exec(db, 'UPDATE practice_answers SET question_id = ? WHERE rowid = ?', [newId, oldRow._rowid])
        continue
      }
      const winner = preferAnswer(oldRow, current)
      if (winner._rowid === oldRow._rowid) {
        await exec(db, `UPDATE practice_answers SET user_answer = ?, option_order = ?, is_correct = ?,
          answered_at = ?, updated_at = ? WHERE rowid = ?`,
        [oldRow.user_answer, oldRow.option_order, oldRow.is_correct, oldRow.answered_at, oldRow.updated_at, current._rowid])
      }
      await alias(db, 'practice_answers', oldRow.sync_id, current.sync_id)
      await exec(db, 'DELETE FROM practice_answers WHERE rowid = ?', [oldRow._rowid])
    }
    await exec(db, 'UPDATE practice_answer_events SET question_id = ? WHERE question_id = ?', [newId, oldId])

    const oldStat = await one<Row>(db, 'SELECT * FROM wrong_stats WHERE question_id = ?', [oldId])
    if (oldStat) {
      const current = await one<Row>(db, 'SELECT * FROM wrong_stats WHERE question_id = ?', [newId])
      if (!current) await exec(db, 'UPDATE wrong_stats SET question_id = ? WHERE question_id = ?', [newId, oldId])
      else {
        const winner = timestamp(oldStat) > timestamp(current) ? oldStat : current
        await exec(db, `UPDATE wrong_stats SET attempt_count = ?, wrong_count = ?, recent_results = ?,
          consecutive_correct = ?, manually_frequent = ?, last_wrong_at = ?, last_attempt_at = ?, updated_at = ?
          WHERE question_id = ?`,
        [winner.attempt_count, winner.wrong_count, winner.recent_results, winner.consecutive_correct,
          winner.manually_frequent, winner.last_wrong_at, winner.last_attempt_at, winner.updated_at, newId])
        await exec(db, 'DELETE FROM wrong_stats WHERE question_id = ?', [oldId])
      }
    }

    const oldLabel = await one<Row>(db, 'SELECT rowid AS _rowid, * FROM question_ai_labels WHERE question_id = ?', [oldId])
    if (oldLabel) {
      const current = await one<Row>(db, 'SELECT rowid AS _rowid, * FROM question_ai_labels WHERE question_id = ?', [newId])
      if (!current) await exec(db, 'UPDATE question_ai_labels SET question_id = ? WHERE question_id = ?', [newId, oldId])
      else {
        const quality = (row: Row) => [Number(row.user_edited || 0), Number(row.locked || 0), timestamp(row)] as const
        const a = quality(oldLabel); const b = quality(current)
        const oldWins = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]
        if (oldWins) {
          const columns = ['primary_skill','secondary_skills','trap_types','attention_points','vocabulary_demand',
            'context_dependency','grammar_dependency','confidence','locked','user_edited','model_name','label_version','updated_at']
          await exec(db, `UPDATE question_ai_labels SET ${columns.map(name => `${name} = ?`).join(', ')} WHERE question_id = ?`,
            [...columns.map(name => oldLabel[name]), newId])
        }
        await exec(db, 'DELETE FROM question_ai_labels WHERE question_id = ?', [oldId])
      }
    }
    await exec(db, `INSERT OR IGNORE INTO question_label_run_items (run_id, question_id)
      SELECT run_id, ? FROM question_label_run_items WHERE question_id = ?`, [newId, oldId])
    await exec(db, 'DELETE FROM question_label_run_items WHERE question_id = ?', [oldId])
    await exec(db, 'UPDATE vocabulary_occurrences SET question_id = ? WHERE question_id = ?', [newId, oldId])
  }
}

async function rebindRounds(db: LearningHistoryRebindDb, unitMap: IdMap, questionMap: IdMap) {
  for (const [oldQuestion, newQuestion] of questionMap) {
    for (const item of await all<Row>(db, 'SELECT rowid AS _rowid, * FROM wrong_retry_round_questions WHERE question_id = ?', [oldQuestion])) {
      const current = await one<Row>(db, 'SELECT rowid AS _rowid, * FROM wrong_retry_round_questions WHERE round_id = ? AND question_id = ?', [item.round_id, newQuestion])
      if (!current) await exec(db, 'UPDATE wrong_retry_round_questions SET question_id = ? WHERE rowid = ?', [newQuestion, item._rowid])
      else {
        const winner = preferAnswer(item, current)
        if (winner._rowid === item._rowid) await exec(db,
          'UPDATE wrong_retry_round_questions SET user_answer = ?, is_correct = ?, updated_at = ? WHERE rowid = ?',
          [item.user_answer, item.is_correct, item.updated_at, current._rowid])
        await alias(db, 'wrong_retry_round_questions', item.sync_id, current.sync_id)
        await exec(db, 'DELETE FROM wrong_retry_round_questions WHERE rowid = ?', [item._rowid])
      }
    }
  }
  for (const [oldUnit, newUnit] of unitMap) {
    for (const oldRound of await all<Row>(db, 'SELECT * FROM wrong_retry_rounds WHERE unit_id = ? ORDER BY id', [oldUnit])) {
      const current = await one<Row>(db, 'SELECT * FROM wrong_retry_rounds WHERE unit_id = ? AND round_number = ?', [newUnit, oldRound.round_number])
      if (!current) { await exec(db, 'UPDATE wrong_retry_rounds SET unit_id = ? WHERE id = ?', [newUnit, oldRound.id]); continue }
      await exec(db, `INSERT OR IGNORE INTO wrong_retry_round_questions
        (round_id, question_id, user_answer, is_correct, sync_id, updated_at)
        SELECT ?, question_id, user_answer, is_correct, sync_id, updated_at
        FROM wrong_retry_round_questions WHERE round_id = ?`, [current.id, oldRound.id])
      await exec(db, 'UPDATE wrong_current_questions SET since_round_id = ? WHERE since_round_id = ?', [current.id, oldRound.id])
      await alias(db, 'wrong_retry_rounds', oldRound.sync_id, current.sync_id)
      await exec(db, 'DELETE FROM wrong_retry_round_questions WHERE round_id = ?', [oldRound.id])
      await exec(db, 'DELETE FROM wrong_retry_rounds WHERE id = ?', [oldRound.id])
    }
  }
}

async function mergeCurrentWrong(db: LearningHistoryRebindDb, unitMap: IdMap, questionMap: IdMap) {
  for (const [oldUnit, newUnit] of unitMap) {
    for (const item of await all<Row>(db, 'SELECT rowid AS _rowid, * FROM wrong_current_questions WHERE unit_id = ?', [oldUnit])) {
      const newQuestion = questionMap.get(Number(item.question_id))
      if (!newQuestion) throw new Error(`错题池题目 ${item.question_id} 缺少严格映射`)
      const current = await one<Row>(db, 'SELECT rowid AS _rowid, * FROM wrong_current_questions WHERE unit_id = ? AND question_id = ?', [newUnit, newQuestion])
      if (!current) await exec(db, 'UPDATE wrong_current_questions SET unit_id = ?, question_id = ? WHERE rowid = ?', [newUnit, newQuestion, item._rowid])
      else {
        if (item.deleted_at == null || timestamp(item) > timestamp(current)) await exec(db,
          'UPDATE wrong_current_questions SET since_round_id = ?, deleted_at = ?, updated_at = ? WHERE rowid = ?',
          [item.since_round_id, item.deleted_at, item.updated_at, current._rowid])
        await alias(db, 'wrong_current_questions', item.sync_id, current.sync_id)
        await exec(db, 'DELETE FROM wrong_current_questions WHERE rowid = ?', [item._rowid])
      }
    }
  }
}

async function rebindUnits(db: LearningHistoryRebindDb, unitMap: IdMap) {
  for (const [oldId, newId] of unitMap) {
    await exec(db, 'UPDATE vocabulary_occurrences SET unit_id = ? WHERE unit_id = ?', [newId, oldId])
    const oldState = await one<Row>(db, 'SELECT * FROM wrong_analysis_states WHERE unit_id = ?', [oldId])
    if (oldState) {
      const current = await one<Row>(db, 'SELECT * FROM wrong_analysis_states WHERE unit_id = ?', [newId])
      if (!current) await exec(db, 'UPDATE wrong_analysis_states SET unit_id = ? WHERE unit_id = ?', [newId, oldId])
      else {
        const winner = String(oldState.analyzed_at || '') > String(current.analyzed_at || '') ? oldState : current
        await exec(db, 'UPDATE wrong_analysis_states SET report_id = ?, analyzed_session_id = ?, analyzed_at = ? WHERE unit_id = ?',
          [winner.report_id, winner.analyzed_session_id, winner.analyzed_at, newId])
        await exec(db, 'DELETE FROM wrong_analysis_states WHERE unit_id = ?', [oldId])
      }
    }
  }
}

async function rebindSubmissions(db: LearningHistoryRebindDb, unitMap: IdMap) {
  for (const [oldId, newId] of unitMap) {
    for (const item of await all<Row>(db, 'SELECT rowid AS _rowid, * FROM practice_unit_submissions WHERE unit_id = ?', [oldId])) {
      const current = await one<Row>(db, 'SELECT rowid AS _rowid, * FROM practice_unit_submissions WHERE session_id = ? AND unit_id = ?', [item.session_id, newId])
      if (!current) await exec(db, 'UPDATE practice_unit_submissions SET unit_id = ? WHERE rowid = ?', [newId, item._rowid])
      else {
        const winner = timestamp(item) > timestamp(current) ? item : current
        if (winner._rowid === item._rowid) await exec(db,
          'UPDATE practice_unit_submissions SET submitted_at = ?, score = ?, max_score = ?, updated_at = ? WHERE rowid = ?',
          [item.submitted_at, item.score, item.max_score, item.updated_at, current._rowid])
        await alias(db, 'practice_unit_submissions', item.sync_id, current.sync_id)
        await exec(db, 'DELETE FROM practice_unit_submissions WHERE rowid = ?', [item._rowid])
      }
    }
  }
}

async function mergeSessions(db: LearningHistoryRebindDb, paperIds?: ReadonlySet<number>) {
  const groups = await all<Row>(db, `SELECT paper_id FROM practice_sessions
    WHERE status = 'active' AND paper_id IS NOT NULL GROUP BY paper_id HAVING COUNT(*) > 1`)
  for (const group of groups) {
    if (paperIds && !paperIds.has(Number(group.paper_id))) continue
    const sessions = await all<Row>(db, `SELECT s.*,
      (SELECT COUNT(*) FROM practice_unit_submissions us WHERE us.session_id = s.id) AS submitted_units,
      (SELECT COUNT(*) FROM practice_answers a WHERE a.session_id = s.id AND TRIM(COALESCE(a.user_answer, '')) <> '') AS answered
      FROM practice_sessions s WHERE s.paper_id = ? AND s.status = 'active'`, [group.paper_id])
    sessions.sort((a, b) => Number(b.submitted_units) - Number(a.submitted_units)
      || Number(b.answered) - Number(a.answered)
      || timestamp(b).localeCompare(timestamp(a)) || Number(b.id) - Number(a.id))
    const canonical = sessions[0]
    for (const loser of sessions.slice(1)) {
      for (const item of await all<Row>(db, 'SELECT rowid AS _rowid, * FROM practice_answers WHERE session_id = ?', [loser.id])) {
        const current = await one<Row>(db, 'SELECT rowid AS _rowid, * FROM practice_answers WHERE session_id = ? AND question_id = ?', [canonical.id, item.question_id])
        if (!current) await exec(db, 'UPDATE practice_answers SET session_id = ? WHERE rowid = ?', [canonical.id, item._rowid])
        else {
          const winner = preferAnswer(item, current)
          if (winner._rowid === item._rowid) await exec(db, `UPDATE practice_answers SET user_answer = ?, option_order = ?,
            is_correct = ?, answered_at = ?, updated_at = ? WHERE rowid = ?`,
          [item.user_answer, item.option_order, item.is_correct, item.answered_at, item.updated_at, current._rowid])
          await alias(db, 'practice_answers', item.sync_id, current.sync_id)
          await exec(db, 'DELETE FROM practice_answers WHERE rowid = ?', [item._rowid])
        }
      }
      for (const item of await all<Row>(db, 'SELECT rowid AS _rowid, * FROM practice_unit_submissions WHERE session_id = ?', [loser.id])) {
        const current = await one<Row>(db, 'SELECT rowid AS _rowid, * FROM practice_unit_submissions WHERE session_id = ? AND unit_id = ?', [canonical.id, item.unit_id])
        if (!current) await exec(db, 'UPDATE practice_unit_submissions SET session_id = ? WHERE rowid = ?', [canonical.id, item._rowid])
        else {
          if (timestamp(item) > timestamp(current)) await exec(db,
            'UPDATE practice_unit_submissions SET submitted_at = ?, score = ?, max_score = ?, updated_at = ? WHERE rowid = ?',
            [item.submitted_at, item.score, item.max_score, item.updated_at, current._rowid])
          await alias(db, 'practice_unit_submissions', item.sync_id, current.sync_id)
          await exec(db, 'DELETE FROM practice_unit_submissions WHERE rowid = ?', [item._rowid])
        }
      }
      await exec(db, 'UPDATE practice_answer_events SET session_id = ? WHERE session_id = ?', [canonical.id, loser.id])
      await exec(db, 'UPDATE wrong_retry_rounds SET session_id = ? WHERE session_id = ?', [canonical.id, loser.id])
      await exec(db, 'UPDATE wrong_analysis_states SET analyzed_session_id = ? WHERE analyzed_session_id = ?', [canonical.id, loser.id])
      await alias(db, 'practice_sessions', loser.sync_id, canonical.sync_id)
      await exec(db, `UPDATE practice_sessions SET status = 'abandoned', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [loser.id])
    }
  }
}

export async function rebindLearningHistory(
  db: LearningHistoryRebindDb,
  options: { paperKeys?: readonly string[] } = {},
): Promise<boolean> {
  const paperKeys = options.paperKeys?.length
    ? new Set(options.paperKeys.map(key => String(key)).filter(Boolean))
    : undefined
  const maps = await strictMaps(db, paperKeys)
  await mergeQuestionRows(db, maps.question)
  await rebindRounds(db, maps.unit, maps.question)
  await mergeCurrentWrong(db, maps.unit, maps.question)
  await rebindUnits(db, maps.unit)
  await rebindSubmissions(db, maps.unit)
  for (const [oldPaper, newPaper] of maps.paper) {
    await exec(db, 'UPDATE practice_sessions SET paper_id = ? WHERE paper_id = ?', [newPaper, oldPaper])
  }
  for (const session of await all<Row>(db, 'SELECT id, unit_ids FROM practice_sessions')) {
    const ids = parseIds(session.unit_ids)
    const mapped = ids.map(id => maps.unit.get(id) || id)
    if (mapped.some((id, index) => id !== ids[index])) {
      await exec(db, 'UPDATE practice_sessions SET unit_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [JSON.stringify(mapped), session.id])
    }
  }

  let mergePaperIds: Set<number> | undefined
  if (paperKeys) {
    mergePaperIds = new Set(maps.paper.values())
    for (const item of await all<Row>(db, `SELECT id FROM papers
      WHERE deleted_at IS NULL AND external_key IN (${[...paperKeys].map(() => '?').join(',')})`,
    [...paperKeys])) {
      mergePaperIds.add(Number(item.id))
    }
  }
  await mergeSessions(db, mergePaperIds)
  return maps.paper.size > 0 || maps.unit.size > 0 || maps.question.size > 0
}

async function hasLearningHistoryRebindDrift(db: LearningHistoryRebindDb): Promise<boolean> {
  return Boolean(await one(db, `SELECT 1
    FROM papers p
    WHERE p.deleted_at IS NOT NULL
      AND (SELECT COUNT(*) FROM papers replacement
        WHERE replacement.profile_id = p.profile_id
          AND replacement.external_key = p.external_key
          AND replacement.deleted_at IS NULL) = 1
      AND (
        EXISTS (SELECT 1 FROM practice_sessions s WHERE s.paper_id = p.id)
        OR EXISTS (SELECT 1 FROM units u WHERE u.paper_id = p.id AND (
          EXISTS (SELECT 1 FROM practice_unit_submissions x WHERE x.unit_id = u.id)
          OR EXISTS (SELECT 1 FROM wrong_retry_rounds x WHERE x.unit_id = u.id)
          OR EXISTS (SELECT 1 FROM wrong_current_questions x WHERE x.unit_id = u.id)
          OR EXISTS (SELECT 1 FROM vocabulary_occurrences x WHERE x.unit_id = u.id)
          OR EXISTS (SELECT 1 FROM wrong_analysis_states x WHERE x.unit_id = u.id)
          OR EXISTS (SELECT 1 FROM questions q WHERE q.unit_id = u.id AND (
            EXISTS (SELECT 1 FROM practice_answers x WHERE x.question_id = q.id)
            OR EXISTS (SELECT 1 FROM practice_answer_events x WHERE x.question_id = q.id)
            OR EXISTS (SELECT 1 FROM wrong_stats x WHERE x.question_id = q.id)
            OR EXISTS (SELECT 1 FROM wrong_retry_round_questions x WHERE x.question_id = q.id)
            OR EXISTS (SELECT 1 FROM wrong_current_questions x WHERE x.question_id = q.id)
            OR EXISTS (SELECT 1 FROM vocabulary_occurrences x WHERE x.question_id = q.id)
            OR EXISTS (SELECT 1 FROM question_ai_labels x WHERE x.question_id = q.id)
            OR EXISTS (SELECT 1 FROM question_label_run_items x WHERE x.question_id = q.id)
          ))
        ))
      )
    LIMIT 1`))
}

/**
 * Repairs a delete/re-import that happened after the one-time migrations ran.
 * The cheap probe keeps normal launches read-only; a detected repair is fully
 * transactional and re-checks strict paper/unit/question mappings.
 */
export async function repairLearningHistoryRebindDrift(
  db: LearningHistoryRebindDb,
): Promise<boolean> {
  if (!await hasLearningHistoryRebindDrift(db)) return false
  await db.execute('BEGIN IMMEDIATE', false)
  try {
    const changed = await rebindLearningHistory(db)
    await db.execute('COMMIT', false)
    return changed
  } catch (error) {
    await db.execute('ROLLBACK', false)
    throw error
  }
}

async function runMigration(
  db: LearningHistoryRebindDb,
  migrationKey: string,
  snapshotPrefix: string,
  applied?: AppliedMigrationProbe,
): Promise<boolean> {
  const alreadyApplied = applied
    ? await applied(migrationKey)
    : Boolean(await one(db, 'SELECT 1 FROM app_migrations WHERE migration_key = ? LIMIT 1', [migrationKey]))
  if (alreadyApplied) return false
  const existingSnapshots = await all<Row>(db, `SELECT name FROM sqlite_master WHERE type = 'table'
    AND name LIKE ?`, [`${snapshotPrefix}%`])
  if (existingSnapshots.length) throw new Error(`检测到未标记完成的 ${migrationKey} 快照，请先人工核验`)
  await db.execute('BEGIN IMMEDIATE', false)
  try {
    for (const table of SNAPSHOT_TABLES) {
      await db.execute(`CREATE TABLE ${quoted(`${snapshotPrefix}${table}`)} AS SELECT * FROM ${quoted(table)}`, false)
    }
    await rebindLearningHistory(db)
    await exec(db, 'INSERT INTO app_migrations (migration_key) VALUES (?)', [migrationKey])
    await db.execute('COMMIT', false)
    return true
  } catch (error) {
    await db.execute('ROLLBACK', false)
    throw error
  }
}

export async function runLearningHistoryRebindV1(db: LearningHistoryRebindDb, applied?: AppliedMigrationProbe): Promise<boolean> {
  return runMigration(
    db,
    LEARNING_HISTORY_REBIND_MIGRATION,
    'learning_history_rebind_v1_snapshot_',
    applied,
  )
}

export async function runLearningHistoryRebindV2(db: LearningHistoryRebindDb, applied?: AppliedMigrationProbe): Promise<boolean> {
  return runMigration(
    db,
    LEARNING_HISTORY_REBIND_V2_MIGRATION,
    'learning_history_rebind_v2_snapshot_',
    applied,
  )
}

export async function runLearningHistoryRebindV3(db: LearningHistoryRebindDb, applied?: AppliedMigrationProbe): Promise<boolean> {
  return runMigration(
    db,
    LEARNING_HISTORY_REBIND_V3_MIGRATION,
    'learning_history_rebind_v3_snapshot_',
    applied,
  )
}
