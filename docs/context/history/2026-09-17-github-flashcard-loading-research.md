# GitHub 同类项目「单词本列表加载 / 切卡」深度调研（2026-09-17）

本轮任务：在动手治本前，先把 GitHub 上同类（单词本、闪卡、间隔重复、词汇练习）高 star 项目的**列表加载与切卡逻辑**翻一遍源码，弄清它们怎么控制一次搬多少数据、什么时候取当前卡，再把结论用回英语刷题机 Android 端「到期队列加载慢」。检索与取证全部可复现，命令见第 7 节；未逐行读过的仓库和未验证项在第 6 节单列。

结论先说三句：

1. 同类项目**没有一个是把整条到期队列一次搬给界面的**。要么 SQL 带 `LIMIT`（Anki `fetch_limit`、Lute `LIMIT start, length`、mnemosyne `limit=50`），要么只把当前卡与邻卡送进内存或渲染（qiyan 单卡按需、orbit 只渲染 3 张）。
2. 分页位置的共识是**下推到 SQL、总数单独算**；前端切片分页只出现在数据本来就整表读进内存的小体量实现里（WordFlow 20 条一页、UnlearnableWord 10 条一页）。
3. 本项目的瓶颈不在 SQL（PC 上同一条 SQL 3.6–7.6 ms，索引已命中），而在 **Capacitor 桥回传 298,086 B**；因此方案应是「SQL 下推 + 只搬当前屏 + 清单载荷裁剪」，也就是把 Lute、qiyan、Anki 三家的做法合并使用。

## 1. 检索方法与可复现命令

检索用 GitHub Search API（`search/repositories`），按主题标签加 `stars:` 阈值，再加中英文关键词组合，共六轮 102 条查询：

| 脚本 | 查询条数（脚本内 `stars:` 计数） | 侧重点 |
| --- | --- | --- |
| `.codex-local/self-test-0917/gh_search.py` | 12 | 起步：flashcard、spaced-repetition、srs、vocabulary |
| `.codex-local/self-test-0917/gh_search2.py` | 14 | 学习工具、语言学习、记忆类 |
| `.codex-local/self-test-0917/gh_search3.py` | 16 | wordbook、vocabulary-builder、闪卡 Web 与移动端 |
| `.codex-local/self-test-0917/gh_search4.py` | 22 | 中文关键词：单词本、生词本、词库、词书、艾宾浩斯、记忆曲线、背单词 |
| `.codex-local/self-test-0917/gh_search5.py` | 18 | 小程序与云函数、Dart/Flutter、Kotlin、C# 客户端、Obsidian 插件 |
| `.codex-local/self-test-0917/gh_search6.py` | 20 | 补漏：`topic:srs`、`topic:memorization`、`topic:leitner`、`topic:review-queue`、japanese srs、flashcards react |

去重口径为 `full_name`（owner/repo），结果合并写回 `.codex-local/self-test-0917/gh-stars/repos.json`：首五轮累计 387 条，第六轮补入 60 条新仓库，**最终 447 条唯一仓库**（每条含 stars、语言、最后推送时间、是否归档、描述）。清单里保留了「描述提到 Anki 但主题无关」的仓库（例如 370,462★ 的 `donnemartin/system-design-primer`），目的是让覆盖率可核查，而不是只留看起来像的。

逐个仓库源码取证的方式：用 `.codex-local/self-test-0917/ghdl.py` 把候选仓库的 GitHub tarball 下载到 `E:/_codex_ghsrc/`（**46 个归档**），再用 `.codex-local/self-test-0917/ghsrc.py`（`ls` / `cat` / `range` / `grep`）在不落盘解包的情况下定位文件与行号；随后用 `.codex-local/self-test-0917/ghdigest.py` 对全部归档跑一遍关键词摘要（`gh-digest.txt`，609 行），保证「筛掉」也基于命中事实而不是印象。

复查命令（Windows PowerShell，在仓库根执行）：

```powershell
$env:PYTHONIOENCODING='utf-8'
python -c "import json;d=json.load(open(r'.codex-local/self-test-0917/gh-stars/repos.json',encoding='utf-8'));print(len(d))"
python .codex-local/self-test-0917/ghsrc.py grep LuteOrg__lute-v3 'LIMIT'
python .codex-local/self-test-0917/ghsrc.py grep Liuhanlin23__qiyan 'intersperse'
python .codex-local/self-test-0917/verify_cites.py
```

最后一条 `verify_cites.py` 是本次为写报告新建的批量校验脚本，把第 3 节的每一条「文件:行」重新 grep 一遍；下文所有行号都以它的输出为准（个别与上一轮笔记不一致的行号已按实测修正）。

## 2. 覆盖面与筛查结论

447 条按处理深度分三档；完整清单见同目录 `2026-09-17-github-flashcard-research-repos.md`（逐条列出仓库、star 数、语言、处理档位与描述，由 `gh-stars/repos.json` 生成，可脚本复查）。

| 档位 | 数量 | 判定依据 |
| --- | --- | --- |
| A：已下载归档并逐文件取证 | 归档 46 个，其中 31 个作为同类证据引用，15 个取证后判定无借鉴价值（见 3.5 节） | 与本项目同构（单词本或闪卡客户端、SRS 调度器、复习队列） |
| B：同类候选但仅摘要筛查 | 138 | 名称或描述开头命中词汇、闪卡、间隔重复主题，形态差异大（网站后端、浏览器插件、命令行工具），未逐文件读 |
| C：主题不符或经取证排除 | 278 | 检索误召（描述在非主题位置提到 flashcard 或词库，本体不是单词本），或已归档但经取证无列表加载逻辑 |

46 个归档里，本次被引用的关键文件见第 3 节；以下是主要归档与取证入口：

| 仓库 | stars | 语言 | 本次引用到的关键文件 |
| --- | --- | --- | --- |
| ankitects/anki | 24k+ | Rust/Python | `rslib/src/scheduler/queue/mod.rs`、`pylib/anki/scheduler/v3.py` |
| ankidroid/Anki-Android | 11k+ | Kotlin/Java | `libanki/.../sched/Scheduler.kt`、`provider/CardContentProvider.kt` |
| LuteOrg/lute-v3 | 1558 | Python | `lute/utils/data_tables.py`、`lute/term/datatables.py`、`lute/term/model.py` |
| RealKai42/qwerty-learner | 高 | TypeScript | `src/constants/index.ts`、`pages/Typing/hooks/useWordList.ts` |
| zyronon/TypeWords | 高 | Vue/TS | `app/components/list/BaseList.vue`、`app/base/Pagination.vue` |
| Liuhanlin23/qiyan | 32 | TypeScript | `src/renderer/src/wordbook/scheduler/queue.ts`、`pages/word-book/study/index.tsx` |
| andymatuschak/orbit | 高 | TypeScript | `packages/core/src/reviewQueue.ts`、`packages/app/src/reviewSessionManager.ts`、`packages/ui/src/components/ReviewArea.tsx` |
| mnemosyne-proj/mnemosyne | 高 | Python | `mnemosyne/libmnemosyne/schedulers/SM2_mnemosyne.py` |
| tema6120/ForgetMeNot | 高 | Kotlin | `domain/interactor/exercise/CardFilterForExercise.kt` |
| tangshimin/MuJing | 高 | Kotlin | `fsrs/LearningSessionManager.kt` |
| lakesare/memcode | 高 | JS | `frontend/pages/courses_id_review/components/WhatsNext/index.js` |
| TBS1996/speki | 509 | Rust/Tauri | `src/utils/sql/fetch/cards.rs` |
| mengxi-ream/read-frog | 9712 | TypeScript | `entrypoints/options/.../glossary-review-dialog.tsx` |
| lzskyline/VocabMeld | 448 | JS | `js/content.js` |
| Doublevil/Houhou-SRS | 158 | C#/WPF | `Kanji.Interface/ViewModels/Partial/Settings/Controls/SettingVocabPerPageViewModel.cs` |
| VienDinhCom/supermemo | 338 | — | 归档 0 MB，仓库无可用内容，未取证 |
| Mint-green/UnlearnableWord | 158 | 小程序/云函数 | `cloudfunctions/statisticRouter/index.js` |
| lczmx/MemoryCard | 35 | FastAPI+Vue | `app/dependencies/queryParams.py`、`app/api/cards.py` |
| mikufoxxx/WordFlow | 45 | Dart | `lib/pages/library_page.dart` |
| lyming99/english | 111 | Dart | `lib/dao/word/word.dart` |
| FreeLanguageTools/vocabsieve | 高 | Python/Qt | `vocabsieve/ui/word_marking_dialog.py` |
| subconcept-labs/ulangi | 高 | TS | `sagas/VocabularySaga.ts`、`ulangi-local-database/src/models/VocabularyModel.ts` |
| SteveSuv/remix-words-funny | 高 | Remix | `app/.server/router/loader/getDoneWordsOfBook.ts` |
| st3v3nmw/obsidian-spaced-repetition | 高 | TypeScript | `src/data/data-structures/deck/deck-tree-iterator.ts` |
| tristcoil/hanabira.org | 高 | TS/Python | `frontend-next/src/components/ComplexFlashcardModalVocabFlask.tsx` |
| Uahh/ToastFish | 高 | C# | `Model/SqliteControl/Select.cs` |
| baturyilmaz/wordpecker-app | 高 | TypeScript | `backend/src/api/learn/routes.ts` |
| 其余 18 个归档（Ciyu、MissBao、carden、miemie、jidoujisho、LibreLingo、LinguaCafe、scholarsome、wordai、BallBall-Words、MemoryAssistInPython、collins_high_frequency_vocabulary、kajweb/dict、nagisanzenin/engram、Yvee1/hascard、Benature/WordReview、syt0r/Kanji-Dojo 等） | — | — | 排除理由见第 3.5 节 |

## 3. 源码证据：同类项目怎么加载列表、怎么切卡

### 3.1 队列物化：一次到底取多少

| 项目 | 证据（文件:行） | 事实 |
| --- | --- | --- |
| Anki（Rust 核心） | `rslib/src/scheduler/queue/mod.rs:92,104` | `fetch_limit: usize` 参数，取卡时 `queues.iter().take(fetch_limit)`——一次取多少由调用方给，核心不一次给全 |
| Anki（Python 包装） | `pylib/anki/scheduler/v3.py:51,56` | `fetch_limit: int = 1`，默认**一次只要 1 张** |
| AnkiDroid | `libanki/src/main/java/com/ichi2/anki/libanki/sched/Scheduler.kt:128` | `getQueuedCards(fetchLimit = 1, intradayLearningOnly = false)` |
| mnemosyne | `mnemosyne/libmnemosyne/schedulers/SM2_mnemosyne.py:182` | `... sort_key=sort_key, limit=50)`——一次最多追加 50 个 id |
| mnemosyne（在手限量） | 同上 `:194-204` | `limit = self.config()` 的 `non_memorised_cards_in_hand`，队列里未背熟的卡另设上限 |
| ForgetMeNot | `domain/interactor/exercise/CardFilterForExercise.kt:8,13,28` | `limit: Int`（`:13` 注释 `-1 means no limit`），**默认 `limit = 100`** |
| MuJing | `fsrs/LearningSessionManager.kt:31,32,39,44` | `maxNewCards: Int = 10`、`maxReviewCards: Int = 50`，随后 `.take(maxReviewCards)` 与 `.take(maxNewCards)` |
| orbit | `packages/core/src/reviewQueue.ts:12,28` | `maximumQueueSize = defaultReviewSessionMaximumQueueSize`，返回 `reviewItems.slice(0, maximumQueueSize)` |
| memcode | `.../WhatsNext/index.js:87` | `[...toReview, ...toLearn, ...reviewNext].slice(0, 20)` |
| speki | `src/utils/sql/fetch/cards.rs:130` | 搜索查询硬顶 `... LIMIT 50` |
| qiyan | `wordbook/scheduler/queue.ts:58,65` 与 `:91,92` | `selectNew`：按加入序 `orderBy(joinTime, dictId).limit(limit)`；`selectReview`：`orderBy(reviewBucketDesc(nd), random()).limit(limit)`——**先排序后 LIMIT** |

读法上的一致点：到期队列是「需要多少张就取多少张」的查询，不是「一次查出全部再在前端切」。Anki 家族甚至默认一次 1 张（`fetch_limit = 1`），因为切卡时还会再要下一张。

### 3.2 列表分页：SQL 下推与前端切片

| 项目 | 证据（文件:行） | 事实 |
| --- | --- | --- |
| Lute v3 | `lute/utils/data_tables.py:199-210` | `start`、`length` 取自请求参数，数据 SQL 为 `SELECT * FROM (select * from {realbase} {where} {orderby} LIMIT {start}, {length}) src {orderby}`；同一函数另给 `recordsTotal: select count(*) from {realbase}` 与 `recordsFiltered: ... {where}`——**分页下推 SQL，总数单独算** |
| TypeWords | `app/components/list/BaseList.vue:32`、`app/base/Pagination.vue:16-17` | 列表 `const limit = 200`；分页组件 `pageSize: 10`，`pageSizes: [10,20,30,40,50,100]` |
| WordFlow | `lib/pages/library_page.dart:114,882-887` | `_pageSize = 20`，`startIndex = _currentPage * _pageSize` 后 `sublist(startIndex, endIndex)`——内存分页（数据本就在内存） |
| UnlearnableWord | `cloudfunctions/statisticRouter/index.js:125,253-254,304` | 云函数 `db.collection('word_book').skip(i * 10).limit(10)`——10 条一页 |
| MemoryCard | `app/dependencies/queryParams.py:11-13`、`app/api/cards.py:38` | `limit: int = Query(10, ge=0, le=50)` 加 `offset`，查询 `cards_query.limit(...).offset(...).all()`——**服务端把 limit 硬顶 50** |
| vocabsieve | `vocabsieve/ui/word_marking_dialog.py:102-109` | `self.page_size = ROWS * COLS`，只为当前页建控件 |
| ulangi | `packages/ulangi-saga/src/sagas/VocabularySaga.ts:73`、`packages/ulangi-local-database/src/models/VocabularyModel.ts:114` | 查询走 `config.vocabulary.fetchLimit`，模型层签名带 `limit`、`offset` 并进 SQL |
| remix-words-funny | `app/.server/router/loader/getDoneWordsOfBook.ts:19-20,35-36` | 查询用 `limit` 与 `offset` 占位符，loader 里 `offset: PAGE_SIZE * cursor`、`limit: PAGE_SIZE` |
| Houhou-SRS | `.../SettingVocabPerPageViewModel.cs:22,41` | 每页词数做成**用户可配设置** `EntriesPerPage`，持久化到 `Settings.Default.VocabPerPage` |
| lyming99/english | `lib/dao/word/word.dart:22,38` | DAO 层查询一律带 `limit :count` |
| qwerty-learner | `src/constants/index.ts:3` | `CHAPTER_LENGTH = 20`——每次练习只发一章 |
| 反面：ToastFish | `Model/SqliteControl/Select.cs:240` | 拼 `select * from` 加表名整表查询后再 `foreach` 全表建卡——整表读入，无分页 |
| 反面：wordpecker | `backend/src/api/learn/routes.ts:25` | `.slice(0, 5)` 固定取 5 条，且没有分页参数，取不全也没有续取入口 |

结论：数据量上到真实用户词库量级（本项目 1200 词夹具、真实库同量级）时，同类项目一律把分页信息带进查询；只有数据本来就在内存里的实现才在前端切片。

### 3.3 切卡与渲染：只送当前卡，最多再送邻卡

| 项目 | 证据（文件:行） | 事实 |
| --- | --- | --- |
| qiyan（与本项目最同构） | `src/renderer/src/wordbook/scheduler/queue.ts:125,289`、`pages/word-book/study/index.tsx` 的 `advance()` | 建队只算 id 序（`intersperse(reviewQ, newQ)` 均匀穿插），**切卡时按 id 单卡查询 `loadStudyCard(dictId)`**，缺行则 `skipCard` 后继续，没有整队重读 |
| orbit（渲染） | `packages/ui/src/components/ReviewArea.tsx:130,133,150` | `maximumCardsToRender = 3`，`.slice(0, maximumCardsToRender)`——**最多只挂 3 张卡到 DOM** |
| orbit（队列操作） | `packages/app/src/reviewSessionManager.ts:117,121,252-280` | 出队与回插都用 `slice(0, index)` 配合 `slice(index + 1)` 拼新数组，内存里只保留当前窗口 |
| read-frog | `entrypoints/options/.../glossary-review-dialog.tsx:30,110` | `MAX_LISTED_CONFLICTS = 100`，渲染时 `conflicts.slice(0, MAX_LISTED_CONFLICTS)` |
| hanabira.org | `ComplexFlashcardModalVocabFlask.tsx:447` | `sentences.slice(0, 2)`，需要时再增量扩窗 |
| VocabMeld | `js/content.js:552,567,798,894` | `MAX_SEGMENTS_PER_BATCH = 20`、每段最多 8 处替换、`filteredCached.slice(0, maxReplacements)`——批处理窗口常量 |
| obsidian-spaced-repetition | `src/data/data-structures/deck/deck-tree-iterator.ts:20,34,74` | 用**游标迭代器**（`IIteratorOrder`、`IDeckTreeIterator`、`SingleDeckIterator`）逐张推进，不做全量队列物化 |
| qiyan（计数） | `wordbook/scheduler/queue.ts` 的 `StudySession` 与 `counts()` | 新卡、复习、提前三档计数从会话内存派生，切卡时 0 次 SQL |

### 3.4 归纳：六条被反复验证的做法

1. 查询带 `LIMIT`（含分页 `start` / `length`），总数与筛选后总数单独用 `count(*)` 算，Lute 是完整范例。
2. 队列只物化「当前窗口 + 少量前瞻」，不是整队（Anki `fetch_limit`、orbit `maximumQueueSize`、MuJing `take(50)`）。
3. 切卡时按 id 单卡拉详情，清单与详情分离（qiyan 的 `advance()` 到 `loadStudyCard`）。
4. 渲染只挂当前卡与邻卡（orbit `maximumCardsToRender = 3`、hanabira 增量扩窗）。
5. 计数由会话或清单派生，避免为计数再跑一遍重查询（qiyan `counts()`）。
6. 每页或每批大小是显式常量或用户设置（Houhou-SRS `EntriesPerPage`、TypeWords `pageSize`、WordFlow `_pageSize = 20`），不随数据增长而变。

### 3.5 判定「无借鉴价值」的仓库与理由

逐个给理由，避免只写筛掉却没说为什么：

| 仓库 | 理由 |
| --- | --- |
| Benature/WordReview | 命中的只有 `bootstrap-select.js` 与 echarts 压缩包里的 `chunkSize`、`offset`（第三方库字符串），自身无列表加载逻辑 |
| airingursb/miemie | 命中项为文案与样式，无分页或队列查询 |
| alyssaxuu/carden | 无查询级分页（卡片数据一次性本地载入） |
| arianneorpilla/jidoujisho | 无 SRS 队列查询证据，命中为动画与布局参数 |
| kantord/LibreLingo | 无单词本列表加载，命中为课程进度模型 |
| simjanos-dev/LinguaCafe | 仅 Vuetify `offset-y` 布局属性命中 |
| hwgilbert16/scholarsome | 仅 `slice(0, 3)` 样式类命中 |
| CiyuTeam/Ciyu | 仅 Flutter 的 `Offset(0, -...)` 绘制命中（`:172` 是装饰偏移） |
| jzxyouok/MissBao、Sniper970119/MemoryAssistInPython、restress/BallBall-Words | 零分页与队列命中 |
| isNeilLin/collins_high_frequency_vocabulary | 仅 `Offset` 绘制命中 |
| senghoo/wordai | 仅 webpack 配置 `limit: 10000`（构建参数，不是数据加载） |
| scriptin/topokanji | 发音与字表工具，无列表分页 |
| somepago/DCR、jven/studyopenings、ahans30/goldfish-loss | 国际象棋、开局库、模型训练，与单词本无关 |
| VienDinhCom/supermemo | 归档 0 MB，仓库无可用内容，无法取证，结论中不引用 |
| syt0r/Kanji-Dojo | tarball 下载 404，**未取证**（不是查过没问题，是没拿到），结论中不引用 |

## 4. 与本项目瓶颈的对照

### 4.1 现场测量（第七轮已固化的事实）

| 观测 | 数值 | 出处 |
| --- | --- | --- |
| PC 上同一条到期队列 SQL | 3.6–7.6 ms | `.codex-local/self-test-0917/bench_query.py` |
| 平板真机 due-queue 总耗时 | 837–963 ms（另一次计量 1034 ms） | `docs/context/history/2026-09-17-load-surfaces-round7.md` |
| 平板真机回传字节 | 298,086 B | 同上 |
| 索引 | `idx_vocab_status` 与 `idx_vocab_reviews_entry` 均命中，仅剩 `USE TEMP B-TREE FOR ORDER BY` | `EXPLAIN QUERY PLAN` |
| 903 行真实到期队列载荷 | A 现状 12 列 396.3 KB（449.4 B 每行）；B 去掉 `review_revision` 后 290.6 KB；C 再去掉 `review_count` 后 275.6 KB；**D 再去掉 `updated_at` 后 244.8 KB（61.8%）** | `.codex-local/self-test-0917/measure-queue-fields.py` |
| JS 侧解析与合并开销 | `JSON.parse` 396 KB 约 1.0 ms、254 KB 约 0.6 ms；`reconcileDueQueue` 3.0 到 0.9 ms；`orderedDueKeys` 0.1 ms | `.codex-local/self-test-0917/bench-queue-client.mjs` |

结论：SQL 与索引不是瓶颈，**跨桥回传 298 KB 加 JSON 序列化才是**；JS 微优化最多值 2 ms，不值得当治本项。

### 4.2 三条可选路线（都能在调研里找到先例）

| 路线 | 先例 | 优点 | 代价与风险 |
| --- | --- | --- | --- |
| ① SQL 排序键下推加 `LIMIT start, length`，返回形状不变 | Lute `data_tables.py:199-210`；Anki `fetch_limit` | 改动最小，随时可回退 | 仍要自己维护已加载到哪，一次只搬一屏 |
| ② 清单只回 id 与排序键，当前卡详情按 id 单取 | qiyan `advance()` 与 `loadStudyCard`；orbit 只渲染 3 张 | 载荷最小，切卡与列表解耦 | 需要详情缓存（本项目 `loadReviewDetail` 与 `ensureReviewDetails` 已就绪） |
| ③ 首屏分页加后台静默补全，保持全局语义 | 无同类先例（同类都接受只加载当前窗口） | 首屏最快，后续语义完整 | 后台仍要搬一次全量，峰值只是被推迟 |

本项目采纳 **① ② ③ 的组合**：清单投影按 3.2 的思路裁到最小（4.1 的 D 档 244.8 KB，降 61.8%），首屏只取一页并用 `IntersectionObserver` 增量加载（复用浏览列表已有的 sentinel 范式，`frontend/src/views/VocabularyView.vue:95,522-527`），当前卡详情走已有的 `loadReviewDetail` 与 `ensureReviewDetails`（`VocabularyView.vue:137-163`），也就是 qiyan 的「清单持 id、详情按需」；`review_revision` 改成标量（见 4.3），清单才可能真正少带字段。

不采纳的做法：前端虚拟滚动（同类只在渲染层做 `slice`，本项目卡在桥而不是 DOM）、JS 微优化（不超过 2 ms）、加索引（已经命中）。

### 4.3 顺带发现的缺陷（本轮一并修）

`frontend/src/views/VocabularyView.vue:55-63` 的 `reviewRevision()` 在前端**兜底重算**版本号时用 `JSON.stringify([normalized_term, last_reviewed_at, next_review_at, updated_at, review_count || 0])`，而清单投影 `projection=queue`（`frontend/src/platform/android/vocabulary.ts:284-288`）已经把列裁到 10 列。一旦清单不再带回 `review_count` 或 `updated_at`，这个兜底算出的版本号与后端 `reviewRevision(entry)`（`vocabulary.ts:151-153`）就会**静默不一致**，表现为评分时 `expected_revision` 对不上，进而触发多余的整队刷新。改成标量版本号（后端直接返回单调值），前端兜底按同一口径算，才能既省字节又不出错。这是同类项目「清单与详情同源」做法的必要配套。

## 5. 据此修订的实施方案

| 层 | 改动 | 依据 |
| --- | --- | --- |
| L1 | `review_revision` 由 JSON 数组字符串改为标量（后端生成，清单与详情同值），前端兜底同步改口径 | 4.3；qiyan 清单与详情同源 |
| L2 | 清单投影裁到最小必要列，保留 id、排序键与版本所需字段 | 4.1 的 D 档 244.8 KB |
| L3 | 到期队列首屏分块：SQL 下推 `LIMIT` 与 `OFFSET`，`IntersectionObserver` 增量加载，当前卡详情按需 | 3.1、3.2、3.3；Lute `LIMIT start, length`、qiyan 单卡按需、Anki `fetch_limit` |

同步修改的测试契约（改投影与分页必然触及，属于同一改动范围）：

| 测试 | 需要同步的断言 |
| --- | --- |
| `frontend/tests/android-read-path-latency.mjs` | `:169-173` 清单 13 字段、`:174-189` 禁用列表、`:185-186` 调用计数、`:193` 字节比、`:198-199` 版本一致 |
| `frontend/tests/vocabulary-review-refresh.mjs` | `:10-11` 函数名白名单、`:102` 队列 URL 形状、`:112` 详情预取顺序 |
| `frontend/tests/vocabulary-review-revision.mjs` | `:71-82`（summary 投影不得带版本号）、`:128-135` 回执版本一致 |

回退方式：改动只涉及源码与测试，无数据库结构变更、无数据迁移；两树各自本地提交，需要时可回到 `905b70a`（内测）与 `b911517`（公测）。

## 6. 未验证与风险

1. **B 档仓库只做了摘要筛查**（`gh-digest.txt` 关键词命中加描述判定），未逐文件读；A 档 46 个里，除 3.5 节列出理由的仓库与 `supermemo`（空归档）、`Kanji-Dojo`（404）之外，都读过关键文件。
2. **真机首屏目标小于 200 ms 尚未验证**：本轮实现后要重出内测包，在平板 1200 词夹具上复测，对照 1034 ms 与 298,086 B。
3. 分块后「剩余到期总数」的语义依赖 `listVocabulary` 的 counts（`frontend/src/platform/android/vocabulary.ts:339-350`）；若分页参数缺省处理不当，会出现首屏计数与总队列不一致，实现时用测试锁住。
4. `contextual_occurrence_key` **不能裁**：`frontend/src/vocabulary-context.ts:103-108` 的 `projectVocabulary` 用它做上下文守卫，summary 投影必须保留，已有断言在 `android-read-path-latency.mjs:259-261`。
5. `supermemo` 与 `Kanji-Dojo` 两个仓库无有效取证，本报告结论不引用它们。

## 7. 产物与复查命令

| 产物 | 路径 |
| --- | --- |
| 447 条检索清单（机器可读） | `.codex-local/self-test-0917/gh-stars/repos.json` |
| 447 条逐条处理档位（人可读附录） | `docs/context/history/2026-09-17-github-flashcard-research-repos.md` |
| 六轮检索脚本 | `.codex-local/self-test-0917/gh_search.py` 到 `gh_search6.py` |
| 归档下载与离线读取 | `.codex-local/self-test-0917/ghdl.py`、`ghsrc.py`（归档在 `E:/_codex_ghsrc/`，46 个 `.tgz`） |
| 全归档关键词摘要 | `.codex-local/self-test-0917/gh-digest.txt`（609 行） |
| 本报告引用批量复核 | `.codex-local/self-test-0917/verify_cites.py` |

```powershell
$env:PYTHONIOENCODING='utf-8'
python .codex-local/self-test-0917/verify_cites.py
python .codex-local/self-test-0917/ghsrc.py grep ankitects__anki 'fetch_limit'
python .codex-local/self-test-0917/ghsrc.py range LuteOrg__lute-v3 'lute-v3-master/lute/utils/data_tables.py' 199 210 250
```
