import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const read = name => readFileSync(new URL('../src/platform/android/' + name + '.ts', import.meta.url), 'utf8')
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const parsed = ts.createSourceFile('database.ts', read('database'), ts.ScriptTarget.Latest, true)
let schema
let transactionSource
for (const statement of parsed.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'transaction') transactionSource = statement.getText(parsed)
  if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
    if (declaration.name.getText(parsed) === 'SCHEMA') schema = declaration.initializer.text
  }
}
assert.ok(schema && transactionSource)

async function fixture(legacy = false) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(schema)
  sqlite.exec("ALTER TABLE practice_sessions ADD COLUMN content_revisions TEXT NOT NULL DEFAULT '{}'; ALTER TABLE practice_sessions ADD COLUMN content_snapshot TEXT NOT NULL DEFAULT '{}'; ALTER TABLE practice_sessions ADD COLUMN snapshot_accepted_revision TEXT NOT NULL DEFAULT ''; ALTER TABLE practice_sessions ADD COLUMN candidate_policy_version INTEGER NOT NULL DEFAULT 0")
  sqlite.exec('PRAGMA foreign_keys=ON')
  for (const table of ['practice_sessions', 'practice_answers', 'practice_answer_events', 'practice_unit_submissions', 'wrong_retry_rounds', 'wrong_retry_round_questions', 'wrong_current_questions']) {
    sqlite.exec('ALTER TABLE ' + table + ' ADD COLUMN sync_id TEXT')
    sqlite.exec('ALTER TABLE ' + table + ' ADD COLUMN updated_at TEXT')
  }
  sqlite.exec('ALTER TABLE wrong_stats ADD COLUMN updated_at TEXT')
  sqlite.exec('ALTER TABLE wrong_stats ADD COLUMN attempt_ledger TEXT')
  let active = false
  const db = {
    async query(sql, values = []) { return { values: sqlite.prepare(sql).all(...values) } },
    async run(sql, values = []) { return sqlite.prepare(sql).run(...values) },
    async isTransactionActive() { return { result: active } },
    async beginTransaction() { sqlite.exec('BEGIN'); active = true },
    async commitTransaction() { sqlite.exec('COMMIT'); active = false },
    async rollbackTransaction() { sqlite.exec('ROLLBACK'); active = false },
  }
  const tx = { exports: {}, rawAndroidDatabase: async () => db, runTransactionSerially: fn => fn() }
  vm.runInNewContext(compile(transactionSource), tx)
  const database = {
    transaction: tx.exports.transaction,
    rows: async (sql, values = []) => sqlite.prepare(sql).all(...values),
    row: async (sql, values = []) => sqlite.prepare(sql).get(...values),
    run: async (sql, values = []) => sqlite.prepare(sql).run(...values),
  }
  const modules = Object.fromEntries(['lan-sync-compat', 'lan-categories', 'lan-sync-serialization', 'lan-sync-versions', 'attempt-stats', 'practice-snapshots', 'candidate-order-policy', 'ordering-fixed-slots'].map(name => {
    const context = { exports: {}, require: name => name === './database' ? database : {} }
    vm.runInNewContext(compile(read(name)), context)
    return ['./' + name, context.exports]
  }))
  if (!legacy) await modules['./lan-sync-versions'].ensureSyncVersions(db)
  const context = { exports: {}, require: name => name === './database' ? database : modules[name] || {} }
  vm.runInNewContext(compile(read('lan-sync') + '; export { applyRemoteChanges, collectLocalChanges, collectLocalTombstones }'), context)
  const practice = { exports: {}, require: name => name === './database' ? database : modules[name] || {} }
  vm.runInNewContext(compile(read('practice')), practice)
  return { sqlite, db, practice: practice.exports, versions: modules['./lan-sync-versions'], ...context.exports }
}
const tables = ['vocabulary_entries']
const timestamp = '2026-09-08 10:00:00'
const insert = (f, text) => f.sqlite.prepare('INSERT INTO vocabulary_entries(term, normalized_term, note, updated_at) VALUES (?, ?, ?, ?)').run('word', 'word', text, timestamp)
const note = f => f.sqlite.prepare('SELECT note FROM vocabulary_entries').get().note

test('attempt ledger preserves legacy baseline, stable ordering, recent window and idempotence', () => {
  const module = { exports: {} }
  vm.runInNewContext(compile(read('attempt-stats')), module)
  const aggregate = module.exports.aggregateAttempts
  const baseline = { attempt_count: 7, wrong_count: 3, consecutive_correct: 1, recent_results: '[false,true]' }
  const a = aggregate(baseline, undefined, ['a', '2026-09-08T00:00:00.000Z', false])
  const b = aggregate(baseline, undefined, ['b', '2026-09-08T00:00:00.000Z', true])
  let merged = aggregate(a, b)
  assert.equal(JSON.stringify(merged), JSON.stringify(aggregate(b, a)))
  assert.equal(JSON.stringify(merged), JSON.stringify(aggregate(merged, a)))
  assert.equal(merged.attempt_count, 9)
  assert.equal(merged.wrong_count, 4)
  assert.equal(merged.consecutive_correct, 1)
  for (let i = 0; i < 12; i++) merged = aggregate(merged, undefined, [`c${String(i).padStart(2, '0')}`, '2026-09-09T00:00:00.000Z', true])
  assert.equal(merged.recent_results, '[true,true,true,true,true,true,true,true,true,true]')
  assert.throws(() => aggregate({ attempt_ledger: '{"v":1,"base":{},"attempts":{"a":["today",1]}}' }))
})

test('same-second independent edits converge regardless of exchange order', async () => {
  const a = await fixture(), b = await fixture()
  try {
    insert(a, 'alpha'); insert(b, 'zulu')
    const left = await a.collectLocalChanges({}, tables)
    const right = await b.collectLocalChanges({}, tables)
    await a.applyRemoteChanges(right.changes, [])
    await b.applyRemoteChanges(left.changes, [])
    assert.equal(note(a), note(b))
  } finally { a.sqlite.close(); b.sqlite.close() }
})

test('attempt ledger rejects extra fields and overflow, deduplicates shared sessions', () => {
  const module = { exports: {} }
  vm.runInNewContext(compile(read('attempt-stats')), module)
  const aggregate = module.exports.aggregateAttempts
  const a = aggregate({}, undefined, ['session', '2026-09-08T00:00:00.000Z', false])
  const b = aggregate({}, undefined, ['session', '2026-09-08T00:00:00.000Z', true])
  const merged = aggregate(a, b)
  assert.equal(JSON.stringify(merged), JSON.stringify(aggregate(b, a)))
  assert.equal(merged.attempt_count, 1)
  const value = JSON.parse(a.attempt_ledger)
  value.base.unexpected_column = 'unsafe'
  assert.throws(() => aggregate({ attempt_ledger: JSON.stringify(value) }))
  assert.throws(() => aggregate({ attempt_count: Number.MAX_SAFE_INTEGER }, undefined, ['new', '2026', true]))
})

test('consumed cursor sends a same-row mutation in the same second', async () => {
  const f = await fixture()
  try {
    insert(f, 'before')
    const first = await f.collectLocalChanges({}, tables)
    f.sqlite.prepare('UPDATE vocabulary_entries SET note=?, updated_at=?').run('after', timestamp)
    const next = await f.collectLocalChanges(first.cursor, tables)
    assert.equal(next.changes.vocabulary_entries.length, 1)
    assert.equal(next.changes.vocabulary_entries[0].note, 'after')
    assert.equal((await f.collectLocalChanges(next.cursor, tables)).changes.vocabulary_entries.length, 0)
  } finally { f.sqlite.close() }
})

test('causal same-second edit wins and repeated delivery stays idle', async () => {
  const a = await fixture(), b = await fixture()
  try {
    insert(a, 'zulu')
    await b.applyRemoteChanges((await a.collectLocalChanges({}, tables)).changes, [])
    b.sqlite.prepare("UPDATE vocabulary_entries SET note='alpha'").run()
    const next = await b.collectLocalChanges({}, tables)
    await a.applyRemoteChanges(next.changes, [])
    assert.equal(note(a), 'alpha')
    const settled = await a.collectLocalChanges({}, tables)
    for (let i = 0; i < 3; i++) await a.applyRemoteChanges(next.changes, [])
    assert.equal((await a.collectLocalChanges(settled.cursor, tables)).changes.vocabulary_entries.length, 0)
  } finally { a.sqlite.close(); b.sqlite.close() }
})

test('migration is repeatable, recursive triggers terminate, rollback preserves cursor', async () => {
  const f = await fixture()
  try {
    f.sqlite.exec('PRAGMA recursive_triggers=ON')
    insert(f, 'before')
    const first = await f.collectLocalChanges({}, tables)
    await f.versions.ensureSyncVersions(f.db)
    assert.equal((await f.collectLocalChanges(first.cursor, tables)).changes.vocabulary_entries.length, 0)
    f.sqlite.exec("SAVEPOINT edit; UPDATE vocabulary_entries SET note='after'; ROLLBACK TO edit; RELEASE edit")
    assert.equal((await f.collectLocalChanges(first.cursor, tables)).changes.vocabulary_entries.length, 0)
    f.sqlite.exec("UPDATE vocabulary_entries SET note='after'")
    assert.equal((await f.collectLocalChanges(first.cursor, tables)).changes.vocabulary_entries.length, 1)
    assert.equal((await f.collectLocalChanges({ vocabulary_entries: { updated_at: '9999', rowid: 999 } }, tables)).changes.vocabulary_entries.length, 1)
  } finally { f.sqlite.close() }
})

test('tombstone replay does not echo or resurrect an old row', async () => {
  const a = await fixture(), b = await fixture()
  try {
    insert(a, 'old')
    const old = await a.collectLocalChanges({}, tables)
    const tomb = { table_name: 'vocabulary_entries', object_key: 'word', profile_name: '', deleted_at: '2026-09-08 11:00:00' }
    await b.applyRemoteChanges({}, [tomb])
    const first = await b.collectLocalTombstones({}, tables)
    await b.applyRemoteChanges(old.changes, [tomb])
    assert.equal(b.sqlite.prepare('SELECT COUNT(*) AS n FROM vocabulary_entries').get().n, 0)
    assert.equal((await b.collectLocalTombstones(first.cursor, tables)).tombstones.length, 0)
    assert.equal(first.tombstones[0].deleted_at, tomb.deleted_at)
  } finally { a.sqlite.close(); b.sqlite.close() }
})

test('invalid metadata rejects the entire batch', async () => {
  const a = await fixture(), b = await fixture()
  try {
    const tomb = { table_name: 'vocabulary_entries', object_key: 'word', profile_name: 'Legacy Bank', deleted_at: '2099' }
    for (const f of [a, b]) f.sqlite.exec("INSERT INTO question_bank_profiles(name) VALUES('Legacy Bank')")
    insert(a, 'old')
    await b.applyRemoteChanges({}, [tomb])
    await b.applyRemoteChanges((await a.collectLocalChanges({}, tables)).changes, [])
    assert.equal(b.sqlite.prepare('SELECT COUNT(*) AS n FROM vocabulary_entries').get().n, 0)
    for (const deleted_at of [null, '', ' ', 1]) await assert.rejects(() => a.applyRemoteChanges({}, [{ ...tomb, deleted_at }]))
    assert.equal(a.sqlite.prepare('SELECT COUNT(*) AS n FROM vocabulary_entries').get().n, 1)
    a.sqlite.exec('DELETE FROM vocabulary_entries')
    for (const bad of [null, -1, 1.5, true, '1', Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => a.versions.syncSequence({ seq: bad }))
      assert.throws(() => a.versions.syncVersion({ _sync_rev: bad }))
    }
    insert(a, 'value')
    const { changes } = await a.collectLocalChanges({}, tables)
    changes.vocabulary_entries.push({ ...changes.vocabulary_entries[0], normalized_term: 'other', _sync_origin: 'invalid' })
    await assert.rejects(() => b.applyRemoteChanges(changes, []))
    assert.equal(b.sqlite.prepare('SELECT COUNT(*) AS n FROM vocabulary_entries').get().n, 0)
  } finally { a.sqlite.close(); b.sqlite.close() }
})

test('preexisting rows backfill without changing business data', async () => {
  const f = await fixture(true)
  try {
    insert(f, 'legacy')
    await f.versions.ensureSyncVersions(f.db)
    const before = f.sqlite.prepare('SELECT * FROM vocabulary_entries').get()
    assert.equal(before.note, 'legacy')
    assert.equal(before.updated_at, timestamp)
    assert.equal(before._sync_rev, 1)
    assert.ok(before._sync_seq > 0)
    await f.versions.ensureSyncVersions(f.db)
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM vocabulary_entries').get(), before)
  } finally { f.sqlite.close() }
})

test('production submissions aggregate independent attempts without replay inflation', async () => {
  const a = await fixture(), b = await fixture()
  try {
    for (const [f, identity] of [[a, 'left'], [b, 'right']]) {
      f.sqlite.exec("INSERT INTO question_bank_profiles(id,name) VALUES(100,'Test Bank'); INSERT INTO papers(id,profile_id,year,title,status,external_key) VALUES(100,100,2026,'Test','published','paper'); INSERT INTO units(id,paper_id,unit_type,title,sequence,external_key) VALUES(100,100,'reading','Unit',1,'unit'); INSERT INTO questions(id,unit_id,number,answer,score,sequence,external_key) VALUES(100,100,1,'A',1,1,'question')")
      f.sqlite.prepare("INSERT INTO practice_sessions(id,mode,unit_ids,sync_id,updated_at) VALUES(100,'unit','[100]',?,?)").run(identity, timestamp)
      f.sqlite.prepare("INSERT INTO practice_answers(session_id,question_id,sync_id,user_answer) VALUES(100,100,?,'')").run(identity + '-answer')
      await f.practice.saveAnswer(100, 100, { answer: 'B', option_order: ['A', 'B'] })
      await f.practice.submitSession(100)
      await f.practice.submitSession(100)
      assert.equal(f.sqlite.prepare('SELECT attempt_count FROM wrong_stats').get().attempt_count, 1)
    }
    const learningTables = ['practice_sessions', 'practice_answers', 'practice_answer_events', 'practice_unit_submissions', 'wrong_stats']
    const left = await a.collectLocalChanges({}, learningTables)
    const right = await b.collectLocalChanges({}, learningTables)
    for (let i = 0; i < 2; i++) {
      await a.applyRemoteChanges(right.changes, [])
      await b.applyRemoteChanges(left.changes, [])
    }
    for (const f of [a, b]) {
      for (const table of learningTables.slice(0, -1)) assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 2, table)
      assert.equal(f.sqlite.prepare('SELECT attempt_count FROM wrong_stats').get().attempt_count, 2)
    }
    const settled = await a.collectLocalChanges({}, learningTables)
    await a.applyRemoteChanges(right.changes, [])
    assert.equal((await a.collectLocalChanges(settled.cursor, learningTables)).changes.wrong_stats.length, 0)
    const old = { ...right.changes.wrong_stats[0] }
    delete old.attempt_ledger
    await assert.rejects(() => a.applyRemoteChanges({ wrong_stats: [old] }, []))
    await a.applyRemoteChanges({}, [{ table_name: 'wrong_stats', object_key: 'question', profile_name: 'Test Bank', deleted_at: '2099' }])
    await a.applyRemoteChanges(right.changes, [])
    assert.equal(a.sqlite.prepare('SELECT COUNT(*) AS n FROM wrong_stats').get().n, 0)
  } finally { a.sqlite.close(); b.sqlite.close() }
})

test('enrichment survives export, legacy missing fields, and repeated delivery', async () => {
  const a = await fixture(), b = await fixture()
  try {
    const morphology = JSON.stringify({ lemma: 'walk', currentForm: 'past' })
    const example = JSON.stringify({ sentence: 'They walked home yesterday.', translation: 'Example translation' })
    a.sqlite.prepare('INSERT INTO vocabulary_entries(term,normalized_term,morphology,generated_example,contextual_occurrence_key,updated_at) VALUES (?,?,?,?,?,?)')
      .run('walked', 'surface:v1:walked', morphology, example, 'encounter-a', timestamp)
    const first = await a.collectLocalChanges({}, tables)
    await b.applyRemoteChanges(first.changes, [])
    let row = b.sqlite.prepare('SELECT * FROM vocabulary_entries').get()
    assert.equal(row.morphology, morphology)
    assert.equal(row.generated_example, example)
    const legacy = { ...first.changes.vocabulary_entries[0], common_meaning: 'legacy edit', updated_at: '2098-01-01' }
    for (const key of ['morphology', 'generated_example', 'contextual_occurrence_key']) delete legacy[key]
    await b.applyRemoteChanges({ vocabulary_entries: [legacy] }, [])
    row = b.sqlite.prepare('SELECT * FROM vocabulary_entries').get()
    assert.equal(row.common_meaning, 'legacy edit')
    assert.equal(row.morphology, morphology)
    assert.equal(row.generated_example, example)
    assert.equal(row.contextual_occurrence_key, 'encounter-a')
    await a.applyRemoteChanges((await b.collectLocalChanges({}, tables)).changes, [])
    assert.equal(a.sqlite.prepare('SELECT morphology FROM vocabulary_entries').get().morphology, morphology)
    await b.applyRemoteChanges(first.changes, [])
    assert.equal(b.sqlite.prepare('SELECT common_meaning FROM vocabulary_entries').get().common_meaning, 'legacy edit')
    assert.equal(b.sqlite.prepare('SELECT COUNT(*) AS n FROM vocabulary_enrichment_jobs').get().n, 0)
  } finally { a.sqlite.close(); b.sqlite.close() }
})

test('source kind and selection offset roundtrip without legacy erasure', async () => {
  const a = await fixture(), b = await fixture()
  try {
    for (const f of [a, b]) {
      f.sqlite.exec('ALTER TABLE vocabulary_occurrences ADD COLUMN sync_id TEXT; ALTER TABLE vocabulary_occurrences ADD COLUMN updated_at TEXT')
      insert(f, 'word')
    }
    a.sqlite.prepare('INSERT INTO vocabulary_occurrences(entry_id,surface_form,source_kind,selection_start,context_sentence,sync_id,updated_at) VALUES(1,?,?,?,?,?,?)')
      .run('word', 'passage', 23, 'This word belongs here.', 'encounter-a', timestamp)
    const first = await a.collectLocalChanges({}, ['vocabulary_occurrences'])
    await b.applyRemoteChanges(first.changes, [])
    const legacy = { ...first.changes.vocabulary_occurrences[0], updated_at: '2098-01-01' }
    delete legacy.source_kind; delete legacy.selection_start
    await b.applyRemoteChanges({ vocabulary_occurrences: [legacy] }, [])
    const row = b.sqlite.prepare('SELECT * FROM vocabulary_occurrences').get()
    assert.equal(row.source_kind, 'passage')
    assert.equal(row.selection_start, 23)
    assert.equal(row.context_sentence, 'This word belongs here.')
    assert.equal(b.sqlite.prepare('SELECT COUNT(*) AS n FROM vocabulary_occurrences').get().n, 1)
  } finally { a.sqlite.close(); b.sqlite.close() }
})

test('session snapshot cannot be erased or replaced by a newer legacy sync row', async () => {
  const f = await fixture()
  try {
    f.sqlite.exec("INSERT INTO question_bank_profiles(id,name) VALUES(100,'Test Bank'); INSERT INTO papers(id,profile_id,year,title,status,external_key) VALUES(100,100,2016,'Test','published','paper'); INSERT INTO units(id,paper_id,unit_type,title,sequence,external_key) VALUES(100,100,'reading','Unit',1,'unit')")
    const snapshot=JSON.stringify({version:1,revision:'test',units:[{unit_key:'unit',payload:{passage:'original'},questions:[]}]})
    f.sqlite.prepare("INSERT INTO practice_sessions(id,mode,unit_ids,sync_id,updated_at,content_snapshot) VALUES(100,'unit','[100]','saved',?,?)").run(timestamp,snapshot)
    for(const content of [undefined,'{}',JSON.stringify({version:1,revision:'other',units:[{unit_key:'unit',payload:{passage:'changed'},questions:[]}]})]) {
      const payload={sync_id:'saved',mode:'unit',unit_ids_keys:['unit'],profile_name:'Test Bank',updated_at:'2099-01-01'}
      if(content!==undefined) payload.content_snapshot=content
      await assert.rejects(f.applyRemoteChanges({practice_sessions:[payload]},[]),/快照不一致/)
      assert.equal(f.sqlite.prepare('SELECT content_snapshot FROM practice_sessions WHERE id=100').get().content_snapshot,snapshot)
    }
    await f.applyRemoteChanges({practice_sessions:[{sync_id:'saved',mode:'unit',unit_ids_keys:['unit'],profile_name:'Test Bank',updated_at:'2099-01-01',content_snapshot:snapshot}]},[])
    assert.equal(f.sqlite.prepare('SELECT content_snapshot FROM practice_sessions WHERE id=100').get().content_snapshot,snapshot)
  } finally { f.sqlite.close() }
})

test('metadata-only snapshot drift accepts the same session without duplicating sessions', async () => {
  const f = await fixture()
  try {
    f.sqlite.exec("INSERT INTO question_bank_profiles(id,name) VALUES(100,'Test Bank'); INSERT INTO papers(id,profile_id,year,title,status,external_key) VALUES(100,100,2016,'Test','published','paper'); INSERT INTO units(id,paper_id,unit_type,title,sequence,external_key) VALUES(100,100,'reading','Unit',1,'unit')")
    const snapshot={version:1,revision:'local-r1',units:[{unit_key:'unit',payload:{passage:'original',shared_data:{}},questions:[]}]}
    f.sqlite.prepare("INSERT INTO practice_sessions(id,mode,unit_ids,sync_id,updated_at,content_snapshot) VALUES(100,'unit','[100]','saved',?,?)").run(timestamp,JSON.stringify(snapshot))
    const remote=structuredClone(snapshot)
    remote.revision='remote-r3'
    remote.units[0].payload.shared_data={content_package_id:'package',content_version:'r3'}
    await f.applyRemoteChanges({practice_sessions:[{sync_id:'saved',mode:'unit',unit_ids_keys:['unit'],profile_name:'Test Bank',updated_at:'2099-01-01',content_snapshot:JSON.stringify(remote)}]},[])
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM practice_sessions').get().n,1)
    assert.equal(JSON.parse(f.sqlite.prepare('SELECT content_snapshot FROM practice_sessions WHERE id=100').get().content_snapshot).units[0].payload.passage,'original')
  } finally { f.sqlite.close() }
})

test('surface aliases preserve references, deletions and prevent resurrection', async () => {
  const a = await fixture(), b = await fixture()
  try {
    a.sqlite.prepare('INSERT INTO vocabulary_entries(term,normalized_term,note,updated_at) VALUES(?,?,?,?)').run('Walked','walked','old',timestamp)
    b.sqlite.prepare('INSERT INTO vocabulary_entries(term,normalized_term,note,updated_at) VALUES(?,?,?,?)').run('walked','surface:v1:walked','new','2090-01-01')
    const left = await a.collectLocalChanges({}, tables), right = await b.collectLocalChanges({}, tables)
    await a.applyRemoteChanges(right.changes, [])
    await b.applyRemoteChanges(left.changes, [])
    for (const f of [a,b]) {
      assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM vocabulary_entries').get().n,1)
      assert.equal(note(f),'new')
      f.sqlite.exec('ALTER TABLE vocabulary_reviews ADD COLUMN sync_id TEXT')
      f.sqlite.exec('ALTER TABLE vocabulary_occurrences ADD COLUMN sync_id TEXT; ALTER TABLE vocabulary_occurrences ADD COLUMN updated_at TEXT')
      await f.applyRemoteChanges({vocabulary_occurrences:[{entry_id_key:f===a?'surface:v1:walked':'walked',sync_id:'occ',surface_form:'walked',updated_at:timestamp}]},[])
      assert.equal(f.sqlite.prepare('SELECT entry_id FROM vocabulary_occurrences').get().entry_id,1)
      await f.applyRemoteChanges({},[{table_name:'vocabulary_entries',object_key:f===a?'surface:v1:walked':'walked',profile_name:'',deleted_at:'2099-01-01'}])
      assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM vocabulary_entries').get().n,0)
      assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM vocabulary_occurrences').get().n,0)
      assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM sync_tombstones WHERE table_name='vocabulary_entries'").get().n,2)
      await f.applyRemoteChanges(left.changes,[])
      await f.applyRemoteChanges(right.changes,[])
      assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM vocabulary_entries').get().n,0)
    }
  } finally { a.sqlite.close(); b.sqlite.close() }
})

test('stem collision preserves distinct surface forms and rejects ambiguous keys', async () => {
  const f=await fixture()
  try {
    f.sqlite.prepare('INSERT INTO vocabulary_entries(term,normalized_term,note,updated_at) VALUES(?,?,?,?)').run('Claims','claim','plural',timestamp)
    await f.applyRemoteChanges({vocabulary_entries:[{term:'claim',normalized_term:'surface:v1:claim',note:'singular',updated_at:'2090-01-01'}]},[])
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM vocabulary_entries').get().n,2)
    await assert.rejects(f.applyRemoteChanges({vocabulary_entries:[{term:'claim',normalized_term:'claim',updated_at:'2099-01-01'}]},[]),/不同词形/)
    await assert.rejects(f.applyRemoteChanges({vocabulary_entries:[{term:'claims',normalized_term:'surface:v1:claim',updated_at:'2099-01-01'}]},[]),/不一致/)
    assert.equal(f.sqlite.prepare("SELECT term FROM vocabulary_entries WHERE normalized_term='claim'").get().term,'Claims')
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM vocabulary_entries').get().n,2)
  } finally { f.sqlite.close() }
})

test('corrected units reject legacy new sessions and accept proven new sessions', async () => {
  const f=await fixture()
  try {
    f.sqlite.exec("INSERT INTO question_bank_profiles(id,name) VALUES(100,'Test Bank'); INSERT INTO papers(id,profile_id,year,title,status,external_key) VALUES(100,100,2016,'Test','published','paper'); INSERT INTO units(id,paper_id,unit_type,title,sequence,external_key) VALUES(100,100,'reading','Unit',1,'unit')")
    f.sqlite.prepare('UPDATE units SET shared_data=? WHERE id=100').run(JSON.stringify({content_revision:'r1'}))
    const payload={sync_id:'new',mode:'unit',unit_ids_keys:['unit'],profile_name:'Test Bank',updated_at:'2099-01-01'}
    await assert.rejects(f.applyRemoteChanges({practice_sessions:[payload]},[]),/缺少修正前内容快照/)
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM practice_sessions').get().n,0)
    await f.applyRemoteChanges({practice_sessions:[{...payload,content_revisions:JSON.stringify({unit:'r1'})}]},[])
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM practice_sessions').get().n,1)
  } finally { f.sqlite.close() }
})
