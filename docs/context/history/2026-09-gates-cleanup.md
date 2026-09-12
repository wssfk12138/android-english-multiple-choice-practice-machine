# 2026-09-12 门禁收尾与工作树归档回执

来源：性能修复复审后的收尾任务（门禁可信化、修复收尾、工作树归档）。性能与持久性修复主体（F1-F8）当日交付，本页只记收尾。

## 完成

- 测试门禁可信化：`frontend/tests` 61 个 .mjs 全部纳入版本管理与 `package.json` 脚本；新增 `test:all`（tests/run-all.mjs）一条命令跑全部门禁并输出汇总，PREREQ（4 个 Playwright 测试，需 `PLAYWRIGHT_MODULE`）显式标注不静默通过。修复 6 个失败测试：`vocabulary-identity`（沙箱白名单补 bumpVocabularyTermPool）、`practice-snapshots` 与 `content-remediation`（connection.run mock 同步为插件形状 `{changes:{changes,lastId}}`）、`document-draft-persistence`（补 `./content-remediation` 沙箱映射，8/8 通过）、`lan-categories`（补 loadSerializationLookup 桩）、`lan-sync-pairing`（补真实 lan-categories 模块并让握手 fixture 满足现行分类协商契约）。
- 隐私扫描：54 个未跟踪测试扫描设备序列号/私网地址/绝对路径/密钥——发现 1 处与真实内测网段同段的旧目录地址（update-settings.mjs），已替换为 192.168.50.8 占位符后入库；其余为合成占位（192.168.1.x/50.x）。
- 修复收尾：`chooseSnapshot` 逐题 INSERT 改为事务内 50 行/批（保持普通 INSERT，重复题响亮失败）；`practice.ts` 与 `practice-snapshots.ts` 的 sessionId 取不到即抛错（不再静默写 0）。
- 只读统计（T6）：真实 Windows 库副本上 `practice_answer_events`（334 行）与 `practice_unit_submissions`（20 行）孤儿行均为 0；`idx_answers_session` 删除后由 `UNIQUE(session_id,question_id)` 自动索引顶替同一查询计划且无退化（47.8ms vs 56.5ms/300 次）——删除收益为零，暂不删。
- 工作树归档（T0）：manifest 全量分类 224 条 status 条目；status 中无可再生产物/临时文件（.gitignore 已排除），移动集合为空，签名文件与 `work/internal-channel` 等运行引用目录未触碰。
- 平板测试包清理（T8）：按改前备份恢复（34 卷/203 单元/1525 题，练习/词汇/错题计数 0，integrity ok），启动一次确认 5 条新索引重建（5/5）。
- 手机端只读诊断（T9）：内测包 alpha.79、测试包 beta.6-test.11；本应用 0 崩溃、0 ANR；新索引 0/5（未装修复版，符合预期）。
- 文档：DECISIONS 追加 7 条本轮决策；RISKS 记入 C2 未做、门禁缺口现状、测试包清理与手机端待验；RUNBOOK 更新测试入口与前置条件。

## 边界

- 本轮窄范围本地提交仅覆盖白名单路径（tests/package.json/性能修复平台源码/五份上下文文档），不推送、不打 tag、不发布、alpha.81 不发布、版本号不变。
- 工作树其余约 130+ 条改动（其他任务成果）原样保留，未移动未提交。
