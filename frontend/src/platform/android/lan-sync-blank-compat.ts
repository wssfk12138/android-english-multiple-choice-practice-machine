// A host may advertise this only if it preserves the unanswered state and
// prevents older clients from pulling results they can't interpret.
export function peerSupportsPartialSubmissions(value: unknown): boolean {
  return value === 1
}

export const PARTIAL_SUBMISSION_SYNC_MESSAGE =
  '留空交卷的记录保留在本机。请升级电脑端，以便同步这些记录。'

export const legacyPartialSubmissionSessionsSql = `
  SELECT DISTINCT a.session_id AS id
    FROM practice_answers a
    JOIN practice_sessions s ON s.id = a.session_id
    JOIN questions q ON q.id = a.question_id
   WHERE a.is_correct IS NULL AND TRIM(COALESCE(a.user_answer, ''),
     char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196,
          8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = ''
     AND (s.status = 'submitted' OR EXISTS (
       SELECT 1 FROM practice_unit_submissions us
        WHERE us.session_id = a.session_id AND us.unit_id = q.unit_id
     ))`
