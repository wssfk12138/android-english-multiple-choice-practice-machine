import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  rebindLearningHistory,
  repairLearningHistoryRebindDrift,
  runLearningHistoryRebindV1,
  runLearningHistoryRebindV2,
  runLearningHistoryRebindV3,
} from '../src/platform/android/learning-history-rebind.ts'

class TestDb {
  constructor() { this.raw = new DatabaseSync(':memory:') }
  async query(sql, values = []) { return { values: this.raw.prepare(sql).all(...values) } }
  async run(sql, values = []) { return this.raw.prepare(sql).run(...values) }
  async execute(sql) { this.raw.exec(sql); return {} }
}

const schema = `
PRAGMA foreign_keys = OFF;
CREATE TABLE question_bank_profiles (id INTEGER PRIMARY KEY, name TEXT, deleted_at TEXT);
CREATE TABLE papers (id INTEGER PRIMARY KEY, profile_id INTEGER, external_key TEXT, deleted_at TEXT);
CREATE TABLE units (id INTEGER PRIMARY KEY, paper_id INTEGER, external_key TEXT);
CREATE TABLE questions (id INTEGER PRIMARY KEY, unit_id INTEGER, external_key TEXT);
CREATE TABLE practice_sessions (id INTEGER PRIMARY KEY, mode TEXT, paper_id INTEGER, unit_ids TEXT, status TEXT, sync_id TEXT, updated_at TEXT);
CREATE TABLE practice_answers (id INTEGER PRIMARY KEY, session_id INTEGER, question_id INTEGER, user_answer TEXT, option_order TEXT, is_correct INTEGER, answered_at TEXT, sync_id TEXT, updated_at TEXT, UNIQUE(session_id, question_id));
CREATE TABLE practice_answer_events (id INTEGER PRIMARY KEY, session_id INTEGER, question_id INTEGER, user_answer TEXT, option_order TEXT, changed_at TEXT, sync_id TEXT, updated_at TEXT);
CREATE TABLE practice_unit_submissions (session_id INTEGER, unit_id INTEGER, submitted_at TEXT, score REAL, max_score REAL, sync_id TEXT, updated_at TEXT, PRIMARY KEY(session_id, unit_id));
CREATE TABLE wrong_stats (question_id INTEGER PRIMARY KEY, attempt_count INTEGER, wrong_count INTEGER, recent_results TEXT, consecutive_correct INTEGER, manually_frequent INTEGER, last_wrong_at TEXT, last_attempt_at TEXT, updated_at TEXT);
CREATE TABLE wrong_retry_rounds (id INTEGER PRIMARY KEY, unit_id INTEGER, session_id INTEGER, round_number INTEGER, question_count INTEGER, correct_count INTEGER, wrong_count INTEGER, submitted_at TEXT, deleted_at TEXT, sync_id TEXT, updated_at TEXT, UNIQUE(unit_id, round_number));
CREATE TABLE wrong_retry_round_questions (round_id INTEGER, question_id INTEGER, user_answer TEXT, is_correct INTEGER, sync_id TEXT, updated_at TEXT, PRIMARY KEY(round_id, question_id));
CREATE TABLE wrong_current_questions (unit_id INTEGER, question_id INTEGER, since_round_id INTEGER, deleted_at TEXT, sync_id TEXT, updated_at TEXT, PRIMARY KEY(unit_id, question_id));
CREATE TABLE vocabulary_entries (id INTEGER PRIMARY KEY, normalized_term TEXT);
CREATE TABLE vocabulary_occurrences (id INTEGER PRIMARY KEY, entry_id INTEGER, surface_form TEXT, unit_id INTEGER, question_id INTEGER, sync_id TEXT, updated_at TEXT);
CREATE TABLE wrong_analysis_states (unit_id INTEGER PRIMARY KEY, report_id INTEGER, analyzed_session_id INTEGER, analyzed_at TEXT);
CREATE TABLE question_ai_labels (question_id INTEGER PRIMARY KEY, primary_skill TEXT, secondary_skills TEXT, trap_types TEXT, attention_points TEXT, vocabulary_demand TEXT, context_dependency TEXT, grammar_dependency TEXT, confidence REAL, locked INTEGER, user_edited INTEGER, model_name TEXT, label_version INTEGER, updated_at TEXT);
CREATE TABLE question_label_run_items (run_id TEXT, question_id INTEGER, PRIMARY KEY(run_id, question_id));
CREATE TABLE sync_id_aliases (table_name TEXT, alias_sync_id TEXT, canonical_sync_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(table_name, alias_sync_id));
CREATE TABLE app_migrations (migration_key TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
`

function insert(db, sql, values = []) { db.raw.prepare(sql).run(...values) }

function fixture({ ambiguous = false, orphanedDeletedPaper = false } = {}) {
  const db = new TestDb()
  db.raw.exec(schema)
  insert(db, 'INSERT INTO question_bank_profiles VALUES (1, ?, NULL)', ['考研英语一'])
  insert(db, 'INSERT INTO papers VALUES (10, 1, ?, ?)', ['paper-2015', '2026-08-20'])
  insert(db, 'INSERT INTO papers VALUES (20, 1, ?, NULL)', ['paper-2015'])
  if (ambiguous) insert(db, 'INSERT INTO papers VALUES (21, 1, ?, NULL)', ['paper-2015'])
  if (orphanedDeletedPaper) {
    insert(db, 'INSERT INTO papers VALUES (30, 1, ?, ?)', ['local.english-practice.2010', '2026-08-20'])
    insert(db, 'INSERT INTO units VALUES (301, 30, ?)', ['orphan-unit'])
    insert(db, 'INSERT INTO questions VALUES (3001, 301, ?)', ['orphan-question'])
    insert(db, 'INSERT INTO practice_sessions VALUES (90, ?, 30, ?, ?, ?, ?)',
      ['paper', JSON.stringify([301]), 'active', 'session-orphan', '2026-08-24 12:00:00'])
    insert(db, `INSERT INTO practice_answers VALUES (9001, 90, 3001, 'C', '[]', 0, ?, ?, ?)`,
      ['2026-08-24 12:00:00', 'answer-orphan', '2026-08-24 12:00:00'])
  }
  const oldUnits = []
  const newUnits = []
  const oldQuestions = []
  const newQuestions = []
  let questionNumber = 0
  for (let unitIndex = 1; unitIndex <= 6; unitIndex++) {
    const oldUnit = 100 + unitIndex
    const newUnit = 200 + unitIndex
    oldUnits.push(oldUnit); newUnits.push(newUnit)
    insert(db, 'INSERT INTO units VALUES (?, 10, ?)', [oldUnit, `unit-${unitIndex}`])
    insert(db, 'INSERT INTO units VALUES (?, 20, ?)', [newUnit, `unit-${unitIndex}`])
    const count = unitIndex <= 3 ? 8 : 7
    for (let index = 0; index < count; index++) {
      questionNumber++
      const oldQuestion = 1000 + questionNumber
      const newQuestion = 2000 + questionNumber
      oldQuestions.push(oldQuestion); newQuestions.push(newQuestion)
      insert(db, 'INSERT INTO questions VALUES (?, ?, ?)', [oldQuestion, oldUnit, `q-${questionNumber}`])
      insert(db, 'INSERT INTO questions VALUES (?, ?, ?)', [newQuestion, newUnit, `q-${questionNumber}`])
    }
  }
  insert(db, 'INSERT INTO practice_sessions VALUES (81, ?, 10, ?, ?, ?, ?)', ['paper', JSON.stringify(oldUnits), 'active', 'session-81', '2026-08-25 12:00:00'])
  insert(db, 'INSERT INTO practice_sessions VALUES (85, ?, 20, ?, ?, ?, ?)', ['paper', JSON.stringify(newUnits), 'active', 'session-85', '2026-08-26 12:00:00'])
  oldQuestions.forEach((questionId, index) => {
    if (index < 25) insert(db, `INSERT INTO practice_answers VALUES (?, 81, ?, 'A', '[]', 1, ?, ?, ?)`, [8100 + index, questionId, '2026-08-25 12:00:00', `answer-old-${index}`, '2026-08-25 12:00:00'])
    insert(db, `INSERT INTO practice_answers VALUES (?, 85, ?, '', '[]', NULL, ?, ?, ?)`, [8500 + index, newQuestions[index], '2026-08-26 12:00:00', `answer-empty-${index}`, '2026-08-26 12:00:00'])
  })
  oldUnits.slice(0, 5).forEach((unitId, index) => insert(db,
    'INSERT INTO practice_unit_submissions VALUES (81, ?, ?, 8, 8, ?, ?)',
    [unitId, '2026-08-25 12:00:00', `submission-old-${index}`, '2026-08-25 12:00:00']))
  oldQuestions.slice(0, 19).forEach((questionId, index) => {
    insert(db, `INSERT INTO wrong_stats VALUES (?, 1, 1, '[false]', 0, 0, ?, ?, ?)`, [questionId, '2026-08-25', '2026-08-25', '2026-08-25'])
    insert(db, `INSERT INTO wrong_current_questions VALUES (?, ?, NULL, NULL, ?, ?)`, [oldUnits[Math.floor(index / 8)], questionId, `wrong-${index}`, '2026-08-25'])
  })
  insert(db, `INSERT INTO wrong_retry_rounds VALUES (301, 101, 81, 1, 8, 3, 5, ?, NULL, 'round-old', ?)`, ['2026-08-25', '2026-08-25'])
  insert(db, `INSERT INTO wrong_retry_round_questions VALUES (301, 1001, 'B', 0, 'round-question-old', ?)`, ['2026-08-25'])
  insert(db, `INSERT INTO practice_answer_events VALUES (1, 81, 1001, 'B', '[]', ?, 'event-old', ?)`, ['2026-08-25', '2026-08-25'])
  insert(db, `INSERT INTO vocabulary_entries VALUES (1, 'example')`)
  insert(db, `INSERT INTO vocabulary_occurrences VALUES (1, 1, 'example', 101, 1001, 'vocab-old', ?)`, ['2026-08-25'])
  insert(db, `INSERT INTO wrong_analysis_states VALUES (101, 1, 81, ?)`, ['2026-08-25'])
  insert(db, `INSERT INTO question_ai_labels VALUES (1001, 'reading', '[]', '[]', '[]', 'medium', 'medium', 'medium', .9, 1, 1, 'model', 1, ?)`, ['2026-08-25'])
  insert(db, `INSERT INTO question_label_run_items VALUES ('run-1', 1001)`)
  return db
}

const db = fixture()
assert.equal(await runLearningHistoryRebindV1(db), true)
assert.equal(await runLearningHistoryRebindV1(db), false, 'migration must be idempotent')
const session = db.raw.prepare(`SELECT id, paper_id, unit_ids, status FROM practice_sessions WHERE id = 81`).get()
assert.equal(session.paper_id, 20)
assert.deepEqual(JSON.parse(session.unit_ids), [201, 202, 203, 204, 205, 206])
assert.equal(db.raw.prepare(`SELECT COUNT(*) count FROM practice_answers WHERE session_id = 81 AND TRIM(user_answer) <> ''`).get().count, 25)
assert.equal(db.raw.prepare(`SELECT COUNT(*) count FROM practice_unit_submissions WHERE session_id = 81`).get().count, 5)
assert.equal(db.raw.prepare(`SELECT COUNT(*) count FROM wrong_current_questions WHERE unit_id BETWEEN 201 AND 206 AND deleted_at IS NULL`).get().count, 19)
assert.equal(db.raw.prepare(`SELECT status FROM practice_sessions WHERE id = 85`).get().status, 'abandoned')
assert.equal(db.raw.prepare(`SELECT canonical_sync_id FROM sync_id_aliases WHERE table_name = 'practice_sessions' AND alias_sync_id = 'session-85'`).get().canonical_sync_id, 'session-81')
assert.equal(db.raw.prepare(`SELECT question_id FROM vocabulary_occurrences WHERE id = 1`).get().question_id, 2001)
assert.equal(db.raw.prepare(`SELECT question_id FROM question_ai_labels`).get().question_id, 2001)
assert.equal(db.raw.prepare(`SELECT COUNT(*) count FROM sqlite_master WHERE type = 'table' AND name LIKE 'learning_history_rebind_v1_snapshot_%'`).get().count, 13)

const ambiguous = fixture({ ambiguous: true })
await assert.rejects(() => runLearningHistoryRebindV1(ambiguous), /候选数为 2/)
assert.equal(ambiguous.raw.prepare(`SELECT COUNT(*) count FROM app_migrations WHERE migration_key = 'learning-history-rebind-v1'`).get().count, 0)
assert.equal(ambiguous.raw.prepare(`SELECT COUNT(*) count FROM sqlite_master WHERE type = 'table' AND name LIKE 'learning_history_rebind_v1_snapshot_%'`).get().count, 0)
assert.equal(ambiguous.raw.prepare(`SELECT paper_id FROM practice_sessions WHERE id = 81`).get().paper_id, 10)

const withOrphan = fixture({ orphanedDeletedPaper: true })
assert.equal(await runLearningHistoryRebindV1(withOrphan), true)
assert.equal(withOrphan.raw.prepare(`SELECT paper_id FROM practice_sessions WHERE id = 81`).get().paper_id, 20,
  'deleted paper with an active replacement must still be rebound')
assert.equal(withOrphan.raw.prepare(`SELECT paper_id FROM practice_sessions WHERE id = 90`).get().paper_id, 30,
  'deleted paper without an active replacement must retain its history in place')
assert.equal(withOrphan.raw.prepare(`SELECT question_id, user_answer FROM practice_answers WHERE session_id = 90`).get().question_id, 3001)
assert.equal(withOrphan.raw.prepare(`SELECT question_id, user_answer FROM practice_answers WHERE session_id = 90`).get().user_answer, 'C')

const postV1Reimport = fixture()
insert(postV1Reimport, 'INSERT INTO app_migrations (migration_key) VALUES (?)', ['learning-history-rebind-v1'])
assert.equal(await runLearningHistoryRebindV2(postV1Reimport), true,
  'v2 must repair a delete/re-import that happened after v1 was already marked complete')
assert.equal(postV1Reimport.raw.prepare(`SELECT paper_id FROM practice_sessions WHERE id = 81`).get().paper_id, 20)
assert.equal(postV1Reimport.raw.prepare(`SELECT COUNT(*) count FROM practice_answers WHERE session_id = 81 AND TRIM(user_answer) <> ''`).get().count, 25)
assert.equal(postV1Reimport.raw.prepare(`SELECT COUNT(*) count FROM practice_unit_submissions WHERE session_id = 81`).get().count, 5)
assert.equal(postV1Reimport.raw.prepare(`SELECT status FROM practice_sessions WHERE id = 85`).get().status, 'abandoned')
assert.equal(await runLearningHistoryRebindV2(postV1Reimport), false, 'v2 migration must be idempotent')

const importTriggered = fixture()
insert(importTriggered, 'INSERT INTO app_migrations (migration_key) VALUES (?)', ['learning-history-rebind-v1'])
insert(importTriggered, 'INSERT INTO app_migrations (migration_key) VALUES (?)', ['learning-history-rebind-v2'])
assert.equal(await rebindLearningHistory(importTriggered, { paperKeys: ['paper-2015'] }), true,
  'a later ESQ import must be able to run the strict rebind after both startup migrations')
assert.equal(importTriggered.raw.prepare(`SELECT paper_id FROM practice_sessions WHERE id = 81`).get().paper_id, 20)
assert.equal(importTriggered.raw.prepare(`SELECT status FROM practice_sessions WHERE id = 85`).get().status, 'abandoned')
assert.equal(importTriggered.raw.prepare(`SELECT question_id FROM vocabulary_occurrences WHERE id = 1`).get().question_id, 2001)

const postV2Reimport = fixture()
insert(postV2Reimport, 'INSERT INTO app_migrations (migration_key) VALUES (?)', ['learning-history-rebind-v1'])
insert(postV2Reimport, 'INSERT INTO app_migrations (migration_key) VALUES (?)', ['learning-history-rebind-v2'])
assert.equal(await runLearningHistoryRebindV3(postV2Reimport), true,
  'v3 must repair devices where delete/re-import happened after v2 was marked complete')
assert.equal(postV2Reimport.raw.prepare(`SELECT paper_id FROM practice_sessions WHERE id = 81`).get().paper_id, 20)
assert.deepEqual(JSON.parse(postV2Reimport.raw.prepare(`SELECT unit_ids FROM practice_sessions WHERE id = 81`).get().unit_ids),
  [201, 202, 203, 204, 205, 206])
assert.equal(postV2Reimport.raw.prepare(`SELECT COUNT(*) count FROM practice_answers WHERE session_id = 81 AND TRIM(user_answer) <> ''`).get().count, 25)
assert.equal(postV2Reimport.raw.prepare(`SELECT COUNT(*) count FROM practice_unit_submissions WHERE session_id = 81`).get().count, 5)
assert.equal(postV2Reimport.raw.prepare(`SELECT status FROM practice_sessions WHERE id = 85`).get().status, 'abandoned')
assert.equal(postV2Reimport.raw.prepare(`SELECT canonical_sync_id FROM sync_id_aliases WHERE table_name = 'practice_sessions' AND alias_sync_id = 'session-85'`).get().canonical_sync_id, 'session-81')
assert.equal(postV2Reimport.raw.prepare(`SELECT COUNT(*) count FROM sqlite_master WHERE type = 'table' AND name LIKE 'learning_history_rebind_v3_snapshot_%'`).get().count, 13)
assert.equal(await runLearningHistoryRebindV3(postV2Reimport), false, 'v3 migration must be idempotent')

const futureReimport = fixture()
for (const key of ['learning-history-rebind-v1', 'learning-history-rebind-v2', 'learning-history-rebind-v3']) {
  insert(futureReimport, 'INSERT INTO app_migrations (migration_key) VALUES (?)', [key])
}
assert.equal(await repairLearningHistoryRebindDrift(futureReimport), true,
  'startup drift repair must handle a delete/re-import after every one-time migration')
assert.equal(futureReimport.raw.prepare(`SELECT paper_id FROM practice_sessions WHERE id = 81`).get().paper_id, 20)
assert.equal(futureReimport.raw.prepare(`SELECT status FROM practice_sessions WHERE id = 85`).get().status, 'abandoned')
assert.equal(await repairLearningHistoryRebindDrift(futureReimport), false,
  'startup drift repair must be a no-op after history is rebound')

console.log('Learning history strict rebind migration: OK')
