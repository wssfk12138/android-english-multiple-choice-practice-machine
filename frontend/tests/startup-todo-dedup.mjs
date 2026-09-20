// 首页 /startup 与 /study-todos 的同屏去重门禁。
// 学习待办的三张卡片（续练、待复习词汇、高频错题）必须直接取 /startup 的同一批
// 聚合结果：一个首页屏幕只允许执行一轮续练/高频/到期聚合，不能因为组件自己再发
// 一次请求而把同一批 SQL 跑两遍。断言用真实 SQLite 执行模块产生的 SQL，并用代理
// 层记录桥调用，避免只断言 mock 被调用。
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
// Runtime 在基础 schema 之后补齐 LAN 身份列与同步簿记列，这里同步镜像，
// 保证被裁剪的投影列确实不存在时测试会失败而不是静默通过。
db.exec(`ALTER TABLE vocabulary_entries ADD COLUMN sync_id TEXT;
  ALTER TABLE vocabulary_entries ADD COLUMN _sync_seq INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE vocabulary_entries ADD COLUMN _sync_rev INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE vocabulary_entries ADD COLUMN _sync_origin TEXT NOT NULL DEFAULT ''`)
for (const table of ['vocabulary_occurrences', 'vocabulary_reviews']) {
  db.exec(`ALTER TABLE ${table} ADD COLUMN sync_id TEXT;
    ALTER TABLE ${table} ADD COLUMN updated_at TEXT;
    ALTER TABLE ${table} ADD COLUMN _sync_seq INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ${table} ADD COLUMN _sync_rev INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ${table} ADD COLUMN _sync_origin TEXT NOT NULL DEFAULT ''`)
}
db.exec(`ALTER TABLE practice_sessions ADD COLUMN sync_id TEXT;
  ALTER TABLE practice_sessions ADD COLUMN updated_at TEXT;
  ALTER TABLE practice_answers ADD COLUMN sync_id TEXT;
  ALTER TABLE practice_answers ADD COLUMN updated_at TEXT;
  ALTER TABLE practice_unit_submissions ADD COLUMN sync_id TEXT;
  ALTER TABLE practice_unit_submissions ADD COLUMN updated_at TEXT;
  ALTER TABLE wrong_current_questions ADD COLUMN sync_id TEXT;
  ALTER TABLE wrong_current_questions ADD COLUMN updated_at TEXT;
  ALTER TABLE wrong_stats ADD COLUMN attempt_ledger TEXT;
  ALTER TABLE wrong_stats ADD COLUMN updated_at TEXT`)

const statements = []
const database = {
  row: async (sql, values = []) => { statements.push(sql); return db.prepare(sql).get(...values) },
  rows: async (sql, values = []) => { statements.push(sql); return db.prepare(sql).all(...values) },
  run: async (sql, values = []) => { statements.push(sql); return db.prepare(sql).run(...values) },
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
const bridgeCalls = () => statements.length
const since = from => statements.slice(from).filter(sql => !/^\s*(?:BEGIN|COMMIT|ROLLBACK)/i.test(sql))

class LocalApiError extends Error { constructor(status, message) { super(message); this.status = status } }
function compile(source) {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}
function load(name, dependencies) {
  const context = { exports: {}, crypto, structuredClone, TextEncoder, setTimeout, clearTimeout, require: key => dependencies[key] ?? {} }
  vm.runInNewContext(compile(read(name)), context)
  return context.exports
}

const profiles = { activeQuestionBankProfileId: async () => 1, resetActiveQuestionBankProfileCache: () => {}, purgeExpiredTrash: async () => {} }
const studyTodos = load('study-todos', {
  './database': database,
  './question-bank-profiles': profiles,
  '../../resume-title': { resumeTitle: (mode, identity) => identity.paper || '' },
})

// 到期判定与词汇页同一语义：ready、next_review_at 为空或已到期、并且当前题库里
// 存在该词的来源。种入的数据刻意包含三种边界：到期、未到期、只属于别的题库。
// schema 已种入默认题库（id=1），这里只补第二个题库，用来验证计数按当前题库收口。
db.exec(`INSERT INTO question_bank_profiles(id, name, is_default) VALUES (2, '英语二', 0);
  INSERT INTO papers(id, external_key, year, title, profile_id, status) VALUES
    (11, 'p11', 2026, '英语一真题', 1, 'published'), (21, 'p21', 2026, '英语二真题', 2, 'published');
  INSERT INTO units(id, paper_id, external_key, unit_type, title, sequence) VALUES
    (111, 11, 'u111', 'reading', '第一篇', 1), (211, 21, 'u211', 'reading', '另一篇', 1);
  INSERT INTO vocabulary_entries(id, term, normalized_term, lemma, translation_status, next_review_at) VALUES
    (1, 'due', 'due', 'due', 'ready', '2020-01-01T00:00:00.000Z'),
    (2, 'open', 'open', 'open', 'ready', NULL),
    (3, 'future', 'future', 'future', 'ready', '2099-01-01T00:00:00.000Z'),
    (4, 'elsewhere', 'elsewhere', 'elsewhere', 'ready', '2020-01-01T00:00:00.000Z'),
    (5, 'pending', 'pending', 'pending', 'pending', '2020-01-01T00:00:00.000Z');
  INSERT INTO vocabulary_occurrences(id, entry_id, surface_form, unit_id) VALUES
    (1001, 1, 'due', 111), (1002, 2, 'open', 111), (1003, 3, 'future', 111),
    (1004, 4, 'elsewhere', 211), (1005, 5, 'pending', 111)`)

const practice = load('practice', {
  './database': database,
  './errors': { LocalApiError },
  './question-bank-profiles': profiles,
  './study-todos': studyTodos,
  './candidate-order-policy': load('candidate-order-policy'),
  './practice-session-resume': load('practice-session-resume'),
  './attempt-stats': load('attempt-stats'),
  './practice-snapshots': {},
  '@capacitor-community/sqlite': {},
})

// ---------------------------------------------------------------- 1. 首页载荷自带待办字段
const startupMark = bridgeCalls()
const startup = await practice.dashboard()
const startupCalls = since(startupMark)
for (const field of ['profile_id', 'review_count', 'frequent_count', 'resume_session']) {
  assert.ok(field in startup,
    `首页载荷必须原生包含 ${field}，否则学习待办只能在同一个屏幕里再发一次 /study-todos 重跑聚合`)
}
assert.equal(Number(startup.profile_id), 1, '首页载荷必须带上当前题库，前端才知道这份待办属于哪个题库')
assert.equal(Number(startup.review_count), 2, '到期词计数必须是当前题库内 ready 且已到期的词数')

// ---------------------------------------------------------------- 2. 与学习待办同一语义
const todosMark = bridgeCalls()
const todos = await studyTodos.studyTodos()
const todosCalls = since(todosMark)
assert.equal(Number(startup.review_count), Number(todos.review_count), '/startup 与 /study-todos 的到期词计数必须来自同一语义')
assert.equal(Number(startup.frequent_count), Number(todos.frequent_count), '/startup 与 /study-todos 的高频题计数必须来自同一语义')
assert.deepEqual(
  [...(startup.resume_session ? [startup.resume_session.id] : [])],
  [...(todos.resume_session ? [todos.resume_session.id] : [])],
  '/startup 与 /study-todos 必须指向同一个续练会话',
)

// 一份屏幕数据只允许查一轮到期词，而且必须是计数而不是把整队词搬过桥。
const startupDueReads = startupCalls.filter(sql => /FROM vocabulary_entries/i.test(sql))
assert.equal(startupDueReads.length, 1, `首页只允许执行一条到期词查询，实际 ${startupDueReads.length} 条`)
assert.match(startupDueReads[0], /COUNT\(\*\)/, '首页的到期词查询必须只回传计数')
assert.ok(!/SELECT \*/i.test(startupDueReads[0]), '首页的到期词查询不得整行读取词库')
// 反向控制：待办接口自己仍然必须完整算出这三项（保留给其它调用方）。
const todosDueReads = todosCalls.filter(sql => /FROM vocabulary_entries/i.test(sql))
assert.equal(todosDueReads.length, 1, '学习待办接口自身仍必须只查一轮到期词')

// ---------------------------------------------------------------- 3. 组件不再自取数据
const componentSource = readFileSync(new URL('../src/components/StudyTodos.vue', import.meta.url), 'utf8')
assert.ok(!/from '\.\.\/api'/.test(componentSource), '学习待办组件不得再自己引入请求层')
assert.ok(!/\bget\s*\(/.test(componentSource), '学习待办组件不得再自己发起 /study-todos 请求')
assert.match(componentSource, /tasks\s*:/, '学习待办组件必须接收首页下发的待办数据')
assert.match(componentSource, /failed\?:/, '学习待办组件必须接收首页下发的失败状态')
assert.match(componentSource, /defineEmits<\{ retry: \[\] \}>/, '重试必须交回首页统一重载')
const viewSource = readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8')
assert.match(viewSource, /<StudyTodos[^>]*:tasks="studyTodos"/, '首页必须把 /startup 的同一份数据下发给学习待办')
assert.match(viewSource, /@retry="loadHome"/, '学习待办的重试必须复用首页单飞加载')
assert.ok(!/tasksRevision/.test(viewSource), '首页不得再用 revision 让学习待办整块重挂载重取')

// ---------------------------------------------------------------- 4. 六项统计一次跨桥
// 首页要的六项统计（试卷/篇目/题目/错题/到期词/高频题）是同一份屏幕数据。每次跨
// SQLite→JS 桥都有固定开销（平板上单次 5~10ms，实测到期词 7.8ms、高频题 8.7ms、
// 四个标量 9.5ms，合并成一条 10.4ms），拆成三条语句既多跨两次桥，又让 SQLite 把
// 同一批 join 扫三遍。断言：六项必须落在同一条语句里。
// 题型统计那条语句也有 paper_count/unit_count 两个别名，所以用只出现在统计语句里的
// wrong_count 作为这一组计数的标识。
const counted = startupCalls.filter(sql => /AS wrong_count/i.test(sql))
assert.equal(counted.length, 1, `首页统计只允许一条语句，实际 ${counted.length} 条`)
for (const alias of ['paper_count', 'unit_count', 'question_count', 'wrong_count', 'review_count', 'frequent_count']) {
  assert.match(counted[0], new RegExp(`AS ${alias}\\b`), `首页统计语句必须一次带回 ${alias}`)
}
assert.equal(startupCalls.filter(sql => /AS frequent_count/i.test(sql)).length, 1, '高频题计数不得在首页统计之外再单独发一条查询')
assert.equal(startupCalls.filter(sql => /AS review_count/i.test(sql)).length, 1, '到期词计数不得在首页统计之外再单独发一条查询')
assert.equal(startupCalls.length, 4, `首页首屏只允许四条语句（六项统计/最近记录/续练/题型），实际 ${startupCalls.length} 条`)

// 反向控制：待办接口虽然自己就是一个屏幕，但两条计数同样是同一批数据，必须合并。
assert.equal(todosCalls.length, 2, `学习待办只允许两条语句（续练 + 两项计数），实际 ${todosCalls.length} 条`)

db.close()
console.log('PASS startup/todo dedup: one aggregate round per screen, same counts, presentational todos')
