import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'
import { parse, compileTemplate } from 'vue/compiler-sfc'

const source = readFileSync(new URL('../src/platform/android/practice.ts', import.meta.url), 'utf8')
const db = new DatabaseSync(':memory:')
db.exec([
  'CREATE TABLE papers(id INTEGER, profile_id INTEGER, year INTEGER, status TEXT, deleted_at TEXT, title TEXT DEFAULT "Paper");',
  'CREATE TABLE units(id INTEGER, paper_id INTEGER, title TEXT DEFAULT "Unit", sequence INTEGER DEFAULT 1);',
  'CREATE TABLE practice_sessions(id INTEGER, mode TEXT, paper_id INTEGER, unit_ids TEXT, status TEXT, started_at TEXT, updated_at TEXT);',
  'CREATE TABLE practice_answers(session_id INTEGER, user_answer TEXT);',
  'CREATE TABLE practice_unit_submissions(session_id INTEGER);',
  "INSERT INTO papers(id,profile_id,year,status,deleted_at) VALUES (1,1,2026,'published',NULL),(2,2,2026,'published',NULL),(3,1,2026,'published','2026-01-01');",
  'INSERT INTO units(id,paper_id) VALUES (1,1),(2,2),(3,3);',
  "INSERT INTO practice_sessions VALUES (1,'unit',NULL,'[1]','active','2026-01-01','2026-01-01'), (2,'unit',NULL,'[2]','active','2026-01-02','2026-01-02'), (3,'paper',3,'[3]','active','2026-01-03','2026-01-03'), (4,'unit',NULL,'[1,2]','active','2026-01-04','2026-01-04'), (5,'unit',NULL,'[99]','active','2026-01-05','2026-01-05'), (6,'unit',NULL,'[]','active','2026-01-06','2026-01-06');",
].join(' '))
let profile = 1
const context = { exports: {}, require(name) {
  if (name === './study-todos') return todosContext.exports
  if (name === '../../resume-title') return titleContext.exports
  if (name === './question-bank-profiles') return { activeQuestionBankProfileId: async () => profile }
  if (name === './database') return {
    row: async (sql, args) => sql.includes("s.status = 'active'") ? db.prepare(sql).get(...args) : {},
    rows: async () => [],
  }
  return {}
} }
const titleContext = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/resume-title.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, titleContext)
const todosContext = { exports: {}, require: context.require }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/platform/android/study-todos.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, todosContext)
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context)
try {
  assert.equal((await context.exports.dashboard()).resume_session.id, 1)
  profile = 2
  assert.equal((await context.exports.dashboard()).resume_session.id, 2)
  profile = 1
  db.exec("UPDATE practice_sessions SET status='submitted' WHERE id=1")
  assert.equal((await context.exports.dashboard()).resume_session, null)
  db.exec("UPDATE practice_sessions SET status='active' WHERE id=1; INSERT INTO practice_sessions VALUES (7,'unit',NULL,'[1]','active','2026-02-01','2026-02-01'); INSERT INTO practice_answers VALUES (1,'A')")
  assert.equal((await context.exports.dashboard()).resume_session.id, 1)
  const vue = readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(vue)
  const compiled = compileTemplate({ source: descriptor.template.content, filename: 'DashboardView.vue', id: 'resume-test' })
  assert.deepEqual(compiled.errors, [])
  assert.ok(descriptor.template.content.includes('<StudyTodos :tasks="studyTodos" :failed="studyTodosFailed" @retry="loadHome" />'))
  assert.ok(descriptor.template.content.includes('v-if="resumeSession" class="resume-practice card" type="button" @click="resumePractice"'))
  assert.ok(vue.includes('if (session?.id) router.push(`/practice/${session.id}`)'))
  const todos = readFileSync(new URL('../src/components/StudyTodos.vue', import.meta.url), 'utf8')
  assert.ok(todos.includes('v-if="tasks.resume_session" :to="`/practice/${tasks.resume_session.id}`"'))
  console.log('Dashboard resume: profile isolation, deleted/mixed/missing units, completion, saved-answer priority and both layouts passed')
} finally { db.close() }
