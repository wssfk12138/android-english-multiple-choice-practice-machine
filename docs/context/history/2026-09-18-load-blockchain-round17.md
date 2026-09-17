# 2026-09-18 第 17 轮：首屏阻塞链拆解（列目录收窄与设置缓存）

> 接手任务 `01a0ae3c-591b-7011-8a7b-719d740c137e` 的续作。权威树为本仓，起点 HEAD `5512fd0`，本轮代码提交 `a797e7b`（11 文件，+226 / −87，**仅本地，未推送**）。证据目录 `.codex-local/self-test-0917/`。

## 1. 授权与边界

用户授权：构建新包、装机、真机测试、排查、本地提交，并明确「发现其它问题一并修复，不再单独授权」。主目标仍是安卓端加载卡顿；约束是**内测版用户数据必须保留**，其它数据不重要。

仍需单独授权、本轮未做：推送、发布、8877 通道更新、永久删除用户数据。公测包与公测兄弟树本轮未动；手机 PHK110 未装机。

## 2. 单词本／每日一背卡顿的元凶（用户点名问题）

**结论：卡顿不在点击动作本身。** 用户是在「加载中」点进单词本或每日一背的，此时数据库连接与整条启动迁移链还没跑完；这两个页面的读查询必须排在启动链条之后，于是要等 1.1–1.4 秒。

自测包冷启动全量桥调用追踪（`cv-list-fix.json`，71 次调用，DCL t=155 → 首屏可读 1411ms）显示，首屏前真正在花时间的是：

| 阶段 | 耗时 | 说明 |
| --- | --- | --- |
| 桥接固定开销 | ~330ms | `App/getInfo` 78ms、`AppUpdater/getPendingInstallerCleanup` 91ms、`createConnection` 93ms |
| `db.execute(SCHEMA)` | 180ms | 每次冷启动重跑建表脚本 |
| 列目录探查 | 138ms | 本轮由 410ms 降下来（见第 3 节） |
| 启动链条小查询 | ~330ms | 约 25 次到迁移链结束，单次 8–20ms；**很小的 `SELECT 1 ... LIMIT 1` 也要 13ms** |

首屏三条只读查询（idx 28／31／32／33）到 t≈1151 才发出，之前全是连接引导与迁移链。

应用已就绪（空闲态）复测属正常范围：单词本 255–331ms、每日一背 126–169ms。**所以「加载中点击要等 1 秒多」是唯一需要处理的形态**，空闲态不需要用户等待。

## 3. 本轮改动

### 3.1 列目录收窄（本轮最大单项）

`frontend/src/platform/android/database.ts` 的 `COLUMN_CATALOGUE_SQL` 原本 join 全部 76 张表（680 行 / 54KB）。改为只取启动链条真正探测的 18 张表（新增 `BOOTSTRAP_CATALOGUE_TABLES`）。设备端微基准 `_bench-cols-0917.mjs`（live WebView，各 3 轮）：

| 写法 | 行数 | 载荷 | 耗时 |
| --- | --- | --- | --- |
| 全量 join（改前） | 680 | 54KB | 143/171/259，均 191ms |
| 收窄 18 张表 join | 245 | 15KB | 58/69/81，均 **69ms** |
| group_concat 每表一行 | 76 | 15.7KB | 159/165/182，均 169ms |
| 逐表 PRAGMA（76 表） | 680 | 56KB | 1133/1219/1284，均 1212ms |

同一份数据在本地 `node:sqlite` 上只花 0.82ms，**说明成本在结果集物化与桥传输，不在 SQL 引擎**；因此选择「少行数」而不是「少查询次数」，`group_concat` 方案虽然只有 76 行但要在 SQL 侧扫全部表，实测比收窄 join 更慢。

同时修掉一个会致命的回落缺陷：批量结果里没有的表**必须回落到逐表 `PRAGMA table_info`**。`papers`、`document_import_jobs` 走 `ensureColumn`，不在启动链条的 18 张表内；若按原逻辑返回空集合，会对已存在的列重复 `ALTER TABLE`。批量查询失败时也改为建立空 Map 缓存，避免每次调用都重探。

### 3.2 设置与迁移键合并

- `app_migrations`：原本逐键查询九次（迁移链三道门 + `wrong-current-pool-v1`、`question-label-auto-lock-v1` + 内容修复门控），改为一次 `SELECT migration_key FROM app_migrations` + 并发单飞缓存。
- 新增 `frontend/src/platform/android/app-settings.ts`：一次 `SELECT key, value FROM app_settings` + 进程内缓存 + 并发单飞；`app-update`、`lan-sync`、`vocabulary-enrichment-runner` 的逐键读写改走该模块，事务内直写后调用 `invalidateAppSettings()`。原本一次冷启动有近二十次单键查询，每次都要一次桥往返。
- `learning-history-rebind.ts`：新增导出类型 `AppliedMigrationProbe`，V1/V2/V3 三个门接受共享探针，不再各付一次桥往返。

### 3.3 关键契约（勿犯）

`isMigrationApplied()` 会在 `androidDatabase()` 引导链内部造成**自死锁**（连接 promise 尚未 resolve）。引导链内部必须使用内部的 `migrationApplied(db, key)` + `AppliedMigrationProbe`，不能直接调用导出函数。

### 3.4 测试桩同步

`vocabulary-enrichment-jobs.mjs`、`lan-sync-pairing.mjs`、`remediation-startup-gate.mjs`、`database-migration.mjs` 四个桩补齐 `./app-settings` 与 `isMigrationApplied` / `recordMigration`，断言字符串随 V1/V3 入口签名更新。

## 4. 真机实测（平板 HEY2-W09，自测包 com.wssfk.epm.selftest0917）

口径：冷启动 → 重载 → 注入计时 → 在「加载中」自动点进目标页，量 tap → 内容可见。

| 指标 | 第 16 轮改前 | 上一状态（全量 join） | 本轮 |
| --- | --- | --- | --- |
| 单词本 tap → 可见 | 1565ms | 1423ms | **1249ms** |
| 每日一背 tap → 可见 | 1940ms | 1407ms | **1120ms** |
| 启动准备桥调用（list / due） | 117 / 127 | 71 / 81 | 71 / 81 |
| 列目录单项 | 430ms（18 次 PRAGMA，t=683→1363） | 410／434ms（1 次 join） | **138／125ms**（1 次 join） |
| 首屏只读查询发出时刻 | t≈1500+ | t=1326 | **t≈1151** |

轨迹：`cv-list-early.json`、`cv-due-early.json`、`cv-list-after.json`、`cv-due-after.json`、`cv-list-fix.json`、`cv-due-fix.json`。轨迹里 `nativePromise missing` 是注入时机导致，不是应用缺陷。

三条轨迹分别对应三代代码，可由「列目录调用形态」直接判定，不是同一版本的重复取样：early 组 18 次逐表 PRAGMA（累计 430ms，t=683→1363）；after 组 1 次 76 表 join（410／434ms）；fix 组 1 次 18 表 join（138／125ms）。tap→可见的差值（list 1565 / 1423 / 1249ms，due 1940 / 1407 / 1120ms）即在这三代代码上分别测得。

内测包 alpha.97 已同签名覆盖安装：versionCode 97 / `0.1.0-alpha.97`，`firstInstallTime` 仍为 2026-08-05 23:59:22（数据目录未动），`lastUpdateTime` 2026-09-18 00:19:09；首次启动 logcat 无 SQLite / FATAL 错误，库文件 `databases/english_practice_machineSQLite.db` 正常打开。

## 5. 题库版本（用户点名确认项）

设备内 `question_bank_packages` 只剩两个包：

- id 5 `wssfk.postgraduate-english-one.2010-2026`、`contentVersion 1.1.0`、`contentRevision 2026-09-r3`、18 篇（2002 + 2010–2026）；
- id 6 `local.english-practice.postgraduate-english-two.2010-2025`、`1.1.2` / `2026-09-r2`。

旧英语一／英语二 1.0.0 已不存在——**用户要求的「删除旧的考研英语题库」在第 16 轮的清理迁移中已自然完成**。`frontend/public/internal-question-bank.esq` 仍是 329,857B、SHA-256 `56E47F6306540F92F901FB846D1A67CCC379358CFE0E37DBB89E0F09C7BA818B`（2026-09-10 写入）。

**结论：内测版考研英语一题库已是当前最新，本轮不需要也未替换题库；本轮也未触碰任何做题记录。**

**警告（勿犯）**：ESQ 包内 `labels/*.json` 是导出时的旧标注，730 条中有 340 条与设备现状不同；**不得用 ESQ 里的 labels 覆盖设备标注**。

## 6. 验证

- `corepack.cmd pnpm run build`（含 `vue-tsc --noEmit`）EXIT=0。
- `node tests/run-all.mjs`：**77 passed / 0 failed / 0 prereq-skipped，156.8s**（`testall-round17.txt`；修桩前失败副本 `testall-round16.txt`）。
- 自测包构建：build / cap sync / gradle 三段 exit=0，APK SHA-256 `01FE0919A5EAFC96B07A826AA2E6D365C6417A82261778D7B38B156F4FEE239C`。
- 内测包 alpha.97：70,184,174B，SHA-256 `F4FF7E0F7F11BA8E3847CC5C9CE949555E0233157DA291F3A8F7C16384C68FAB`。

## 7. 未验证项与下一轮候选

- 内测包是 release 非 debuggable，无 9229，**无法在内测包上做桥调用计数与写路径测量**；第 4 节除 alpha.97 安装信息外的数字全部来自自测包（同代码、不同数据），不能写成内测包实测。内测包本轮只做了启动不崩与库可打开。
- alpha.97 装机后**未再走应用内「导出应用数据库副本」核对内测库逐表计数**（需用户在应用内操作）。同签名覆盖安装不改数据目录，且本轮代码未触碰 v1.0.0 清理之外的迁移，判断数据未动；如需权威指纹要再导出一次。
- 加载卡顿只证明首屏阻塞链收缩，**不宣称全部卡顿已消除**。剩余最大结构项：把整条启动迁移链挪到首屏之后（候选含 `schema_version` 持久化门控直接跳过列目录），收益最大但风险最高，须单独一轮并配全绿门禁。
- 其它已识别、未处理：诊断面板 09/10 历史 `bundled_question_bank_install Error`（本轮未复现）；8877 启动路径的更新检查改短超时或延后（**不要动 `native-http.ts` 的全局超时**，参考 `updates.ts:34-47`、`app-update.ts:100-150`、`local-api.ts:360-377`）。
- `installBundledQuestionBank`（`question-bank.ts:319-361`）同版本判定**不要**加 `contentRevision`，会触发整包重装与学习历史重绑。

## 8. 提交与证据

`a797e7b perf(android): 首屏阻塞链批量取列与设置缓存`，11 文件：`database.ts`、`app-settings.ts`（新增）、`app-update.ts`、`lan-sync.ts`、`vocabulary-enrichment-runner.ts`、`content-remediation.ts`、`learning-history-rebind.ts`、`tests/vocabulary-enrichment-jobs.mjs`、`tests/lan-sync-pairing.mjs`、`tests/remediation-startup-gate.mjs`、`tests/database-migration.mjs`。

工作树中另有数十条往轮既有未提交内容（`PROJECT_INDEX.md`、`docs/context/*`、`App.vue`、`router.ts`、`SettingsView.vue`、多个 `tests/*.mjs` 及若干未跟踪文件/目录），按最小范围未纳入本次提交，也未清理。

保留证据：`$ST/cv-list-fix.json`、`$ST/cv-due-fix.json`、`$ST/cv-list-after.json`、`$ST/cv-due-after.json`、`$ST/_bench-cols-0917.mjs`、`$ST/cold-vocab-0917.mjs`、`$ST/_cvlist.mjs`、`$ST/testall-round17.txt`、`$ST/build-alpha97.log`、`$ST/wx-progress-*.txt`。整个 `.codex-local/` 按项目规则不入库。
