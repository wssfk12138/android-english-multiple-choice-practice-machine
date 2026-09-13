# 当前工作

> 最后更新：2026-09-13（私有数据库读取通道：内测 alpha.88 / versionCode 88 已覆盖安装平板与手机，导出副本已按真机 adb 取回复核；卡顿修复暂停，横屏卡顿未修）。既有交付核验日期不变，本页仅保留当前摘要。

## 私有数据库读取通道（本轮交付，已按真机取回验证）

应用数据目录 /data/data/包名/databases 无法被电脑直接读取：allowBackup=false、内测包非 debuggable，run-as 与 adb backup 都不可用。本轮新增内部渠道专用的读取通道，把数据库导出成可被 adb 拉取或系统分享取走的副本。

实现：frontend/android/app/src/main/java/com/wssfk/englishpracticemachine/DatabaseExportPlugin.java 优先用 SQLite VACUUM INTO 生成单文件一致性快照（失败时退回逐字节复制并连带 -wal 与 -shm），写入应用外部私有目录 Android/data/包名/files/db-export/，只保留最近 3 次导出。副本会被显式放宽到 0644——外部私有目录下的文件默认是 0600，shell 用户能列出目录却读不到文件，直接拉取会报 Permission denied。前端封装在 frontend/src/platform/android/database-export.ts。

入口在“更新 → 诊断日志”分区（frontend/src/views/AndroidUpdatesView.vue，按运行时平台判断，仅在 Android 原生壳内出现；公测副本尚未同步此改动）：“导出应用数据库副本”回报文件名、大小、SHA-256、PRAGMA integrity_check 与快照方式；“导出并系统分享”经 FileProvider 与 ACTION_SEND 交系统分享，供没有电脑时取走。

真机验证（alpha.88）：平板导出 12,840,960 字节、SHA-256 efda7c4bf74f18f1bdba072662e7f616e3b1bb6e5eb2e2bff361c765cd8928f8；手机导出 13,598,720 字节、SHA-256 cdf94a76307cf8bcae5f3ffd1d5a085ce3f35bb3dfcae88c484c26d26cefade2。两份副本均可拉取，本机 node:sqlite 复核 integrity_check 为 ok、 77 张表，表集合与原参考快照一致，vocabulary_entries 216 / practice_sessions 33 / app_settings 21 计数一致。后续卡顿定位可以直接只读查询错题、词汇和复习记录。

## 卡顿与加载观感修复（暂停：横屏卡顿未修）

按 [卡顿与 UI 修复方案](history/2026-09-card-lag-and-ui-fix-plan.md) 完成 P0–P3：进入“今日到期”先渲染等高卡片骨架并让到期队列在后台落地，评分接口只回传轻量结果；启动路径把内容修正、试卷元数据扫描、LAN 同步版本表和内置题库包判定改为探针后按需写入；首页 `mounted` 与启动事件合并为单飞刷新；学习待办的“正在加载”占位换成等高骨架。前端门禁 63 项全部通过，内测 alpha.86 已覆盖安装平板与手机并保留用户数据，构建与哈希证据见方案文档的“实施结果”。

暂停与现状（2026-09-13）：用户真机反馈竖屏复习流畅，只有横屏卡顿；同一份数据在手机（PHK110 / Android 16）竖屏同样流畅，携带 127 词的手机竖屏也流畅，说明数据量与本轮查询改动不是主因。平板为 HEY2-W09 / Android 14。定位期采样的横屏帧时间中位数约为平板 38ms、手机 12ms（单次采样，未复测）。尚未处理的候选因素集中在横屏路径的三处 backdrop-filter：frontend/src/styles.css 的 .review-overlay（blur 13px）、.practice-top（blur 15px）、.practice-footer（blur 16px）；竖屏媒体查询已把复习卡片的 blur 显式改为 none。用户怀疑与平板自身的开发者选项（如视图属性检查）有关，未证实。另记录：竖屏“今日到期”复习卡片排版不美观，细节待用户补充。

## Android UI 整改（alpha.83 起交付，待真机抽验）

最新安装（2026-09-13）：用户追加授权后，提交 `03eb0d7` 已构建为内测 alpha.89 / versionCode 89，并同签名覆盖安装到平板 HEY2-W09 与手机 PHK110；两端版本、安装包哈希、UID 与首次安装时间已核验，保留原数据。实际界面体验由用户验收，详细证据见 [本地界面整改回执](history/2026-09-ui-local-followup.md)。

2026-09-13 本地补充整改已完成，见 [本地界面整改回执](history/2026-09-ui-local-followup.md)：方案 UI 项 1、2、4–11 补齐，含翻译补全开关、记忆内容分层、窄屏单层展开、筛选选择状态、模型/同步折叠及题库/错题操作；竖屏长单词按宽度缩字号并保持单行，评分保存期间三按钮文字和横排稳定。合成布局与交互测试、前端构建验证详见回执。本次未改性能路径，第 3 项卡顿仍暂停，已随 alpha.89 安装，等待用户真机验收。

按 2026-09-12《EPM-UI整改-Zcode实施规格》完成设置中枢分组、模型列表/详情/主题化选择弹层、单词本配置统一与列表/详情/复习视觉、错题本主次操作与批量、更新/导入分区、全应用自有确认弹层与返回键协调。手机 alpha.83 已修复 1.35 倍字体下 OptionSheet 说明文字溢出并完成安装复验；公测 beta.6-test.14 已在手机安装，平板保留用户数据并使用同签名调试包更新。回执与当前验证见 [UI 整改回执](history/2026-09-ui-remediation.md)；性能审查见 [启动性能审查](history/2026-09-startup-performance-review.md)。

## 整改前交付基线（77/113，不含本轮整改）

| 对象 | 已验证状态 |
| --- | --- |
| 手机 | 内测77 / alpha.77、公测113 / beta.6-test.9均覆盖安装，UID和首次安装时间保持，安装APK哈希匹配，启动通过。 |
| 平板 | 内测77 / alpha.77、公测113 / beta.6-test.9均覆盖安装，UID和首次安装时间保持，安装APK哈希匹配，启动通过。用户确认安装完成，按要求停止验收。 |
| Windows两版 | 在线备份后停止指定进程，经真实桌面快捷方式独立重开；新进程、健康接口、业务逐表哈希、配对和密钥侧文件一致。ShellExecute验收，不冒称Explorer鼠标操作或正常退出服务。 |
| P2 URL/依赖 | Android公测TS和Java域名前缀误拒修复；Windows公测6项测试通过，内测保留LAN策略。四树nanoid3.3.18、生产审计零项、前端构建通过。 |
| 分发准备 | Windows公测Node改22.14.0并检查pnpm退出码，私有验收目录已忽略。安装前端与新构建字节一致。 |

## 剩余事项

- [门禁收尾与工作树归档](history/2026-09-gates-cleanup.md)（2026-09-12）已完成：61 个测试全部入库并挂接 `test:all`；Playwright 已随仓库安装，4 个浏览器测试默认真跑（支持 `--strict` 让 PREREQ 阻断）；修复 6 个失败测试（含 `test:document-draft-persistence` 8/8）；`chooseSnapshot` 批量化、`sessionId` 兜底硬化；孤儿行/冗余索引只读统计落档；平板测试包残留数据已按备份恢复；手机端只读诊断完成。窄范围本地提交按白名单执行（不推送）。

- [AI助手基础Agent与切页修复](history/2026-09-assistant-agent.md)：Windows/Android开发仓源码与合成验证完成。DOCX受限工具、多轮结果反馈、本机副本、任务步骤与切页状态保留已实现；未同步公测或覆盖安装。待一次真实模型和Android系统分享体验；不重跑无关验收。

- [玻璃首页交付已完成](history/2026-09-glass-dashboard.md)：手机、平板及Windows两版均已交付；学习待办、词汇、题型与三个统计卡统一半透明材质。用户确认平板安装完成并要求停止验收，不再重复检查。

- [学习待办交付已完成](history/2026-09-study-todos.md)：电脑与Android横屏按当前题库展示续练、待复习词汇和高频错题；题型练习标题与题库概览已落地。Windows实际列表计数一致。主观阅读与使用体验交由用户确认。
- [C盘迁移与去重已完成](history/2026-09-storage-migration.md)：三批交付证据与Gradle缓存迁至E盘，旧SDK和重复staging去重；六处旧路径保留联接，C盘净增约15.2 GiB。后续清理2000/aac2工作树须先处理staging联接依赖，详见MAP。

- 下一阶段备选：[做题记录开发计划](practice-history-plan.md)。2026-09-09 已收口需求；仅最终整卷提交和明确单篇随机练习提交进入记录，过程单篇提交不归档，删除沿用七天回收站。当前只完成计划，用户明确本阶段不开发；是否启动由下一阶段选择。

- [代理接入和本地交付已完成](history/2026-09-mirror-delivery.md)。公共代理的长期可用性未作保证，APK代理及大文件压力测试不在本轮范围。
- 平板内测今日到期未展开卡片实机无重叠；公测无词条，沿用各56场景矩阵。阅读密度和大小仍由用户体验确认。
- Windows CI本地修复尚未推送/运行。Android历史成功不能替代Windows新CI证据。
- P3付费模型、大包与长期容量、广泛故障矩阵暂挂；历史普通保存EDIT1回退根因未证实。

## 边界

- 四个E盘权威树适用窄同步、构建、设备安装和Windows重开已授权；C盘仅承载任务。
- 09-11历史用户已授权任务完成后窄范围本地提交；本次尚有实施待办，未暂存或提交。push、Release、更新通道和额外清理未授权；多批既有成果保留，本地开发稳定态不代表可发布干净。
- 手机内测重装是本轮例外；平板与Windows数据保留边界不变。旧APK不等于数据库可降级。
- 本任务多次压缩已达到换窗条件，本次安全闭环后建议新任务加载AGENTS、PROJECT_INDEX、NOW和续接清单；不扩大最终验收范围。

## 证据

[本月历史](history/2026-09.md) · [路径和私有回执](MAP.md) · [验收](RUNBOOK.md) · [风险](RISKS.md)
