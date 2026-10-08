# 首页与单词本首次载入卡顿：只读代码审查 + 真机数据库实测（2026-09-14）

核验日期：2026-09-14。范围：本仓（Android 开发权威树）`frontend/src` 源码静态审查，加上对**真机导出数据库快照**的只读实测。

未修改任何应用代码、未构建、未安装、未连接设备、未执行 git 写操作。性能修复仍按 [NOW](../NOW.md) 保持暂停；本记录是[最终方案 R3 第 11 节](../2026-09-tablet-landscape-ui-plan.md#11-首页与单词本首次载入卡顿观察任务已纳入已完成本轮源码观察)观察义务的证据补充。

## 0. 本轮新增的方法：用真机数据库代替假数据库

之前的容量探针（`.codex-local/zcode-takeover-20260913/scale.cjs`）用的是**假数据库，不执行真实 SQL**，只能看结构增长。本轮改用 2026-09-13 从两台设备通过应用内“导出应用数据库副本”取出的**真实快照**（`work/db-export/tablet-export.db`、`phone-export.db`），用 `node:sqlite` 逐条执行当前源码里的原始 SQL 并计时、取真实执行计划。

- 脚本：`work/perf-probe.cjs`（每次先把快照复制到临时目录再打开，原快照不被写入）。
- 原始输出：`work/perf-tablet.txt`、`work/perf-phone.txt`。
- 局限：PC 上的 `node:sqlite` 不等于平板的 WebView + Capacitor 桥 + 单插件线程；绝对值只作**下界参照**，不能当作平板耗时。快照为 2026-09-13 状态，不是卡顿发生时刻的实时状态。

两台设备的数据规模（真实快照）：

| 对象 | 平板 HEY2-W09 | 手机 PHK110 |
| --- | ---: | ---: |
| papers | 51 | 34 |
| units | 305 | 203 |
| questions | **2290** | 1525 |
| practice_sessions | 33 | 0 |
| wrong_stats | 155 | 155 |
| vocabulary_entries | 216 | 216 |
| vocabulary_occurrences | 224 | 224 |
| vocabulary_reviews | 948 | 957 |
| 数据库文件 | 12.25 MiB | 12.97 MiB |

**关键对照事实：单词本相关的数据量两台设备完全一样（216 词 / 224 出现记录 / 948 与 957 条复习记录）。** 题库数据则是平板更多（题量是手机的 1.5 倍）。

## 1. 实测结果：SQL 本身不是瓶颈

平板快照上的中位数（7 次、去预热）：

| 路径 | 中位耗时 | 返回/影响 |
| --- | ---: | --- |
| `activeQuestionBankProfileId()`（2 条查询） | 0.04 ms | 每次调用都要查 app_settings + profiles |
| `/startup` → `dashboard()` 的 4 个标量子查询 | 0.19 ms | — |
| `/startup` → `frequentQuestionIds()` | 0.14 ms | — |
| `/startup` → `resumablePracticeSession()` | 0.44 ms | — |
| `/startup` → 题型统计 GROUP BY | 0.12 ms | — |
| `/study-todos` → 到期词 COUNT + 相关 EXISTS | 0.13 ms | — |
| `/papers` → `sweepEmptyPaperSessions()`（写） | 0.08 ms | 0 行命中也要走一次写事务 |
| `/papers` → `listPapers()` 主查询 | 0.76 ms | 返回 51 行（`SELECT p.*`，含 `shared_data`） |
| `/vocabulary/home?limit=20` | 0.21 ms | 20 行 |
| 单词本列表 `limit=100` | 1.59 ms | 100 行，JSON 约 **115 KB** |
| 单词本列表 `limit=all` | 1.71 ms | 216 行，JSON 约 **238 KB** |
| 列表 counts 聚合 | 0.21 ms | — |
| 出现记录 `IN(216 ids)` | 0.59 ms | 224 行，JSON 约 **122 KB** |
| 待翻译 id 查询 | 0.02 ms | — |

手机快照同样全部在 0.02–1.8 ms。**所有热点 SQL 都在 2 毫秒以内**，即使按 PC→平板差 10–30 倍放大，也到不了用户报告的“4.9 秒 / 5.8 秒”量级。

平板快照的真实执行计划（`EXPLAIN QUERY PLAN`）：

- 单词本列表：`SCAN vocabulary_entries` + `USE TEMP B-TREE FOR ORDER BY`（全表扫描 + 临时 B 树排序，`LIMIT 100` 无法下推）。
- `listPapers()`：`USE TEMP B-TREE FOR GROUP BY` + `USE TEMP B-TREE FOR count(DISTINCT)` + 两次 `USE TEMP B-TREE FOR ORDER BY`，外加 **13 个相关子查询**。
- `sweepEmptyPaperSessions()`：`SCAN practice_sessions` + 2 个 `NOT EXISTS`。
- `homeVocabulary`：能走 `idx_vocab_status`，但排序仍要 `USE TEMP B-TREE FOR ORDER BY`。

另确认两件事：

1. 应用的 `journal_mode` 是 `delete`（回滚日志），不是 WAL。全仓只在 `DatabaseExportPlugin.java:281` 读它做诊断，**没有任何地方设置它**。含义：读事务与写事务互相阻塞，且写事务会把整个页面写回。
2. `database.ts` 只有一个连接（`connectionPromise`，`database.ts:437`、`940-1151`），且 `rows/row/run`（`database.ts:1153-1179`）**不入队**，只有显式 `transaction()`（`:1181-1210`）走串行队列。原生侧 Capacitor 的插件调用共用一个 `HandlerThread`，所以并发请求的语句不会真正并行，而是 FIFO 串行且互相插队——一条慢语句会队头阻塞所有其他查询。

## 2. 首次载入路径上确认的代码事实

### 2.1 首页冷启动必然刷新两轮（新增的关键发现）

`main.ts:14-47`：先 `mount('#app')`（`:35`，避免白屏），再后台跑 `runAndroidStartupPreparation()`：`platformRuntime.ready()` → `ensureContentRemediation()`（`:18`）→ `purgeExpiredTrash()`（`:20`）→ 可选内置题库安装，最后 `finally` 里派发 `android-startup-prepared`（`:46`）。

`main.ts:14-29` 的 `await ensureContentRemediation()` 是**阻塞这条启动链的关键点**（`:18`）：事件只有在内容修正整段结束、`purgeExpiredTrash()`、内置题库安装全部做完之后才发出。而 `DashboardView.vue:119-123` 的 `onMounted` 会立刻 `loadHome()`，`:120` 又监听同一个事件再触发一次 `loadHome`。单飞逻辑（`:76-92`）只能合并“同一时刻在途”的请求，**跨轮不合并**。

结果：冷启动进首页固定发两轮 `/startup` + `/vocabulary/home` + `/papers`，`tasksRevision` 自增两次，模板 `:key="tasksRevision"`（`:170`）让 `StudyTodos` 整体卸载重挂载两次（每次又发一条 `/study-todos`），整页渲染两遍。

另外，`ensureContentRemediation()` 即使已经“修正完成”也要付固定成本：`loadBundledContentManifest()`（`content-remediation.ts:207-220`）每次冷启动都 `fetch('/content-remediation.json')`。该文件**实测 4,030,971 字节（3.85 MB）、65 个单元、835 道题**，还要跑 `validateContentManifest()`（`:19-45`）的 canonical 全量比对——全部在前端线程。之后 `remediationSettled()`（`:240-257`）再花约 3 条 SQL。首次安装后首启还会走 `applyContentWithBackup()`（`:174-192`）：全库 `exportToJson('full')` 备份 + 写文件回读校验 + 事务内**再跑一遍** preflight + 逐篇写入（每篇约 `9 + 2×题数 + 选项数` 条语句，65 篇可达千条级）。

`DashboardView.vue:97-98` 的 `window.__LINJIAN_STARTUP__` 嵌入快照快捷路径**全仓只有消费端、没有生产者**（`MainActivity.java`、`frontend/android` 都没有注入），在当前树下是死代码，所以 `/startup` 每次必发。

### 2.2 首页一轮请求 ≈ 20 条 SQL，且档案 id 被反复解析

`/startup` → `dashboard()`（`practice.ts:969-1018`）与 `/study-todos` → `studyTodos()`（`study-todos.ts:32-40`）**各自**都调用：

- `activeQuestionBankProfileId()`（`question-bank-profiles.ts:17-45`，每次 2 条查询，**无缓存**）；
- `frequentQuestionIds()`（`study-todos.ts:7-10`，含 `json_array_length` + `json_each` 相关子查询）；
- `resumablePracticeSession()`（`study-todos.ts:12-30`，3 处 `json_each(s.unit_ids)` + ORDER BY 里 2 个相关 COUNT）。

这两个接口的重复计算是历史审查（`history/2026-09-startup-performance-review.md`）已指出的问题，**至今仍在**。合计一轮首页约 20 条语句、`activeQuestionBankProfileId` 约解析 5 次；因为冷启动刷两轮，实际翻倍。

`listPapers()`（`question-bank.ts:800-848`）额外有两个问题：`:802` 在读路径上先执行一次**无条件 UPDATE**（`sweepEmptyPaperSessions`，`:788-798`）；主查询里“选当前进行中的试卷会话”那段几乎逐字重复了两遍（`:807-818` 的 `active_session_id` 与 `:819-833` 的 `active_done`），`last_score`/`last_max_score`（`:834-839`）也是两条同形子查询。

### 2.3 首页在手机竖屏渲染两套 DOM

`DashboardView.vue` 同时有 `.desktop-dashboard`（`:168`，内含 `QuestionBankSwitcher`、`StudyTodos`、词汇 ticker、题型练习、题库概览）和 `.portrait-dashboard`（`:198`，含第二个 `QuestionBankSwitcher`、`publishedPapers` 列表、第二个词汇 ticker）。

CSS 只是隐藏：`styles.css:4420` 在非安卓/非竖屏隐藏 portrait 版；`dashboard-glass.css:102` 在 Android 竖屏隐藏 desktop 版。**两棵子树都真实挂载、都真实渲染**，只是其中一棵被 `display:none`。后果：

- 手机竖屏上 `StudyTodos` 仍然挂载并发 `/study-todos`（因为它只存在于 desktop 那棵里），但**手机上没有任何地方显示学习待办**，请求与渲染都是纯浪费；且每条首页刷新还会因 `:key` 重挂载一次。
- 两个 `QuestionBankSwitcher` 实例同时挂载（`:169` / `:199`），可能让 `/question-bank-profiles` 双发。

### 2.4 单词本首次进入是“串行等待 + 后台抢资源”

`VocabularyView.vue:417-421` 的第二个 `onMounted`：非复习入口一律先 `startPendingTranslations()`（`:193-205`）——**先 `await` POST `/vocabulary/translation-runs`**（`:195`，内部是查全部待翻译 id + 分块 UPDATE + 启动翻译 worker），**然后才 `load()`**（`:199`），再启动 5 秒轮询（`:200`、`:140-144`）。

也就是说：打开单词本的**第一步不是读列表**，而是先做一次翻译调度写库，列表读取排在它后面；紧接着 `void initializeEnrichment()`（`:420`）又会做一次补缺盘点（INSERT…SELECT 循环）并启动补缺 worker。翻译 runner（`vocabulary-translation-runner.ts:16-54`，每轮 `LIMIT 8` 批量调模型）与补缺 runner（`vocabulary-enrichment-runner.ts:65-83`）**彼此不串行**，且与 UI 请求共用同一条 SQLite 连接/插件线程——冷启动时“翻译 + 补缺 + 首屏列表 + 首页两轮”会互相插队。

列表 SQL 本身（`vocabulary.ts:292-303`）用的是 `SELECT *`（33 列，含 `synonyms`/`similar_forms`/`morphology`/`generated_example` 等大 TEXT）+ 每行一个相关 COUNT 子查询，排序用 `datetime(last_seen_at)` 表达式，所以走全表扫描 + 临时 B 树（已由执行计划确认）。`:318-333` 还会额外把当前页所有词条的出现记录整批拉出（`SELECT *`，含 `context_sentence` 等长文本）。

复习路径上还有一处：`rate()`（`:295-341`）每次评分前都 `await refreshDueQueue()`（`:305`），即**每评一张卡都重跑一次 `limit=all` 的全量到期集查询**；`startReinforcement()`（`:370-379`）在 `:377` 先 `await load(...,{all:true})` 再切换复习界面（`:378`），点击后必然先等一次全表查询且没有骨架。

## 3. 与实测/历史证据的交叉判断

### 3.1 数据量与“SQL 慢”都被排除

- 两台设备的单词本数据**完全相同**（216/224/948↔957），但用户报告平板卡、手机不卡 → 单词本卡顿**不是数据量驱动的**。
- 平板题库数据**更多**（2290 题 vs 1525 题，`practice_sessions` 33 vs 0），首页请求的返回体也更大，但卡的是平板、不卡的是手机 → 首页卡顿**也不是返回体大小驱动的**。
- 热点 SQL 全部 ≤ 2 ms（PC 上界参照）→ 单条 SQL 不是 4.9 秒/5.8 秒的来源。

这与 2026-09-13 已有的结论一致并相互加强：当时记录“竖屏复习流畅、手机携带 127 词也流畅” → 数据量与查询改动不是主因。

### 3.2 仍与 2026-09-13 记录一致的渲染层因素

横屏仍保留 3 处 `backdrop-filter`：`styles.css:314` `.review-overlay` blur 13px、`:321` `.practice-top` blur 15px、`:370` `.practice-footer` blur 16px；竖屏媒体查询已把 `.vocabulary-review-overlay` 显式置 `backdrop-filter:none`（`styles.css:4121-4126`），横屏 `study-theme.css:81-86` 只改背景未清 blur。首页玻璃面板另有 `dashboard-glass.css:20-21` 的 `backdrop-filter: blur(18px) saturate(125%)` 施加在**多个**卡片上（`:15` 选择器同时命中 `.todo-item`/`.ticker-word`/`.action-card`/`.overview-stat`/`.bank-switcher-main`）。这两项与“手机流畅、平板卡”的设备差异方向一致（同一套模糊面积在平板大屏上像素更多），但**本轮没有新的帧时间测量，不能断言它占多少**。

### 3.3 哪些是流程浪费、哪些可能是主因

| 类别 | 项目 | 判断 |
| --- | --- | --- |
| 确定浪费（对卡顿有贡献，但不太可能是数秒级主因） | 冷启动首页刷两轮；`StudyTodos` 因 `:key` 重挂载；重复的 `frequentQuestionIds`/`resumablePracticeSession`；`activeQuestionBankProfileId` 无缓存；`listPapers` 读路径写 + 重复子查询块；手机竖屏渲染两套首页 DOM 并请求不显示的 `/study-todos`；单词本 `SELECT *` + 全量出现记录；每次评分重跑全量到期集 | 源码事实，均有行号证据。合计会明显加重主线程与单连接排队，但按实测每项都是毫秒级 |
| 需要继续验证的候选主因 | 冷启动 3.85 MB 修正清单的 fetch + 全量校验 + 两轮首页刷新；翻译/补缺 worker 与首屏争抢同一条连接；横屏/首页多层 `backdrop-filter` 的 GPU 成本 | 有依据的线索/推断，缺真机分段计时 |
| 本轮排除 | “SQL 太慢”“单词本数据量太大”“题库数据太大” | 已被真机快照实测与双设备对照否定 |

## 4. 未知与限制

- 没有任何真机分段计时：不知道 4.9 秒里 SQL、桥、JSON 解析、主线程投影、Vue 渲染、GPU 合成各占多少。
- `node:sqlite` 与平板 WebView + Capacitor 桥的单插件线程不同，绝对值不能外推。
- 快照是 2026-09-13 的静态状态，不代表卡顿发生瞬间；导出时 WAL/回滚日志状态未知。
- `VITE_BUNDLED_QUESTION_BANK(S)` 是否为发布构建外部注入未确认（仓库内没有 `.env` 定义）。
- 未核对设备上前端包的实际内容（`work/.../tablet-perf/` 下有历史解包产物可对，本轮未做）。
- `styles.css:4110-4126` 所在媒体查询的具体条件本轮未逐字确认（沿用既有记录）。

## 5. 建议的下一步验证（不改代码，按优先级）

1. **先做分段计时，别先改代码**：在冷启动路径上打时间戳——`mount` → 首次 `/startup` 返回 → `android-startup-prepared` 派发 → 第二次 `/startup` 返回 → 首页首个内容帧；单词本：`translation-runs` POST 结束 → 列表返回 → 详情返回 → 首个内容帧。这一项就能判定两轮刷新和 worker 争抢各值多少。
2. **确认 `applyContentWithBackup` 是否真的被跳过**：查设备库 `app_migrations` 里是否有 `content-remediation:2026-09-r3`。有 → 常规启动只付清单 fetch + 校验；没有 → 首启的重活会反复出现，值得单独处理。
3. **量 3.85 MB 清单的代价**：在设备 WebView 里测 `fetch('/content-remediation.json')` + `validateContentManifest()` 的主线程耗时（预期百毫秒级）。
4. **确认 `backdrop-filter` 的占比**：只在平板上做一次对照——临时用开发者选项/注入 CSS 关掉首页与复习路径的 blur，比较帧时间与“评分→下一词”等待。这是判定渲染层主因最省事的一步。
5. **统计单连接排队**：在翻译/补缺 worker 空转与满载两种状态下各测一次冷启动进首页、进单词本，验证队头阻塞假设。
6. 之后再决定修复范围（合并两轮刷新、去掉手机竖屏隐藏树的请求、给 `activeQuestionBankProfileId` 加缓存、`listVocabulary` 减列、`listPapers` 去掉读路径写等），并按 R3 第 11 节“不以前后可比测量之外的推断声称性能改善”的规则汇报。

## 6. 本轮对既定整改路径的影响

本轮是只读审查，**没有改动任何应用代码**，因此不改变 R3 已完成的 R1–R11、F1–F23、N1–N5、O1/O6 各项的实现与验证结论，也不启动独立性能修复。

## 7. 证据入口

- 实测脚本与原始输出：`work/perf-probe.cjs`、`work/perf-tablet.txt`、`work/perf-phone.txt`
- 真机数据库快照：`work/db-export/tablet-export.db`、`work/db-export/phone-export.db`（2026-09-13 导出，含真实用户数据，不得提交）
- 历史测量：`.codex-local/zcode-takeover-20260913/tablet-perf/measurement-and-route.md`（平板评分等待 3.9–6.1 秒、中位 4.9 秒；单词本首屏 5.8 秒；手机未复现）
- 历史容量探针（假数据库，仅供结构对照）：`.codex-local/zcode-takeover-20260913/scale.cjs`、`tablet-perf/scale.json`
- 旧启动性能审查：`docs/context/history/2026-09-startup-performance-review.md`
