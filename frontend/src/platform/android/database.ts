import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import { createSerialQueue } from './serial-queue'

const DB_NAME = 'english_practice_machine'
const DB_VERSION = 1

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_key TEXT NOT NULL UNIQUE,
  package_id TEXT NOT NULL DEFAULT '',
  content_version TEXT NOT NULL DEFAULT '',
  year INTEGER NOT NULL UNIQUE,
  subject TEXT NOT NULL DEFAULT '英语一',
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id INTEGER NOT NULL,
  external_key TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  subtype TEXT,
  title TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  passage TEXT NOT NULL DEFAULT '',
  shared_data TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
  UNIQUE (paper_id, external_key)
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  external_key TEXT NOT NULL,
  number INTEGER NOT NULL,
  stem TEXT NOT NULL DEFAULT '',
  question_type TEXT NOT NULL DEFAULT 'single_choice',
  answer TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 1,
  sequence INTEGER NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
  UNIQUE (unit_id, external_key)
);
CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  stable_key TEXT NOT NULL,
  original_label TEXT NOT NULL,
  content TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  UNIQUE (question_id, stable_key)
);
CREATE TABLE IF NOT EXISTS practice_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  paper_id INTEGER,
  unit_ids TEXT NOT NULL,
  shuffle_options INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TEXT,
  score REAL,
  max_score REAL
);
CREATE TABLE IF NOT EXISTS practice_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  user_answer TEXT NOT NULL DEFAULT '',
  option_order TEXT NOT NULL DEFAULT '[]',
  is_correct INTEGER,
  answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  UNIQUE (session_id, question_id)
);
CREATE TABLE IF NOT EXISTS practice_answer_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  user_answer TEXT NOT NULL,
  option_order TEXT NOT NULL DEFAULT '[]',
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS practice_unit_submissions (
  session_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  score REAL NOT NULL DEFAULT 0,
  max_score REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, unit_id)
);
CREATE TABLE IF NOT EXISTS wrong_stats (
  question_id INTEGER PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  recent_results TEXT NOT NULL DEFAULT '[]',
  consecutive_correct INTEGER NOT NULL DEFAULT 0,
  manually_frequent INTEGER NOT NULL DEFAULT 0,
  last_wrong_at TEXT,
  last_attempt_at TEXT
);
CREATE TABLE IF NOT EXISTS wrong_analysis_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_key TEXT NOT NULL DEFAULT '',
  unit_ids TEXT NOT NULL DEFAULT '[]',
  input_snapshot TEXT NOT NULL DEFAULT '{}',
  scope_title TEXT NOT NULL DEFAULT '',
  question_count INTEGER NOT NULL DEFAULT 0,
  aggregate_data TEXT NOT NULL DEFAULT '{}',
  report TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS wrong_analysis_states (
  unit_id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL,
  analyzed_session_id INTEGER NOT NULL DEFAULT 0,
  analyzed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS vocabulary_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  normalized_term TEXT NOT NULL UNIQUE,
  lemma TEXT NOT NULL DEFAULT '',
  phonetic TEXT NOT NULL DEFAULT '',
  part_of_speech TEXT NOT NULL DEFAULT '',
  contextual_meaning TEXT NOT NULL DEFAULT '',
  common_meaning TEXT NOT NULL DEFAULT '',
  synonyms TEXT NOT NULL DEFAULT '[]',
  antonyms TEXT NOT NULL DEFAULT '[]',
  similar_forms TEXT NOT NULL DEFAULT '[]',
  memory_hint TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  translation_status TEXT NOT NULL DEFAULT 'queued',
  translation_error TEXT NOT NULL DEFAULT '',
  encounter_count INTEGER NOT NULL DEFAULT 1,
  study_status TEXT NOT NULL DEFAULT 'learning',
  manually_frequent INTEGER NOT NULL DEFAULT 0,
  user_edited INTEGER NOT NULL DEFAULT 0,
  next_review_at TEXT,
  last_reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS vocabulary_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  surface_form TEXT NOT NULL,
  context_sentence TEXT NOT NULL DEFAULT '',
  context_before TEXT NOT NULL DEFAULT '',
  context_after TEXT NOT NULL DEFAULT '',
  unit_id INTEGER,
  question_id INTEGER,
  year INTEGER,
  unit_title TEXT NOT NULL DEFAULT '',
  unit_type TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entry_id) REFERENCES vocabulary_entries(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS vocabulary_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  rating TEXT NOT NULL,
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_review_at TEXT
);
CREATE TABLE IF NOT EXISTS ai_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  default_model TEXT NOT NULL DEFAULT '',
  temperature REAL NOT NULL DEFAULT 0.2,
  max_tokens INTEGER NOT NULL DEFAULT 1200,
  system_prompt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ai_profile_models (
  profile_id INTEGER NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  owned_by TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  is_visible INTEGER NOT NULL DEFAULT 1,
  is_available INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (profile_id, model_id)
);
CREATE TABLE IF NOT EXISTS ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '新对话',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  profile_id INTEGER,
  model_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS question_ai_labels (
  question_id INTEGER PRIMARY KEY,
  primary_skill TEXT NOT NULL DEFAULT '',
  secondary_skills TEXT NOT NULL DEFAULT '[]',
  trap_types TEXT NOT NULL DEFAULT '[]',
  attention_points TEXT NOT NULL DEFAULT '[]',
  vocabulary_demand TEXT NOT NULL DEFAULT 'medium',
  context_dependency TEXT NOT NULL DEFAULT 'medium',
  grammar_dependency TEXT NOT NULL DEFAULT 'medium',
  confidence REAL NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 1,
  model_name TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS question_bank_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id TEXT NOT NULL,
  content_version TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL DEFAULT '',
  manifest_data TEXT NOT NULL DEFAULT '{}',
  source_file TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (package_id, content_version)
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_units_paper ON units(paper_id);
CREATE INDEX IF NOT EXISTS idx_questions_unit ON questions(unit_id);
CREATE INDEX IF NOT EXISTS idx_answers_session ON practice_answers(session_id);
CREATE INDEX IF NOT EXISTS idx_wrong_count ON wrong_stats(wrong_count DESC);
CREATE INDEX IF NOT EXISTS idx_vocab_priority ON vocabulary_entries(encounter_count DESC, last_seen_at DESC);
INSERT OR IGNORE INTO schema_version(version) VALUES (1);
`

const manager = new SQLiteConnection(CapacitorSQLite)
let connectionPromise: Promise<SQLiteDBConnection> | null = null

export async function androidDatabase(): Promise<SQLiteDBConnection> {
  if (!connectionPromise) {
    connectionPromise = (async () => {
      const consistent = await manager.checkConnectionsConsistency()
      const existing = await manager.isConnection(DB_NAME, false)
      let db: SQLiteDBConnection
      if (consistent.result && existing.result) {
        db = await manager.retrieveConnection(DB_NAME, false)
      } else {
        db = await manager.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false)
      }
      if (!(await db.isDBOpen()).result) await db.open()
      await db.execute(SCHEMA)
      const questionColumns = await db.query('PRAGMA table_info(questions)')
      if (!(questionColumns.values || []).some(column => column.name === 'content_hash')) {
        await db.execute("ALTER TABLE questions ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''")
      }
      const stateColumns = await db.query('PRAGMA table_info(wrong_analysis_states)')
      if ((stateColumns.values || []).length && !(stateColumns.values || []).some(column => column.name === 'analyzed_session_id')) {
        await db.execute('ALTER TABLE wrong_analysis_states ADD COLUMN analyzed_session_id INTEGER NOT NULL DEFAULT 0')
      }
      const vocabColumns = await db.query('PRAGMA table_info(vocabulary_entries)')
      const vocabNames = new Set((vocabColumns.values || []).map(column => column.name))
      if (!vocabNames.has('synonyms')) await db.execute("ALTER TABLE vocabulary_entries ADD COLUMN synonyms TEXT NOT NULL DEFAULT '[]'")
      if (!vocabNames.has('antonyms')) await db.execute("ALTER TABLE vocabulary_entries ADD COLUMN antonyms TEXT NOT NULL DEFAULT '[]'")
      if (!vocabNames.has('similar_forms')) await db.execute("ALTER TABLE vocabulary_entries ADD COLUMN similar_forms TEXT NOT NULL DEFAULT '[]'")
      return db
    })()
  }
  return connectionPromise
}

export async function rows<T = Record<string, unknown>>(
  statement: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await (await androidDatabase()).query(statement, values)
  return (result.values || []) as T[]
}

export async function row<T = Record<string, unknown>>(
  statement: string,
  values: unknown[] = [],
): Promise<T | null> {
  return (await rows<T>(statement, values))[0] || null
}

export async function run(
  statement: string,
  values: unknown[] = [],
): Promise<{ changes: number; lastId?: number }> {
  // 单条语句交给 SQLite 自动提交即可；显式事务由 transaction() 统一管理。
  // 插件默认会在每次 run 内自行开启事务，事务内再调用会报 “Already in transaction”。
  const result = await (await androidDatabase()).run(statement, values, false)
  return {
    changes: Number(result.changes?.changes || 0),
    lastId: result.changes?.lastId,
  }
}

const runTransactionSerially = createSerialQueue()

export async function transaction<T>(operation: (db: SQLiteDBConnection) => Promise<T>): Promise<T> {
  return runTransactionSerially(async () => {
    const db = await androidDatabase()
    const active = await db.isTransactionActive()
    if (active.result) await db.rollbackTransaction()
    await db.beginTransaction()
    try {
      const result = await operation(db)
      await db.commitTransaction()
      return result
    } catch (error) {
      try {
        if ((await db.isTransactionActive()).result) await db.rollbackTransaction()
      } catch {
        // Preserve the original operation error.
      }
      throw error
    }
  })
}
