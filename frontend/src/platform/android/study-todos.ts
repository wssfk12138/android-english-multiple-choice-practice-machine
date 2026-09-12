import { resumeTitle } from '../../resume-title'
import { row, rows } from './database'
import { activeQuestionBankProfileId } from './question-bank-profiles'

export const vocabularyProfileCondition = `EXISTS (SELECT 1 FROM vocabulary_occurrences vo JOIN units vu ON vu.id = vo.unit_id JOIN papers vp ON vp.id = vu.paper_id WHERE vo.entry_id = vocabulary_entries.id AND vp.profile_id = ? AND vp.deleted_at IS NULL)`

export async function frequentQuestionIds(): Promise<number[]> {
  const profileId = await activeQuestionBankProfileId()
  return (await rows<{ question_id: number }>(`SELECT w.question_id FROM wrong_stats w JOIN questions q ON q.id = w.question_id JOIN units u ON u.id = q.unit_id JOIN papers p ON p.id = u.paper_id WHERE p.profile_id = ? AND p.deleted_at IS NULL AND w.wrong_count > 0 AND (w.manually_frequent = 1 OR w.wrong_count >= 3 OR (json_array_length(w.recent_results) >= 5 AND (SELECT COUNT(*) FROM json_each(w.recent_results) WHERE value = 0) >= 3)) AND EXISTS (SELECT 1 FROM wrong_current_questions wc WHERE wc.question_id = w.question_id AND wc.deleted_at IS NULL)`, [profileId])).map(item => Number(item.question_id))
}

export async function resumablePracticeSession() {
  const profileId = await activeQuestionBankProfileId()
  const resume = await row<{ id: number; mode: string; title: string }>(`SELECT s.id, s.mode,
  (SELECT json_object('year', p.year, 'paper', p.title, 'unit', u.title)
   FROM json_each(s.unit_ids) ids JOIN units u ON u.id = ids.value
   JOIN papers p ON p.id = u.paper_id ORDER BY u.sequence, u.id LIMIT 1) AS title
FROM practice_sessions s
WHERE s.status = 'active'
  AND EXISTS (SELECT 1 FROM json_each(s.unit_ids) ids JOIN units u ON u.id = ids.value
    JOIN papers p ON p.id = u.paper_id WHERE p.profile_id = ? AND p.status = 'published' AND p.deleted_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM json_each(s.unit_ids) ids LEFT JOIN units u ON u.id = ids.value
    LEFT JOIN papers p ON p.id = u.paper_id WHERE p.id IS NULL OR p.profile_id <> ? OR p.status <> 'published' OR p.deleted_at IS NOT NULL)
ORDER BY (SELECT COUNT(*) FROM practice_unit_submissions pus WHERE pus.session_id = s.id) DESC,
  (SELECT COUNT(*) FROM practice_answers pa WHERE pa.session_id = s.id AND TRIM(COALESCE(pa.user_answer, '')) <> '') DESC,
  COALESCE(s.updated_at, s.started_at) DESC, s.id DESC LIMIT 1`, [profileId, profileId])
  if (!resume) return null
  const identity = JSON.parse(resume.title || '{}')
  return { ...resume, year: identity.year, title: resumeTitle(resume.mode, identity) }
}

export async function studyTodos() {
  const profileId = await activeQuestionBankProfileId()
  const resume = await resumablePracticeSession()
  // Same ISO comparison as listVocabulary: next_review_at is written with JS
  // toISOString(), so the parameter must use that format too.
  const due = await row<{ count: number }>(`SELECT COUNT(*) AS count FROM vocabulary_entries WHERE translation_status = 'ready' AND (next_review_at IS NULL OR next_review_at <= ?) AND EXISTS (SELECT 1 FROM vocabulary_occurrences vo JOIN units vu ON vu.id = vo.unit_id JOIN papers vp ON vp.id = vu.paper_id WHERE vo.entry_id = vocabulary_entries.id AND vp.profile_id = ? AND vp.deleted_at IS NULL)`, [new Date().toISOString(), profileId])
  const frequent = await frequentQuestionIds()
  return { profile_id: profileId, resume_session: resume, review_count: Number(due?.count || 0), frequent_count: frequent.length }
}
