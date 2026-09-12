type JsonRecord = Record<string, any>

const SESSION_CHILD_TABLES = [
  'practice_answers',
  'practice_answer_events',
  'practice_unit_submissions',
  'wrong_retry_rounds',
] as const

/**
 * Finds remote sessions that have no learning rows in the same pull batch.
 * These are only candidates for compatibility handling; the caller must also
 * prove that the local canonical session has no learning rows before skipping.
 */
export function unreferencedRemoteSessionIds(
  changes: Record<string, JsonRecord[]>,
): Set<string> {
  const referenced = new Set<string>()
  for (const table of SESSION_CHILD_TABLES) {
    for (const payload of changes[table] || []) {
      const sessionId = String(payload.session_id_key || '').trim()
      if (sessionId) referenced.add(sessionId)
    }
  }

  return new Set(
    (changes.practice_sessions || [])
      .map(payload => String(payload.sync_id || '').trim())
      .filter(sessionId => sessionId && !referenced.has(sessionId)),
  )
}
