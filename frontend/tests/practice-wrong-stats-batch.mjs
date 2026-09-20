import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { DatabaseSync } from 'node:sqlite'
import ts from 'typescript'

const source = readFileSync(new URL('../src/platform/android/practice.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('practice.ts', source, ts.ScriptTarget.Latest, true)
const wanted = new Set(['transactionRow', 'transactionRows', 'transactionRun', 'gradeRows'])
const functions = ast.statements
  .filter(statement => ts.isFunctionDeclaration(statement) && wanted.has(statement.name?.text))
  .map(statement => statement.getText(ast))
  .join('\n')

const calls = []
const answers = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1,
  question_id: index + 101,
  session_id: 7,
  user_answer: 'B',
  is_correct: null,
}))
const gradeTable = new Map(answers.map(answer => [answer.question_id, { answer: 'A', score: 1 }]))
const context = {
  exports: {},
  Map, Set, Date, Number, String, Boolean, Object,
  row: async statement => statement.includes('practice_sessions') ? { sync_id: 'session-sync' } : null,
  rows: async () => [],
  run: async (statement, values = []) => { calls.push({ statement, values }); return {} },
  snapshotGradeMany: async () => gradeTable,
  aggregateAttempts: (_current, _unused, attempt) => ({
    wrong_count: attempt[2] ? 0 : 1,
    attempt_count: 1,
    recent_results: JSON.stringify([attempt[2] ? 1 : 0]),
    attempt_ledger: JSON.stringify([attempt]),
  }),
}
vm.createContext(context)
const compiled = ts.transpileModule(
  functions + '\nthis.gradeRows = gradeRows',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
vm.runInContext(compiled, context)

const result = await context.gradeRows(answers)
assert.equal(result.results.length, 20)
const insert = calls.find(call => /INSERT OR IGNORE INTO wrong_stats\(question_id\)/.test(call.statement))
assert.ok(insert, 'single-unit grading must pre-create wrong_stats rows')
assert.equal((insert.statement.match(/\(\?\)/g) || []).length, 20, insert.statement)
assert.doesNotMatch(insert.statement, /\(\(\?\)\)/, 'VALUES must contain one parenthesized placeholder per row')
assert.deepEqual(insert.values, answers.map(answer => answer.question_id))
assert.equal(insert.values.length, 20)
console.log('PASS wrong_stats batch: 20 questions use 20 row placeholders and 20 bound values')

const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE wrong_stats(question_id INTEGER PRIMARY KEY)')
db.prepare(insert.statement).run(...insert.values)
assert.equal(db.prepare('SELECT count(*) n FROM wrong_stats').get().n, 20)
db.close()
