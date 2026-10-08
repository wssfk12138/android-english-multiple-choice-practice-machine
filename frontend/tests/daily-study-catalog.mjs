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
  const before = plain(f.db.prepare('SELECT * FROM vocabulary_entries').all())
  const all = await api.dailyStudyCatalog(new URLSearchParams())
  assert.equal(all.items.length, 1203, 'whole lightweight directory, beyond browsing page limits')
  assert.deepEqual(Object.keys(all.items[0]).sort(), ['id','identity','term'])
  assert.deepEqual(plain(all.items.map(x => x.id)), Array.from({ length: 1203 }, (_, i) => i + 1), 'deterministic ID tie break')
  assert.equal(new Set(all.items.map(x => x.identity)).size, 1203)
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
  const oldIdentity = chosen.items[0].identity
  f.db.exec("DELETE FROM vocabulary_entries WHERE id=1001")
  f.seed(1, 'ready', 1001)
  f.db.exec("UPDATE vocabulary_entries SET sync_id='replacement' WHERE id=1001")
  assert.notEqual((await api.dailyStudyCatalog(new URLSearchParams())).items.find(x => x.id===1001).identity, oldIdentity)
  f.db.exec("UPDATE app_settings SET value='different-db' WHERE key='daily_study_database_id'")
  assert.notEqual((await api.dailyStudyStatus(new URLSearchParams())).scope_key, all.scope_key)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM vocabulary_reviews').get().n, 0)
  assert.deepEqual(plain(f.db.prepare('SELECT * FROM vocabulary_entries WHERE id=1').get()), before[0], 'read leaves review and content state untouched')
  console.log('PASS daily study catalog: full consistent projection, shared filters/order, real DB/bank identity, ID reuse and read-only behavior')
} finally { f.close() }
