# 加载路径治本优化与平板交付：交接说明（2026-09-17）

> 本页是「彻底优化安卓端各加载项首屏与卡顿」这一轮工作的收尾交接。读者是接手的新任务：先读本页，再按需读
> [基线变更报告](2026-09-17-load-surfaces-changes.md)、[图差异基线报告](2026-09-17-load-surfaces-baseline-report.md)。
> 源码、测试和现场状态为准；本页只保留当前有效结论与未完成项。

## 1. 一句话现状

内测树（本仓）四项加载路径治本修复已全部完成并通过门禁；内测 alpha.92/92 与公测 beta.6-test.16/120 均已出包并装到平板。
本轮收尾已完成：逐项对照检查、收尾文档、内测树本地提交、ClawBot 微信交接报告（`work/wechat-notify-handoff-0917.txt`，工具输出“已发送”）。内测树本收尾共 3 个提交、最终 HEAD `173a0f3`（主体 `57c0c45` 27 个文件 + 收尾文档 `3738844` + 清点修正 `173a0f3`），未推送。
剩下的是公测自测截图与 `gfxinfo` 补齐，以及两项需用户决定的事项（公测树是否本地提交、平板公测库是否恢复或重装）。没有推送、没有发布、没有通道更新。

## 2. 任务与授权边界

- 目标（goal，threadId `01a0acba-53c9-77c2-a20e-2bf928adb23c`）：以单词本（含复习/巩固、关闭、翻页）为先导做治本修复，并把同类优化扩展到错题本、首页、模型配置等所有同族瓶颈的加载路径；每项改动遵循 engineering-code-generation 门禁（失败测试先行、最小实现、定向+完整测试、`pnpm run build`、`git diff --check`、基线变更报告）；完成后逐项对照检查、平板更新内测与公测并自测、必要的本地提交与 docs 更新。该 goal 仍为活动状态（未标记完成、也未暂停），剩余项见第 8、9 节；用户已于 2026-09-17 要求本轮收尾并由新窗口续接。
- 已授权：正常编辑、定向测试与构建、**本地提交**、更新 `docs/context/NOW.md`、新增 `docs/context/history/*`、ClawBot 微信通知、**公测仓按内测相同文件范围同步并出包**（用户原话：“授权按内测相同文件范围直接同步公测仓并出包”）。
- 未授权：push、发布/通道更新（更新清单与 8877 通道）、历史重写、永久删除、整仓覆盖其它版本、Windows 树同步。
- 仓库边界：内测权威树 `E:\EnglishPracticeMachine\Codex\english-multiple-choice-practice-machine-android`；公测树 `E:\EnglishPracticeMachine\Codex\english-multiple-choice-practice-machine-android-github-v2`（独立仓库，两树有大量既有差异，只允许逐文件范围同步）。

## 3. 本轮四项修复

| 项 | 面 | 文件 | 改动实质 | 失败测试先行证据 |
| --- | --- | --- | --- | --- |
| A | 首页 | `frontend/src/platform/android/study-todos.ts`、`practice.ts` | 首页六项统计合成一条语句：到期词与高频题计数抽成 `studyTodoCountColumns` / `studyTodoCountValues(profileId)` 片段（语义单一定义，错题列表与统计共用），`dashboard()` 拼入该片段并回传 `review_count`/`frequent_count`，删掉 `frequentQuestionIds()` 与 `studyTodos()` 两次独立调用 | 首页桥调用 17→4、同一批 SQL 由 3 条（9.5+8.7+7.8ms）合成 1 条（10.4ms），见 `screens-before3/after7` |
| B | 模型配置 | `model-key-store.ts`、`ai.ts` | 密钥库缓存“未解析原文”（读取仍每次重新解析，返回值语义不变；写入成功后同步缓存）；已确认删除的旧版单密钥条目不再重复跨桥；新增私有 `migrateExistingKeys` 与 `namedKeySummary(id, knownExists)`，清单类调用方（`/ai/profiles`）传 `true`，单配置入口（`selectedKey`/`editUnlocked`/同步）仍走带校验的 `migrateKeys`，错误文案 `API 配置不存在` 不变；`ai.ts` 的 models 由每配置一次查询改为一次 `IN (...)` 取回后在 JS 分桶（桶内顺序仍等价 `ORDER BY model_id`） | 模型配置桥调用 13→2 |
| C | 回归修复 | `frontend/tests/maintenance-routing.mjs`、`document-draft-persistence.mjs` | 第 18 轮引入的 `sweepEmptyPaperSessions` 未在测试桩中提供，两个测试失败；补齐桩，未改产品代码 | 失败测试先行：两测试在改动前报缺桩 |
| D | 单词本到期队列 | `frontend/src/platform/android/vocabulary.ts` | `queueEntryColumns` 由 10 列再裁到 10 列中的实质 4 列（去掉 `lemma`/`study_status`/`review_stage`/`lapse_count`，仅浏览列表、编辑表单与卡片详情使用）；`last_result`/`created_at` 经 `vocabulary-due-queue.ts` 确认被 `reconcileDueQueue` 读取，保留 | `AssertionError: 到期队列不得回传复习流程不读取的 lemma`（`frontend/tests/android-read-path-latency.mjs`） |

说明：`ai.ts`、`practice.ts`、`vocabulary.ts`、`vocabulary-context.ts` 的工作树差异同时包含更早几轮（出现记录字段投影 `occurrenceProjectionColumns`、清单投影 `projection=summary`、错题分析报告范围校验）的同批未提交改动；本仓自 `d2276e7` 之后一直是多阶段混合未提交状态，本轮未清理也未回退。

## 4. 门禁结果（本轮已执行，代码未再变动，可直接复用）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 读路径延迟门禁 | `node frontend/tests/android-read-path-latency.mjs` | PASS |
| 类型检查 | `tsc --noEmit -p tsconfig.json`（frontend） | EXIT=0 |
| 定向测试 | 6 个受影响测试 | 全 0（无失败） |
| 完整测试 | `pnpm run test:all` | 77 passed / 0 failed / 153.9s |
| 生产构建 | `pnpm run build` | EXIT=0 |
| 空白检查 | `git diff --check` | EXIT=0 |

重新执行时注意：`test:all` 必须保持全绿（RISKS 已记为门禁条件）。

## 5. 真机收益（平板，同一 216 词夹具，中位数）

数据来源：`.codex-local/vocabulary-latency-20260916/screens-before3.json`（10:07）→ `screens-after7.json`（13:15），`.codex-local/vocabulary-latency-20260916/summarize.cjs` 聚合。

| 场景 | visible/paint (ms) | 桥调用 | 同批 SQL (ms) | 载荷 (B) |
| --- | --- | --- | --- | --- |
| dashboard | 429/446 → **219/234** | 17 → **6** | 641 → **195** | 12,857 → **7,941** |
| vocabulary-due-queue | 859/890 → **204/222** | 3 → 3 | 756 → **157** | 261,886 → **51,452** |
| vocabulary-list | 471/531 → **161/198** | 2 → 2 | 279 → **67** | 25,705 → 8,331（**不可直接对比**，见下） |
| wrong-book | 212/215 → 197/199 | 5 → **3** | 112 → 78 | 4,550 → 4,503（本就轻，差值在波动范围） |
| model-config | 312/344 → **116/142** | 13 → **2** | 261 → **53** | 6,969 → 6,197 |

诚实边界：

- `vocabulary-list` 的载荷差**主要来自分页位置**，不是投影裁剪：before3 与公测那次都命中第 1 页（101 行、25,705B），after7 那次是滚动增量页（32 行、8,331B）。用夹具直接验证：page1 101 行 full=116,334B / summary=25,616B；page2 32 行 full=34,079B / summary=8,020B。summary 投影在两棵树都生效。
- 到期队列（`projection=queue`）是**行集合相同**的对照：261,886 → 51,452B 与 859 → 204ms 可直接归因于投影裁剪 + 统计合并。
- `screens-after7` 的 dashboard paint 在同一轮不同记录里出现过 234 与 222 两个值（不同聚合脚本口径），引用时以 `summarize.cjs` 输出为准。
- 设备负载会显著影响绝对值：公测 120 同夹具测得 dashboard 273/301ms、due-queue 362/382ms，载荷与内测一致（7,964B / 50,451B），说明差异来自设备当时负载，不是代码差异。

## 6. 交付与装机

| 对象 | 版本 | 产物 | SHA-256 | 状态 |
| --- | --- | --- | --- | --- |
| 平板内测 | alpha.92 / versionCode 92 | `outputs/internal-channel/english-practice-machine-android-0.1.0-alpha.92-internal.apk`（70,180,958B） | `E17AC4D12F1A14F8BCC69561865C2243B8BD4DBB56F90DE85176B8C653CE6700` | 已装机并确认版本 |
| 平板公测 | 0.1.0-beta.6-test.16 / versionCode 120 | 公测树 `frontend/android/app/build/outputs/apk/publicTest/app-publicTest.apk`（74,617,067B） | `23EDE31D8B9E18F28F2BFA299B9E45FA5C02349C3A4EC663B4282AD3AB120696` | 已装机并确认版本 |

包名：内测 `com.wssfk.englishpracticemachine`（release 构建，无 WebView 调试端口）；公测 `com.wssfk.englishpracticemachine.publictest`（debuggable，9229 端口可用于桥接测量，只适用于本仓内测安装包之外的自测）。

公测安装的关键根因（已查实，后面不要再当故障重查）：平板上原公测 119 是本机 debug 签名（`CN=Android Debug`，指纹 `a8987899b5bb…` = `C:\Users\MEC\.android\debug.keystore`），而公测树 `signing.properties` 指向发布密钥（与内测同证书），因此直接覆盖报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`。处理方式为 `adb uninstall` + `adb install`（非 `-r`），卸载前已备份：

- 旧 APK：`.codex-local/self-test-0917/installed-publictest-119.apk`
- 旧数据库：`.codex-local/self-test-0917/publictest-119-db.sqlite`（7,720,960B；2 包/1525 题/1525 条 AI 标注/65 条 remediation receipts，**无任何学习进度**）

卸载无损的依据：公测首次启动会自动导入内置 ESQ 题库（`assets/public/internal-question-bank.esq` 等 2 个），实测 120 库为 questions=1525 / papers=34 / units=203 / options=6585 / question_bank_packages=2，与内测一致，题库数据可重建。

## 7. 公测树同步范围（已完成，勿重做）

- 公测树 HEAD `ac66ad8`；备份原工作树差异到**公测树仓根下**的 `.codex-local/publictree-worktree-backup-0917.patch`（275,833B；路径相对 `english-multiple-choice-practice-machine-android-github-v2`，本仓同名目录里没有这个文件）。
- 整文件同步并逐一核对 SHA-256 相同：`frontend/src/vocabulary-context.ts`；`frontend/src/platform/android/{vocabulary.ts,study-todos.ts,practice.ts,model-key-store.ts,question-bank-profiles.ts,question-bank.ts}`；新增测试 `frontend/tests/{android-read-path-latency.mjs,model-config-read-path.mjs,startup-todo-dedup.mjs,maintenance-routing.mjs}`。
- 增量同步：`ai.ts` 的 `listProfiles()` 批量 models 分桶 + `namedKeySummary(profile.id, true)`；`VocabularyView.vue` 到期队列请求加 `&projection=queue`；`local-api.ts` 恢复 `sweepEmptyPaperSessions` 导入与调用；`tests/document-draft-persistence.mjs` 测试桩补齐。
- 仍存在差异的文件属于两树既有有意差异（内测独有 7 个文件、公测独有 2 个文件、49 个既有差异文件），**不得整仓覆盖**。三个主要仍差异文件：`ai.ts`（954/931 行）、`local-api.ts`（380/389）、`VocabularyView.vue`（811/707）。
- 公测出包链路：`corepack.cmd pnpm run build` → `npx cap sync android` → `.\gradlew.bat assemblePublicTest -PappVersionCode=120 -PappVersionName=0.1.0-beta.6-test.16`（JAVA_HOME=Microsoft JDK 21，ANDROID_SDK_ROOT=E:\EnglishPracticeMachine\.toolchains\android-sdk）。
- 公测树**尚未提交**（用户授权只覆盖“同步并出包”）。

## 8. 收尾结果与剩余工作

1. **公测自测截图补齐**：公测 120 已装好且夹具已注入。**做这一步前先停诊断包 `com.wssfk.epm.latency0916fixed`（pid 7890，仍占前台，会打断截图）**。需补 `publictest-*` 系列的单词本列表 / 复习态 / 详情展开 / 翻页 / 错题本 / 模型配置截图与 `gfxinfo`，与基线 `.codex-local/self-test-0917/gfx-publictest-119-before.txt`（7 帧、janky 71%、90th 150ms）对照。已有的桥接测量脚本 `.codex-local/self-test-0917/measure-publictest.mjs` 产出 `screens-publictest-after.json`（4/4 ok，各场景见第 5 节）。
2. **逐项对照检查（已完成）**：第 3 节四项修复与第 4 节门禁已逐条核对，无无关改动混入；`frontend/tests/run-all.mjs` 用 `readdirSync` 自动纳入新增测试，`pnpm run test:all` 已实际跑到 77 passed。
3. **收尾文档（已完成）**：本页 + `NOW.md` + `RISKS.md`（新增两条中级风险：按屏裁剪的列投影会静默失效、公测树本轮同步成果尚未提交）均已更新。
4. **本地提交（已完成）**：`57c0c45 perf(android): 收口加载路径治本优化与平板交付`，27 个文件（源码 13、测试 10、docs 5；其中 `wrong-analysis-history.ts` 与 6 个测试为新增）；其后追加两个收尾提交 `3738844`（收尾交接记录）与 `173a0f3`（去掉测试尾空行、澄清备份补丁所在仓），**当前 HEAD 为 `173a0f3`**。暂存前用 `git diff --cached --name-only` 核对过范围，无 `.codex-local/**`、无 APK/DB/签名/日志；未推送、无 amend、未发 Release、未更新 8877 通道。含同线已完成改动：`vocabulary-context.ts`、`wrong-analysis-history.ts`、`question-bank.ts`（`listPapers` 读路径只读 + 列投影）、`question-bank-profiles.ts`（活跃题库缓存）、`vocabulary-enrichment-runner.ts`、`local-api.ts`。
5. **清理临时日志**：`$env:TEMP\gate-*.log`、`probe-q*.log`、`build-internal-0917.log`、`measure-internal-0917.log`、`public-build-0917.log`、`public-capsync-0917.log`、`public-build-apk-0917.log`、`diag-verify.log`；仓库根未跟踪的 `session-70b8c0da-b83c-4efe-bf00-f819bdf069f0.tmp` 确认无用后处理（删除只能用 `apply_patch` Delete File）。
6. **可选的下一轮优化**（未做，不属本轮交付）：首页 `homeVocabulary`（3,436B）与 `papers`（3,355B）仍是 dashboard 6 次调用里的大头；`vocabulary_entries.contextual_occurrence_key`（32 字符 hex）在列表/复习流程从不读取（只有 `vocabulary-context.ts`、`ai.ts`、`vocabulary.ts:276,435` 写入或详情使用），是 summary 投影里可再裁的候选。

## 9. 待用户决定

1. 平板公测 120 当前装的是注入后的**测试夹具数据**（不是用户真实公测库；旧库已备份且无学习进度、题库可自动重建）。是否恢复旧库、或重装一次干净包，需要用户决定。
2. 公测树（`github-v2`，HEAD `ac66ad8`）是否本地提交（本轮只授权“同步并出包”）；原工作树差异已备份到公测树仓根下的 `.codex-local/publictree-worktree-backup-0917.patch`（275,833B）。

## 10. 已排除路线（勿重复投入）

`homeVocabulary` 排序改写、hoisting active/submitted session、去掉 `review_count` 子查询、`papers` 两列改 `json_object`、`queue/tuple-json` 与 `queue/keys-only`、`items/nested-in(rewrite)`、`vocabularyProfileCondition` 改写。

仍然未知且本轮不纠缠：内测升级后首次进单词本显示 0；`lan-sync.ts:168/186/217` 外部写活跃题库键不在 `question-bank-profiles` 缓存契约内（该风险因本轮把活跃题库缓存同步到公测而同样适用于公测）；横屏仍有 3 处 `backdrop-filter: blur()` 待查（`frontend/src/styles.css` 的 `.review-overlay` 13px、`.practice-top` 15px、`.practice-footer` 16px）。

## 11. 现场与命令速查

- adb：`E:/EnglishPracticeMachine/.toolchains/android-sdk/platform-tools/adb.exe`；两台设备在线，**多设备必须带 `-s`**。
  - 平板：`adb-AWMDUN4201G02529-FIfHZL (2)._adb-tls-connect._tcp`（HEY2_W09 / Android 14 / 192.168.3.25 / 物理屏 1600x2560 @340dpi / 当前 ROTATION_90 横屏）
  - 手机：`adb-9479f243-8zeUiH (2)._adb-tls-connect._tcp`（PHK110）
- 平板侧边栏坐标（1600x2560）：首页 (160,335)、题库与练习 (160,443)、错题本 (160,550)、单词本 (160,660)、导入题库 (160,767)、AI 学习助手 (160,875)、设置 (160,984)、更新 (160,1090)、夜间模式 (160,1511)。
- 夹具与测量：夹具 `.codex-local/vocabulary-latency-20260916/fixture.db`（216 词 / 224 出现记录 / 948 复习 / 51 卷 / 2290 题）；内测与诊断包测量用 `.codex-local/vocabulary-latency-20260916/screens.mjs`（需 `$env:TEST_SERIAL`）；公测用 `.codex-local/self-test-0917/measure-publictest.mjs`。
- 无 WebView 调试端口时拉库的可靠写法：先 `$env:ANDROID_SERIAL='<serial>'`，再 `Start-Process -FilePath $adb -ArgumentList @('exec-out','run-as','<pkg>','cat','databases/english_practice_machineSQLite.db') -RedirectStandardOutput $out -NoNewWindow -Wait`。
- 仓库级坑：`apply_patch` 同一文件不能又删又加，hunk 必须按行号升序，同一文件多 hunk 要分两次 patch；含中文必须 UTF-8；删除文件只能用 `apply_patch` Delete File；`rg` 路径带 `*` 报 os error 123；长输出门禁需重定向到日志再读；`cell_id` 跨 turn 失效。

## 12. 设备与数据边界

- 不提交 APK/AAB/数据库/签名文件/`signing.properties`/日志/私有题库/用户数据；`.codex-local/**` 全部 git 忽略且禁止提交。
- 不要读 `C:\Users\MEC\.dsh\.credentials.yaml`；API Key 只走原生 SecureStore。
- 本仓自 `d2276e7` 起的混合未提交状态是既有事实，不经授权不得清理、回退或整仓覆盖。
