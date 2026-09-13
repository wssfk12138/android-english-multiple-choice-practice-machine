# 路径、版本与同步边界

> 2026-09-12 仅核对规则、四个源码目录与 Git 状态；未重新验证设备、安装、远端或发行。旧快照不代表当前事实或授权。

## 工作树与用途

| 用途 | 路径 | 边界 |
| --- | --- | --- |
| Android 开发 | E:/EnglishPracticeMachine/Codex/english-multiple-choice-practice-machine-android | 默认 Android 开发目标 |
| Android 公测 | E:/EnglishPracticeMachine/Codex/english-multiple-choice-practice-machine-android-github-v2 | 仅获批公测修改或逐项同步 |
| Windows 开发 | E:/EnglishPracticeMachine/Codex/2026-08-02/ba | Windows 本地开发与运行 |
| Windows 发布 | E:/EnglishPracticeMachine/Codex/english-practice-machine-github | 获批公开修改与发行 |

状态在操作前现场核验，不保存易失效的 HEAD 或干净断言。C 盘临时工作树不自动替代以上源码权威位置。

## 同步与发布边界

- Android 专属实现不能整仓迁往 Windows；向 Android 公测迁移也须明确授权并保留版本差异。共享逻辑列源、目标、行为差异及两端必要验证。
- 暂存、本地提交、推送、Release、内测通道和跨仓同步分别授权，不把旧记录作为新操作授权。
- 公开副本不得包含设备地址、令牌、Key、签名、私有题库、数据库、日志、用户数据或本页个人路径。
- 包名、签名、版本和目标清单按当前源码、构建输入、产物及对应渠道核验，不抄旧快照参数。

## Android 路径

- frontend/src/：前端；frontend/src/platform/android/：平台适配；frontend/android/：原生工程。
- docs/：产品文档；docs/context/：专题入口；.codex-local/、work/、outputs/：工具与产物，操作前查引用和忽略规则。
- 应用私有数据库读取通道（内测包专用，2026-09-13 交付）：原生插件 frontend/android/app/src/main/java/com/wssfk/englishpracticemachine/DatabaseExportPlugin.java，前端封装 frontend/src/platform/android/database-export.ts，入口在“更新 → 诊断日志”。导出副本落在设备端 Android/data/包名/files/db-export/，不随源码走，也不是仓库产物。

## 环境与清理依赖（沿用 2026-09-09 记录，使用前复核）

- 三批交付证据已迁至 E:/EnglishPracticeMachine/archives/codex-evidence/，保留原日期/任务ID层级；本页历史C盘visualizations链接通过Junction继续可用。
- Gradle用户目录为 E:/EnglishPracticeMachine/.toolchains/gradle-user-home，User级GRADLE_USER_HOME已设置；C:/Users/MEC/.gradle保留Junction。Android SDK仍为 E:/EnglishPracticeMachine/.toolchains/android-sdk，C盘旧SDK已核验去重并保留Junction。
- C盘工作树2000的.codex-local/staging-alpha39联接至aac2工作树同名保留副本。后续删除或归档任一工作树前先处理此依赖，不能直接移除aac2保留副本。其余工作树与源码未清理。2026-09-13 只读盘点：C:/Users/MEC/.codex/worktrees 下余 9 个游离工作树（41e89bd 七个、fbba2b4 两个），其中 1569/18e1/6318/e55a 干净，2000/2eb7/7a35/aac2/f405 带非空白的旧功能改动（AppUpdater、LanSync、ESQ 等），与已归档的卡顿修复尝试（a2f0）不是同一批；本次未删除任何工作树。
- 私有清单、逐文件SHA-256、环境旧值和回退说明：E:/EnglishPracticeMachine/archives/c-drive-migration-20260909/README.md；闭环见history/2026-09-storage-migration.md。这些设备路径与私有回执不得同步到公开副本。

## 当前任务和历史

- [NOW](NOW.md)：接续任务时定位相关事项；其中阶段授权须查用户依据，不自动扩展。
- [原路径地图](history/context-routing-before-2026-09-12-MAP.md)：完整保留安装、发布、同步及私有回执快照；仅追溯时按标题搜索。
- [本月历史](history/2026-09.md)、[运行验收](RUNBOOK.md)、[风险](RISKS.md)：按问题读取，不默认全文加载。
