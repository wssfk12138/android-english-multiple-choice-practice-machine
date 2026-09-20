import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'
const read = path => readFileSync(new URL('../src/platform/android/' + path, import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const db = new DatabaseSync(':memory:')
db.exec("CREATE TABLE ai_conversations(id INTEGER PRIMARY KEY, title TEXT, updated_at TEXT); INSERT INTO ai_conversations VALUES(1, '新对话', ''); CREATE TABLE ai_messages(id INTEGER PRIMARY KEY, conversation_id INTEGER, role TEXT, content TEXT, attachments TEXT, profile_id INTEGER, model_id TEXT);")
const run = async (sql, values = []) => db.prepare(sql).run(...values)
const database = {
  row: async (sql, values = []) => db.prepare(sql).get(...values),
  rows: async (sql, values = []) => db.prepare(sql).all(...values), run,
  transaction: async operation => { db.exec('BEGIN'); try { const result = await operation({ run }); db.exec('COMMIT'); return result } catch (error) { db.exec('ROLLBACK'); throw error } },
}
const errors = { exports: {} }; vm.runInNewContext(compile(read('errors.ts')), errors)
const context = { exports: {}, require: name => ({ './database': database, './errors': errors.exports })[name] || {} }
vm.runInNewContext(compile(read('ai.ts')), context)
try {
  const body = { conversation_id: 1, profile_id: 1, model: 'test', message: 'Edit fixture', answer: 'Done' }
  db.exec("CREATE TRIGGER fail_answer BEFORE INSERT ON ai_messages WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT, 'injected'); END;")
  await assert.rejects(context.exports.saveAgentExchange(body), /injected/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_messages').get().n, 0)
  db.exec('DROP TRIGGER fail_answer')
  await context.exports.saveAgentExchange(body)
  const history = await context.exports.conversation(1)
  assert.equal(history.messages.length, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(history.messages[0].attachments)), [])
  assert.equal(history.title, 'Edit fixture')
  await assert.rejects(context.exports.saveAgentExchange({ ...body, answer: 'x'.repeat(30001) }))
  console.log('PASS: Android agent exchange atomicity, history attachment decoding and bounds')
} finally { db.close() }
