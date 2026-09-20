// 安卓首屏读取路径的量化门禁：活跃题库配置缓存、到期队列列投影、高频题计数、
// 模型配置批量读取、试卷列表列投影。全部用真实 SQLite 执行模块产生的 SQL，
// 用代理层记录桥调用次数与语句文本，避免“只断言 mock 被调用”。
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
// 同步列在 runtime 里是逐表补齐的（database.ts 的 sync_id/updated_at 循环），
// 试卷清扫与错题统计都会读它们，这里同样镜像出来。
db.exec(`ALTER TABLE practice_sessions ADD COLUMN sync_id TEXT;
  ALTER TABLE practice_sessions ADD COLUMN updated_at TEXT;
  ALTER TABLE practice_answers ADD COLUMN sync_id TEXT;
  ALTER TABLE practice_answers ADD COLUMN updated_at TEXT;
  ALTER TABLE practice_unit_submissions ADD COLUMN sync_id TEXT;
  ALTER TABLE practice_unit_submissions ADD COLUMN updated_at TEXT;
  ALTER TABLE wrong_current_questions ADD COLUMN sync_id TEXT;
  ALTER TABLE wrong_current_questions ADD COLUMN updated_at TEXT;
  ALTER TABLE wrong_retry_rounds ADD COLUMN sync_id TEXT;
  ALTER TABLE wrong_retry_rounds ADD COLUMN updated_at TEXT;
  ALTER TABLE wrong_retry_round_questions ADD COLUMN sync_id TEXT;
  ALTER TABLE wrong_retry_round_questions ADD COLUMN updated_at TEXT;
  ALTER TABLE wrong_stats ADD COLUMN attempt_ledger TEXT;
  ALTER TABLE wrong_stats ADD COLUMN updated_at TEXT`)

const statements = []
const executedSets = []
let transactionCalls = 0
const database = {
  row: async (sql, values = []) => { statements.push(sql); return db.prepare(sql).get(...values) },
  rows: async (sql, values = []) => { statements.push(sql); return db.prepare(sql).all(...values) },
  run: async (sql, values = []) => { statements.push(sql); return db.prepare(sql).run(...values) },
  // 评分把两条写语句合并成一次原生 executeSet：一次桥调用 + 一个原生事务。
  // 原生插件在 set 内不取 SELECT 结果（oneRowStatement 只走 executeInsert/
  // executeUpdateDelete），桩同样只按顺序执行语句。
  executeSet: async (set, transaction = true, returnMode = 'no') => {
    executedSets.push({ set, transaction, returnMode })
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const item of set) { statements.push(item.statement); db.prepare(item.statement).run(...(item.values || [])) }
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  },
  transaction: async operation => {
    transactionCalls++
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
const since = from => statements.slice(from).filter(sql => !/^\\s*(?:BEGIN|COMMIT|ROLLBACK)/i.test(sql))

class LocalApiError extends Error { constructor(status, message) { super(message); this.status = status } }
function compile(source) {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}
function loadModule(source) {
  const module = { exports: {}, require: () => ({}) }
  vm.runInNewContext(compile(source), module)
  return module.exports
}
function load(name, dependencies) {
  const context = { exports: {}, crypto, structuredClone, TextEncoder, require: key => dependencies[key] ?? {} }
  vm.runInNewContext(compile(read(name)), context)
  return context.exports
}

const projection = loadModule(readFileSync(new URL('../src/vocabulary-context.ts', import.meta.url), 'utf8'))

// ---------------------------------------------------------------- 1. 活跃题库配置缓存
const profiles = load('question-bank-profiles', {
  './database': database,
  './errors': { LocalApiError },
  './wrong-analysis-history': { restoreAnalysis: async () => {}, pruneAnalysis: async () => {}, reconcileArchivedAnalysis: async () => {} },
})
// schema 已种入默认配置（id=1），这里只补第二个题库，名称不同可避免删除时的重名探测分支。
db.exec("INSERT INTO question_bank_profiles(id, name, is_default) VALUES (2, '英语二', 0)")

let mark = bridgeCalls()
assert.equal(await profiles.activeQuestionBankProfileId(), 1)
const firstRead = since(mark).length
assert.ok(firstRead > 0, '首次解析活跃题库必须真正读库')
mark = bridgeCalls()
for (let round = 0; round < 18; round++) await profiles.activeQuestionBankProfileId()
assert.equal(since(mark).length, 0, '同一进程内重复解析活跃题库必须命中缓存，不再走数据库桥')
db.exec("UPDATE app_settings SET value = '2' WHERE key = 'active_question_bank_profile_id'")
assert.equal(await profiles.activeQuestionBankProfileId(), 1, '缓存只由本模块的写入点失效，外部直接改库不在契约内')

await profiles.activateQuestionBankProfile(2)
assert.equal(await profiles.activeQuestionBankProfileId(), 2, '切换活跃题库后必须读取新值而不是返回缓存')
mark = bridgeCalls()
await profiles.activeQuestionBankProfileId()
assert.equal(since(mark).length, 0, '切换后再次解析仍应命中缓存')

await profiles.deleteQuestionBankProfile(2)
assert.equal(await profiles.activeQuestionBankProfileId(), 1, '删除当前活跃题库后必须重新解析并回落到剩余题库')

// ---------------------------------------------------------------- 2. 到期队列投影
const vocabulary = load('vocabulary', {
  './database': database,
  './errors': { LocalApiError },
  './vocabulary-enrichment-runner': { queueVocabularyEnrichment: async () => {} },
  './study-todos': { vocabularyProfileCondition: '1 = 1' },
  '../../vocabulary-context': projection,
})
db.exec(`INSERT INTO vocabulary_entries(id, term, normalized_term, translation_status, common_meaning,
    contextual_meaning, memory_hint, note, phonetic, part_of_speech, synonyms, antonyms, similar_forms,
    morphology, generated_example, contextual_occurrence_key, encounter_count, next_review_at, last_reviewed_at)
  VALUES (11, 'went', 'went', 'ready', '去（过去式）', 'He went home.', '联想：go 的过去式', '笔记', '/went/', 'v.',
    '["depart"]', '["arrive"]', '[]', '{"currentForm":"past"}', '{"sentence":"He went home.","translation":"他回家了。"}',
    'occ-sync-11', 3, NULL, '2026-09-01 08:00:00');
  INSERT INTO vocabulary_entries(id, term, normalized_term, translation_status, common_meaning, next_review_at)
  VALUES (12, 'abandon', 'abandon', 'ready', '放弃', '2030-01-01 00:00:00')`)
db.exec(`INSERT INTO vocabulary_occurrences(entry_id, surface_form, source_kind, context_sentence, year, unit_title,
    unit_type, selection_start, context_before, context_after, created_at, sync_id)
  VALUES (11, 'went', 'passage', 'He went home yesterday.', 2026, 'Unit 1', 'reading', 3, 'before', 'after',
    '2026-09-10 10:00:00', 'occ-sync-11')`)
db.exec("UPDATE vocabulary_entries SET contextual_occurrence_key = 'occ-sync-11' WHERE id = 11")
db.exec("INSERT INTO vocabulary_reviews(entry_id, rating, mode, next_review_at, sync_id, updated_at) VALUES (11, 'know', 'scheduled', NULL, 'rev-1', '2026-09-11 09:00:00')")

// 整行读取是这台设备的卡顿基准：155 词队列 = 词条整行 + 整队出现记录。
const fullMark = bridgeCalls()
const fullRows = await vocabulary.listVocabulary(new URLSearchParams('status=review&limit=all'))
const fullCalls = since(fullMark)
assert.equal(fullRows.items.length, 1)
const fullItem = fullRows.items[0]
assert.ok(fullCalls.some(sql => /FROM vocabulary_occurrences/i.test(sql)), '整行读取会为整队拉取出现记录（对照基准）')

// 到期队列改为“清单”：只回传队列排序、卡片抬头与评分确认需要的列，
// 展开内容（释义/例句/同义词/出现记录）由单张卡片按需读取。
const queueMark = bridgeCalls()
const dueRows = await vocabulary.listVocabulary(new URLSearchParams('status=review&limit=all&projection=queue'))
const queueCalls = since(queueMark)
assert.equal(dueRows.items.length, 1)
const dueItem = dueRows.items[0]
// 清单只回传复习界面在详情到达前真正读取的列：卡片抬头（term/phonetic/
// is_frequent）、队列排序（reconcileDueQueue 读 translation_status/last_result/
// next_review_at/last_reviewed_at/created_at）与乐观并发身份（review_revision
// 的三个输入）。lemma/study_status/review_stage/lapse_count 只服务浏览列表、
// 编辑表单与卡片详情，updated_at 只服务手工编辑，队列带上它们只是多出来的
// 桥载荷（实测 903 行队列：updated_at 每行 33B，JSON 数组身份每行 121B）。
for (const field of ['id', 'term', 'normalized_term', 'phonetic', 'translation_status',
  'next_review_at', 'last_reviewed_at', 'created_at', 'last_result',
  'review_count', 'review_revision', 'is_frequent']) {
  assert.deepEqual(dueItem[field], fullItem[field], `到期队列清单缺少或改写了 ${field}`)
}
for (const field of ['lemma', 'study_status', 'review_stage', 'lapse_count', 'updated_at']) {
  assert.ok(!(field in dueItem), `到期队列不得回传复习流程不读取的 ${field}`)
}
assert.equal(dueItem.review_count, 1)
assert.ok(dueItem.is_frequent, '到期队列必须把高频词带出来')
assert.equal(dueRows.counts.total, 2)
assert.equal(dueRows.counts.review, 1)
// 卡片身份必须是短标量：清单与详情要能算出同一个值，而 JSON 数组身份在 903
// 行队列里要 121B/行，是这块界面载荷的第一大头。
assert.ok(!String(dueItem.review_revision).startsWith('['), '卡片身份必须是标量而不是 JSON 数组')
assert.ok(String(dueItem.review_revision).length <= 64, `卡片身份必须保持短标量（${dueItem.review_revision}）`)
// 分页只裁清单行，不裁计数：复习进度分母与“待背 N 词”都读 counts.review，
// 因此分页后它们必须仍覆盖整个到期集合。
const pagedRows = await vocabulary.listVocabulary(new URLSearchParams('status=all&limit=1&offset=0&projection=queue'))
assert.equal(pagedRows.items.length, 1, '清单必须按 limit 分页')
assert.deepEqual({ ...pagedRows.counts }, { ...dueRows.counts }, '分页不得改变计数：计数覆盖整个集合')
// 分母读的是计数，不是已经取到手的行数：分页之后卡片抬头若拿 reviewItems.length
// 当分母，会从「01 / 12」随分块补齐一路跳到真实总数，评分让出补全通道时还会停在中间值。
const vocabularyView = readFileSync(new URL('../src/views/VocabularyView.vue', import.meta.url), 'utf8')
assert.ok(vocabularyView.includes("String(reviewKind === 'scheduled' ? displayCount(counts.review) : reviewItems.length)"),
  '复习进度分母必须读 counts.review，而不是已取到的行数')
const secondPage = await vocabulary.listVocabulary(new URLSearchParams('status=all&limit=1&offset=1&projection=queue'))
assert.equal(secondPage.items[0].id, 12, '清单必须按 offset 续读下一页')
for (const sql of queueCalls) {
  assert.ok(!/SELECT \*/i.test(sql), `到期队列不得整行读取：${sql}`)
  assert.ok(!/FROM vocabulary_occurrences/i.test(sql), `到期队列不得为整队拉取出现记录：${sql}`)
}
assert.equal(queueCalls.length, 2, '到期队列只需要词条与计数两次读取')
assert.equal(fullCalls.length, 3, '整行读取需要词条、计数与出现记录三次读取（对照基准）')
for (const field of ['synonyms', 'memory_hint', 'latest_sentence', 'occurrences', 'contextual_meaning']) {
  assert.ok(!(field in dueItem), `到期队列不得回传只在展开后才读取的 ${field}`)
}
// 体积是桥成本的直接驱动量：清单必须显著小于整行，卡片的展开内容必须保持 KB 量级。
const queueBytes = JSON.stringify(dueRows.items).length
const fullBytes = JSON.stringify(fullRows.items).length
assert.ok(queueBytes < fullBytes / 2, `到期队列体积必须降到整行的一半以下（${queueBytes} vs ${fullBytes}）`)

// 每日一背首批卡一次取回队列字段和轻量详情，只多一次批量出现记录读取；
// 不得为每张卡逐条查库，也不得触发 localSimilarMatches 的整本词库扫描。
const warmReviewMark = bridgeCalls()
const reviewRows = await vocabulary.listVocabulary(new URLSearchParams('status=review&limit=12&offset=0&projection=review'))
const warmReviewCalls = since(warmReviewMark)
assert.equal(reviewRows.items.length, 1)
const warmed = reviewRows.items[0]
assert.equal(warmed.review_detail.latest_sentence, 'He went home yesterday.', '首批卡必须预热原句')
assert.equal(warmed.review_detail.common_meaning, '去（过去式）', '首批卡必须预热常用释义')
assert.equal(warmed.review_detail.memory_hint, '联想：go 的过去式', '首批卡必须预热记忆提示')
assert.deepEqual([...warmed.review_detail.local_similar], [], '首批复习卡不得计算本地相似词')
assert.ok(!('review_detail' in dueItem), '后续 queue 投影仍保持极小载荷')
assert.equal(warmReviewCalls.length, 3, '首批复习卡只允许词条、计数、批量出现记录三次读取')
assert.equal(warmReviewCalls.filter(sql => /FROM vocabulary_occurrences/i.test(sql)).length, 1, '出现记录必须一次批量读取')
for (const sql of warmReviewCalls) {
  assert.ok(!/SELECT\s+id,\s*term\s+FROM\s+vocabulary_entries/i.test(sql), `首批卡不得扫描整本词库计算相似词：${sql}`)
}
const card = await vocabulary.serializeEntry(11)
assert.equal(card.latest_sentence, 'He went home yesterday.', '复习卡片展开时必须读到原句')
assert.equal(card.memory_hint, '联想：go 的过去式', '复习卡片展开时必须读到记忆提示')
assert.equal(card.contextual_meaning, 'He went home.', '复习卡片展开时必须读到语境释义')
assert.equal(card.review_revision, fullItem.review_revision, '清单与详情必须给出同一份卡片身份')
assert.ok(JSON.stringify(card).length < 4096, '单张卡片详情必须保持 KB 量级')

// 额外巩固同样走清单：只取本轮需要的候选词，不再整本词库整行读取。
const reinforceMark = bridgeCalls()
const reinforce = await vocabulary.listVocabulary(new URLSearchParams('status=all&limit=2&projection=queue'))
const reinforceCalls = since(reinforceMark)
assert.equal(reinforce.items.length, 2, '巩固队列按请求的条数返回候选词')
for (const sql of reinforceCalls) {
  assert.ok(!/SELECT \*/i.test(sql), `巩固队列不得整行读取：${sql}`)
  assert.ok(!/FROM vocabulary_occurrences/i.test(sql), `巩固队列不得为候选词拉取出现记录：${sql}`)
}

// 出现记录投影必须与整行读取得到同一份“最近有效来源”。
const fullOccurrences = db.prepare('SELECT * FROM vocabulary_occurrences WHERE entry_id = 11').all()
const entryRow = db.prepare('SELECT * FROM vocabulary_entries WHERE id = 11').get()
const fromFull = projection.projectVocabulary({ ...entryRow, review_count: 1 }, fullOccurrences)
const serialized = await vocabulary.serializeEntry(11)
// 投影的目标就是不再把整行搬过桥，所以这里比较的是“选中同一条来源记录”
// 以及该记录被读取的每一个列，而不是比较整行对象（整行必然多出被裁掉的列）。
const occurrenceFields = ['entry_id', 'year', 'unit_title', 'unit_type', 'source_kind', 'surface_form', 'context_sentence', 'created_at', 'sync_id']
assert.equal(serialized.occurrences.length, fromFull.occurrences.length, '投影必须选出同一条最近来源')
for (const field of occurrenceFields) {
  assert.deepEqual(serialized.occurrences[0][field], fromFull.occurrences[0][field], `出现记录投影缺少或改写了 ${field}`)
}
assert.deepEqual(Object.keys(serialized.occurrences[0]).sort(), [...occurrenceFields].sort(),
  '出现记录投影不得再带回卡片与语境判定都不读取的列')
assert.equal(serialized.latest_sentence, fromFull.latest_sentence)
assert.equal(serialized.context_key, fromFull.context_key)
assert.equal(serialized.contextual_meaning, 'He went home.')
const occurrenceSelects = since(0).filter(sql => /FROM vocabulary_occurrences/i.test(sql))
assert.ok(occurrenceSelects.length, '必须真实查询出现记录')
for (const sql of occurrenceSelects) {
  assert.ok(!/SELECT \*/i.test(sql), `出现记录查询不得整行读取：${sql}`)
}

// ---------------------------------------------------------------- 2b. 评分合并为单次原生调用
const txBefore = transactionCalls
const reviewMark = bridgeCalls()
const ack = await vocabulary.reviewVocabulary(11, 'hard', 'scheduled', dueItem.review_revision)
const reviewCalls = since(reviewMark)
// 评分链路的语句形状：一次状态读取（乐观并发校验）与一次 executeSet
// 里的两条写语句。评分回执直接由已验证状态构建，不再追加读回执。
assert.equal(reviewCalls.length, 3, `评分只允许“读状态 + 两条写语句”，实际 ${reviewCalls.length} 条`)
assert.equal(executedSets.length, 1, '评分必须一次 executeSet 写完两条语句')
assert.equal(executedSets[0].transaction, true, 'executeSet 必须自带原生事务，失败整组回滚')
assert.equal(executedSets[0].returnMode, 'no', 'executeSet 不得要求回执列（原生 set 取不到 SELECT 结果）')
// 展开成宿主域数组再比较：模块在 vm 沙箱里，跨域数组的原型不同会让 deepEqual 失败。
assert.deepEqual([...executedSets[0].set.map(item => item.statement.trim().split(/\s+/)[0])], ['UPDATE', 'INSERT'],
  '写入顺序必须保持先改词条（顺位/到期）再记账')
assert.equal(executedSets[0].set[0].values.length, 7, '词条更新必须绑定全部七个参数')
assert.equal(transactionCalls - txBefore, 0, '评分不得再包 transaction() 外壳')
for (const sql of reviewCalls) assert.ok(!/SELECT \*/i.test(sql), `评分路径不得整行读取：${sql}`)
assert.equal(ack.id, 11)
assert.equal(ack.review_count, 2)
assert.equal(ack.review_revision, (await vocabulary.serializeEntry(11)).review_revision, '回执版本必须与随后读到的版本一致')
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vocabulary_reviews WHERE entry_id = 11').get().n, 2, '评分必须新增一条复习记录')

// summary 投影必须保留语境来源键：列表回落到语境释义时要用它校验“这条释义
// 是否仍属于最近的有效来源”（projectVocabulary 的 contextual_meaning 守卫）。
const summaryRows = await vocabulary.listVocabulary(new URLSearchParams('projection=summary&limit=2'))
assert.equal(summaryRows.items.find(item => item.id === 11).contextual_occurrence_key, 'occ-sync-11')
assert.equal(summaryRows.items.find(item => item.id === 11).review_revision, undefined, 'summary 投影不回传卡片身份')

// ---------------------------------------------------------------- 3. 高频题计数
const studyTodos = load('study-todos', {
  './database': database,
  './question-bank-profiles': { activeQuestionBankProfileId: async () => 1 },
  '../../resume-title': { resumeTitle: () => '' },
})
db.exec(`INSERT INTO papers(id, external_key, year, title, profile_id, status) VALUES (101, 'p101', 2026, '试卷', 1, 'published');
  INSERT INTO units(id, paper_id, external_key, unit_type, title, sequence) VALUES (201, 101, 'u201', 'reading', 'Unit', 1);
  INSERT INTO questions(id, unit_id, external_key, number, answer, sequence, question_type) VALUES (301, 201, 'q301', 1, 'A', 1, 'single_choice');
  INSERT INTO wrong_stats(question_id, wrong_count) VALUES (301, 3);
  INSERT INTO wrong_current_questions(unit_id, question_id) VALUES (201, 301)`)
const frequentIds = await studyTodos.frequentQuestionIds()
const countMark = bridgeCalls()
const frequentCount = await studyTodos.frequentQuestionCount()
assert.equal(frequentCount, frequentIds.length)
// 计数语句的形状可以随内联片段变化（首页六项统计与它共用同一份片段），但契约不变：
// 只跨一次桥、只回传一行计数，且不得把题号搬回 JS。
const countStatements = since(countMark)
assert.equal(countStatements.length, 1, `高频题计数只允许一条语句，实际 ${countStatements.length} 条`)
assert.match(countStatements[0], /AS count/i, '高频题计数必须回传一行计数而不是一批题号')
// 外层投影必须是单个 COUNT(...)（直接聚合或标量子查询），不能是 SELECT w.question_id。
assert.match(countStatements[0].trim(), /^SELECT\s+(COUNT\(|\(\s*SELECT\s+COUNT\()/i,
  `高频题计数必须是单个标量计数，而不是把题号搬回 JS：${countStatements[0]}`)

// ---------------------------------------------------------------- 4. 模型配置批量读取
const keySummaries = []
const ai = load('ai', {
  './database': database,
  './errors': { LocalApiError },
  './model-key-store': {
    namedKeySummary: async id => { keySummaries.push(id); return { has_api_key: true } },
    selectedKey: async () => ({}),
    writeLegacyKey: async () => {},
    suppressProfileKeys: async () => {},
  },
  './native-http': { nativeBytes: async () => ({ values: [] }), nativeJson: async () => ({}), nativeText: async () => '' },
  './ai-adapters': { adapterFor: () => ({}), normalizeAdapterId: value => value || 'openai-chat' },
  './vocabulary-enrichment-fields': { mergeVocabularyEnrichment: () => ({}) },
})
db.exec(`INSERT INTO ai_profiles(id, name, adapter, base_url, enabled, is_default) VALUES
  (1, 'A', 'openai-chat', 'https://a.test/v1', 1, 1), (2, 'B', 'openai-chat', 'https://b.test/v1', 1, 0),
  (3, 'C', 'openai-chat', 'https://c.test/v1', 0, 0);
  INSERT INTO ai_profile_models(profile_id, model_id, is_visible, is_available) VALUES
  (1, 'm-b', 1, 1), (1, 'm-a', 1, 1), (2, 'm-c', 0, 1), (3, 'm-d', 1, 0)`)
const profileMark = bridgeCalls()
const listed = await ai.listProfiles()
// vm 里构造的数组与本文件的数组不同 realm，先展开成宿主数组再比较。
assert.deepEqual([...listed].map(item => item.id), [1, 2, 3])
assert.deepEqual([...listed[0].models].map(model => model.model_id), ['m-a', 'm-b'])
assert.equal(listed[1].models.length, 1)
assert.equal(listed[2].models[0].is_available, false)
assert.deepEqual([...listed].map(item => item.has_api_key), [true, true, true])
assert.equal(keySummaries.length, 3)
const modelSelects = since(profileMark).filter(sql => /^SELECT \* FROM ai_profile_models/i.test(sql.trim()))
assert.deepEqual(modelSelects, ['SELECT * FROM ai_profile_models WHERE profile_id IN (?, ?, ?) ORDER BY profile_id, model_id'],
  '模型必须一次批量读取并按 profile_id 分桶，不能每个配置各查一次')

// ---------------------------------------------------------------- 5. 试卷列表列投影
db.exec(`INSERT INTO papers(id, external_key, year, title, profile_id, status, subject, exam_type, content_version, updated_at)
    VALUES (102, 'p102', 2026, '试卷二', 1, 'published', '英语', '真题', 3, '2026-09-01 00:00:00');
  INSERT INTO units(id, paper_id, external_key, unit_type, title, sequence) VALUES (202, 102, 'u202', 'reading', 'Unit', 1);
  INSERT INTO questions(id, unit_id, external_key, number, answer, sequence, question_type)
    VALUES (302, 202, 'q302', 1, 'A', 1, 'single_choice'), (303, 202, 'q303', 2, 'B', 2, 'single_choice')`)
const questionBank = load('question-bank', {
  './database': database,
  './errors': { LocalApiError },
  './question-bank-profiles': { activeQuestionBankProfileId: async () => 1 },
  './import-destination': {},
  './ordering-fixed-slots': {},
  '../question-bank-limits.ts': {},
  './learning-history-rebind': {},
  jszip: {},
})
const papers = await questionBank.listPapers()
const paper = papers.find(item => item.id === 102)
assert.ok(paper, '试卷列表必须包含目标试卷')
assert.deepEqual(Object.keys(paper).sort(), ['active_done', 'active_session_id', 'id', 'last_max_score', 'last_score',
  'question_count', 'status', 'subject', 'title', 'unit_count', 'year'])
assert.equal(Number(paper.unit_count), 1)
assert.equal(Number(paper.question_count), 2)
assert.equal(paper.active_session_id, null)
assert.equal(paper.status, 'published')

db.close()
console.log('PASS android read path: profile cache, due projection, frequent count, model batching, paper projection')
