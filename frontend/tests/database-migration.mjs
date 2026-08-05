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
const staleForeignKeyRepair = source.indexOf('await repairStalePaperForeignKey(db)', profileMigration)
const profileIndexes = source.indexOf('await createQuestionBankProfileIndexes(db)', profileMigration)
assert.ok(
  startupMigration >= 0 && profileMigration > startupMigration,
  'exam metadata must be migrated before the legacy papers table can be rebuilt',
)
assert.ok(
  staleForeignKeyRepair > profileMigration && profileIndexes > staleForeignKeyRepair,
  'stale paper foreign keys must be repaired before profile indexes are created',
)

const profileMigrationStart = source.indexOf('async function migrateQuestionBankProfiles')
const legacyRenameGuard = source.indexOf('PRAGMA legacy_alter_table = ON', profileMigrationStart)
const papersRename = source.indexOf('ALTER TABLE papers RENAME TO papers_rebuild_tmp_papers', profileMigrationStart)
const legacyRenameRestore = source.indexOf('PRAGMA legacy_alter_table = OFF', papersRename)
assert.ok(
  legacyRenameGuard > profileMigrationStart
    && papersRename > legacyRenameGuard
    && legacyRenameRestore > papersRename,
  'legacy table rename mode must protect child foreign keys while papers is rebuilt',
)

const repairStart = source.indexOf('async function repairStalePaperForeignKey')
const inspectUnitsForeignKey = source.indexOf('PRAGMA foreign_key_list(units)', repairStart)
const createReplacementUnits = source.indexOf('CREATE TABLE units_fk_repair', repairStart)
const dropBrokenUnits = source.indexOf('DROP TABLE units;', createReplacementUnits)
const restoreUnitsName = source.indexOf('ALTER TABLE units_fk_repair RENAME TO units', dropBrokenUnits)
assert.ok(
  repairStart >= 0
    && inspectUnitsForeignKey > repairStart
    && createReplacementUnits > inspectUnitsForeignKey
    && dropBrokenUnits > createReplacementUnits
    && restoreUnitsName > dropBrokenUnits,
  'the alpha.13 stale units foreign key must be rebuilt without renaming the broken table',
)

assert.ok(
  profileIndexes > profileMigration,
  'profile indexes must be created only after legacy profile columns are added',
)

console.log('Android legacy paper-schema migration ordering: OK')
