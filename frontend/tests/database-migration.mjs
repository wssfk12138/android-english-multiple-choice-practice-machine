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

const databaseInitialization = source.indexOf('connectionPromise = (async () =>')
const recoverInterruptedTable = source.indexOf('await recoverInterruptedPaperTable(db)', databaseInitialization)
const createBaseSchema = source.indexOf('await db.execute(SCHEMA)', databaseInitialization)
const restoreSnapshots = source.indexOf('await restorePaperMigrationSnapshots(db)', createBaseSchema)
const startupMigration = source.indexOf('await migratePaperExamMetadata(db)', restoreSnapshots)
const profileMigration = source.indexOf('await migrateQuestionBankProfiles(db)', startupMigration)
const staleForeignKeyRepair = source.indexOf('await repairStalePaperForeignKey(db)', profileMigration)
const cleanupInterruptedMigration = source.indexOf('await cleanupInterruptedPaperMigration(db)', staleForeignKeyRepair)
const profileIndexes = source.indexOf('await createQuestionBankProfileIndexes(db)', cleanupInterruptedMigration)
assert.ok(
  recoverInterruptedTable > databaseInitialization
    && createBaseSchema > recoverInterruptedTable
    && restoreSnapshots > createBaseSchema
    && startupMigration > restoreSnapshots,
  'an interrupted papers table and child snapshots must be recovered around base-schema creation',
)
assert.ok(
  startupMigration >= 0 && profileMigration > startupMigration,
  'exam metadata must be migrated before the legacy papers table can be rebuilt',
)
assert.ok(
  staleForeignKeyRepair > profileMigration
    && cleanupInterruptedMigration > staleForeignKeyRepair
    && profileIndexes > cleanupInterruptedMigration,
  'stale paper foreign keys must be repaired before temporary tables are cleaned and indexes are created',
)

const interruptedRecoveryStart = source.indexOf('async function recoverInterruptedPaperTable')
const preferCompleteSource = source.indexOf("const recoveryCandidates = ['papers_rebuild_tmp_papers', 'papers_rebuild']", interruptedRecoveryStart)
const recoverBeforeReturn = source.indexOf('ALTER TABLE ${candidate} RENAME TO papers', preferCompleteSource)
assert.ok(
  interruptedRecoveryStart >= 0 && preferCompleteSource > interruptedRecoveryStart && recoverBeforeReturn > preferCompleteSource,
  'interrupted migration recovery must prefer the complete temporary source table',
)

const snapshotRestoreStart = source.indexOf('async function restorePaperMigrationSnapshots')
const snapshotMerge = source.indexOf('INSERT OR IGNORE INTO', snapshotRestoreStart)
const snapshotDrop = source.indexOf('DROP TABLE', snapshotMerge)
assert.ok(
  snapshotRestoreStart >= 0 && snapshotMerge > snapshotRestoreStart && snapshotDrop > snapshotMerge,
  'migration snapshots must be merged before they are removed',
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

const transactionStart = source.indexOf('export async function transaction')
const startedGuard = source.indexOf('let started = false', transactionStart)
const beginTransaction = source.indexOf('await db.beginTransaction()', startedGuard)
const markStarted = source.indexOf('started = true', beginTransaction)
const guardedRollback = source.indexOf('if (started && (await db.isTransactionActive()).result)', markStarted)
assert.ok(
  transactionStart >= 0
    && startedGuard > transactionStart
    && beginTransaction > startedGuard
    && markStarted > beginTransaction
    && guardedRollback > markStarted,
  'transaction rollback must only affect a transaction started by the current operation',
)

const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8')
const mountApp = main.indexOf("createApp(App).use(router).mount('#app')")
const startPreparation = main.indexOf('void runAndroidStartupPreparation()')
const startupReadyEvent = main.indexOf("window.dispatchEvent(new CustomEvent('android-startup-prepared'))", startPreparation)
assert.ok(
  mountApp >= 0 && startPreparation > mountApp && startupReadyEvent > startPreparation,
  'the Vue shell must mount before Android database and bundled-bank preparation starts',
)

const dashboard = readFileSync(fileURLToPath(new URL('../src/views/DashboardView.vue', import.meta.url)), 'utf8')
assert.match(
  dashboard,
  /addEventListener\('android-startup-prepared', reloadAfterAndroidStartup\)/,
  'the dashboard must reload after first-run bundled-bank installation finishes',
)
assert.match(
  dashboard,
  /removeEventListener\('android-startup-prepared', reloadAfterAndroidStartup\)/,
  'the dashboard must remove its Android startup listener when unmounted',
)

console.log('Android startup and legacy database recovery contracts: OK')
