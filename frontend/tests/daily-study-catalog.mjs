import assert from 'node:assert/strict'
import ts from 'typescript'
import { fixture, read, plain } from './helpers/vocabulary-request-fixture.mjs'
const f = fixture()
try {
  const source = ts.createSourceFile('vocabulary.ts', read('platform/android/vocabulary.ts'), ts.ScriptTarget.Latest, true)
  const names = ['vocabularySelection', 'dailyStudyMetadata', 'dailyStudyCatalog', 'dailyStudyStatus']
  const code = source.statements.filter(s => ts.isFunctionDeclaration(s) && names.includes(s.name?.text)).map(s => s.getText(source)).join('\n')
  const api = f.evaluate('catalog', code, { ...f.database, activeQuestionBankProfileId: async () => 1, vocabularyProfileCondition: 'EXISTS (SELECT 1 FROM vocabulary_occurrences WHERE entry_id=vocabulary_entries.id AND year=2026 AND ?=1)' })
  assert.equal(typeof api.dailyStudyCatalog, 'function', 'S4 catalog API exists')
  f.seed(1203, 'ready')
  // Seeding can cross a SQLite clock second. This assertion intentionally
  // tests equal timestamps, so create that tie explicitly instead of relying on speed.
  f.db.exec("UPDATE vocabulary_entries SET created_at='2026-01-01 00:00:00',updated_at='2026-01-01 00:00:00',last_seen_at='2026-01-01 00:00:00'")
  const before = plain(f.db.prepare('SELECT * FROM vocabulary_entries').all())
  const all = await api.dailyStudyCatalog(new URLSearchParams())
  assert.equal(all.items.length, 1203, 'whole lightweight directory, beyond browsing page limits')
  assert.deepEqual(Object.keys(all.items[0]).sort(), ['id','identity','term'])
  assert.deepEqual(plain(all.items.map(x => x.id)), Array.from({ length: 1203 }, (_, i) => i + 1), 'deterministic ID tie break')
  assert.equal(new Set(all.items.map(x => x.identity)).size, 1203)
  assert.ok(f.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_vocab_reviews_latest'").get(), 'latest formal review lookup has a covering index')
  // New membership is derived from the latest formal scheduled rating only.
  // Each fixture also exercises a distinct ordering timestamp below.
  const review = f.db.prepare('INSERT INTO vocabulary_reviews(entry_id,rating,mode,reviewed_at) VALUES(?,?,?,?)')
  review.run(1001, 'fluent', 'scheduled', '2026-02-01 00:00:00')
  review.run(1002, 'again', 'scheduled', '2026-02-01 00:00:01')
  review.run(1003, 'know', 'scheduled', '2026-02-01 00:00:02')
  review.run(1004, 'hard', 'scheduled', '2026-02-01 00:00:03')
  review.run(1005, 'fluent', 'scheduled', '2026-02-01 00:00:04')
  review.run(1005, 'know', 'scheduled', '2026-02-01 00:00:05')
  review.run(1006, 'know', 'scheduled', '2026-02-01 00:00:06')
  review.run(1006, 'fluent', 'scheduled', '2026-02-01 00:00:07')
  review.run(1007, 'know', 'scheduled', '2026-02-01 00:00:08')
  review.run(1007, 'fluent', 'reinforcement', '2026-02-01 00:00:09')
  review.run(1008, 'hard', 'scheduled', '2026-02-01 00:00:10')
  review.run(1008, 'fluent', 'scheduled', 'not-a-date')
  for (const [id, createdAt] of [[1002, '2026-03-02 00:00:00'], [1004, '2026-03-04 00:00:00'], [1005, '2026-03-05 00:00:00'], [1007, '2026-03-07 00:00:00'], [1008, '2026-03-08 00:00:00']]) {
    f.db.prepare('UPDATE vocabulary_entries SET created_at=? WHERE id=?').run(createdAt, id)
  }
  const unlearned = await api.dailyStudyCatalog(new URLSearchParams('status=new'))
  assert.equal(unlearned.items.length, 1201, 'no record/again/know/hard stay; fluent leaves')
  assert.ok(!unlearned.items.some(x => x.id === 1001), 'fluent-only word leaves the new range')
  assert.ok(!unlearned.items.some(x => x.id === 1006), 'latest formal fluent wins after an earlier know')
  for (const id of [1002, 1003, 1004, 1005, 1007, 1008, 1009]) assert.ok(unlearned.items.some(x => x.id === id), 'new keeps entry ' + id)
  const order = unlearned.items.map(x => x.id)
  assert.ok(order.indexOf(1008) < order.indexOf(1007) && order.indexOf(1007) < order.indexOf(1005)
    && order.indexOf(1005) < order.indexOf(1004) && order.indexOf(1004) < order.indexOf(1002), 'newest created_at first')
  const unlearnedAgain = await api.dailyStudyCatalog(new URLSearchParams('status=new'))
  assert.deepEqual(plain(unlearnedAgain.items.map(x => x.id)), order, 'repeated new catalogue has stable identity tie-breaks')
  assert.notEqual(unlearned.scope_key, all.scope_key)
  assert.equal(unlearned.scope_key, (await api.dailyStudyStatus(new URLSearchParams('status=new'))).scope_key)
  const reviewsBefore = f.db.prepare('SELECT COUNT(*) AS n FROM vocabulary_reviews').get().n
  assert.equal((await api.dailyStudyCatalog(new URLSearchParams('search=missing'))).items.length, 0)
  f.db.exec("UPDATE vocabulary_entries SET common_meaning='Chosen', manually_frequent=1 WHERE id=1001")
  const chosen = await api.dailyStudyCatalog(new URLSearchParams('search=%20Chosen%20&status=frequent'))
  assert.equal(chosen.items[0].id, 1001)
  assert.equal(chosen.scope_key, (await api.dailyStudyStatus(new URLSearchParams('search=Chosen&status=frequent'))).scope_key)
  assert.notEqual(chosen.scope_key, all.scope_key)
  f.db.exec("INSERT INTO vocabulary_occurrences(entry_id,year,surface_form) VALUES(1001,2026,'go')")
  const scoped = await api.dailyStudyCatalog(new URLSearchParams('scope=current'))
  assert.equal(scoped.items.length, 1)
  assert.notEqual(scoped.scope_key, all.scope_key)
  f.db.exec('PRAGMA foreign_keys=ON')
  const bankIdentity = f.db.prepare('SELECT identity FROM daily_study_bank_identity WHERE profile_id=1').get().identity
  f.db.exec("UPDATE question_bank_profiles SET deleted_at=CURRENT_TIMESTAMP WHERE id=1")
  f.db.exec("UPDATE question_bank_profiles SET deleted_at=NULL WHERE id=1")
  assert.equal(f.db.prepare('SELECT identity FROM daily_study_bank_identity WHERE profile_id=1').get().identity, bankIdentity, 'soft delete/restore retains bank identity')
  f.db.exec("INSERT INTO question_bank_profiles(id,name) VALUES(99,'Temporary synthetic bank')")
  const temporaryIdentity = f.db.prepare('SELECT identity FROM daily_study_bank_identity WHERE profile_id=99').get().identity
  f.db.exec('DELETE FROM question_bank_profiles WHERE id=99')
  f.db.exec("INSERT INTO question_bank_profiles(id,name) VALUES(99,'Replacement synthetic bank')")
  assert.notEqual(f.db.prepare('SELECT identity FROM daily_study_bank_identity WHERE profile_id=99').get().identity, temporaryIdentity, 'physical bank ID reuse changes identity')
  const oldIdentity = chosen.items[0].identity
  f.db.exec("DELETE FROM vocabulary_entries WHERE id=1001")
  f.seed(1, 'ready', 1001)
  assert.notEqual((await api.dailyStudyCatalog(new URLSearchParams())).items.find(x => x.id===1001).identity, oldIdentity)
  f.db.exec("UPDATE app_settings SET value='different-db' WHERE key='daily_study_database_id'")
  assert.notEqual((await api.dailyStudyStatus(new URLSearchParams())).scope_key, all.scope_key)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM vocabulary_reviews').get().n, reviewsBefore, 'catalogue reads never mutate review state')
  assert.deepEqual(plain(f.db.prepare('SELECT * FROM vocabulary_entries WHERE id=1').get()), before[0], 'read leaves review and content state untouched')
  console.log('PASS daily study catalog: full consistent projection, shared filters/order, real DB/bank identity, ID reuse and read-only behavior')
} finally { f.close() }
