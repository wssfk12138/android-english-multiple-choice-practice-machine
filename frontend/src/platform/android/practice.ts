import type { SQLiteDBConnection } from '@capacitor-community/sqlite'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { row, rows, run, transaction } from './database'
import { incompleteSubmission, LocalApiError } from './errors'
import { activeQuestionBankProfileId } from './question-bank-profiles'

type JsonRecord = Record<string, any>
type TransactionDb = Pick<SQLiteDBConnection, 'query' | 'run'>
const audioUrlCache = new Map<string, string>()
const listeningHasAudioSql = (alias = 'u') => `
  json_valid(${alias}.shared_data)
  AND json_type(${alias}.shared_data, '$.audio_tracks') = 'array'
  AND json_array_length(${alias}.shared_data, '$.audio_tracks') > 0
`

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function shuffled<T>(items: T[]): T[] {
  const output = [...items]
  for (let index = output.length - 1; index > 0; index--) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[output[index], output[target]] = [output[target], output[index]]
  }
  return output
}

async function resolveAudioTracks(sharedData: JsonRecord): Promise<JsonRecord[]> {
  const tracks = Array.isArray(sharedData.audio_tracks)
    ? sharedData.audio_tracks.filter((track: unknown) => track && typeof track === 'object')
    : []
  const resolved = []
  for (const rawTrack of tracks) {
    const track = { ...(rawTrack as JsonRecord) }
    const path = String(track.path || '')
    if (!track.url && path) {
      let url = audioUrlCache.get(path)
      if (!url) {
        const result = await Filesystem.getUri({ path, directory: Directory.Data })
        url = Capacitor.convertFileSrc(result.uri)
        audioUrlCache.set(path, url)
      }
      track.url = url
    }
    if (track.url) resolved.push(track)
  }
  return resolved
}

async function serializeQuestion(
  question: JsonRecord,
  shuffleOptions: boolean,
  savedOrder?: string[],
  includeAnswer = false,
  preserveOptionLabels = false,
): Promise<JsonRecord> {
  let options = await rows<JsonRecord>(
    `SELECT stable_key, original_label, content, sequence, metadata
     FROM options WHERE question_id = ? ORDER BY sequence`,
    [question.id],
  )
  if (savedOrder?.length) {
    const order = new Map(savedOrder.map((key, index) => [key, index]))
    options.sort((left, right) =>
      (order.get(left.stable_key) ?? 999) - (order.get(right.stable_key) ?? 999))
  } else if (shuffleOptions && options.length > 1) {
    options = shuffled(options)
  }
  const metadata = parseJson<JsonRecord>(question.metadata, {})
  const payload: JsonRecord = {
    id: question.id,
    number: question.number,
    stem: question.stem,
    question_type: question.question_type,
    score: question.score,
    metadata,
    stem_blocks: metadata.content_blocks || [],
    options: options.map((option, index) => {
      const optionMetadata = parseJson<JsonRecord>(option.metadata, {})
      return {
        stable_key: option.stable_key,
        label: preserveOptionLabels
          ? option.original_label
          : String.fromCharCode(65 + index),
        content: option.content,
        metadata: optionMetadata,
        content_blocks: optionMetadata.content_blocks || [],
      }
    }),
    option_order: options.map(option => option.stable_key),
  }
  if (includeAnswer) payload.answer = question.answer
  return payload
}

async function serializeUnit(
  unitId: number,
  options: {
    shuffleOptions: boolean
    answerOrders?: Map<number, string[]>
    includeAnswers?: boolean
    onlyQuestionIds?: Set<number>
  },
): Promise<JsonRecord> {
  const unit = await row<JsonRecord>(
    `SELECT u.*, p.year, p.subject
     FROM units u JOIN papers p ON p.id = u.paper_id
     WHERE u.id = ?`,
    [unitId],
  )
  if (!unit) throw new LocalApiError(404, '未找到练习单元')
  let questions = await rows<JsonRecord>(
    'SELECT * FROM questions WHERE unit_id = ? ORDER BY sequence',
    [unitId],
  )
  if (options.onlyQuestionIds) {
    questions = questions.filter(question => options.onlyQuestionIds!.has(question.id))
  }
  let sharedPartBOrder: string[] | undefined
  if (unit.unit_type === 'part_b'
    && questions.length
    && options.shuffleOptions
    && !options.answerOrders?.size) {
    sharedPartBOrder = shuffled(
      (await rows<{ stable_key: string }>(
        'SELECT stable_key FROM options WHERE question_id = ? ORDER BY sequence',
        [questions[0].id],
      )).map(item => item.stable_key),
    )
  }
  const serializedQuestions = []
  for (const question of questions) {
    serializedQuestions.push(await serializeQuestion(
      question,
      options.shuffleOptions && !sharedPartBOrder,
      options.answerOrders?.get(question.id) || sharedPartBOrder,
      Boolean(options.includeAnswers),
      unit.subtype === 'true_false',
    ))
  }
  const sharedData = parseJson<JsonRecord>(unit.shared_data, {})
  if (unit.unit_type === 'listening') {
    if (!Array.isArray(sharedData.audio_tracks) || !sharedData.audio_tracks.length) {
      const { repairPublishedDocumentAudio } = await import('./document-import')
      sharedData.audio_tracks = await repairPublishedDocumentAudio(Number(unit.paper_id))
    }
    sharedData.audio_tracks = await resolveAudioTracks(sharedData)
  }
  return {
    id: unit.id,
    paper_id: unit.paper_id,
    year: unit.year,
    subject: unit.subject,
    unit_type: unit.unit_type,
    subtype: unit.subtype,
    title: unit.title,
    sequence: unit.sequence,
    passage: unit.passage,
    shared_data: sharedData,
    content_blocks: sharedData.content_blocks || [],
    questions: serializedQuestions,
    max_score: serializedQuestions.reduce((sum, question) => sum + Number(question.score), 0),
  }
}

async function selectUnitIds(body: JsonRecord): Promise<{ unitIds: number[]; paperId: number | null }> {
  const activeProfileId = await activeQuestionBankProfileId()
  if (body.mode === 'paper') {
    if (!body.paper_id) throw new LocalApiError(400, '按年份练习需要选择试卷')
    const paper = await row<{ id: number }>(
      'SELECT id FROM papers WHERE id = ? AND profile_id = ? AND deleted_at IS NULL',
      [body.paper_id, activeProfileId],
    )
    if (!paper) throw new LocalApiError(404, '试卷不存在或不属于当前题库配置')
    const unitIds = (await rows<{ id: number }>(
      'SELECT id FROM units WHERE paper_id = ? ORDER BY sequence',
      [body.paper_id],
    )).map(item => item.id)
    return { unitIds, paperId: Number(body.paper_id) }
  }
  if (body.mode === 'unit') {
    const unitIds = (body.unit_ids || []).map(Number).filter(Boolean)
    if (!unitIds.length) throw new LocalApiError(400, '请选择练习篇目')
    const owned = await rows<{ id: number }>(
      `SELECT u.id FROM units u
       JOIN papers p ON p.id = u.paper_id
       WHERE u.id IN (${unitIds.map(() => '?').join(',')})
         AND p.profile_id = ?
         AND p.deleted_at IS NULL`,
      [...unitIds, activeProfileId],
    )
    if (owned.length !== unitIds.length) {
      throw new LocalApiError(404, '部分篇目不存在或不属于当前题库配置')
    }
    return { unitIds, paperId: body.paper_id ? Number(body.paper_id) : null }
  }
  if (body.mode === 'random') {
    if (body.selection_scope === 'paper_unit_type') {
      if (!body.unit_type) throw new LocalApiError(400, '整套题型练习需要指定题型')
      let paperSql = `SELECT DISTINCT p.id
        FROM papers p JOIN units u ON u.paper_id = p.id
        JOIN questions q ON q.unit_id = u.id
        WHERE p.status = 'published'
          AND p.deleted_at IS NULL
          AND p.profile_id = ?
          AND u.unit_type = ?`
      const paperValues: unknown[] = [activeProfileId, body.unit_type]
      if (body.unit_type === 'listening') {
        paperSql += ` AND (${listeningHasAudioSql('u')})`
      }
      if (body.paper_id) {
        paperSql += ' AND p.id = ?'
        paperValues.push(body.paper_id)
      }
      const paperIds = shuffled(
        (await rows<{ id: number }>(paperSql, paperValues)).map(item => item.id),
      )
      if (!paperIds.length) {
        throw new LocalApiError(404, '当前题库配置中没有符合条件的完整题型')
      }
      const selectedPaperId = Number(paperIds[0])
      const unitIds = (await rows<{ id: number }>(
        `SELECT id FROM units
         WHERE paper_id = ? AND unit_type = ?
           AND (unit_type <> 'listening' OR (${listeningHasAudioSql('units')}))
         ORDER BY sequence, id`,
        [selectedPaperId, body.unit_type],
      )).map(item => item.id)
      return { unitIds, paperId: selectedPaperId }
    }

    let sql = `SELECT u.id FROM units u JOIN papers p ON p.id = u.paper_id
      WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.profile_id = ?`
    const values: unknown[] = [activeProfileId]
    if (body.unit_type) {
      sql += ' AND u.unit_type = ?'
      values.push(body.unit_type)
      if (body.unit_type === 'listening') {
        sql += ` AND (${listeningHasAudioSql('u')})`
      }
    }
    if (body.paper_id) {
      sql += ' AND u.paper_id = ?'
      values.push(body.paper_id)
    }
    const candidates = shuffled((await rows<{ id: number }>(sql, values)).map(item => item.id))
    return {
      unitIds: candidates.slice(0, Math.max(1, Number(body.count || 1))),
      paperId: body.paper_id ? Number(body.paper_id) : null,
    }
  }
  if (body.mode === 'wrong') {
    let sql = `SELECT DISTINCT q.unit_id
      FROM wrong_stats w
      JOIN questions q ON q.id = w.question_id
      JOIN units u ON u.id = q.unit_id
      JOIN papers p ON p.id = u.paper_id
      WHERE w.wrong_count > 0 AND p.profile_id = ? AND p.deleted_at IS NULL`
    const values: unknown[] = [activeProfileId]
    if (body.unit_ids?.length) {
      sql += ` AND q.unit_id IN (${body.unit_ids.map(() => '?').join(',')})`
      values.push(...body.unit_ids)
    }
    if (body.question_ids?.length) {
      sql += ` AND q.id IN (${body.question_ids.map(() => '?').join(',')})`
      values.push(...body.question_ids)
    }
    if (body.unit_type) {
      sql += ' AND q.unit_id IN (SELECT id FROM units WHERE unit_type = ?)'
      values.push(body.unit_type)
    }
    const candidates = shuffled(
      (await rows<{ unit_id: number }>(sql, values)).map(item => item.unit_id),
    )
    return {
      unitIds: candidates.slice(0, Math.max(1, Number(body.count || candidates.length || 1))),
      paperId: body.paper_id ? Number(body.paper_id) : null,
    }
  }
  throw new LocalApiError(400, '不支持的练习模式')
}

function normalizeListeningAudio(units: JsonRecord[]) {
  const listeningUnits = units.filter(unit => unit.unit_type === 'listening')
  if (listeningUnits.length < 2) return
  const sharedPayloads = listeningUnits.map(unit => unit.shared_data || {})
  if (sharedPayloads.some(payload => payload.audio_mode)) return
  const trackLists = sharedPayloads.map(payload =>
    Array.isArray(payload.audio_tracks) ? payload.audio_tracks : [],
  )
  if (!trackLists[0]?.length) return
  if (trackLists.some(tracks => JSON.stringify(tracks) !== JSON.stringify(trackLists[0]))) return
  if (trackLists[0].length !== listeningUnits.length) return
  sharedPayloads.forEach((payload, index) => {
    payload.audio_tracks = [trackLists[0][index]]
    payload.audio_mode = 'per_unit'
  })
}

export async function createSession(body: JsonRecord): Promise<JsonRecord> {
  const { unitIds, paperId } = await selectUnitIds(body)
  if (!unitIds.length) throw new LocalApiError(400, '没有符合条件的练习篇目')
  const shuffleOptions = body.shuffle_options !== false
  const created = await run(
    `INSERT INTO practice_sessions (mode, paper_id, unit_ids, shuffle_options)
     VALUES (?, ?, ?, ?)`,
    [body.mode, paperId, JSON.stringify(unitIds), shuffleOptions ? 1 : 0],
  )
  const sessionId = Number(created.lastId)
  const requestedWrongQuestions = new Set<number>((body.question_ids || []).map(Number))
  const onlyByUnit = new Map<number, Set<number>>()
  if (body.mode === 'wrong') {
    let sql = `SELECT q.id, q.unit_id FROM wrong_stats w
      JOIN questions q ON q.id = w.question_id
      WHERE w.wrong_count > 0 AND q.unit_id IN (${unitIds.map(() => '?').join(',')})`
    const values: unknown[] = [...unitIds]
    if (requestedWrongQuestions.size) {
      sql += ` AND q.id IN (${[...requestedWrongQuestions].map(() => '?').join(',')})`
      values.push(...requestedWrongQuestions)
    }
    for (const question of await rows<{ id: number; unit_id: number }>(sql, values)) {
      const set = onlyByUnit.get(question.unit_id) || new Set<number>()
      set.add(question.id)
      onlyByUnit.set(question.unit_id, set)
    }
  }
  const units = []
  for (const unitId of unitIds) {
    const unit = await serializeUnit(unitId, {
      shuffleOptions,
      onlyQuestionIds: body.mode === 'wrong' ? onlyByUnit.get(unitId) : undefined,
    })
    units.push(unit)
    for (const question of unit.questions) {
      await run(
        `INSERT OR IGNORE INTO practice_answers
          (session_id, question_id, user_answer, option_order)
         VALUES (?, ?, '', ?)`,
        [sessionId, question.id, JSON.stringify(question.option_order)],
      )
    }
  }
  normalizeListeningAudio(units)
  return {
    id: sessionId,
    mode: body.mode,
    paper_id: paperId,
    status: 'active',
    shuffle_options: shuffleOptions,
    units,
    progress: {
      answered: 0,
      total: units.reduce((sum, unit) => sum + unit.questions.length, 0),
    },
  }
}

export async function getSession(sessionId: number): Promise<JsonRecord> {
  const session = await row<JsonRecord>(
    'SELECT * FROM practice_sessions WHERE id = ?',
    [sessionId],
  )
  if (!session) throw new LocalApiError(404, '练习记录不存在')
  const unitIds = parseJson<number[]>(session.unit_ids, [])
  const answerRows = await rows<JsonRecord>(
    `SELECT a.*, q.unit_id, q.score AS question_score
     FROM practice_answers a JOIN questions q ON q.id = a.question_id
     WHERE a.session_id = ?`,
    [sessionId],
  )
  const answers = new Map(answerRows.map(answer => [answer.question_id, answer]))
  const answerOrders = new Map(
    answerRows.map(answer => [answer.question_id, parseJson<string[]>(answer.option_order, [])]),
  )
  const unitSubmissions = new Map(
    (await rows<JsonRecord>(
      'SELECT * FROM practice_unit_submissions WHERE session_id = ?',
      [sessionId],
    )).map(item => [item.unit_id, item]),
  )
  const onlyByUnit = new Map<number, Set<number>>()
  if (session.mode === 'wrong') {
    for (const answer of answerRows) {
      const set = onlyByUnit.get(answer.unit_id) || new Set<number>()
      set.add(answer.question_id)
      onlyByUnit.set(answer.unit_id, set)
    }
  }
  const units = []
  for (const unitId of unitIds) {
    const unit = await serializeUnit(unitId, {
      shuffleOptions: Boolean(session.shuffle_options),
      answerOrders,
      includeAnswers: session.status === 'submitted',
      onlyQuestionIds: session.mode === 'wrong' ? onlyByUnit.get(unitId) : undefined,
    })
    const unitSubmission = unitSubmissions.get(unitId)
    for (const question of unit.questions) {
      const answer = answers.get(question.id)
      question.user_answer = answer?.user_answer || ''
      if ((session.status === 'submitted' || unitSubmission) && answer) {
        question.is_correct = Boolean(answer.is_correct)
        const answerRow = await row<{ answer: string }>(
          'SELECT answer FROM questions WHERE id = ?',
          [question.id],
        )
        question.answer = answerRow?.answer || ''
      }
    }
    const submitted = Boolean(unitSubmission || session.status === 'submitted')
    if (submitted) {
      const unitAnswers = unit.questions
        .map((question: JsonRecord) => answers.get(question.id))
        .filter(Boolean) as JsonRecord[]
      const score = unitSubmission?.score ?? unitAnswers
        .filter(answer => answer.is_correct === 1)
        .reduce((sum, answer) => sum + Number(answer.question_score), 0)
      unit.submission = {
        submitted: true,
        submitted_at: unitSubmission?.submitted_at || session.submitted_at,
        score,
        max_score: unitSubmission?.max_score ?? unit.max_score,
        wrong_count: unitAnswers.filter(answer => answer.is_correct === 0).length,
        correct_count: unitAnswers.filter(answer => answer.is_correct === 1).length,
        question_count: unitAnswers.length,
      }
    } else {
      unit.submission = { submitted: false }
    }
    units.push(unit)
  }
  normalizeListeningAudio(units)
  const resultSummary = session.status === 'submitted'
    ? {
        score: session.score,
        max_score: session.max_score,
        wrong_count: answerRows.filter(answer => answer.is_correct === 0).length,
        correct_count: answerRows.filter(answer => answer.is_correct === 1).length,
        question_count: answerRows.length,
      }
    : null
  return {
    id: session.id,
    mode: session.mode,
    paper_id: session.paper_id,
    status: session.status,
    shuffle_options: Boolean(session.shuffle_options),
    started_at: session.started_at,
    submitted_at: session.submitted_at,
    score: session.score,
    max_score: session.max_score,
    result_summary: resultSummary,
    units,
    progress: {
      answered: answerRows.filter(answer => Boolean(answer.user_answer)).length,
      total: answerRows.length,
    },
  }
}

export async function saveAnswer(
  sessionId: number,
  questionId: number,
  body: JsonRecord,
): Promise<{ saved: true }> {
  const session = await row<JsonRecord>(
    'SELECT status FROM practice_sessions WHERE id = ?',
    [sessionId],
  )
  if (!session) throw new LocalApiError(404, '练习记录不存在')
  if (session.status !== 'active') throw new LocalApiError(400, '已经提交的练习不能修改')
  const question = await row<{ unit_id: number }>(
    'SELECT unit_id FROM questions WHERE id = ?',
    [questionId],
  )
  if (!question) throw new LocalApiError(404, '题目不存在')
  const submitted = await row(
    `SELECT 1 AS found FROM practice_unit_submissions
     WHERE session_id = ? AND unit_id = ?`,
    [sessionId, question.unit_id],
  )
  if (submitted) throw new LocalApiError(400, '这一篇已经提交，不能继续修改')
  const previous = await row<{ user_answer: string }>(
    `SELECT user_answer FROM practice_answers
     WHERE session_id = ? AND question_id = ?`,
    [sessionId, questionId],
  )
  const result = await run(
    `UPDATE practice_answers
     SET user_answer = ?, option_order = ?, answered_at = CURRENT_TIMESTAMP
     WHERE session_id = ? AND question_id = ?`,
    [
      String(body.answer || ''),
      JSON.stringify(body.option_order || []),
      sessionId,
      questionId,
    ],
  )
  if (!result.changes) throw new LocalApiError(404, '题目不属于该练习')
  if (body.answer && previous?.user_answer !== body.answer) {
    await run(
      `INSERT INTO practice_answer_events
        (session_id, question_id, user_answer, option_order)
       VALUES (?, ?, ?, ?)`,
      [sessionId, questionId, body.answer, JSON.stringify(body.option_order || [])],
    )
  }
  return { saved: true }
}

async function transactionRow<T>(
  db: TransactionDb | undefined,
  statement: string,
  values: unknown[] = [],
): Promise<T | null> {
  if (!db) return row<T>(statement, values)
  const result = await db.query(statement, values)
  return (result.values?.[0] as T | undefined) || null
}

async function transactionRun(
  db: TransactionDb | undefined,
  statement: string,
  values: unknown[] = [],
): Promise<void> {
  if (db) {
    await db.run(statement, values, false)
    return
  }
  await run(statement, values)
}

async function updateWrongStat(
  questionId: number,
  isCorrect: boolean,
  db?: TransactionDb,
) {
  const current = await transactionRow<JsonRecord>(
    db,
    'SELECT * FROM wrong_stats WHERE question_id = ?',
    [questionId],
  )
  const now = new Date().toISOString()
  if (!current) {
    await transactionRun(
      db,
      `INSERT INTO wrong_stats
        (question_id, attempt_count, wrong_count, recent_results,
         consecutive_correct, last_wrong_at, last_attempt_at)
       VALUES (?, 1, ?, ?, ?, ?, ?)`,
      [
        questionId,
        isCorrect ? 0 : 1,
        JSON.stringify([isCorrect]),
        isCorrect ? 1 : 0,
        isCorrect ? null : now,
        now,
      ],
    )
    return
  }
  const recent = [...parseJson<boolean[]>(current.recent_results, []), isCorrect].slice(-10)
  await transactionRun(
    db,
    `UPDATE wrong_stats SET
       attempt_count = attempt_count + 1,
       wrong_count = wrong_count + ?,
       recent_results = ?,
       consecutive_correct = ?,
       last_wrong_at = ?,
       last_attempt_at = ?
     WHERE question_id = ?`,
    [
      isCorrect ? 0 : 1,
      JSON.stringify(recent),
      isCorrect ? Number(current.consecutive_correct) + 1 : 0,
      isCorrect ? current.last_wrong_at : now,
      now,
      questionId,
    ],
  )
}

async function gradeRows(
  answerRows: JsonRecord[],
  db?: TransactionDb,
): Promise<{ score: number; maxScore: number }> {
  let score = 0
  let maxScore = 0
  for (const answerRow of answerRows) {
    maxScore += Number(answerRow.score)
    const user = String(answerRow.user_answer || '').trim().toUpperCase().split('').sort().join('')
    const answer = String(answerRow.answer || '').trim().toUpperCase().split('').sort().join('')
    const correct = Boolean(user) && user === answer
    if (correct) score += Number(answerRow.score)
    await transactionRun(db, 'UPDATE practice_answers SET is_correct = ? WHERE id = ?', [
      correct ? 1 : 0,
      answerRow.id,
    ])
    if (answerRow.is_correct == null) {
      await updateWrongStat(answerRow.question_id, correct, db)
    }
  }
  return { score, maxScore }
}

export async function submitUnit(sessionId: number, unitId: number): Promise<JsonRecord> {
  const session = await row<JsonRecord>('SELECT * FROM practice_sessions WHERE id = ?', [sessionId])
  if (!session) throw new LocalApiError(404, '练习记录不存在')
  if (session.status !== 'active') throw new LocalApiError(400, '整份练习已经提交')
  if (session.mode !== 'paper') throw new LocalApiError(400, '只有按年份练习支持单篇提交')
  const existing = await row(
    'SELECT 1 AS found FROM practice_unit_submissions WHERE session_id = ? AND unit_id = ?',
    [sessionId, unitId],
  )
  if (existing) return getSession(sessionId)
  const answerRows = await rows<JsonRecord>(
    `SELECT a.*, q.answer, q.score, q.number, u.title AS unit_title
     FROM practice_answers a
     JOIN questions q ON q.id = a.question_id
     JOIN units u ON u.id = q.unit_id
     WHERE a.session_id = ? AND q.unit_id = ?
     ORDER BY q.sequence`,
    [sessionId, unitId],
  )
  if (!answerRows.length) throw new LocalApiError(400, '篇目中没有题目')
  const missing = answerRows.find(item => !String(item.user_answer || '').trim())
  if (missing) incompleteSubmission(
    { id: unitId, title: missing.unit_title },
    { id: missing.question_id, number: missing.number },
  )
  await transaction(async db => {
    const graded = await gradeRows(answerRows, db)
    await db.run(
      `INSERT INTO practice_unit_submissions
        (session_id, unit_id, score, max_score) VALUES (?, ?, ?, ?)`,
      [sessionId, unitId, graded.score, graded.maxScore],
      false,
    )
  })
  return getSession(sessionId)
}

export async function submitSession(sessionId: number): Promise<JsonRecord> {
  const session = await row<JsonRecord>('SELECT * FROM practice_sessions WHERE id = ?', [sessionId])
  if (!session) throw new LocalApiError(404, '练习记录不存在')
  if (session.status === 'submitted') return getSession(sessionId)
  const answerRows = await rows<JsonRecord>(
    `SELECT a.*, q.answer, q.score, q.unit_id, q.number, u.title AS unit_title
     FROM practice_answers a
     JOIN questions q ON q.id = a.question_id
     JOIN units u ON u.id = q.unit_id
     WHERE a.session_id = ?
     ORDER BY u.sequence, q.sequence`,
    [sessionId],
  )
  if (!answerRows.length) throw new LocalApiError(400, '练习中没有题目')
  const missing = answerRows.find(item => !String(item.user_answer || '').trim())
  if (missing) incompleteSubmission(
    { id: missing.unit_id, title: missing.unit_title },
    { id: missing.question_id, number: missing.number },
  )
  const byUnit = new Map<number, JsonRecord[]>()
  for (const answer of answerRows) {
    const unitAnswers = byUnit.get(answer.unit_id) || []
    unitAnswers.push(answer)
    byUnit.set(answer.unit_id, unitAnswers)
  }
  await transaction(async db => {
    let score = 0
    let maxScore = 0
    for (const [unitId, unitAnswers] of byUnit) {
      const graded = await gradeRows(unitAnswers, db)
      score += graded.score
      maxScore += graded.maxScore
      await db.run(
        `INSERT INTO practice_unit_submissions
          (session_id, unit_id, score, max_score)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, unit_id) DO UPDATE SET
           score = excluded.score, max_score = excluded.max_score`,
        [sessionId, unitId, graded.score, graded.maxScore],
        false,
      )
    }
    await db.run(
      `UPDATE practice_sessions SET
         status = 'submitted', submitted_at = CURRENT_TIMESTAMP,
         score = ?, max_score = ?
       WHERE id = ?`,
      [score, maxScore, sessionId],
      false,
    )
  })
  return getSession(sessionId)
}

export async function dashboard(): Promise<JsonRecord> {
  const profileId = await activeQuestionBankProfileId()
  const counts = await row<JsonRecord>(
    `SELECT
      (SELECT COUNT(*) FROM papers WHERE status = 'published' AND profile_id = ? AND deleted_at IS NULL) AS paper_count,
      (SELECT COUNT(*) FROM units u JOIN papers p ON p.id = u.paper_id WHERE p.profile_id = ? AND p.deleted_at IS NULL) AS unit_count,
      (SELECT COUNT(*) FROM questions q JOIN units u ON u.id = q.unit_id JOIN papers p ON p.id = u.paper_id WHERE p.profile_id = ? AND p.deleted_at IS NULL) AS question_count,
      (SELECT COUNT(*) FROM wrong_stats w JOIN questions q ON q.id = w.question_id JOIN units u ON u.id = q.unit_id JOIN papers p ON p.id = u.paper_id WHERE w.wrong_count > 0 AND p.profile_id = ? AND p.deleted_at IS NULL) AS wrong_count`,
    [profileId, profileId, profileId, profileId],
  )
  const frequent = await rows<JsonRecord>(
    `SELECT w.wrong_count, w.recent_results, w.manually_frequent
     FROM wrong_stats w
     JOIN questions q ON q.id = w.question_id
     JOIN units u ON u.id = q.unit_id
     JOIN papers p ON p.id = u.paper_id
     WHERE w.wrong_count > 0 AND p.profile_id = ? AND p.deleted_at IS NULL`,
    [profileId],
  )
  const frequentCount = frequent.filter(item => {
    const recent = parseJson<boolean[]>(item.recent_results, [])
    return Boolean(item.manually_frequent)
      || Number(item.wrong_count) >= 3
      || (recent.length >= 5 && recent.filter(value => !value).length >= 3)
  }).length
  const recentSessions = await rows<JsonRecord>(
    `SELECT s.id, s.mode, s.status, s.started_at, s.submitted_at,
       s.score, s.max_score, p.year
     FROM practice_sessions s LEFT JOIN papers p ON p.id = s.paper_id
     WHERE p.profile_id = ? OR s.paper_id IS NULL
     ORDER BY s.id DESC LIMIT 5`,
    [profileId],
  )
  const unitTypeCounts = Object.fromEntries(
    (await rows<{ unit_type: string; count: number }>(
      `SELECT u.unit_type, COUNT(DISTINCT u.id) AS count
       FROM units u JOIN papers p ON p.id = u.paper_id
       JOIN questions q ON q.unit_id = u.id
       WHERE p.profile_id = ? AND p.status = 'published' AND p.deleted_at IS NULL
         AND (u.unit_type <> 'listening' OR (${listeningHasAudioSql('u')}))
       GROUP BY u.unit_type`,
      [profileId],
    )).map(item => [item.unit_type, Number(item.count)]),
  )
  const paperTypeCounts = Object.fromEntries(
    (await rows<{ unit_type: string; count: number }>(
      `SELECT u.unit_type, COUNT(DISTINCT p.id) AS count
       FROM units u JOIN papers p ON p.id = u.paper_id
       JOIN questions q ON q.unit_id = u.id
       WHERE p.profile_id = ? AND p.status = 'published' AND p.deleted_at IS NULL
         AND (u.unit_type <> 'listening' OR (${listeningHasAudioSql('u')}))
       GROUP BY u.unit_type`,
      [profileId],
    )).map(item => [item.unit_type, Number(item.count)]),
  )
  return {
    ...counts,
    frequent_count: frequentCount,
    unit_type_counts: unitTypeCounts,
    paper_type_counts: paperTypeCounts,
    recent_sessions: recentSessions,
  }
}

export async function listWrong(): Promise<JsonRecord[]> {
  const profileId = await activeQuestionBankProfileId()
  const data = await rows<JsonRecord>(
    `SELECT q.id AS question_id, q.number, q.stem,
       u.id AS unit_id, u.title AS unit_title, u.unit_type,
       p.year, w.*
     FROM wrong_stats w
     JOIN questions q ON q.id = w.question_id
     JOIN units u ON u.id = q.unit_id
     JOIN papers p ON p.id = u.paper_id
     WHERE w.wrong_count > 0 AND p.profile_id = ? AND p.deleted_at IS NULL
     ORDER BY w.manually_frequent DESC, w.wrong_count DESC, w.last_wrong_at DESC`,
    [profileId],
  )
  return data.map(item => {
    const recent = parseJson<boolean[]>(item.recent_results, [])
    return {
      ...item,
      recent_results: recent,
      is_frequent: Boolean(item.manually_frequent)
        || Number(item.wrong_count) >= 3
        || (recent.length >= 5 && recent.filter(value => !value).length >= 3),
    }
  })
}
