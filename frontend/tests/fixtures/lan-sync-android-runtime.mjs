import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'

// Run the production bootstrap and sync code against SQLite. Replace only
// the native bridges and the app settings store.
export async function openAndroidSyncFixture({ post, settings = {}, readSource } = {}) {
  const sqlite = new DatabaseSync(':memory:')
  const secure = new Map()
  const db = {
    async query(sql, args = []) { return { values: sqlite.prepare(sql).all(...args) } },
    async execute(sql) { sqlite.exec(sql); return {} },
    async run(sql, args = []) {
      const result = sqlite.prepare(sql).run(...args)
      return { changes: { changes: result.changes, lastId: Number(result.lastInsertRowid) } }
    },
    async isDBOpen() { return { result: true } },
    async isTransactionActive() { return { result: sqlite.isTransaction } },
    async beginTransaction() { sqlite.exec('BEGIN'); return {} },
    async commitTransaction() { sqlite.exec('COMMIT'); return {} },
    async rollbackTransaction() { sqlite.exec('ROLLBACK'); return {} },
  }
  const replacements = {
    '@capacitor-community/sqlite': { SQLiteConnection: class {
      async checkConnectionsConsistency() { return { result: true } }
      async isConnection() { return { result: true } }
      async retrieveConnection() { return db }
    } },
    './lan-transport': { LanTransport: { post }, validateLanBaseUrl: raw => raw },
    '../secure-store': { secureStore: {
      async get(key) { return secure.get(key) },
      async set(key, value) { secure.set(key, value) },
      async remove(key) { secure.delete(key) },
    } },
    './app-settings': {
      async readAppSetting(key) { return settings[key] || '' },
      async writeAppSetting(key, value) { settings[key] = value },
      invalidateAppSettings() {},
    },
  }
  const modules = new Map()
  function load(name) {
    name = name.replace(/\.ts$/, '')
    if (Object.hasOwn(replacements, name)) return replacements[name]
    if (modules.has(name)) return modules.get(name).exports
    const module = { exports: {} }
    modules.set(name, module)
    const file = new URL('../../src/platform/android/' + name + '.ts', import.meta.url)
    const source = readSource?.(name) ?? readFileSync(file, 'utf8')
    const { outputText } = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } })
    const execute = vm.runInThisContext('(function (exports, require) { ' + outputText + '\n})', { filename: file.pathname })
    execute(module.exports, load)
    return module.exports
  }
  try {
    await load('./database').androidDatabase()
    return { sqlite, load }
  } catch (error) {
    sqlite.close()
    throw error
  }
}

export function seedAndroidSyncBank(sqlite) {
  sqlite.exec(`
    INSERT INTO question_bank_profiles(id, name) VALUES(54, 'Profile A');
    INSERT INTO papers(id, profile_id, year, title, status, external_key)
      VALUES(1, 54, 2031, 'Synthetic paper', 'published', 'paper-1');
    INSERT INTO units(id, paper_id, title, unit_type, external_key, sequence) VALUES
      (10, 1, 'Submitted unit', 'reading', 'unit-1', 1),
      (11, 1, 'Open unit', 'reading', 'unit-1b', 2);
    INSERT INTO questions(id, unit_id, number, answer, score, external_key, sequence) VALUES
      (110, 10, 1, 'A', 2, 'q-1', 1), (111, 10, 2, 'A', 2, 'q-2', 2), (112, 11, 3, 'A', 2, 'q-3', 3);
  `)
}
