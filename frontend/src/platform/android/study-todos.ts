import { resumeTitle } from '../../resume-title'
import { row, rows } from './database'
import { activeQuestionBankProfileId } from './question-bank-profiles'

export const vocabularyProfileCondition = `EXISTS (SELECT 1 FROM vocabulary_occurrences vo JOIN units vu ON vu.id = vo.unit_id JOIN papers vp ON vp.id = vu.paper_id WHERE vo.entry_id = vocabulary_entries.id AND vp.profile_id = ? AND vp.deleted_at IS NULL)`

// 高频题判定是错题列表和统计摘要共用的同一份语义，抽成一条条件串，
// 避免“列表用什么算高频、计数用什么算高频”两份实现在后续改动中漂移。
const frequentQuestionCondition = `w.wrong_count > 0 AND (w.manually_frequent = 1 OR w.wrong_count >= 3 OR (json_array_length(w.recent_results) >= 5 AND (SELECT COUNT(*) FROM json_each(w.recent_results) WHERE value = 0) >= 3)) AND EXISTS (SELECT 1 FROM wrong_current_questions wc WHERE wc.question_id = w.question_id AND wc.deleted_at IS NULL)`

// 到期词与高频题是首页统计和学习待办共用的同一份语义。两条计数抽成可内嵌的
// SELECT 列片段（参数顺序固定：到期时间戳、题库、题库），调用方既能单独查询，
// 也能拼进自己那条语句：同一块屏幕的六项统计合成一条只跨一次桥，而不是拆成
// 三条（平板实测 9.5 + 8.7 + 7.8 = 26ms，合并后 10.4ms）。
const dueVocabularyCountSql = `(SELECT COUNT(*) FROM vocabulary_entries WHERE translation_status = 'ready' AND (next_review_at IS NULL OR next_review_at <= ?) AND ${vocabularyProfileCondition})`
const frequentQuestionCountSql = `(SELECT COUNT(*) FROM wrong_stats w JOIN questions q ON q.id = w.question_id JOIN units u ON u.id = q.unit_id JOIN papers p ON p.id = u.paper_id WHERE p.profile_id = ? AND p.deleted_at IS NULL AND ${frequentQuestionCondition})`

export const studyTodoCountColumns = `${dueVocabularyCountSql} AS review_count, ${frequentQuestionCountSql} AS frequent_count`

// 与 studyTodoCountColumns 一一对应的参数；两者必须成对使用，顺序不可拆开。
export function studyTodoCountValues(profileId: number): unknown[] {
  return [new Date().toISOString(), profileId, profileId]
}

export async function frequentQuestionIds(): Promise<number[]> {
  const profileId = await activeQuestionBankProfileId()
  return (await rows<{ question_id: number }>(`SELECT w.question_id FROM wrong_stats w JOIN questions q ON q.id = w.question_id JOIN units u ON u.id = q.unit_id JOIN papers p ON p.id = u.paper_id WHERE p.profile_id = ? AND p.deleted_at IS NULL AND ${frequentQuestionCondition}`, [profileId])).map(item => Number(item.question_id))
}

// 只需要数量时（首页统计、学习待办）不要把这批题号搬回 JS：
// 每一行都要跨一次 SQLite→JS 桥，题号本身在计数场景毫无用处。
export async function frequentQuestionCount(): Promise<number> {
  const profileId = await activeQuestionBankProfileId()
  const result = await row<{ count: number }>(`SELECT ${frequentQuestionCountSql} AS count`, [profileId])
  return Number(result?.count || 0)
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

// 到期词计数是词汇页、首页和学习待办共用的同一份语义：ready、next_review_at 为空
// 或已到期，并且当前题库里存在该词的来源。语义只写在上面的片段里一处，避免“谁算
// 到期”在后续改动里漂移成两份实现。
// Same ISO comparison as listVocabulary: next_review_at is written with JS
// toISOString(), so the parameter must use that format too.
export async function dueVocabularyCount(): Promise<number> {
  const profileId = await activeQuestionBankProfileId()
  const due = await row<{ count: number }>(`SELECT ${dueVocabularyCountSql} AS count`, [new Date().toISOString(), profileId])
  return Number(due?.count || 0)
}

// 首页（/startup）与学习待办（/study-todos）渲染的是同一批数据。首页把它一起带回，
// 同一块屏幕就不必为这一个卡片区再发一次请求、把续练与高频题聚合重跑一遍。
export type StudyTodosPayload = {
  profile_id: number
  resume_session: { id: number; mode: string; title: string; year?: number } | null
  review_count: number
  frequent_count: number
}

export async function studyTodos(): Promise<StudyTodosPayload> {
  const profileId = await activeQuestionBankProfileId()
  const resume = await resumablePracticeSession()
  // 两项计数同属这一屏，合成一条语句即可算出；参数与片段成对取自同一份定义。
  const counts = await row<{ review_count: number; frequent_count: number }>(`SELECT ${studyTodoCountColumns}`, studyTodoCountValues(profileId))
  return {
    profile_id: profileId,
    resume_session: resume,
    review_count: Number(counts?.review_count || 0),
    frequent_count: Number(counts?.frequent_count || 0),
  }
}
