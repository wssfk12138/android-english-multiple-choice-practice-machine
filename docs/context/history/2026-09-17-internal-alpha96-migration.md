# 2026-09-17 内测 alpha.96：旧库清理迁移解阻与启动准备收缩

> 本文件是接手任务 `01a0ae3c-591b-7011-8a7b-719d740c137e` 的当前轮记录（本地证据目录 `.codex-local/self-test-0917/`，脚本前缀 `r14-*`）。权威树为本仓，HEAD 起点 `d2fdf14`，本轮代码提交 `03fd49a`（9 文件，+519 / −87，仅本地，未推送）。

## 1. 授权与边界

用户授权：构建新包、装机、真机测试、排查、本地提交，并明确「发现其它问题一并修复，不再单独授权」。任务约束：主目标是安卓端加载卡顿；**内测版用户数据必须保留**，其它数据不重要；如需更换题库，必须先保护所有与旧题库绑定的做题记录，并在完成后删除旧的考研英语题库。

仍需单独授权、本轮未做：推送、发布、8877 通道更新、永久删除用户数据。

## 2. 缺陷 C：旧库清理迁移被参数错位阻断（本轮主因之一）

`frontend/src/platform/android/database.ts` 的题库包去重与旧库清理迁移里，`packageCopyReferences` 与 `deleteProfilePackageCopy` 两处的 `questionValues` 传了 `[...paperValues, ...paperValues]`（6 个值），而 `questionScope` 只有 3 个 `?`：语句共 54 个参数、绑定了 81 个，`db.run` 抛 `Cannot bind argument at index 81 ... statement has 54 parameters`。整段迁移在 try/catch 内，失败只 `console.info`，于是**每次冷启动都重跑一遍清理、每次都失败**，内测库长期保留重复题库包（4 个包、`papers` 52 行）。

修复：两处改为 `[...paperValues]`。修复后迁移首次成功落库，写入 `duplicate-profile-package-v1` 与 `legacy-question-bank-prune-v1`（库内 15:18:20 / 15:18:21 UTC，即本机 23:18）。

## 3. 缺陷 D：启动与 VACUUM 失败无法诊断

同一处 catch 只打印 `[object Object]`。新增 `describeError()`（`frontend/src/platform/android/database.ts:482`），启动 catch 与 vacuum catch 改打真实原因。这是本轮能定位缺陷 C 的前提。

## 4. 同批收口的启动／加载路径改动（本轮一并提交）

- `lan-sync-versions.ts`：13 张表逐个桥调用探测改为一次目录查询 + `UNION ALL` 合并探测，稳态启动不再为每张表各付一次桥调用；
- `main.ts`：启动准备事件带 `changed`，内容未变时首页不再重刷；`StudyTodos.vue` 直接复用 `/startup` 聚合结果，同一屏不重复请求；
- `content-remediation.ts`：增加打包摘要门控，包未变时跳过逐 unit 预检；
- `DashboardView.vue` + 新增 `composables/useAndroidLandscape.ts`：横屏题型图标跟随方向标记。

## 5. 真机结果（平板 HEY2-W09，内测 alpha.96）

产物：`outputs/internal-channel/english-practice-machine-android-0.1.0-alpha.96-internal.apk`，70,183,708 B，SHA-256 `A62616433842F4BFE69DF409F1300DDDB7D7F684AA43F97CB4C3E8625F100B77`，versionCode 96。与 alpha.95 同签名覆盖安装，`firstInstallTime` 仍为 2026-08-05 23:59:22（数据保留），`lastUpdateTime` 2026-09-17 23:18:03。

数据库（应用内「导出应用数据库副本」取证）：迁移前 `int-baseline-231501.db` 16,461,824 B → 迁移后 `int-after-096.db` 9,506,816 B；应用内面板自报 17.2 → 9.1 MiB。逐表计数 `papers 52→34`、`options 10075→6585`、`units 310→203`、`questions 2330→1525`、`question_ai_labels 1879→1074`、`question_bank_packages 4→2`、`esq_import_jobs 6→3`、`content_remediation_receipts 98→64`；`PRAGMA integrity_check` = ok，`foreign_key_check` 0 行。

**被删掉的就是旧题库**：迁移前库里有 4 个包——旧英语一 1.0.0（id 1）、旧英语二 1.0.0（id 3）、新英语一 1.1.0（id 5）、新英语二 1.1.2（id 6）；迁移后只剩 id 5 与 id 6，即用户要求的「删除旧的考研英语题库」由这次清理自然完成。

**用户数据零变化**（迁移前后逐项一致）：`practice_sessions` 33、`practice_answers` 1057、`wrong_stats` 155 行（Σwrong=75）、`vocabulary_entries` 216、`vocabulary_occurrences` 224、`vocabulary_reviews` 1006（到期 943）；`practice_answers` 对 `questions` 的孤儿行 0。

冷启动（内测包，`am start -W`，各轮先 `logcat -c` 与 `force-stop`）：TotalTime **858 / 849 / 882 ms**。gfxinfo：107 帧、janky 30（28.04%）、50th 40ms / 90th 57ms / 99th 200ms。注意 `gfx-publictest-119-before.txt` 只有 7 帧且属公测包（119），**不能当内测改前基线**，该组帧数据只作描述，不能宣称帧率改善。

启动准备阶段（自测包 `com.wssfk.epm.selftest0917`，同一份代码、可调试）桥调用全量追踪：改前基线 `boot-int-base-1.json` = **preparedAt 3101ms / 187 次桥调用 / SQL 4033ms**；改后连测三次 `r14-steady-1/2/3.json` = **preparedAt 2031 / 2005 / 1875ms、97 次桥调用、SQL 2427 / 2570 / 2365ms**。启动准备耗时下降约 35%，桥调用减半；剩余重复 SQL 约 434ms（`app_settings` 逐键 15 次、题库概览统计并发两份、`SELECT 1 FROM app_migrations` 6 次）。

另有一份早期记录 `boot-int-fix-1.json.json` 报 44 次调用 / 1278ms，本轮三次复测都无法重现，**按一次性异常处理**，不得当成稳态数字引用。

## 6. 题库版本结论（用户点名确认项）

`frontend/public/internal-question-bank.esq`：`packageId = wssfk.postgraduate-english-one.2010-2026`、`contentVersion = 1.1.0`、`contentRevision = 2026-09-r3`、18 篇；与设备内 `questions` 805/805、`units` 107/107 全等。英语二 `local.english-practice.postgraduate-english-two.2010-2025`、`1.1.2` / `2026-09-r2`：720/720 题、96/96 unit 全等。

**结论：内测版考研英语一题库已是当前最新（r3），本轮不需要也未执行题库替换**；旧题库的删除是第 5 节那次清理迁移的结果。

**警告（勿犯）**：ESQ 包内 `labels/*.json` 是导出时的旧标注，730 条中有 340 条与设备现状不同；**不得用 ESQ 里的 labels 覆盖设备标注**。比对时必须按 `options.sequence` 排序、`answers` 结构是 `{correctOption, score}`，否则会出假差异。

## 7. 验证

`corepack.cmd pnpm run build`（含 `vue-tsc --noEmit`）EXIT=0；`node tests/run-all.mjs` **77 passed / 0 failed / 0 prereq-skipped，169.0s**；`test:database-migration`（含 learning-history-rebind）、`tests/android-read-path-latency.mjs`、`tests/vocabulary-review-refresh.mjs` 全部 PASS。日志见 `$ST/r14-t-*.log`、`$ST/r14-testall.log`。

## 8. 未验证项与残余风险

- 内测包是 release 非 debuggable，**没有 9229 端口**，无法在内测包上做桥调用计数与写路径测量；第 5 节的启动准备数字全部来自自测包（同代码、不同数据），不能写成内测包实测。内测包只有 `am start -W` 与 gfxinfo 两类数据。
- 加载卡顿只证明「启动准备阶段」收缩与库体积下降，**不宣称全部卡顿已消除**。剩余已知热点（见第 5 节尾部）与下一轮候选：Dashboard 首屏四条大 JOIN 合并或延后、`app_settings` 逐键查询批量化（内测库 23 个键，其中 3 个游标 600–813B）、8877 启动路径的更新检查改短超时或延后（**不要动 `native-http.ts` 的全局超时**，参考 `updates.ts:34-47`、`app-update.ts:100-150`、`local-api.ts:360-377`）。
- `installBundledQuestionBank`（`question-bank.ts:319-361`）的同版本取代判定只比 `packageId + contentVersion`，不含 `contentRevision`；内测英语一内容版本 1.1.0 已跨越 r2 → r3，靠 `content-remediation` 的 bundle 哈希通道而不是这条路径更新。**本轮不改**：一旦让包替换介入，会触发整包重装与学习历史重绑，风险远大于收益，须单独评估并配全绿门禁。
- 诊断面板只留 1 条历史错误 `启动准备 09/10 20:45:09 · bundled_question_bank_install Error`；alpha.96 运行后无新增，本轮未复现，也未清理这条历史记录（清理属用户决定）。
- 手机 PHK110 本轮未装机、未测试；公测包与公测兄弟树本轮未动。

## 9. 证据与临时文件

保留：`$ST/int-baseline-231501.db`、`$ST/int-after-096.db`（迁移前后库副本，本轮结论的直接证据）、`$ST/boot-int-base-1.json`、`$ST/r14-steady-1/2/3.json`、`$ST/logcat-096-after.txt`、`$ST/gfx-coldstart-096.txt`、`$ST/r14-t-*.log`、`$ST/r14-testall.log`、`$ST/wx-progress-*.txt`。

一次性脚本可留（都很小且可复用）：`$ST/_q.mjs`（只读查询）、`$ST/_dup-sql.mjs`（重复 SQL 归因）、`$ST/coldstart-096.ps1`、`$ST/gfx-jank-096.ps1`、`$ST/boot-trace.mjs`、`$ST/bootlist.mjs`。整个 `.codex-local/` 按项目规则不入库。

## 10. 提交

`03fd49a perf(android): 修掉旧库清理迁移的参数错位并恢复可诊断日志`，9 文件：`frontend/src/platform/android/database.ts`、`lan-sync-versions.ts`、`content-remediation.ts`、`frontend/src/main.ts`、`frontend/src/components/StudyTodos.vue`、`frontend/src/views/DashboardView.vue`、`frontend/src/composables/useAndroidLandscape.ts`（新增）、`frontend/vite.config.ts`、`frontend/tests/database-migration.mjs`。工作树中另有数十条往轮既有未提交内容（含 `App.vue`、`SettingsView.vue`、`NamedModelKeys.vue`、`tests/settings-layout.mjs` 等横屏遗留），按最小范围未纳入本次提交，也未清理。

