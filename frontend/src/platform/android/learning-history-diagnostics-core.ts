type JsonRecord = Record<string, unknown>

export interface LearningHistoryDiagnosticDb {
  query(statement: string, values?: unknown[]): Promise<{ values?: JsonRecord[] }>
}

interface CountRow extends JsonRecord { count?: unknown }

async function count(db: LearningHistoryDiagnosticDb, statement: string): Promise<number> {
  const result = await db.query(statement)
  return Math.max(0, Number((result.values?.[0] as CountRow | undefined)?.count || 0))
}

/** Read-only aggregate evidence. No learning row, identifier, content, or timeline is exported. */
export async function collectLearningHistoryDiagnostics(
  db: LearningHistoryDiagnosticDb,
): Promise<JsonRecord> {
  const [sessionGroups, integrity, vocabulary] = await Promise.all([
    db.query(`SELECT
      CASE
        WHEN status = 'active' THEN 'active'
        WHEN status IN ('submitted', 'completed') THEN 'completed'
        WHEN status IN ('abandoned', 'cancelled') THEN 'abandoned'
        ELSE 'other'
      END AS status_group,
      COUNT(*) AS count
    FROM practice_sessions
    GROUP BY status_group
    ORDER BY status_group`),
    db.query(`SELECT
      (SELECT COUNT(*) FROM practice_answers a
        LEFT JOIN practice_sessions s ON s.id = a.session_id WHERE s.id IS NULL) AS answers_without_session,
      (SELECT COUNT(*) FROM practice_answers a
        LEFT JOIN questions q ON q.id = a.question_id WHERE q.id IS NULL) AS answers_without_question,
      (SELECT COUNT(*) FROM practice_unit_submissions us
        LEFT JOIN practice_sessions s ON s.id = us.session_id WHERE s.id IS NULL) AS submissions_without_session,
      (SELECT COUNT(*) FROM practice_unit_submissions us
        LEFT JOIN units u ON u.id = us.unit_id WHERE u.id IS NULL) AS submissions_without_unit`),
    db.query(`SELECT
      (SELECT COUNT(*) FROM vocabulary_entries) AS entries,
      (SELECT COUNT(*) FROM vocabulary_occurrences) AS occurrences,
      (SELECT COUNT(*) FROM vocabulary_reviews) AS reviews,
      (SELECT COUNT(*) FROM vocabulary_occurrences v
        LEFT JOIN vocabulary_entries e ON e.id = v.entry_id WHERE e.id IS NULL) AS occurrences_without_entry,
      (SELECT COUNT(*) FROM vocabulary_reviews r
        LEFT JOIN vocabulary_entries e ON e.id = r.entry_id WHERE e.id IS NULL) AS reviews_without_entry`),
  ])
  const totalSessions = await count(db, 'SELECT COUNT(*) AS count FROM practice_sessions')
  const safeNumber = (value: unknown) => Math.max(0, Number(value || 0))
  const statusCounts = { active: 0, completed: 0, abandoned: 0, other: 0 }
  for (const row of sessionGroups.values || []) {
    const key = String(row.status_group) as keyof typeof statusCounts
    if (key in statusCounts) statusCounts[key] = safeNumber(row.count)
  }
  const integrityRow = integrity.values?.[0] || {}
  const vocabularyRow = vocabulary.values?.[0] || {}
  return {
    format: 'english-practice-learning-history-diagnostics',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    privacyNotice: '仅包含只读汇总计数和完整性类别；不含学习记录、标识符、题库、题目、答案或词汇正文。',
    sessions: { total: totalSessions, ...statusCounts },
    integrity: {
      answersWithoutSession: safeNumber(integrityRow.answers_without_session),
      answersWithoutQuestion: safeNumber(integrityRow.answers_without_question),
      submissionsWithoutSession: safeNumber(integrityRow.submissions_without_session),
      submissionsWithoutUnit: safeNumber(integrityRow.submissions_without_unit),
    },
    vocabulary: {
      entries: safeNumber(vocabularyRow.entries),
      occurrences: safeNumber(vocabularyRow.occurrences),
      reviews: safeNumber(vocabularyRow.reviews),
      occurrencesWithoutEntry: safeNumber(vocabularyRow.occurrences_without_entry),
      reviewsWithoutEntry: safeNumber(vocabularyRow.reviews_without_entry),
    },
  }
}

export function serializeLearningHistoryDiagnostics(report: JsonRecord): string {
  return JSON.stringify(report, null, 2)
}
