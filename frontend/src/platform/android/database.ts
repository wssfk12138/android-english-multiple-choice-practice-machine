import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import { createSerialQueue } from './serial-queue'
import { orderingFixedSlotsForPaperUnit } from './ordering-fixed-slots'

const DB_NAME = 'english_practice_machine'
const DB_VERSION = 1

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
  mode TEXT NOT NULL DEFAULT 'scheduled',
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
CREATE INDEX IF NOT EXISTS idx_trash_purge ON trash_entries(purge_after, restored_at);
CREATE TABLE IF NOT EXISTS sync_tombstones (
  table_name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  profile_name TEXT NOT NULL DEFAULT '',
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (table_name, object_key, profile_name)
);
INSERT OR IGNORE INTO schema_version(version) VALUES (1);
`

const manager = new SQLiteConnection(CapacitorSQLite)
let connectionPromise: Promise<SQLiteDBConnection> | null = null

async function ensureColumn(
  db: SQLiteDBConnection,
  table: string,
  column: string,
  declaration: string,
) {
  const result = await db.query(`PRAGMA table_info(${table})`)
  if (!(result.values || []).some(item => item.name === column)) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
  }
}

async function tableNames(db: SQLiteDBConnection): Promise<string[]> {
  const result = await db.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  )
  return (result.values || []).map(item => String(item.name))
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
    return
  }

  // The temporary table is the complete source of the old migration. The
  // replacement table may still be empty or only partially populated when an
  // upgrade is interrupted, so use it only when the source no longer exists.
  for (const candidate of recoveryCandidates) {
    if (names.has(candidate)) {
      await db.execute(`ALTER TABLE ${candidate} RENAME TO papers`)
      return
    }
  }
}

async function restorePaperMigrationSnapshots(db: SQLiteDBConnection) {
  const snapshotPrefix = 'papers_rebuild_snapshot_'
  const names = new Set(await tableNames(db))
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
  }
}

async function cleanupInterruptedPaperMigration(db: SQLiteDBConnection) {
  const names = new Set(await tableNames(db))
  if (!names.has('papers')) return
  for (const temporary of ['papers_rebuild', 'papers_rebuild_tmp_papers']) {
    if (!names.has(temporary)) continue
    const refs = await tableReferences(db, temporary)
    if (!refs.length) {
      await db.execute(`DROP TABLE IF EXISTS "${temporary}"`)
    }
  }
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

async function migratePaperExamMetadata(db: SQLiteDBConnection) {
  await ensureColumn(db, 'papers', 'exam_type', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'papers', 'exam_month', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(db, 'papers', 'set_number', 'INTEGER NOT NULL DEFAULT 1')
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
    if (Array.isArray(sharedData.fixed_slots) && sharedData.fixed_slots.length) continue
    const fixedSlots = orderingFixedSlotsForPaperUnit(row, row)
    if (!fixedSlots.length) continue
    await db.run(
      'UPDATE units SET shared_data = ? WHERE id = ?',
      [JSON.stringify({ ...sharedData, fixed_slots: fixedSlots }), Number(row.id)],
      false,
    )
  }
}

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
      await recoverInterruptedPaperTable(db)
      await db.execute(SCHEMA)
      await restorePaperMigrationSnapshots(db)
      await migratePaperExamMetadata(db)
      await migrateQuestionBankProfiles(db)
      await repairStalePaperForeignKey(db)
      await cleanupInterruptedPaperMigration(db)
      await createQuestionBankProfileIndexes(db)
      await backfillEnglishOneOrderingFixedSlots(db)
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
      if (!vocabNames.has('review_stage')) await db.execute('ALTER TABLE vocabulary_entries ADD COLUMN review_stage INTEGER NOT NULL DEFAULT 0')
      if (!vocabNames.has('last_result')) await db.execute("ALTER TABLE vocabulary_entries ADD COLUMN last_result TEXT NOT NULL DEFAULT ''")
      if (!vocabNames.has('lapse_count')) await db.execute('ALTER TABLE vocabulary_entries ADD COLUMN lapse_count INTEGER NOT NULL DEFAULT 0')
      const reviewColumns = await db.query('PRAGMA table_info(vocabulary_reviews)')
      const reviewNames = new Set((reviewColumns.values || []).map(column => column.name))
      if (!reviewNames.has('mode')) await db.execute("ALTER TABLE vocabulary_reviews ADD COLUMN mode TEXT NOT NULL DEFAULT 'scheduled'")
      const wrongPoolMigration = await db.query(
        "SELECT migration_key FROM app_migrations WHERE migration_key = 'wrong-current-pool-v1' LIMIT 1",
      )
      if (!(wrongPoolMigration.values || []).length) {
        await db.execute(`
          INSERT OR IGNORE INTO wrong_current_questions (unit_id, question_id)
          SELECT q.unit_id, w.question_id
          FROM wrong_stats w
          JOIN questions q ON q.id = w.question_id
          WHERE w.wrong_count > 0;
          INSERT INTO app_migrations (migration_key) VALUES ('wrong-current-pool-v1');
        `)
      }
      const labelColumns = await db.query('PRAGMA table_info(question_ai_labels)')
      const labelNames = new Set((labelColumns.values || []).map(column => column.name))
      if (!labelNames.has('user_edited')) await db.execute("ALTER TABLE question_ai_labels ADD COLUMN user_edited INTEGER NOT NULL DEFAULT 0")
      if (!labelNames.has('label_version')) await db.execute("ALTER TABLE question_ai_labels ADD COLUMN label_version INTEGER NOT NULL DEFAULT 1")
      if (!labelNames.has('updated_at')) {
        await db.execute("ALTER TABLE question_ai_labels ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")
        await db.execute("UPDATE question_ai_labels SET updated_at = CURRENT_TIMESTAMP WHERE updated_at = ''")
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
        const syncColumns = await db.query(`PRAGMA table_info(${table})`)
        const names = new Set((syncColumns.values || []).map(column => column.name))
        if (!names.has('sync_id')) {
          await db.execute(`ALTER TABLE ${table} ADD COLUMN sync_id TEXT`)
        }
        if (!names.has('updated_at')) {
          await db.execute(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT`)
        }
      }
      for (const table of ['wrong_stats']) {
        const syncColumns = await db.query(`PRAGMA table_info(${table})`)
        const names = new Set((syncColumns.values || []).map(column => column.name))
        if (!names.has('updated_at')) {
          await db.execute(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT`)
        }
      }
      // LAN sync stable keys: backfill sync_id / updated_at for rows that
      // predate the sync columns, so incremental comparisons and deletes work.
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
      await db.run(
        `UPDATE wrong_stats SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL OR updated_at = ''`,
        [],
        false,
      )
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
      } catch {
        // Preserve the original operation error.
      }
      throw error
    }
  })
}
