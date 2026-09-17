# 加载路径治本优化第八轮：到期队列分页增量加载、复习身份标量化与平板公测库复原（2026-09-17）

第七轮把瓶颈锁定为「Capacitor 桥回传约 297KB 到期队列」，本轮按研究结论把这条路径改成首屏分页 + 后台增量补齐，同时把卡片身份从 JSON 数组压成短标量、把队列投影再裁一列，并在真机上取得 1034ms → 124ms 的对照。全程证据在末节列明；未验证项单列，不当作已通过。

## 1. 本轮授权与用户决定

| 事项 | 用户决定 | 执行结果 |
| --- | --- | --- |
| 做到哪一步 | 按研究方案做 L1 复习版本标量化、L2 队列投影瘦身、L3 首页分页增量加载，并顺手修显而易见的相邻缺陷 | 已实现并门禁通过 |
| 两树成果是否本地提交 | 各自本地提交，不推送 | 已提交，见第 2.5 节 |
| 平板公测库（当时为自测注入 1200 词夹具） | 恢复备份的 119 旧库 | 已复原并核验，见第 5.4 节 |

授权范围：正常编辑、定向测试与构建、两树各自本地提交（不推送）、更新 `docs/context/NOW.md` / `RISKS.md` 与新增 `docs/context/history/*`、ClawBot 微信通知、公测仓按内测相同文件范围同步并出包、平板真机自测、恢复平板公测 119 旧库。**无**推送、发布 / 8877 通道更新、历史重写、永久删除、整仓覆盖、Windows 树同步授权。

## 2. 代码改动与提交

变更集边界精确为 5 个文件，两树 `git diff --stat` 逐项一致（5 files changed, 272 insertions, 39 deletions），五个文件的 SHA-256 已逐个对齐：

| 文件 | 内容 | SHA-256（两树相同） |
| --- | --- | --- |
| `frontend/src/platform/android/vocabulary.ts` | L1 + L2 + SQL 侧排序键 | `CDD56C12579152044CDBF5B1BEBE4E00D81FC2125C6618BC981DD01AF627B1E3` |
| `frontend/src/views/VocabularyView.vue` | L3 + 进度分母修复 | `B0E03FC9FC93F95B8B1CC0CFA3EF8DFD4550DE096A71CF1AA20CCC60F8666691` |
| `frontend/src/vocabulary-due-queue.ts` | `reconcileDueQueue` 增加 `pending` | `241473FC602510758B0FEABD203D92BFFEBCDAD69F3159D392733E7E1EAF549A` |
| `frontend/tests/android-read-path-latency.mjs` | 投影与分母契约断言 | `13A9563D54CAC4A71153945B38B073512FA553FE081DF07E24EFAF4B8D748D6B` |
| `frontend/tests/vocabulary-review-refresh.mjs` | 分页 / 补齐 / 前台复用断言 | `6DE6234445122C5D2BCFA92DC6245E638DACE6B3CFA1F2D0DA34255FF65B4014` |

### 2.1 L1 复习版本标量化（`reviewRevision`）

原先的身份是 `JSON.stringify([normalized_term, last_reviewed_at, next_review_at, updated_at, review_count||0])`，本轮改成用竖线拼接 `review_count`、`last_reviewed_at`、`next_review_at` 三个字段的短标量；`reviewStateColumns` 同步去掉 `normalized_term` 与 `updated_at`，前端兜底改成带上 `wordKey(word)` 的同字段标量。

两个理由都来自实测，不是风格偏好：其一，903 行到期队列里 JSON 数组身份占 **121 B/行**，是这块界面载荷的第一大头；其二，`updated_at` 只是同步与手工编辑的记账列，评分链路从不读回，留在身份里会让「裁掉该列的清单」与「状态读取」算出两个身份，评分被静默判成过期。前端兜底必须带 `wordKey`，否则刷新后换了一张卡也会被当成同一张，揭示状态留在新卡上。

### 2.2 L2 队列投影瘦身（`queueEntryColumns`）

去掉 `updated_at`（903 行实测 **33 B/行**）。`normalized_term`、`phonetic`、`last_result`、`created_at` 与 `review_count` 子查询仍然必须保留：`reconcileDueQueue` 与 `wordKey` 依赖前四者，计数子查询供 `counts` 使用。

### 2.3 L3 首屏分页 + 后台增量补齐

`DUE_FIRST_PAGE = 12`、`DUE_PAGE = 150`，新增 `dueQueueUrl(limit, offset)`、`duePageSignature`、`setScheduledWords`、`applyDueQueue(pending)`、`dueFillWanted`、`finishFill`、`readWholeDueQueue`、`fillDueQueue`、`topUpDueQueue(force)`、`fillDueQueueForRating`。

首屏 URL 由 `limit=all` 变成 `/vocabulary?status=review&limit=12&offset=0&projection=queue`，第二页为 `limit=150&offset=12`。为了让第一页真的是队首那一页，服务端 `listVocabulary` 对 `status=review` 改用与客户端 `reconcileDueQueue` 逐项一致的排序键（未复习在前 → `last_reviewed_at` → `next_review_at` 缺省回落 `created_at` → `lower(normalized_term||term)`），浏览顺序（其余筛选）保持原样。

配套约束（都用测试锁住）：

- 分页只裁清单行，不裁计数：`counts` 必须仍覆盖整个到期集合。
- `reconcileDueQueue(saved, words, now, pending)` 在 `pending` 为真时把还没取到的已存键原样保留，否则每取一页都会先把没取到的词删掉再按到期时间排到队尾。
- 补全让位于评分：`reviewSaving` 为真时后台补全停下，评分自己需要时用 `force` 走 `fillDueQueueForRating`，最多 8 轮，直到「确实取满」而不是「这一轮跑完」。
- 队首签名与 `counts.review` 都没变时沿用已累计的整队，前台恢复不会把队列缩回首屏，也不会打断当前卡。
- 队列没取满时不判「今天复习完」：先 `topUpDueQueue(true)` 补齐，期间显示骨架卡。
- 服务器忽略 `limit`/`offset` 时分别回落到「按整队收尾」与 `readWholeDueQueue`。

### 2.4 顺手修掉的分页显示缺陷（本轮新增）

分页暴露了一个真实缺陷：复习卡抬头的分母原本是 `reviewItems.length`（已取到手的行数）。真机 dump 显示「每日一背 01 / 12」，而 `counts.review` 已是 903——分母会随分块补齐从 12 跳到 150 → 903，评分让出补全通道时还会停在中间值。

改为 `String(reviewKind === 'scheduled' ? displayCount(counts.review) : reviewItems.length)`，并把文件里那段误导注释（「进度分母随队列真实长度增长」）改写为「补全期间下一张卡要能按队列顺序接上」。`android-read-path-latency.mjs` 增加一条源码契约断言（读 `VocabularyView.vue` 文本，必须含上述表达式）。

**注意：这个分母修复不在 alpha.94 包里**，真机当时看到的仍是 `01 / 12`。是否重新出包装机由用户决定。

### 2.5 提交

| 树 | 提交前 HEAD | 本轮提交 | 内容 |
| --- | --- | --- | --- |
| 内测（Android 开发权威树） | `905b70a` | `9162bf7`（5 文件，+272 / −39）+ 紧随其后的第八轮记录提交 | 5 个源码 / 测试文件一次提交；第八轮 history 记录与 `NOW.md` / `RISKS.md` 另一次提交 |
| 公测 | `b911517` | `f5b335e`（5 文件，+272 / −39） | 同范围 5 文件；公测树无 `docs/context` 惯例，未同步内测文档 |

两树均**未推送**；两树都仍有大量既有未提交内容，只按白名单暂存，未清理也未回退既有差异。回退点即上表的提交前 HEAD。

## 3. 门禁

| 对象 | 命令 | 结果 |
| --- | --- | --- |
| 内测 | `node tests/android-read-path-latency.mjs` | PASS（含新增的分母与标量断言） |
| 内测 | `node tests/vocabulary-review-refresh.mjs` | PASS |
| 内测 | `npm run test:all` | **77 passed / 0 failed**（155.5s） |
| 内测 | `pnpm run build`（含 `vue-tsc --noEmit`） | EXIT=0 |
| 公测 | `pnpm run build` | EXIT=0（`built in 4.92s`） |
| 公测 | `node tests/run-all.mjs` | 71 passed / **10 failed** / 3 prereq-skipped（84 total, 37.6s） |

公测的 10 失败 + 3 跳过**与改动前基线逐文件一致**：`faillist.py` 对 16:35 的 `test-all-round4b.log`（改动前）与本次 `pub-tests-r8b.txt` 提取 FAIL/PREREQ 行，两次得到同一份 13 个文件清单（`barcode-scanner-layout`、`import-destination`、`lan-categories`、`lan-s6-ui`、`lan-sync-ai-profiles`、`lan-sync-conflict-atomicity`、`lan-sync-feedback`、`lan-sync-pairing`、`maintenance-routing`、`settings-layout`、`startup-todo-dedup`、`vocabulary-layout`、`vocabulary-manual-edit`）。结论按文件集合核对得出，不是只看失败数量。本轮改动的 `android-read-path-latency`、`vocabulary-review-refresh`、`vocabulary-due-queue`、`vocabulary-review-revision` 在公测树全部 PASS。

## 4. 出包与装机

| 通道 | 版本 | versionCode | APK 大小 | SHA-256 |
| --- | --- | ---: | ---: | --- |
| 内测 | `0.1.0-alpha.94` | 94 | 70,181,737 B | `5B7A05222F9AF7BB87D89CC5A4E80A92BBA5D594B7053A68D4F47A6A95F39C7D` |
| 公测 | `0.1.0-beta.6-test.18` | 122 | 74,618,800 B | `9FF4A7EBDB1A4D687082E7EC2F9214C89DE025093FD6FFCD24ECF33A57B90170` |

内测版本号由 `build-android-internal.ps1 -VersionCode / -VersionName` 参数注入（`gradle.properties` 无 `appVersion*`，`build.gradle:21-22` 读 properties），因此 alpha.94 确实含本轮的 5 文件变更集，但**不含第 2.4 节的分母修复**。平板安装确认：内测 `com.wssfk.englishpracticemachine` code 94 / `0.1.0-alpha.94` / lastUpdate 2026-09-17 20:20:19；公测 `com.wssfk.englishpracticemachine.publictest` code 122 / `0.1.0-beta.6-test.18` / lastUpdate 2026-09-17 20:24:10。

关键限制沿用第七轮：**内测包是 release 且非 debuggable，没有 9229 调试端口**，桥调用计数与写路径测量只能在公测 debuggable 包上做；两树 5 文件已同哈希，测量结果代表同一份代码。

## 5. 平板真机结果（HEY2-W09 / Android 14 / 1600x2560 @340dpi / ROTATION_90 横屏）

### 5.1 五场景对照（同一 1200 词夹具）

夹具：1200 词 / 1700 出现 / 4884 复习 / **903 到期** / 14,557,184 B，由 `make_big_fixture.py` 从已验证可用的 `diag-db.sqlite` 生成（重生成代价低，取证时可随时重建）。

| 场景 | 第七轮基线可见 | 第八轮可见 | paint 基线→现在 | 桥载荷 基线→现在 | 调用数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **vocabulary-due-queue** | **1034 ms** | **124 ms** | 1060 → 151 | **298,086 B → 3,502 B** | 3 → 2 |
| vocabulary-list | 336 ms | 303 ms | 342 → 326 | 14,768 B（不变） | 3 |
| dashboard | 280 ms | 284 ms | 299 → 306 | 7,889 → 7,904 B | 6 |
| wrong-book | 192 ms | 184 ms | 200 → 199 | 4,503 B（不变） | 3 |
| model-config | 108 ms | 97 ms | 122 → 114 | 6,197 B（不变） | 2 |

到期队列四项指标同时下降：可见时间 **1034 → 124 ms**、载荷 **298,086 → 3,502 B**（约 1/85）、桥调用 3 → 2、SQL 950 → 62 ms。研究方案设定的「首屏 < 200 ms」目标达成。

### 5.2 到期队列逐轮明细（`duefix.py`，4 轮）

dump 文本仍显示「每日一背 01 / 12」——这正是第 2.4 节缺陷在已装包上的表现（分母读的是已取到手的第一页行数）。

| 轮次 | visible | paint | 实际桥调用 |
| --- | ---: | ---: | --- |
| 1 | 159 ms | 179 ms | 列表 SQL 62 ms / 3,420 B + counts SQL 10 ms / 82 B |
| 2 | 125 ms | 157 ms | 54 ms / 3,420 B + 11 ms / 82 B |
| 3 | 123 ms | 145 ms | 49 ms / 3,420 B + 11 ms / 82 B |
| 4 | 98 ms | 119 ms | 38 ms / 3,420 B + 11 ms / 82 B |

每一轮都是「首屏分页 SQL（3,420 B）+ counts SQL（82 B）」两次调用——首屏不再回传 903 行，其余分块在后台补齐；四轮里都没出现第二页 150 行的调用，说明测量窗口内首屏已经足够渲染。

### 5.3 行为断言（测试层，非真机）

`vocabulary-review-refresh.mjs` 锁住三条路径：13 条到期队列在 `reviewSaving` 为真时首屏只发 1 次调用并停在第 12 条，`topUpDueQueue(true)` 后第二页 URL 为 `limit=150&offset=12`、补齐后 13 条不重不漏；前台恢复重进复习时队首未变则不发额外整队调用、队列仍为 13 条且不退出复习。`android-read-path-latency.mjs` 断言 `review_revision` 不以 `[` 开头且长度 ≤ 64、分页不改 `counts`、`limit=1&offset=1` 能续读到第 2 行。

### 5.4 平板公测库复原为 119 旧库

- 设备 `/data/data/com.wssfk.englishpracticemachine.publictest/databases/english_practice_machineSQLite.db` = **7,720,960 B**、`md5sum` = **`a7be0d3c8dacf12e6afd8ba85b68c82d`**，与 PC 备份 `.codex-local/self-test-0917/publictest-119-db.sqlite` 的 MD5 完全一致；`databases/` 下无 `-wal`/`-shm` 残留，mtime 2026-09-17 20:42。
- 备份内容核对（`verify119-r8.py`）：`pragma integrity_check` = ok，questions 1525 / options 6585 / units 203 / papers 34 / question_bank_packages 2，`vocabulary_entries` 与 `vocabulary_reviews` 均为 0（旧库无学习进度）。
- 启动后首页（`r8-pt119-home.xml`）：**107 篇 / 18 套 / 805 道客观题**、待复习词汇 0、「暂无到期词汇」「暂无高频错题」，1200 词夹具数据已清除。

## 6. 未完成与未验证

- **已装包不含分母修复**：alpha.94 与 beta.6-test.18 仍是 `01 / 12`；是否重出 alpha.95 由用户决定。
- 1000+ 词规模的内测包桥调用与评分延迟：**无法测量**，内测包非 debuggable。
- 内测升级后首次进单词本显示 0 条：现象未复现亦未定位，本轮不纠缠（排查范围需单独授权）。
- 横屏下 3 处 `backdrop-filter: blur()`（`frontend/src/styles.css` 的 `.review-overlay` 13px、`.practice-top` 15px、`.practice-footer` 15px/16px）：未测。
- `lan-sync.ts:168/186/217` 外部写活跃题库键不在 `question-bank-profiles` 缓存契约内：未查。
- 手机本次未改动、未复测。

## 7. 证据位置与本轮工具

全部在本树 `.codex-local/self-test-0917/`：`sumr8.py`（五场景基线 / 修复对照 + 夹具计数）、`duefix.py`（到期队列逐轮明细与桥调用 SQL）、`faillist.py`（FAIL/PREREQ 文件集合对比，用于证明公测失败集未变）、`verify119-r8.py`（119 备份内容核对）、`showxml.py`（UI dump 文本提取）、`measure-publictest.mjs`（5 场景 × 4 轮，插桩 `Capacitor.nativePromise` 取 ms + bytes，只对三个隔离包生效）；结果 `vocab1200-fix.json`、`vocab1200-screens.json`、`r8-pt119-home.xml`；门禁日志 `test-all-r8b.txt`、`build-r8b.txt`、`pub-build-r8b.txt`、`pub-tests-r8b.txt`，公测改动前基线 `.codex-local/test-all-round4b.log`。

研究交付物（本轮已交付）：`docs/context/history/2026-09-17-github-flashcard-loading-research.md`（§5 L1/L2/L3 方案）、`docs/context/history/2026-09-17-github-flashcard-research-repos.md`。方案取证的实现参照：Anki `fetch_limit=1`、AnkiDroid `getQueuedCards(fetchLimit=1)`、Lute `LIMIT start,length` + 独立 `count(*)`、qiyan「列表存 id、详情按 id」、orbit「最多渲染 3 张卡」、mnemosyne `limit=50`、MuJing `take(50)`。

## 8. 已排除路线（勿重复投入）

沿用第七轮全部排除项，另加本轮作废：JSON 数组形式的 `reviewRevision`（改为短标量）、队列投影保留 `updated_at`（实测 33 B/行且评分链路不读回）、`reconcileDueQueue(saved, words, now)` 旧签名（分页下会把没取到的词排到队尾）、用 `reviewItems.length` 当复习进度分母、把 `counts` 也按页裁剪。
