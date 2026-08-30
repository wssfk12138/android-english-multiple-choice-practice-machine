import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  collectLearningHistoryDiagnostics,
  serializeLearningHistoryDiagnostics,
} from '../src/platform/android/learning-history-diagnostics-core.ts'

class TestDb {
  constructor() {
    this.raw = new DatabaseSync(':memory:')
    this.statements = []
  }
  async query(statement, values = []) {
    this.statements.push(statement)
    return { values: this.raw.prepare(statement).all(...values) }
  }
}

const db = new TestDb()
db.raw.exec(`
CREATE TABLE practice_sessions (id INTEGER PRIMARY KEY, status TEXT, private_note TEXT);
CREATE TABLE questions (id INTEGER PRIMARY KEY, body TEXT);
CREATE TABLE units (id INTEGER PRIMARY KEY);
CREATE TABLE practice_answers (session_id INTEGER, question_id INTEGER, user_answer TEXT);
CREATE TABLE practice_unit_submissions (session_id INTEGER, unit_id INTEGER);
CREATE TABLE vocabulary_entries (id INTEGER PRIMARY KEY, term TEXT);
CREATE TABLE vocabulary_occurrences (entry_id INTEGER, surface_form TEXT);
CREATE TABLE vocabulary_reviews (entry_id INTEGER);
INSERT INTO practice_sessions VALUES (1, 'active', 'private session note');
INSERT INTO practice_sessions VALUES (2, 'submitted', 'second private note');
INSERT INTO questions VALUES (10, 'private question');
INSERT INTO practice_answers VALUES (1, 10, 'private answer');
INSERT INTO practice_answers VALUES (999, 999, 'orphan private answer');
INSERT INTO practice_unit_submissions VALUES (999, 999);
INSERT INTO vocabulary_entries VALUES (20, 'private word');
INSERT INTO vocabulary_occurrences VALUES (20, 'private surface');
INSERT INTO vocabulary_occurrences VALUES (999, 'orphan surface');
INSERT INTO vocabulary_reviews VALUES (999);
`)

const report = await collectLearningHistoryDiagnostics(db)
assert.deepEqual(report.sessions, { total: 2, active: 1, completed: 1, abandoned: 0, other: 0 })
assert.equal(report.integrity.answersWithoutSession, 1)
assert.equal(report.integrity.answersWithoutQuestion, 1)
assert.equal(report.integrity.submissionsWithoutSession, 1)
assert.equal(report.integrity.submissionsWithoutUnit, 1)
assert.equal(report.vocabulary.occurrencesWithoutEntry, 1)
assert.equal(report.vocabulary.reviewsWithoutEntry, 1)
assert.ok(db.statements.every(statement => /^\s*SELECT\b/i.test(statement)))
const serialized = serializeLearningHistoryDiagnostics(report)
for (const forbidden of [
  'private session', 'private question', 'private answer', 'private word', 'private surface',
  'sync_id', 'migration', 'http://', 'https://', 'receiverUrl',
]) assert.ok(!serialized.includes(forbidden), `Leaked ${forbidden}`)
assert.ok(new TextEncoder().encode(serialized).byteLength < 1024 * 1024)
console.log('learning history diagnostics tests passed')
