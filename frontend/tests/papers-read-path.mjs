// 试卷列表是首页与试卷库共用的读取路径。这里用真实 SQLite 执行模块产生的 SQL，
// 断言四件事：
// 1) 读取路径只读：/papers 不得在被调用时写库（原先每次都无条件跑一次清扫 UPDATE，
//    既占用读路径耗时，也把 updated_at 刷成新值，制造无意义的同步变更）。
// 2) 清扫语义保留：7 天前既无作答也无提交的空会话仍要变成 abandoned，有作答、
//    有提交或刚刚开始（仍在 7 天内）的会话必须保持 active。
// 3) 清扫是进程内一次性维护：同一次启动里第二个调用不再写库；清扫失败由调用方
//    兜底，不影响列表读取。
// 4) 列表列投影与进行中会话的排序语义不变。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'

const read = name => readFileSync(new URL('../src/platform/android/' + name + '.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('db.ts', read('database'), ts.ScriptTarget.Latest, true)
const schema = ast.statements.flatMap(s => ts.isVariableStatement(s) ? [...s.declarationList.declarations] : [])
  .find(d => d.name.getText(ast) === 'SCHEMA').initializer.text

const db = new DatabaseSync(':memory:')
db.exec(schema)
// runtime 在基础 schema 之后逐表补齐 LAN 身份列与 updated_at，这里镜像出来，
// 保证清扫条件里引用的列真实存在。
db.exec(`ALTER TABLE practice_sessions ADD COLUMN sync_id TEXT;
  ALTER TABLE practice_sessions ADD COLUMN updated_at TEXT;
  ALTER TABLE practice_sessions ADD COLUMN _sync_seq INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE practice_sessions ADD COLUMN _sync_rev INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE practice_sessions ADD COLUMN _sync_origin TEXT NOT NULL DEFAULT '';
  ALTER TABLE practice_answers ADD COLUMN sync_id TEXT;
  ALTER TABLE practice_answers ADD COLUMN updated_at TEXT;
  ALTER TABLE practice_unit_submissions ADD COLUMN sync_id TEXT;
  ALTER TABLE practice_unit_submissions ADD COLUMN updated_at TEXT`)

function stubDatabase(recorder) {
  const statements = recorder.statements
  return {
    row: async (sql, values = []) => { statements.push(sql); return db.prepare(sql).get(...values) },
    rows: async (sql, values = []) => { statements.push(sql); return db.prepare(sql).all(...values) },
    run: async (sql, values = []) => {
      statements.push(sql)
      if (recorder.failRun && recorder.failRun(sql)) throw new Error('disk I/O error')
      return db.prepare(sql).run(...values)
    },
    transaction: async operation => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = await operation({
          query: async (sql, values = []) => { statements.push(sql); return { values: db.prepare(sql).all(...values) } },
          run: async (sql, values = []) => { statements.push(sql); return db.prepare(sql).run(...values) },
        })
        db.exec('COMMIT')
        return result
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
  }
}

class LocalApiError extends Error { constructor(status, message) { super(message); this.status = status } }

function compile(source) {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}
// 每个实例都是一次独立的模块求值，等价于应用进程重启；同一次求值内的多次调用
// 才是同一个进程。
function loadQuestionBank(recorder) {
  const context = {
    exports: {}, crypto, structuredClone, TextEncoder,
    require: key => ({
      './database': stubDatabase(recorder),
      './errors': { LocalApiError },
      './question-bank-profiles': { activeQuestionBankProfileId: async () => 1 },
      './import-destination': {},
      './ordering-fixed-slots': {},
      '../question-bank-limits.ts': {},
      './learning-history-rebind': {},
      jszip: {},
    })[key] ?? {},
  }
  vm.runInNewContext(compile(read('question-bank')), context)
  return context.exports
}

const WRITE = /^\s*(?:UPDATE|INSERT|DELETE|REPLACE)\b/i
const since = (statements, from) => statements.slice(from).filter(sql => !/^\s*(?:BEGIN|COMMIT|ROLLBACK)/i.test(sql))
const daysAgo = days => new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19)
const stale = daysAgo(10)
const fresh = daysAgo(0)

db.exec(`INSERT INTO papers(id, external_key, year, title, profile_id, status, subject, exam_type, content_version)
    VALUES (301, 'p301', 2026, '清扫目标', 1, 'published', '英语一', '真题', 1),
           (302, 'p302', 2026, '有作答', 1, 'published', '英语一', '真题', 1),
           (303, 'p303', 2026, '刚打开', 1, 'published', '英语一', '真题', 1),
           (304, 'p304', 2026, '有提交', 1, 'published', '英语一', '真题', 1),
           (305, 'p305', 2026, '双会话', 1, 'published', '英语一', '真题', 1);
  INSERT INTO units(id, paper_id, external_key, unit_type, title, sequence)
    VALUES (401, 301, 'u401', 'reading', 'Unit', 1), (402, 302, 'u402', 'reading', 'Unit', 1),
           (403, 303, 'u403', 'reading', 'Unit', 1), (404, 304, 'u404', 'reading', 'Unit', 1),
           (405, 305, 'u405', 'reading', 'Unit', 1);
  INSERT INTO questions(id, unit_id, external_key, number, answer, sequence, question_type)
    VALUES (501, 401, 'q501', 1, 'A', 1, 'single_choice'), (502, 401, 'q502', 2, 'B', 2, 'single_choice'),
           (503, 405, 'q503', 1, 'A', 1, 'single_choice');
  INSERT INTO practice_sessions(id, mode, paper_id, unit_ids, status, started_at, updated_at)
    VALUES (901, 'paper', 301, '[401]', 'active', '${stale}', '${stale}'),
           (902, 'paper', 302, '[402]', 'active', '${stale}', '${stale}'),
           (903, 'paper', 303, '[403]', 'active', '${fresh}', '${fresh}'),
           (904, 'paper', 304, '[404]', 'active', '${stale}', '${stale}'),
           (905, 'paper', 305, '[405]', 'active', '${fresh}', '${fresh}'),
           (906, 'paper', 305, '[405]', 'active', '${fresh}', '${fresh}')`)
db.exec(`INSERT INTO practice_answers(session_id, question_id, user_answer) VALUES (902, 502, 'A');
  INSERT INTO practice_unit_submissions(session_id, unit_id) VALUES (904, 404);
  INSERT INTO practice_answers(session_id, question_id, user_answer) VALUES (906, 503, 'A');
  INSERT INTO practice_unit_submissions(session_id, unit_id) VALUES (905, 405)`)

const sessionStatus = id => db.prepare('SELECT status FROM practice_sessions WHERE id = ?').get(id).status

// ------------------------------------------------- 1. 读取路径只读
const first = { statements: [] }
const questionBank = loadQuestionBank(first)
const papers = await questionBank.listPapers()
assert.deepEqual(since(first.statements, 0).filter(sql => WRITE.test(sql)), [],
  '/papers 读取路径必须只读，清扫不得在列表请求里跑')

const target = papers.find(item => item.id === 301)
assert.ok(target, '列表必须包含目标试卷')
assert.deepEqual(Object.keys(target).sort(), ['active_done', 'active_session_id', 'id', 'last_max_score', 'last_score',
  'question_count', 'status', 'subject', 'title', 'unit_count', 'year'],
  '列投影与前端消费方约定保持不变')
assert.equal(Number(target.unit_count), 1)
assert.equal(Number(target.question_count), 2)
assert.equal(target.active_session_id, null)

// ------------------------------------------------- 2. 进行中会话的排序语义不变
const dual = papers.find(item => item.id === 305)
assert.equal(dual.active_session_id, 905, '提交篇数更多的会话优先作为进行中会话')
assert.equal(Number(dual.active_done), 1, 'active_done 必须统计被选中会话的提交篇数，而不是另一个会话')

// ------------------------------------------------- 3. 清扫仍是一次显式维护
const maintenance = { statements: [] }
const sweeper = loadQuestionBank(maintenance)
await sweeper.sweepEmptyPaperSessions()
assert.equal(sessionStatus(901), 'abandoned', '7 天前既无作答也无提交的空会话仍要被清扫')
assert.equal(sessionStatus(902), 'active', '有作答的会话不能被清扫')
assert.equal(sessionStatus(903), 'active', '7 天内新开的空会话不能被清扫')
assert.equal(sessionStatus(904), 'active', '有整篇提交的会话不能被清扫')

// ------------------------------------------------- 4. 每次启动只清扫一次
let mark = maintenance.statements.length
await sweeper.sweepEmptyPaperSessions()
assert.deepEqual(since(maintenance.statements, mark).filter(sql => WRITE.test(sql)), [],
  '同一次启动内第二次清扫必须直接返回，不再写库')

db.prepare("INSERT INTO practice_sessions(id, mode, paper_id, unit_ids, status, started_at, updated_at)"
  + " VALUES (907, 'paper', 302, '[402]', 'active', ?, ?)").run(daysAgo(10), daysAgo(10))
await loadQuestionBank({ statements: [] }).sweepEmptyPaperSessions()
assert.equal(sessionStatus(907), 'abandoned', '下一次启动仍要在维护时清理到期的空会话')

// ------------------------------------------------- 5. 清扫失败可被调用方兜底
db.prepare("INSERT INTO practice_sessions(id, mode, paper_id, unit_ids, status, started_at, updated_at)"
  + " VALUES (908, 'paper', 303, '[403]', 'active', ?, ?)").run(daysAgo(10), daysAgo(10))
const failing = loadQuestionBank({ statements: [], failRun: sql => /^\s*UPDATE practice_sessions\b/i.test(sql) })
await assert.rejects(failing.sweepEmptyPaperSessions(), /disk I\/O error/,
  '清扫写库失败必须把错误交给调用方，而不是静默吞掉')
const degraded = await failing.listPapers()
assert.ok(degraded.some(item => item.id === 301), '清扫失败后列表读取必须依旧可用')
assert.equal(sessionStatus(908), 'active', '清扫失败时不得留下半个中间状态')

// ------------------------------------------------- 6. 维护入口挂在应用启动边界
const localApiSource = read('local-api')
assert.match(localApiSource, /void sweepEmptyPaperSessions\(\)\.catch/, '清扫必须在应用请求边界触发并自行兜底失败')
const listSource = read('question-bank')
assert.equal(/sweepEmptyPaperSessions/.test(listSource.slice(listSource.indexOf('export async function listPapers'))),
  false, 'listPapers 内部不得再引用清扫')

db.close()
console.log('PASS papers read path: read-only list, explicit once-per-launch sweep, unchanged projection and ranking')
