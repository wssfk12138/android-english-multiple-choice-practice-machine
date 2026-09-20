import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import { createSerialQueue } from './serial-queue'
import { ensureSyncVersions } from './lan-sync-versions'
import { orderingFixedSlotsForPaperUnit } from './ordering-fixed-slots'
import {
  LEARNING_HISTORY_REBIND_MIGRATION,
  LEARNING_HISTORY_REBIND_V2_MIGRATION,
  LEARNING_HISTORY_REBIND_V3_MIGRATION,
  type AppliedMigrationProbe,
  repairLearningHistoryRebindDrift,
  runLearningHistoryRebindV1,
  runLearningHistoryRebindV2,
  runLearningHistoryRebindV3,
} from './learning-history-rebind'

const DB_NAME = 'english_practice_machine'
const DB_VERSION = 1

/** One-time startup repairs tracked in `app_migrations` so repeat launches skip them. */
const ORDERING_FIXED_SLOTS_MIGRATION = 'ordering-fixed-slots-v1'

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS question_bank_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_question_bank_profiles_name
  ON question_bank_profiles(name COLLATE NOCASE) WHERE deleted_at IS NULL;
INSERT INTO question_bank_profiles(name, description, is_default)
SELECT '考研英语一', '现有题库自动迁移配置', 1
WHERE NOT EXISTS (SELECT 1 FROM question_bank_profiles);
CREATE TABLE IF NOT EXISTS papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL DEFAULT 1,
  external_key TEXT NOT NULL,
  package_id TEXT NOT NULL DEFAULT '',
  content_version TEXT NOT NULL DEFAULT '',
  year INTEGER NOT NULL,
  subject TEXT NOT NULL DEFAULT '英语一',
  title TEXT NOT NULL,
  exam_type TEXT NOT NULL DEFAULT '',
  exam_month INTEGER NOT NULL DEFAULT 0,
  set_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'published',
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id) REFERENCES question_bank_profiles(id)
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
CREATE TABLE IF NOT EXISTS wrong_retry_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  round_number INTEGER NOT NULL,
  question_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE,
  UNIQUE (unit_id, round_number)
);
CREATE TABLE IF NOT EXISTS wrong_retry_round_questions (
  round_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  user_answer TEXT NOT NULL DEFAULT '',
  is_correct INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (round_id, question_id),
  FOREIGN KEY (round_id) REFERENCES wrong_retry_rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS wrong_current_questions (
  unit_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  since_round_id INTEGER,
  deleted_at TEXT,
  PRIMARY KEY (unit_id, question_id),
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  FOREIGN KEY (since_round_id) REFERENCES wrong_retry_rounds(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS app_migrations (
  migration_key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    morphology TEXT NOT NULL DEFAULT '{}',
    generated_example TEXT NOT NULL DEFAULT '{}',
    contextual_occurrence_key TEXT NOT NULL DEFAULT '',
  memory_hint TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  translation_status TEXT NOT NULL DEFAULT 'queued',
  translation_error TEXT NOT NULL DEFAULT '',
  encounter_count INTEGER NOT NULL DEFAULT 1,
  study_status TEXT NOT NULL DEFAULT 'learning',
  manually_frequent INTEGER NOT NULL DEFAULT 0,
  user_edited INTEGER NOT NULL DEFAULT 0,
  review_stage INTEGER NOT NULL DEFAULT 0,
  last_result TEXT NOT NULL DEFAULT '',
  lapse_count INTEGER NOT NULL DEFAULT 0,
  next_review_at TEXT,
  last_reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS vocabulary_enrichment_jobs (
  entry_id INTEGER PRIMARY KEY REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued',
  error TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS vocabulary_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  surface_form TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'unknown',
  selection_start INTEGER NOT NULL DEFAULT -1,
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
  mode TEXT NOT NULL DEFAULT 'scheduled',
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_review_at TEXT
);
CREATE TABLE IF NOT EXISTS ai_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  adapter TEXT NOT NULL DEFAULT 'openai-chat',
  base_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  default_model TEXT NOT NULL DEFAULT '',
  temperature REAL NOT NULL DEFAULT 0.2,
  max_tokens INTEGER NOT NULL DEFAULT 1200,
  reasoning_effort TEXT NOT NULL DEFAULT '',
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
  attachments TEXT,
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
  user_edited INTEGER NOT NULL DEFAULT 0,
  model_name TEXT NOT NULL DEFAULT '',
  label_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS question_label_run_items (
  run_id TEXT NOT NULL,
  question_id INTEGER NOT NULL,
  PRIMARY KEY (run_id, question_id)
);
CREATE TABLE IF NOT EXISTS question_label_runs (
  run_id TEXT PRIMARY KEY,
  question_bank_profile_id INTEGER NOT NULL,
  scope_kind TEXT NOT NULL DEFAULT 'all',
  year INTEGER,
  paper_ids TEXT NOT NULL DEFAULT '[]',
  overwrite_unlocked INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (question_bank_profile_id) REFERENCES question_bank_profiles(id)
);
CREATE TABLE IF NOT EXISTS document_import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL DEFAULT 1,
  filename TEXT NOT NULL,
  answer_filename TEXT NOT NULL DEFAULT '',
  source_file_base64 TEXT NOT NULL DEFAULT '',
  answer_file_base64 TEXT NOT NULL DEFAULT '',
  audio_files_base64 TEXT NOT NULL DEFAULT '[]',
  detected_year INTEGER,
  detected_format TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  draft_data TEXT NOT NULL DEFAULT '{}',
  warnings TEXT NOT NULL DEFAULT '[]',
  published_paper_ids TEXT NOT NULL DEFAULT '[]',
  published_scope_title TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS esq_import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL DEFAULT 1,
  filename TEXT NOT NULL,
  package_data TEXT NOT NULL DEFAULT '{}',
  raw_file_base64 TEXT NOT NULL DEFAULT '',
  preview_data TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
INSERT OR IGNORE INTO app_settings(key, value)
VALUES ('active_question_bank_profile_id', '1');
INSERT OR IGNORE INTO app_settings(key, value)
VALUES ('vocabulary_revision', '0');
CREATE TRIGGER IF NOT EXISTS trg_vocabulary_entries_revision_insert
AFTER INSERT ON vocabulary_entries
BEGIN
  UPDATE app_settings
  SET value = CAST(COALESCE(NULLIF(value, ''), '0') AS INTEGER) + 1
  WHERE key = 'vocabulary_revision';
END;
CREATE TRIGGER IF NOT EXISTS trg_vocabulary_entries_revision_update
AFTER UPDATE ON vocabulary_entries
BEGIN
  UPDATE app_settings
  SET value = CAST(COALESCE(NULLIF(value, ''), '0') AS INTEGER) + 1
  WHERE key = 'vocabulary_revision';
END;
CREATE TRIGGER IF NOT EXISTS trg_vocabulary_entries_revision_delete
AFTER DELETE ON vocabulary_entries
BEGIN
  UPDATE app_settings
  SET value = CAST(COALESCE(NULLIF(value, ''), '0') AS INTEGER) + 1
  WHERE key = 'vocabulary_revision';
END;
CREATE TRIGGER IF NOT EXISTS trg_vocabulary_occurrences_revision_insert
AFTER INSERT ON vocabulary_occurrences
BEGIN
  UPDATE app_settings
  SET value = CAST(COALESCE(NULLIF(value, ''), '0') AS INTEGER) + 1
  WHERE key = 'vocabulary_revision';
END;
CREATE TRIGGER IF NOT EXISTS trg_vocabulary_occurrences_revision_update
AFTER UPDATE ON vocabulary_occurrences
BEGIN
  UPDATE app_settings
  SET value = CAST(COALESCE(NULLIF(value, ''), '0') AS INTEGER) + 1
  WHERE key = 'vocabulary_revision';
END;
CREATE TRIGGER IF NOT EXISTS trg_vocabulary_occurrences_revision_delete
AFTER DELETE ON vocabulary_occurrences
BEGIN
  UPDATE app_settings
  SET value = CAST(COALESCE(NULLIF(value, ''), '0') AS INTEGER) + 1
  WHERE key = 'vocabulary_revision';
END;
CREATE TRIGGER IF NOT EXISTS trg_vocabulary_reviews_revision_insert
AFTER INSERT ON vocabulary_reviews
BEGIN
  UPDATE app_settings
  SET value = CAST(COALESCE(NULLIF(value, ''), '0') AS INTEGER) + 1
  WHERE key = 'vocabulary_revision';
END;
CREATE TRIGGER IF NOT EXISTS trg_vocabulary_reviews_revision_update
AFTER UPDATE ON vocabulary_reviews
BEGIN
  UPDATE app_settings
  SET value = CAST(COALESCE(NULLIF(value, ''), '0') AS INTEGER) + 1
  WHERE key = 'vocabulary_revision';
END;
CREATE TRIGGER IF NOT EXISTS trg_vocabulary_reviews_revision_delete
AFTER DELETE ON vocabulary_reviews
BEGIN
  UPDATE app_settings
  SET value = CAST(COALESCE(NULLIF(value, ''), '0') AS INTEGER) + 1
  WHERE key = 'vocabulary_revision';
END;
CREATE TABLE IF NOT EXISTS trash_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deletion_batch_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id INTEGER NOT NULL,
  resource_name TEXT NOT NULL DEFAULT '',
  profile_id INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  purge_after TEXT NOT NULL,
  restored_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_units_paper ON units(paper_id);
CREATE INDEX IF NOT EXISTS idx_questions_unit ON questions(unit_id);
CREATE INDEX IF NOT EXISTS idx_answers_session ON practice_answers(session_id);
CREATE INDEX IF NOT EXISTS idx_wrong_count ON wrong_stats(wrong_count DESC);
CREATE INDEX IF NOT EXISTS idx_vocab_priority ON vocabulary_entries(encounter_count DESC, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_vocab_occurrences_entry ON vocabulary_occurrences(entry_id, id);
CREATE INDEX IF NOT EXISTS idx_vocab_reviews_entry ON vocabulary_reviews(entry_id);
CREATE INDEX IF NOT EXISTS idx_trash_purge ON trash_entries(purge_after, restored_at);
CREATE INDEX IF NOT EXISTS idx_vocab_status ON vocabulary_entries(translation_status, next_review_at);
CREATE INDEX IF NOT EXISTS idx_events_question ON practice_answer_events(question_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_session ON practice_answer_events(session_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_paper ON practice_sessions(paper_id, status);
CREATE INDEX IF NOT EXISTS idx_enrichment_state ON vocabulary_enrichment_jobs(state);
CREATE TABLE IF NOT EXISTS sync_tombstones (
  table_name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  profile_name TEXT NOT NULL DEFAULT '',
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (table_name, object_key, profile_name)
);
CREATE TABLE IF NOT EXISTS sync_id_aliases (
  table_name TEXT NOT NULL,
  alias_sync_id TEXT NOT NULL,
  canonical_sync_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (table_name, alias_sync_id)
);
INSERT OR IGNORE INTO schema_version(version) VALUES (1);
`

const manager = new SQLiteConnection(CapacitorSQLite)
let connectionPromise: Promise<SQLiteDBConnection> | null = null

// Catalogue reads are pure and repeatable inside one launch, and Android pays
// roughly 20ms of bridge overhead per PRAGMA. The migration chain used to probe
// the same table up to five times, so cache the answers per connection. Anything
// that rebuilds a table has to drop the affected entry (see invalidateCatalogues).
let columnNameCache: Map<string, Set<string>> | null = null
let tableNameCache: string[] | null = null
// `PRAGMA table_info` costs one bridge round trip per table, and the column
// migration chain asks about eighteen of them on every cold start (~430ms on the
// tablet). The table-valued form reads the whole catalogue in a single query.
// Builds without introspection pragmas keep the per-table path.
//
// The single query is restricted to the tables the boot chain actually probes.
// The unfiltered join returns every column of all 76 tables (680 rows, ~54KB)
// and measures ~190ms on the tablet; the filtered form returns 245 rows / ~15KB
// in ~70ms. Any table outside this list still resolves through the per-table
// form and is cached the same way.
const BOOTSTRAP_CATALOGUE_TABLES = [
  'ai_messages',
  'ai_profiles',
  'document_import_jobs',
  'papers',
  'practice_answer_events',
  'practice_answers',
  'practice_sessions',
  'practice_unit_submissions',
  'question_ai_labels',
  'questions',
  'vocabulary_entries',
  'vocabulary_occurrences',
  'vocabulary_reviews',
  'wrong_analysis_states',
  'wrong_current_questions',
  'wrong_retry_round_questions',
  'wrong_retry_rounds',
  'wrong_stats',
] as const
let batchColumnCatalogueUnsupported = false
// The migration chain and the content-remediation gate each check one
// `app_migrations` key, so a launch asks about nine separate times. Reading the
// whole table once answers all of them.
let appliedMigrationKeyCache: Set<string> | null = null
let appliedMigrationPending: Promise<Set<string>> | null = null

function invalidateCatalogues() {
  columnNameCache = null
  tableNameCache = null
  appliedMigrationKeyCache = null
  appliedMigrationPending = null
}

const COLUMN_CATALOGUE_SQL = `SELECT m.name AS table_name, p.name AS column_name
  FROM sqlite_master m
  JOIN pragma_table_info(m.name) p
  WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
    AND m.name IN (${BOOTSTRAP_CATALOGUE_TABLES.map(name => `'${name}'`).join(', ')})`

async function tableColumnNames(
  db: SQLiteDBConnection,
  table: string,
): Promise<Set<string>> {
  if (!columnNameCache && !batchColumnCatalogueUnsupported) {
    try {
      const result = await db.query(COLUMN_CATALOGUE_SQL)
      const catalogue = new Map<string, Set<string>>()
      for (const item of result.values || []) {
        const name = String(item.table_name)
        let columns = catalogue.get(name)
        if (!columns) {
          columns = new Set<string>()
          catalogue.set(name, columns)
        }
        columns.add(String(item.column_name))
      }
      columnNameCache = catalogue
    } catch (error) {
      batchColumnCatalogueUnsupported = true
      // Keep a cache so the per-table fallback below answers each table once.
      columnNameCache = new Map()
      console.info('[db] column catalogue unavailable, probing tables one at a time: ' + describeError(error))
    }
  }
  const cached = columnNameCache?.get(table)
  if (cached) return cached
  // Tables outside the boot catalogue, and builds without table-valued pragmas,
  // fall back to one probe per table.
  const result = await db.query(`PRAGMA table_info(${table})`)
  const names = new Set((result.values || []).map(item => String(item.name)))
  columnNameCache?.set(table, names)
  return names
}

async function ensureColumn(
  db: SQLiteDBConnection,
  table: string,
  column: string,
  declaration: string,
) {
  const names = await tableColumnNames(db, table)
  if (!names.has(column)) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
    names.add(column)
  }
}

/**
 * Capacitor plugin rejections arrive as plain objects, so String(error) would
 * only print "[object Object]" and hide the real reason.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.name + ': ' + error.message
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; error?: unknown }
    const message = candidate.message ?? candidate.error
    if (typeof message === 'string' && message) return message
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

async function tableNames(db: SQLiteDBConnection): Promise<string[]> {
  if (tableNameCache) return tableNameCache
  const result = await db.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  )
  tableNameCache = (result.values || []).map(item => String(item.name))
  return tableNameCache
}

async function tableReferences(db: SQLiteDBConnection, tableName: string): Promise<string[]> {
  const references: string[] = []
  for (const name of await tableNames(db)) {
    const keys = await db.query(`PRAGMA foreign_key_list("${name.replaceAll('"', '""')}")`)
    if ((keys.values || []).some(item => String(item.table || '').toLowerCase() === tableName.toLowerCase())) {
      references.push(name)
    }
  }
  return references
}

async function tableRowCount(db: SQLiteDBConnection, tableName: string): Promise<number> {
  const result = await db.query(`SELECT COUNT(*) AS count FROM "${tableName.replaceAll('"', '""')}"`)
  return Number(result.values?.[0]?.count || 0)
}

async function migrationApplied(db: SQLiteDBConnection, key: string): Promise<boolean> {
  return (await appliedMigrationKeys(db)).has(key)
}

async function appliedMigrationKeys(db: SQLiteDBConnection): Promise<Set<string>> {
  if (appliedMigrationKeyCache) return appliedMigrationKeyCache
  // Concurrent callers share one read; the migration chain asks from several
  // awaits at once while the content-remediation gate starts in parallel.
  if (!appliedMigrationPending) {
    appliedMigrationPending = db
      .query('SELECT migration_key FROM app_migrations')
      .then(result => {
        const keys = new Set((result.values || []).map(item => String(item.migration_key)))
        appliedMigrationKeyCache = keys
        return keys
      })
      .finally(() => { appliedMigrationPending = null })
  }
  return appliedMigrationPending
}

async function markMigrationApplied(db: SQLiteDBConnection, key: string) {
  await db.run('INSERT OR IGNORE INTO app_migrations (migration_key) VALUES (?)', [key], false)
  appliedMigrationKeyCache?.add(key)
}

/** Same answers as the private helpers, for modules that read through row/run. */
export async function isMigrationApplied(key: string): Promise<boolean> {
  return migrationApplied(await androidDatabase(), key)
}

export async function recordMigration(key: string): Promise<void> {
  await markMigrationApplied(await androidDatabase(), key)
}

async function recoverInterruptedPaperTable(db: SQLiteDBConnection) {
  const names = new Set(await tableNames(db))
  const recoveryCandidates = ['papers_rebuild_tmp_papers', 'papers_rebuild']

  if (names.has('papers')) {
    const papersCount = await tableRowCount(db, 'papers')
    if (papersCount > 0) return

    const populatedCandidate = await (async () => {
      for (const candidate of recoveryCandidates) {
        if (names.has(candidate) && await tableRowCount(db, candidate) > 0) return candidate
      }
      return ''
    })()
    if (!populatedCandidate) return

    await db.execute('PRAGMA foreign_keys = OFF', false)
    try {
      await db.execute('DROP TABLE papers', false)
      await db.execute(`ALTER TABLE ${populatedCandidate} RENAME TO papers`, false)
    } finally {
      await db.execute('PRAGMA foreign_keys = ON', false)
    }
    invalidateCatalogues()
    return
  }

  // The temporary table is the complete source of the old migration. The
  // replacement table may still be empty or only partially populated when an
  // upgrade is interrupted, so use it only when the source no longer exists.
  for (const candidate of recoveryCandidates) {
    if (names.has(candidate)) {
      await db.execute(`ALTER TABLE ${candidate} RENAME TO papers`)
      invalidateCatalogues()
      return
    }
  }
}

async function restorePaperMigrationSnapshots(db: SQLiteDBConnection) {
  const snapshotPrefix = 'papers_rebuild_snapshot_'
  const names = new Set(await tableNames(db))
  let dropped = false
  for (const snapshot of [...names].filter(name => name.startsWith(snapshotPrefix))) {
    const target = snapshot.slice(snapshotPrefix.length)
    if (!names.has(target)) continue
    const snapshotColumns = (await db.query(`PRAGMA table_info("${snapshot.replaceAll('"', '""')}")`)).values || []
    const targetColumns = (await db.query(`PRAGMA table_info("${target.replaceAll('"', '""')}")`)).values || []
    const targetNames = new Set(targetColumns.map(item => String(item.name)))
    const shared = snapshotColumns
      .map(item => String(item.name))
      .filter(name => targetNames.has(name))
    if (shared.length) {
      const columnList = shared.map(name => `"${name.replaceAll('"', '""')}"`).join(', ')
      await db.execute(
        `INSERT OR IGNORE INTO "${target.replaceAll('"', '""')}" (${columnList})
         SELECT ${columnList} FROM "${snapshot.replaceAll('"', '""')}"`,
      )
    }
    await db.execute(`DROP TABLE "${snapshot.replaceAll('"', '""')}"`)
    dropped = true
  }
  if (dropped) invalidateCatalogues()
}

async function cleanupInterruptedPaperMigration(db: SQLiteDBConnection) {
  const names = new Set(await tableNames(db))
  if (!names.has('papers')) return
  let dropped = false
  for (const temporary of ['papers_rebuild', 'papers_rebuild_tmp_papers']) {
    if (!names.has(temporary)) continue
    const refs = await tableReferences(db, temporary)
    if (!refs.length) {
      await db.execute(`DROP TABLE IF EXISTS "${temporary}"`)
      dropped = true
    }
  }
  if (dropped) invalidateCatalogues()
}

async function migrateQuestionBankProfiles(db: SQLiteDBConnection) {
  const defaultProfile = await db.query(
    'SELECT id FROM question_bank_profiles WHERE deleted_at IS NULL ORDER BY is_default DESC, id LIMIT 1',
  )
  const defaultProfileId = Number(defaultProfile.values?.[0]?.id || 1)
  await ensureColumn(db, 'papers', 'profile_id', `INTEGER NOT NULL DEFAULT ${defaultProfileId}`)
  await ensureColumn(db, 'papers', 'deleted_at', 'TEXT')
  await ensureColumn(db, 'document_import_jobs', 'profile_id', `INTEGER NOT NULL DEFAULT ${defaultProfileId}`)
  await ensureColumn(db, 'document_import_jobs', 'source_file_base64', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'document_import_jobs', 'answer_file_base64', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'document_import_jobs', 'audio_files_base64', "TEXT NOT NULL DEFAULT '[]'")
  await ensureColumn(db, 'document_import_jobs', 'deleted_at', 'TEXT')
  await db.run('UPDATE papers SET profile_id = ? WHERE profile_id IS NULL OR profile_id = 0', [defaultProfileId], false)
  await db.run('UPDATE document_import_jobs SET profile_id = ? WHERE profile_id IS NULL OR profile_id = 0', [defaultProfileId], false)
  const table = await db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'papers'")
  const sql = String(table.values?.[0]?.sql || '').toUpperCase()
  if (sql.includes('YEAR INTEGER NOT NULL UNIQUE') || sql.includes('EXTERNAL_KEY TEXT NOT NULL UNIQUE')) {
    const childTables = [
      'units', 'questions', 'options', 'practice_sessions',
      'practice_answers', 'practice_answer_events',
      'practice_unit_submissions', 'wrong_stats',
      'vocabulary_occurrences', 'wrong_analysis_states',
    ]
    await db.execute('PRAGMA foreign_keys = OFF', false)
    await db.execute('PRAGMA legacy_alter_table = ON', false)
    try {
    for (const child of childTables) {
      const columns = await db.query(`PRAGMA table_info(${child})`)
      if (columns.values?.length) {
        const columnList = columns.values
          .map(item => `"${String(item.name)}"`)
          .join(', ')
        await db.execute(
          `CREATE TABLE papers_rebuild_snapshot_${child} AS SELECT ${columnList} FROM ${child}`,
        )
      }
    }
    await db.execute('ALTER TABLE papers RENAME TO papers_rebuild_tmp_papers')
    await db.execute(`
      CREATE TABLE papers_rebuild (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        external_key TEXT NOT NULL,
        package_id TEXT NOT NULL DEFAULT '',
        content_version TEXT NOT NULL DEFAULT '',
        year INTEGER NOT NULL,
        subject TEXT NOT NULL DEFAULT '英语一',
        title TEXT NOT NULL,
        exam_type TEXT NOT NULL DEFAULT '',
        exam_month INTEGER NOT NULL DEFAULT 0,
        set_number INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'published',
        deleted_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (profile_id) REFERENCES question_bank_profiles(id)
      )
    `)
    await db.execute(`
      INSERT INTO papers_rebuild
        (id, profile_id, external_key, package_id, content_version, year,
         subject, title, exam_type, exam_month, set_number, status,
         deleted_at, created_at, updated_at)
      SELECT id, profile_id, external_key, package_id, content_version, year,
             subject, title, exam_type, exam_month, set_number, status,
             deleted_at, created_at, updated_at
      FROM papers_rebuild_tmp_papers
    `)
    await db.execute('ALTER TABLE papers_rebuild RENAME TO papers')
    await db.execute('DROP TABLE papers_rebuild_tmp_papers')
    await db.execute(`
      DROP TABLE units;
      DROP TABLE questions;
      DROP TABLE options;
      DROP TABLE practice_sessions;
      DROP TABLE practice_answers;
      DROP TABLE practice_answer_events;
      DROP TABLE practice_unit_submissions;
      DROP TABLE wrong_stats;
      DROP TABLE vocabulary_occurrences;
      DROP TABLE wrong_analysis_states;
      CREATE TABLE units (
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
      CREATE TABLE questions (
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
      CREATE TABLE options (
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
      CREATE TABLE practice_sessions (
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
      CREATE TABLE practice_answers (
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
      CREATE TABLE practice_answer_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        question_id INTEGER NOT NULL,
        user_answer TEXT NOT NULL,
        option_order TEXT NOT NULL DEFAULT '[]',
        changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE practice_unit_submissions (
        session_id INTEGER NOT NULL,
        unit_id INTEGER NOT NULL,
        submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        score REAL NOT NULL DEFAULT 0,
        max_score REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, unit_id)
      );
      CREATE TABLE wrong_stats (
        question_id INTEGER PRIMARY KEY,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        wrong_count INTEGER NOT NULL DEFAULT 0,
        recent_results TEXT NOT NULL DEFAULT '[]',
        consecutive_correct INTEGER NOT NULL DEFAULT 0,
        manually_frequent INTEGER NOT NULL DEFAULT 0,
        last_wrong_at TEXT,
        last_attempt_at TEXT
      );
      CREATE TABLE vocabulary_occurrences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL,
        surface_form TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'unknown',
  selection_start INTEGER NOT NULL DEFAULT -1,
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
      CREATE TABLE wrong_analysis_states (
        unit_id INTEGER PRIMARY KEY,
        report_id INTEGER NOT NULL,
        analyzed_session_id INTEGER NOT NULL DEFAULT 0,
        analyzed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_units_paper ON units(paper_id);
      CREATE INDEX IF NOT EXISTS idx_questions_unit ON questions(unit_id);
      CREATE INDEX IF NOT EXISTS idx_answers_session ON practice_answers(session_id);
      CREATE INDEX IF NOT EXISTS idx_answer_events_question
        ON practice_answer_events(question_id, changed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_unit_submissions_session
        ON practice_unit_submissions(session_id);
      CREATE INDEX IF NOT EXISTS idx_wrong_count ON wrong_stats(wrong_count DESC);
      CREATE INDEX IF NOT EXISTS idx_vocab_priority
        ON vocabulary_entries(encounter_count DESC, last_seen_at DESC);
      CREATE INDEX IF NOT EXISTS idx_vocab_occurrences_entry
        ON vocabulary_occurrences(entry_id, created_at DESC);
    `)
    for (const child of childTables) {
      const snapshot = await db.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [`papers_rebuild_snapshot_${child}`],
      )
      if (!snapshot.values?.length) continue
      const snapshotColumns = (await db.query(
        `PRAGMA table_info(papers_rebuild_snapshot_${child})`,
      )).values || []
      const oldNames = new Set(snapshotColumns.map(item => String(item.name)))
      const newColumns = (await db.query(`PRAGMA table_info(${child})`)).values || []
      const shared = newColumns
        .map(item => String(item.name))
        .filter(name => oldNames.has(name))
      if (shared.length) {
        const columnList = shared.map(name => `"${name}"`).join(', ')
        await db.execute(
          `INSERT INTO ${child} (${columnList})
           SELECT ${columnList} FROM papers_rebuild_snapshot_${child}`,
        )
      }
      await db.execute(`DROP TABLE papers_rebuild_snapshot_${child}`)
    }
    } finally {
      await db.execute('PRAGMA legacy_alter_table = OFF', false)
      await db.execute('PRAGMA foreign_keys = ON', false)
    }
    invalidateCatalogues()
    const violations = await db.query('PRAGMA foreign_key_check')
    if (violations.values?.length) {
      throw new Error(
        `数据库迁移后外键校验失败：${JSON.stringify(violations.values)}`,
      )
    }
  }
  await db.run(
    `INSERT OR IGNORE INTO app_settings(key, value)
     VALUES ('active_question_bank_profile_id', ?)`,
    [String(defaultProfileId)],
    false,
  )
}

async function repairStalePaperForeignKey(db: SQLiteDBConnection) {
  const foreignKeys = await db.query('PRAGMA foreign_key_list(units)')
  const staleReference = (foreignKeys.values || []).some(
    item => String(item.table || '').toLowerCase() === 'papers_rebuild_tmp_papers',
  )
  if (!staleReference) return

  await db.execute('PRAGMA foreign_keys = OFF', false)
  try {
    await db.execute(`
      DROP TABLE IF EXISTS units_fk_repair;
      CREATE TABLE units_fk_repair (
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
      INSERT INTO units_fk_repair
        (id, paper_id, external_key, unit_type, subtype, title, sequence, passage, shared_data)
      SELECT id, paper_id, external_key, unit_type, subtype, title, sequence, passage, shared_data
      FROM units;
      DROP TABLE units;
      ALTER TABLE units_fk_repair RENAME TO units;
      CREATE INDEX IF NOT EXISTS idx_units_paper ON units(paper_id);
    `)
    invalidateCatalogues()
  } finally {
    await db.execute('PRAGMA foreign_keys = ON', false)
  }

  const repairedForeignKeys = await db.query('PRAGMA foreign_key_list(units)')
  const paperReference = (repairedForeignKeys.values || []).some(
    item => String(item.table || '').toLowerCase() === 'papers',
  )
  if (!paperReference) {
    throw new Error('数据库迁移失败：units 外键未恢复到 papers')
  }
}

/**
 * Older builds could publish one question-bank package while a second profile was
 * selected, so the same papers kept a second copy of their units, questions,
 * options and generated labels. No practice record pointed at that copy, but every
 * list and queue read walked both copies on start-up.
 *
 * A copy is removed only when nothing references it. A copy that carries user work
 * (answers, wrong items, retry rounds, vocabulary, a session's unit list, a trash
 * entry or a user-edited label) stays untouched and is reported instead.
 */
async function migratePaperExamMetadata(db: SQLiteDBConnection) {
  await ensureColumn(db, 'papers', 'exam_type', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'papers', 'exam_month', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'papers', 'set_number', 'INTEGER NOT NULL DEFAULT 1')
  // The columns above already carry constant defaults, so the sweep is only
  // needed while legacy rows still hold NULL. Probe first to keep cold start
  // from rewriting every paper row on each launch.
  const pending = await db.query(
    `SELECT 1 FROM papers
     WHERE exam_type IS NULL OR exam_month IS NULL OR set_number IS NULL
     LIMIT 1`,
  )
  if (!(pending.values || []).length) return
  await db.run(
    `UPDATE papers
     SET exam_type = COALESCE(exam_type, ''),
         exam_month = COALESCE(exam_month, 0),
         set_number = COALESCE(set_number, 1)`,
    [],
    false,
  )
}

async function createQuestionBankProfileIndexes(db: SQLiteDBConnection) {
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_papers_profile
      ON papers(profile_id, deleted_at, year DESC);
    CREATE INDEX IF NOT EXISTS idx_document_import_profile
      ON document_import_jobs(profile_id, deleted_at, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_esq_import_profile
      ON esq_import_jobs(profile_id, deleted_at, updated_at DESC);
  `)
}

/**
 * Older bundled/ESQ packages did not carry the fixed-position metadata for
 * English I Part B ordering questions. Backfill only the contextual hint so
 * existing user answers, labels and passages remain untouched.
 */
async function backfillEnglishOneOrderingFixedSlots(db: SQLiteDBConnection) {
  // Bundled/ESQ imports write fixed_slots up front, so this backfill is a
  // one-time repair for rows imported by older builds. The marker plus the
  // bounded probe keep repeat launches free of the full scan.
  if (await migrationApplied(db, ORDERING_FIXED_SLOTS_MIGRATION)) return
  const pending = await db.query(`
    SELECT 1
    FROM units
    INNER JOIN papers ON papers.id = units.paper_id
    WHERE units.unit_type = 'part_b'
      AND units.subtype = 'paragraph_reordering'
      AND papers.year IN (2010, 2011, 2014, 2017, 2018, 2019, 2023)
      AND papers.deleted_at IS NULL
      AND (units.shared_data IS NULL
           OR (units.shared_data NOT LIKE '%fixed_slots%'
               AND units.shared_data NOT LIKE '%fixedSlots%'))
    LIMIT 1
  `)
  const changed = (pending.values || []).length > 0
  if (changed) await runOrderingFixedSlotsBackfill(db)
  await markMigrationApplied(db, ORDERING_FIXED_SLOTS_MIGRATION)
}

async function runOrderingFixedSlotsBackfill(db: SQLiteDBConnection) {
  const result = await db.query(`
    SELECT units.id, units.unit_type, units.subtype, units.shared_data,
           papers.year, papers.subject, papers.title, papers.external_key
    FROM units
    INNER JOIN papers ON papers.id = units.paper_id
    WHERE units.unit_type = 'part_b'
      AND units.subtype = 'paragraph_reordering'
      AND papers.year IN (2010, 2011, 2014, 2017, 2018, 2019, 2023)
      AND papers.deleted_at IS NULL
  `)
  for (const row of result.values || []) {
    let sharedData: Record<string, any> = {}
    try {
      const parsed = JSON.parse(String(row.shared_data || '{}'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) sharedData = parsed
    } catch {
      continue
    }
    if (Array.isArray(sharedData.fixed_slots) || Array.isArray(sharedData.fixedSlots)) continue
    const fixedSlots = orderingFixedSlotsForPaperUnit(row, row)
    if (!fixedSlots.length) continue
    await db.run(
      'UPDATE units SET shared_data = ? WHERE id = ?',
      [JSON.stringify({ ...sharedData, fixed_slots: fixedSlots }), Number(row.id)],
      false,
    )
  }
}

async function rawAndroidDatabase(): Promise<SQLiteDBConnection> {
  if (!connectionPromise) {
    connectionPromise = (async () => {
      invalidateCatalogues()
      const consistent = await manager.checkConnectionsConsistency()
      const existing = await manager.isConnection(DB_NAME, false)
      let db: SQLiteDBConnection
      if (consistent.result && existing.result) {
        db = await manager.retrieveConnection(DB_NAME, false)
      } else {
        db = await manager.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false)
      }
      if (!(await db.isDBOpen()).result) await db.open()
      await recoverInterruptedPaperTable(db)
      await db.execute(SCHEMA)
      await ensureColumn(db, 'ai_profiles', 'adapter', "TEXT NOT NULL DEFAULT 'openai-chat'")
      await ensureColumn(db, 'ai_profiles', 'reasoning_effort', "TEXT NOT NULL DEFAULT ''")
      await restorePaperMigrationSnapshots(db)
      await migratePaperExamMetadata(db)
      await migrateQuestionBankProfiles(db)
      await repairStalePaperForeignKey(db)
      await cleanupInterruptedPaperMigration(db)
      await createQuestionBankProfileIndexes(db)
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_question_label_run_items_question
          ON question_label_run_items(question_id, run_id);
        CREATE INDEX IF NOT EXISTS idx_question_label_runs_profile_status
          ON question_label_runs(question_bank_profile_id, status, updated_at DESC);
      `)
      await backfillEnglishOneOrderingFixedSlots(db)
      const questionColumns = await tableColumnNames(db, 'questions')
      if (!questionColumns.has('content_hash')) {
        await db.execute("ALTER TABLE questions ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''")
        questionColumns.add('content_hash')
      }
      const stateColumns = await tableColumnNames(db, 'wrong_analysis_states')
      if (stateColumns.size && !stateColumns.has('analyzed_session_id')) {
        await db.execute('ALTER TABLE wrong_analysis_states ADD COLUMN analyzed_session_id INTEGER NOT NULL DEFAULT 0')
        stateColumns.add('analyzed_session_id')
      }
      const aiMessageColumns = await tableColumnNames(db, 'ai_messages')
      if (aiMessageColumns.size && !aiMessageColumns.has('attachments')) {
        await db.execute('ALTER TABLE ai_messages ADD COLUMN attachments TEXT')
        aiMessageColumns.add('attachments')
      }
      const vocabColumns = await tableColumnNames(db, 'vocabulary_entries')
      const sessionColumns = await tableColumnNames(db, 'practice_sessions')
      if (!sessionColumns.has('candidate_policy_version')) {
        await db.execute('ALTER TABLE practice_sessions ADD COLUMN candidate_policy_version INTEGER NOT NULL DEFAULT 0')
        sessionColumns.add('candidate_policy_version')
      }
      if (!sessionColumns.has('content_snapshot')) {
        await db.execute("ALTER TABLE practice_sessions ADD COLUMN content_snapshot TEXT NOT NULL DEFAULT '{}'")
        sessionColumns.add('content_snapshot')
      }
      if (!sessionColumns.has('snapshot_accepted_revision')) {
        await db.execute("ALTER TABLE practice_sessions ADD COLUMN snapshot_accepted_revision TEXT NOT NULL DEFAULT ''")
        sessionColumns.add('snapshot_accepted_revision')
      }
      if (!sessionColumns.has('content_revisions')) {
        await db.execute("ALTER TABLE practice_sessions ADD COLUMN content_revisions TEXT NOT NULL DEFAULT '{}'")
        sessionColumns.add('content_revisions')
      }
      const occurrenceNames = await tableColumnNames(db, 'vocabulary_occurrences')
      if (!occurrenceNames.has('source_kind')) {
        await db.execute("ALTER TABLE vocabulary_occurrences ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'unknown'")
        occurrenceNames.add('source_kind')
      }
      if (!occurrenceNames.has('selection_start')) {
        await db.execute('ALTER TABLE vocabulary_occurrences ADD COLUMN selection_start INTEGER NOT NULL DEFAULT -1')
        occurrenceNames.add('selection_start')
      }
      const vocabNames = vocabColumns
      for (const [name, fallback] of [['morphology', '{}'], ['generated_example', '{}'], ['contextual_occurrence_key', '']]) {
        if (!vocabNames.has(name)) {
          await db.execute(`ALTER TABLE vocabulary_entries ADD COLUMN ${name} TEXT NOT NULL DEFAULT '${fallback}'`)
          vocabNames.add(name)
        }
      }
      for (const [name, declaration] of [
        ['synonyms', "TEXT NOT NULL DEFAULT '[]'"],
        ['antonyms', "TEXT NOT NULL DEFAULT '[]'"],
        ['similar_forms', "TEXT NOT NULL DEFAULT '[]'"],
        ['review_stage', 'INTEGER NOT NULL DEFAULT 0'],
        ['last_result', "TEXT NOT NULL DEFAULT ''"],
        ['lapse_count', 'INTEGER NOT NULL DEFAULT 0'],
      ] as const) {
        if (vocabNames.has(name)) continue
        await db.execute(`ALTER TABLE vocabulary_entries ADD COLUMN ${name} ${declaration}`)
        vocabNames.add(name)
      }
      const reviewNames = await tableColumnNames(db, 'vocabulary_reviews')
      if (!reviewNames.has('mode')) {
        await db.execute("ALTER TABLE vocabulary_reviews ADD COLUMN mode TEXT NOT NULL DEFAULT 'scheduled'")
        reviewNames.add('mode')
      }
      if (!await migrationApplied(db, 'wrong-current-pool-v1')) {
        await db.execute(`
          INSERT OR IGNORE INTO wrong_current_questions (unit_id, question_id)
          SELECT q.unit_id, w.question_id
          FROM wrong_stats w
          JOIN questions q ON q.id = w.question_id
          WHERE w.wrong_count > 0;
        `)
        await markMigrationApplied(db, 'wrong-current-pool-v1')
      }
      const labelNames = await tableColumnNames(db, 'question_ai_labels')
      if (!labelNames.has('user_edited')) {
        await db.execute("ALTER TABLE question_ai_labels ADD COLUMN user_edited INTEGER NOT NULL DEFAULT 0")
        labelNames.add('user_edited')
      }
      if (!labelNames.has('label_version')) {
        await db.execute("ALTER TABLE question_ai_labels ADD COLUMN label_version INTEGER NOT NULL DEFAULT 1")
        labelNames.add('label_version')
      }
      if (!labelNames.has('updated_at')) {
        await db.execute("ALTER TABLE question_ai_labels ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")
        labelNames.add('updated_at')
        await db.execute("UPDATE question_ai_labels SET updated_at = CURRENT_TIMESTAMP WHERE updated_at = ''")
      }
      if (!await migrationApplied(db, 'question-label-auto-lock-v1')) {
        await db.run(
          `UPDATE question_ai_labels
           SET locked = 1, updated_at = CURRENT_TIMESTAMP
           WHERE locked = 0
             AND EXISTS (SELECT 1 FROM questions WHERE questions.id = question_ai_labels.question_id)
             AND (TRIM(COALESCE(primary_skill, '')) <> ''
                  OR TRIM(COALESCE(model_name, '')) <> ''
                  OR user_edited = 1)`,
          [],
          false,
        )
        await markMigrationApplied(db, 'question-label-auto-lock-v1')
      }
      for (const table of [
        'practice_sessions',
        'practice_answers',
        'practice_answer_events',
        'practice_unit_submissions',
        'wrong_retry_rounds',
        'wrong_retry_round_questions',
        'wrong_current_questions',
        'vocabulary_occurrences',
        'vocabulary_reviews',
      ]) {
        const names = await tableColumnNames(db, table)
        if (!names.has('sync_id')) {
          await db.execute(`ALTER TABLE ${table} ADD COLUMN sync_id TEXT`)
          names.add('sync_id')
        }
        if (!names.has('updated_at')) {
          await db.execute(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT`)
          names.add('updated_at')
        }
      }
      for (const table of ['wrong_stats']) {
        const names = await tableColumnNames(db, table)
        if (!names.has('attempt_ledger')) {
          await db.execute('ALTER TABLE wrong_stats ADD COLUMN attempt_ledger TEXT')
          names.add('attempt_ledger')
        }
        if (!names.has('updated_at')) {
          await db.execute(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT`)
          names.add('updated_at')
        }
      }
      // LAN sync stable keys: backfill sync_id / updated_at for rows that
      // predate the sync columns, so incremental comparisons and deletes work.
      // App code writes both columns on insert, so the probe usually finds
      // nothing and the launch stays read-only.
      const syncIdentityTables = [
        'practice_sessions',
        'practice_answers',
        'practice_answer_events',
        'practice_unit_submissions',
        'wrong_retry_rounds',
        'wrong_retry_round_questions',
        'wrong_current_questions',
        'vocabulary_occurrences',
        'vocabulary_reviews',
      ]
      // A single combined probe replaces ten per-table round trips; each branch
      // is served by the sync_id index and normally returns no rows. Branches
      // must stay bare existence checks: SQLite rejects a LIMIT inside a
      // compound SELECT branch.
      const syncPending = await db.query([
        ...syncIdentityTables.map(
          table => `SELECT '${table}' AS table_name WHERE EXISTS (SELECT 1 FROM ${table}
           WHERE sync_id IS NULL OR sync_id = '' OR updated_at IS NULL OR updated_at = '')`,
        ),
        `SELECT 'wrong_stats' AS table_name WHERE EXISTS (SELECT 1 FROM wrong_stats
         WHERE updated_at IS NULL OR updated_at = '')`,
      ].join(' UNION ALL '))
      const pendingTables = new Set((syncPending.values || []).map(row => String(row.table_name)))
      for (const table of syncIdentityTables) {
        if (!pendingTables.has(table)) continue
        await db.run(
          `UPDATE ${table} SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL OR sync_id = ''`,
          [],
          false,
        )
        await db.run(
          `UPDATE ${table} SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL OR updated_at = ''`,
          [],
          false,
        )
      }
      if (pendingTables.has('wrong_stats')) {
        await db.run(
          `UPDATE wrong_stats SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL OR updated_at = ''`,
          [],
          false,
        )
      }
      // A new database connection has no surviving in-process translation worker.
      const stalledTranslations = await db.query(
        "SELECT 1 FROM vocabulary_entries WHERE user_edited = 0 AND translation_status = 'translating' LIMIT 1",
      )
      if ((stalledTranslations.values || []).length) {
        await db.run(
          "UPDATE vocabulary_entries SET translation_status = 'queued', translation_error = '' WHERE user_edited = 0 AND translation_status = 'translating'",
          [], false,
        )
      }
      const stalledEnrichment = await db.query(
        "SELECT 1 FROM vocabulary_enrichment_jobs WHERE state = 'inflight' LIMIT 1",
      )
      if ((stalledEnrichment.values || []).length) {
        await db.run("UPDATE vocabulary_enrichment_jobs SET state='queued' WHERE state='inflight'", [], false)
      }
      await ensureSyncVersions(db)
      // These gates run inside the connection bootstrap, so they cannot call the
      // `isMigrationApplied` export: that awaits the very promise still pending
      // here. They share the launch-wide key cache through the probe instead,
      // and the cache is kept in step after a gate writes its key directly.
      const appliedProbe: AppliedMigrationProbe = key => migrationApplied(db, key)
      const rebindGates: [string, () => Promise<boolean>][] = [
        [LEARNING_HISTORY_REBIND_MIGRATION, () => runLearningHistoryRebindV1(db, appliedProbe)],
        [LEARNING_HISTORY_REBIND_V2_MIGRATION, () => runLearningHistoryRebindV2(db, appliedProbe)],
        [LEARNING_HISTORY_REBIND_V3_MIGRATION, () => runLearningHistoryRebindV3(db, appliedProbe)],
      ]
      for (const [key, gate] of rebindGates) {
        if (await gate()) appliedMigrationKeyCache?.add(key)
      }
      await repairLearningHistoryRebindDrift(db)
      return db
    })()
  }
  return connectionPromise
}

// Only the import transaction uses the raw connection while this barrier is held.
// Ordinary callers (including background workers and diagnostics) await it.
let exclusiveBarrier: Promise<void> | undefined
let databaseFailure: Error | undefined
const pendingDatabaseCalls = new Set<Promise<unknown>>()
let guardedConnection: SQLiteDBConnection | undefined
export async function androidDatabase(): Promise<SQLiteDBConnection> {
  const db = await rawAndroidDatabase()
  guardedConnection ||= new Proxy(db, {
    get(target, property) {
      const value = Reflect.get(target, property)
      if (typeof value !== 'function') return value
      return async (...args: unknown[]) => {
        while (exclusiveBarrier) await exclusiveBarrier
        if (databaseFailure) throw databaseFailure
        const pending = Promise.resolve(value.apply(target, args))
        pendingDatabaseCalls.add(pending)
        try { return await pending } finally { pendingDatabaseCalls.delete(pending) }
      }
    },
  })
  return guardedConnection
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

// 一组写语句合并成一次桥调用 + 一个原生事务（插件在 finally 里自动回滚）。
// 只用于“多条写必须同时生效”的合并场景：集合内取不到 SELECT 结果，
// 读值仍由调用方在事务外单独读取。
export async function executeSet(set: { statement: string; values?: unknown[] }[]): Promise<void> {
  // 原生端逐条执行 row.getJSONArray("values")，缺省该键会直接抛 JSONException，
  // 这里统一补空数组，无参语句也能安全合并。
  await (await androidDatabase()).executeSet(
    set.map(item => ({ statement: item.statement, values: item.values || [] })),
    true,
    'no',
  )
}

const runTransactionSerially = createSerialQueue()

export async function transaction<T>(operation: (db: SQLiteDBConnection) => Promise<T>, options: { exclusive?: boolean } = {}): Promise<T> {
  return runTransactionSerially(async () => {
    if (typeof databaseFailure !== 'undefined' && databaseFailure) throw databaseFailure
    const db = await rawAndroidDatabase()
    let release: (() => void) | undefined
    if (options.exclusive) {
      exclusiveBarrier = new Promise<void>(resolve => { release = resolve })
      await Promise.allSettled([...pendingDatabaseCalls])
    }
    try {
    const active = await db.isTransactionActive()
    if (active.result) {
      throw new Error('检测到未清理的 SQLite 活动事务，已拒绝嵌套写入')
    }
    let started = false
    try {
      await db.beginTransaction()
      started = true
      const result = await operation(db)
      if (!(await db.isTransactionActive()).result) {
        throw new Error('SQLite 事务在提交前意外结束')
      }
      await db.commitTransaction()
      started = false
      return result
    } catch (error) {
      try {
        if (started && (await db.isTransactionActive()).result) await db.rollbackTransaction()
      } catch (rollbackError) {
        // Never let waiting writers join a transaction whose rollback failed.
        // Reopening the app lets SQLite recover its durable journal.
        databaseFailure = new Error('SQLite 回滚失败，请重新启动应用后重试', { cause: rollbackError })
      }
      throw error
    }
    } finally {
      if (release) { exclusiveBarrier = undefined; release() }
    }
  })
}
