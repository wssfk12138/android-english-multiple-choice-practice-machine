# 加载路径治本优化第七轮：评分链路合并、公测本地提交与 1200 词库真机基线（2026-09-17）

本轮在第六轮「按屏裁剪列投影 + 跨桥调用合并」之上，把优化推进到写路径（评分），并首次在 1200 词规模的夹具真机上测出新的主瓶颈。以下结论都有现场证据；未验证项在末节单列。

## 1. 本轮授权与用户决定

| 事项 | 用户决定 | 执行结果 |
| --- | --- | --- |
| 做到哪一步 | 继续治本（评分合并、列表减行不改列、巩固与前台恢复改用复习投影、修 reviewRevision 兜底静默失效） | 已实现并门禁通过 |
| 公测树本轮同步成果是否本地提交 | 本地提交，不推送 | 已提交 `b911517`，未推送 |
| 平板公测库（当时为自测注入夹具） | 恢复备份的 119 旧库 | 已恢复并启动核对，见第 5 节 |

授权范围：正常编辑、定向测试与构建、两树本地提交、docs 更新、ClawBot 通知、公测仓按内测相同文件范围同步并出包、平板真机自测与公测库恢复。**无**推送、发布/8877 通道更新、历史重写、永久删除、整仓覆盖、Windows 树同步授权。

## 2. 代码改动与提交

内测树（Android 开发权威树，未推送）：

| 提交 | 内容 | 规模 |
| --- | --- | --- |
| `779aa3b` | 评分合并为一次原生调用；评分后复习版本兜底字段与后端同字段同顺序；浏览列表改用 `projection=summary`（减行不改列）；到期队列与巩固入口改用 `projection=queue`；清除 `load(options.all)` 死分支与 `listUrl` 的 `limit=all` 特例 | 6 文件，+507 / −118 |
| `07f24de` | `executeSet` 为缺省 `values` 的语句补空数组 | 1 文件，+7 / −1 |

公测树：`b911517`，与内测相同文件范围（6 文件，1113+ / 260−），**未推送**；该树仍有 45 条既有未提交内容，按要求未清理、未回退。

### 2.1 原生 `executeSet` 事实（`@capacitor-community/sqlite@8.1.0`）

读取 `node_modules/@capacitor-community/sqlite/android/src/main/java/com/capacitorjs/plugins/sqlite/SQLite/Database.java`：

- `:445-488` `executeSet(JSArray set, Boolean transaction, String returnMode)`；`:453` 的 `if (transaction)` 是真实判断。
- `:714-723` 只有 `retMode.startsWith("wA")` 且语句含 `RETURNING` 时才回填 `values` → **set 内的 SELECT 恒返回空 `values`**。
- `:486` `finally` 自动回滚。
- JS 包装 `executeSet(set, transaction = true, returnMode = 'no', isSQL92 = true)`（`:674`）。我们传 `transaction=true`。

因此把「读回执」并入同一 set 的方案不成立（拿不到返回值），评分链路改为「读 `reviewState` → 一次 `executeSet` 写入 → 读回执 SELECT」三步，其中第 4 次及之后的桥调用属于下一张卡的详情预读，不在写入路径内。

### 2.2 已作废的旧结论

`vocabulary_entries.contextual_occurrence_key` **不可从 summary 投影裁掉**：`frontend/src/vocabulary-context.ts:107-108` 的守卫 `contextKey && entry.contextual_occurrence_key === contextKey ? entry.contextual_meaning : ''` 依赖它，`frontend/src/platform/android/vocabulary.ts:387-388` 的 summary 分支正是为 `common_meaning` 为空时回落语境释义而调用。NOW 中的旧表述本轮已改写。

## 3. 门禁

| 对象 | 命令 | 结果 |
| --- | --- | --- |
| 内测 | `npm run test:all` | **77 passed / 0 failed** |
| 内测 | `pnpm run build`（含 `vue-tsc --noEmit -p tsconfig.app.json`） | EXIT=0 |
| 内测 | 提交范围 `git diff --check` | EXIT=0 |
| 公测 | `node tests/run-all.mjs` | 71 passed / **10 failed** / 3 skipped |
| 公测 | `pnpm run build` | EXIT=0 |

公测 10 个失败全部是**同步之前既有的落后**，本轮同步没有引入新失败：其中 `vocabulary-manual-edit.mjs` 因公测夹具缺 19 行 `ALTER TABLE` 循环，另 1 个因公测仓未安装 `playwright`。分类依据是逐个核对失败断言与公测夹具差异，不是只看数量。

## 4. 出包与装机

| 通道 | 版本 | versionCode | APK 大小 | SHA-256 |
| --- | --- | ---: | ---: | --- |
| 内测 | `0.1.0-alpha.93` | 93 | 70,180,852 B | `ACCF39DE86F28D7A37062F5B5B926249656F11B448201663FDD893685DE45141` |
| 公测 | `0.1.0-beta.6-test.17` | 121 | 74,617,896 B | `ADB8B773C0073D729AC66CADE9F8232C6ADC2CE4FD28538323FC6A520C6E35D2` |

两包同证书（`b50d155c…`），均已装机启动确认。关键限制：**内测包是 release 且非 debuggable，没有 9229 调试端口**，所以评分链路的桥调用计数只能在公测 debuggable 包上测（两边 6 文件已一致，测量结果可代表改动后的代码）。

## 5. 平板真机结果（HEY2-W09 / Android 14 / 1600x2560 @340dpi / ROTATION_90 横屏）

### 5.1 五场景 1200 词大库基线（`vocab1200-screens.json`）

| 场景 | 可见（中位） | paint | 桥调用 | SQL 中位 | 载荷 |
| --- | ---: | ---: | ---: | ---: | ---: |
| dashboard | 280ms | 299ms | 6 | 405ms | 7,889B |
| vocabulary-list | 336ms | 342ms | 3 | 182ms | 14,768B |
| **vocabulary-due-queue** | **1034ms** | **1060ms** | 3 | **950ms** | **298,086B** |
| wrong-book | 192ms | 200ms | 3 | 70ms | 4,503B |
| model-config | 108ms | 122ms | 2 | 46ms | 6,197B |

对照上一轮 216 词规模（`screens-publictest-after.json`）的 due-queue 352ms / 50,451B，到期队列**按行线性增长**（该夹具 883 条到期词）。夹具由 `make_big_fixture.py` 从已验证可用的 `diag-db.sqlite` 生成：1200 词 / 1700 出现 / 4884 复习 / 883 到期 / 123 条仅语境释义条目 / 14,557,184B。

### 5.2 到期队列根因归因

- 设备端那条列表 SQL（含 `review_count` 子查询与 `is_frequent` CASE）单条 **837ms / 297,003B**。
- PC 侧同一语句仅 **3.6–7.6ms**，序列化 1.4ms（`bench_query.py`）。
- `EXPLAIN QUERY PLAN`：`SEARCH vocabulary_entries USING INDEX idx_vocab_status`、`SEARCH vocabulary_reviews USING COVERING INDEX idx_vocab_reviews_entry`、`USE TEMP B-TREE FOR ORDER BY`。

结论：**瓶颈在 Capacitor 桥把约 297KB 结果传回 JS，不在 SQL 执行，也不是缺索引**。≤500 行分块 + `IntersectionObserver` 增量拉取是目前唯一被证据支持的方向（本轮未实现）。内测树既有注释（`vocabulary.ts:279-283`）也记过同类实测：155 词下裁掉 `lemma/study_status/review_stage/lapse_count` 后 62,478B → 50,373B、96.4ms → 68.3ms。

### 5.3 评分三按钮（`vocab1200-ratings.json`）

六次评分（前 domMs / 后 paintMs）：不认识 151/166、认识 96/136、熟练 58/86、不认识 66/85、认识 55/85、熟练 62/84。

写路径干净：每次评分恰好 **3 次桥调用** = 读 `reviewState`（`SELECT id, normalized_term, last_reviewed_at, next_review_at, updated_…`）→ **一次 `executeSet`** → 读回执（同 SQL）。上一轮 216 词基线（`fixed-visible-ratings.json`）是 **12 次桥调用、单次返回 239,693 字符**，合并后写路径调用次数降到四分之一。

### 5.4 前台恢复（`vocab1200-resume.json`）

2 次 hidden→visible 事件：**firstCallMs = 7ms**，稳定可见 310ms / paint 326ms，桥调用 2 次，bridgeMs 117ms，载荷仅 **26B**。两次调用都是 `SELECT value FROM app_settings WHERE key = ?`（74ms、43ms），说明回到可见态时**没有重读整个到期队列**，与「前台恢复改用复习投影」的预期一致。

探针踩过两个坑，已修在 `device-0917b.mjs`：`am start -n <pkg>/.MainActivity` 不生效，必须写全 `pkg/com.wssfk.englishpracticemachine.MainActivity`；绝对时间判断（`performance.now() > 60000`）会在注入瞬间误判，必须用相对基准 `armed = performance.now()`。

### 5.5 平板公测库恢复 119 旧库

- 源：`.codex-local/self-test-0917/publictest-119-db.sqlite`，7,720,960B，SHA-256 `229D9AF16422CA7FC99DCF537424776F4F5341B7C1FACE5228B9ECEB5CCE5009`，`pragma integrity_check` = ok。
- 内容核对：questions 1525、question_ai_labels 1525、content_remediation_receipts 65、question_bank_packages 2、papers 34、units 203、options 6585，`vocabulary_entries` / `vocabulary_reviews` / 各类 practice 表均为 0（旧库无学习进度）。
- 流程：`am force-stop` → push 到 `/data/local/tmp` → `run-as … sh -c 'cat … > databases/english_practice_machineSQLite.db'`（无 `-wal`/`-shm` 残留）。
- 校验：PC MD5 `A7BE0D3C8DACF12E6AFD8BA85B68C82D` 与设备 `md5sum` 一致；启动后首页恢复为 18 套试卷 / 107 篇 / 805 道客观题、「待复习词汇 0」，1200 词夹具数据已清除。

## 6. 未完成与未验证

- 到期队列分块增量拉取：未实现（本轮未获授权）。
- 1000+ 词规模的内测包评分延迟：**无法测量**，内测包非 debuggable，缺少调试端口。
- 内测升级后首次进单词本显示 0 条：现象未复现亦未定位，本轮不纠缠。
- 横屏下 3 处 `backdrop-filter: blur()`（`frontend/src/styles.css` 的 `.review-overlay` 13px、`.practice-top` 15px、`.practice-footer` 15px/16px）：未测。
- `lan-sync.ts:168/186/217` 外部写活跃题库键不在 `question-bank-profiles` 缓存契约内：未查。

## 7. 证据位置与本轮工具

全部在本树 `.codex-local/self-test-0917/`：`make_big_fixture.py`（生成 ≥1000 词确定性夹具）、`bench_query.py`（PC 侧同语句成本拆解 + EXPLAIN QUERY PLAN）、`indexes.py` / `dbstat.py` / `schema.py`、`summarize.py`（五场景 JSON 摘要）、`device-0917b.mjs`（评分三按钮 / 前台恢复 / review 准备探针）、结果 `vocab1200-screens.json`、`vocab1200-ratings.json`、`vocab1200-resume.json`、日志 `ratings-0917b.log`、`resume-0917b.log`。

工程化技能基线报告：`docs/context/history/2026-09-17-load-surfaces-round7-baseline.md`（基线名 `load-surfaces-0917b`，创建于改动前，故报告范围同时包含本轮构建产物与文档变化）。

## 8. 已排除路线（勿重复投入）

`homeVocabulary` 排序改写、hoisting active/submitted session、去掉 `review_count` 子查询（PC 侧仅省 0.6ms）、`papers` 两列改 `json_object`、`queue/tuple-json`、`queue/keys-only`、`items/nested-in(rewrite)`、`vocabularyProfileCondition` 改写、summary 裁 `contextual_occurrence_key`（本轮作废）、到期队列再裁 `normalized_term/phonetic/last_result/created_at`（测试与 `reconcileDueQueue`/`wordKey` 依赖）。
