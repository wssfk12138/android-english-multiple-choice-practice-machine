import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const sourcePath = fileURLToPath(
  new URL('../src/platform/android/database.ts', import.meta.url),
)
const source = readFileSync(sourcePath, 'utf8')
const schema = source.match(
  /const SCHEMA = `([\s\S]*?)`\r?\n\r?\nconst manager/,
)?.[1] || ''

assert.ok(schema, 'database schema template should be discoverable')
assert.equal(
  /UPDATE\s+papers\s+SET\s+exam_type/i.test(schema),
  false,
  'the base schema must not update columns that may not exist in an upgraded database',
)
assert.equal(
  /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_(papers|document_import|esq_import)_profile/i.test(schema),
  false,
  'the base schema must not index profile columns that may not exist in an upgraded database',
)

const migrationStart = source.indexOf('async function migratePaperExamMetadata')
const ensureExamType = source.indexOf("ensureColumn(db, 'papers', 'exam_type'", migrationStart)
const normalizeExamType = source.indexOf('UPDATE papers', migrationStart)
assert.ok(migrationStart >= 0, 'exam metadata migration should exist')
assert.ok(
  ensureExamType > migrationStart && normalizeExamType > ensureExamType,
  'exam columns must be added before their values are normalized',
)

const startupMigration = source.indexOf('await migratePaperExamMetadata(db)')
const profileMigration = source.indexOf('await migrateQuestionBankProfiles(db)', startupMigration)
const profileIndexes = source.indexOf('await createQuestionBankProfileIndexes(db)', profileMigration)
assert.ok(
  startupMigration >= 0 && profileMigration > startupMigration,
  'exam metadata must be migrated before the legacy papers table can be rebuilt',
)
assert.ok(
  profileIndexes > profileMigration,
  'profile indexes must be created only after legacy profile columns are added',
)

console.log('Android legacy paper-schema migration ordering: OK')
