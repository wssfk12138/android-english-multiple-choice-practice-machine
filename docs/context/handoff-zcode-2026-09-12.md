# 给 zcode 的完整接手提示词

请接手英语刷题机多端整改任务。以下是截至 2026-09-12 的交接状态。不要把本提示词中的历史设备状态当作当前状态；先按需核验，再继续实施。不要从头重做已经通过且输入未变化的验证。

## 一、我的目标和已确定的选择

1. 我的练习记录以平板端现存记录为准，因为最近主要在平板练习。
2. 原失败同步批次有 32 个会话：旧备份审计显示 5 份等价、27 份有真实内容冲突。对 27 组冲突逐项甄别，优先合并，独立历史最后考虑。不要再询问我整体冲突策略；遇到确实无法安全合并的具体项目，再说明差异和待决策点。
3. 优先完成“模型配置与 Key 以平板为源同步到 Windows 内测”和“校勘证据收口”，再处理练习记录冲突与其余交付映射。
4. 将剩余工作分成非实机验收部分和实机验收部分推进。签名打包、部署、真实 Key 同步、真实记录合并属于实施，不要因它们涉及设备就误称为最终用户验收，也不要因为排除最终体验验收而漏做这些实施。
5. 最终平板性能/交互与 Windows 视觉体验由我确认。你负责受影响构建、定向自动化验证和数据保护核对，不无限扩大验收。

## 二、工作树与上下文入口

四个独立权威树：

- Android 内测开发（AD）：E:/EnglishPracticeMachine/Codex/english-multiple-choice-practice-machine-android
- Android 公测（AP）：E:/EnglishPracticeMachine/Codex/english-multiple-choice-practice-machine-android-github-v2
- Windows 内测（WD）：E:/EnglishPracticeMachine/Codex/2026-08-02/ba
- Windows 公测（WP）：E:/EnglishPracticeMachine/Codex/english-practice-machine-github

先读取目标树实际 AGENTS.md、PROJECT_INDEX.md。开发读 docs/context/NOW.md；版本/路径读 MAP.md；构建/安装读 RUNBOOK.md；高风险数据修改读 RISKS.md；必要时读 DECISIONS.md。不要默认全文加载整个历史。

本轮 Android 开发仓关键文件：

- docs/context/remediation-followup-2026-09-11.md
- docs/context/history/2026-09-remediation-followup.md
- docs/context/remediation-plan-2026-09.md

注意：上述旧台账尚未吸收本轮后半程成果，仍可能写“27组冲突等待用户策略”“模型同步仅部分实现”。这些表述已经过时，按本提示词、源码和证据核验后修正；不要按旧文档再次询问已确定的策略。

原任务 ID：01a086ad-a2d9-7503-9d51-68f59f974e20；续接任务 ID：01a090f7-f1c1-7411-ae2c-f28b7a6bce11。只在具体授权或事实有歧义时查相关片段，不再完整展开聊天记录。

## 三、第一部分：非实机验收工作

### A. 校勘证据收口——优先

私有证据根：E:/EnglishPracticeMachine/verification/remediation-20260910

已有 followup-source-evidence-20260911.json，由 audit_followup_evidence.py 生成。它是定向证据，不是全题库逐字认证。四树清单的 65 个单元 after/findings 已核验一致，reviewedBefore 可以不同。

已经得到的定向结论：

- F005：2016 英一完型第17空前的孤立 G，来源支持移除。
- F007：2025 第21题 B 选项与补充来源对应选项一致。
- F008：2023 英二第37题 A 选项与补充来源对应选项一致。
- F029：2025 O'Hanlon 三处名称修复核实。
- F025：2021 sentence_insertion 类型、说明和 A–G 七候选结构已核实。候选全文未被认证；既有 BY、anaudit、· contracts 等疑点不能未经来源擅改。
- F027：2014 英二七个修复候选短语与补充来源一致，亦有既有可信 Word 证据。
- F028：2013 七段结构、空位顺序和 That should 分词核实；保留可信 Word 的 have increased，不静默采用补充网页 has 变体。
- F024：初版报告 fullCandidateDMatches 为 false。之后已用 inspect_f024_diff.py 定位：2026 D 段文字相同，差异为标点后的空格，例如 Jack,or Jill,dull.The 与 Jack, or Jill, dull. The；末句归属正确，正文不再残留。尚未将此解释写入第二版报告。应保留严格比较 false 的事实，另加限定的“标点空格差异”核对证据，不要宽泛忽略所有空白来掩盖词内变化，更不必只为通过比较去改题库。
- F033：初版报告独立核实 8/9 年。2010/2011/2014/2017/2018/2019 来自可信 Word VML 同行绝对横坐标；2025/2026 来自补充 HTML 的明确预给位置链。2023 在最后一步也取得了新的补充来源位置链：41=B → 预给A → 42=F → 预给E → 43=D → 预给H → 44=C → 45=G，与当前 [41,A,42,E,43,H,44,45] 一致。新文件 supplemental-sources/lazynote-2023-one-followup.html 及同名 .receipt.json 已保存来源 URL、抓取时间和 SHA-256；fetch_2023_slot_evidence.py 打印了该链。尚未将2023补入第二版审计报告。这个证据是补充网页交叉核对，不要写成可信 Word 原图已渲染通过。

下一步：

1. 复核以上两项新增证据，生成 followup-source-evidence-20260911-r2.json 或新的明确日期版本，保留初版报告。
2. 每项写明核实范围、来源、hash、比较方法和剩余边界；2026 完型20空证据不能拿来证明 Part B。
3. 更新校勘台账。不要把九项定向问题收口写成1525题/全部候选已逐字认证。

脚本注意：audit_followup_evidence.py 使用 open('x')，直接重跑会因既有输出而失败；先改为新的输出版本。coverage_r3.py、verify_remaining_source_r2.py 可能覆盖旧报告，不盲跑。inspect_supplemental_units.py 底部有写报告副作用，不直接 import 整个文件。原始 Word、数据库和既有证据不覆盖。

### B. 模型配置与 Key 同步——代码已完成，真实同步未完成

已实现并在四树适用位置落地：

- Windows 两树：backend/app/services/model_snapshot.py、model_key_transaction.py、routers/sync.py，以及 tests/test_model_snapshot.py。
- 独立 authoritative_push / snapshot_version:1 全配置快照；同名覆盖原 id，缺失补建，电脑独有配置和 Key 保留；模型字段、endpoint、adapter、enabled/default、命名 Key、selected Key 一并处理。
- 配置歧义、重复名称/模型ID、坏Key标识/hash/selected、多个默认等整批拒绝；目标匹配 profile 的模型列表按源替换，全局默认标记以源为准。
- 真 Key 使用 Windows DPAPI 侧文件，不写入 SQLite；带加密 recovery journal 和 SQLite commit marker 的失败回退/恢复机制。已有事务 fail closed。不要夸大为全部跨进程普通 Key 编辑并发场景已验证。
- Android 两树：model-key-sync.ts、lan-sync.ts、local-api.ts、AndroidUpdatesView.vue 及 frontend/tests/model-snapshot.mjs。
- 已有“以本机模型配置发送到电脑”确认入口，必须 TLS、对端能力、models 权限和明确确认；严格校验 ack 版本与数量；不运行学习记录同步。POST /android/lan-sync/models/authoritative 要求 confirm === true。

已通过的验证（相关输入未变时复用）：

- Windows 内测原 Key 7 项和新增快照10项通过；Windows 公测合计17项通过。
- Android 两树普通 model-keys 和新增 model-snapshot 合成测试通过。
- Android 两树前端 build、cap sync android、Gradle assembleDebug 均通过。
- Debug APK 只是构建验证，不是能覆盖正式签名安装的交付 APK。

待做：审阅目标差异，确认当前代码和证据对应；按现有 RUNBOOK 准备正式签名 Android 候选和包含新后端的 Windows 冻结包，做阶段特有轻量检查。尚未签名交付、部署或真实 Key 同步，不能宣称已完成同步。

### C. 27组练习记录冲突——先只读逐项方案，再真实实施

快照等价补丁与测试已经完成：Windows 内测接入 snapshots_equivalent；两 Windows 保持 JSON 布尔值/数字不同和大整数精确性；Android 补充等价和真实差异测试。不可为了消除冲突而放宽正文、候选、顺序、评分校验。

旧批次32会话全部同ID，5等价/27真实差异；当时重放仍保护性拒绝整个失败批次。真实学习库未因本轮改动而合并。

待完成：

1. 在真实操作前取得当前平板和Windows的安全备份/快照；旧32会话报告只是起点，不能直接当当前状态。
2. 逐项列出会话、题目快照版本、正文/选项/顺序、作答、评分、时间和来源的差异，明确内容修订与学习行为差异。
3. 以平板现存练习记录为主，保留电脑独有且不冲突的有效信息；有对应关系才合并，不能把答案硬套到不同选项顺序或题目内容。
4. 不静默重判分、删快照、覆盖原答案。仅在无法合理合并时提出具体独立历史方案并说明原因。
5. 用备份副本或合成数据测试幂等、重复同步不重复计数、失败回退和统计一致；再实施真实同步。

### D. 其他实施与文档收口

- 校正题库应用平板内测：旧回执是 r3 修订98实例、保护32会话，不是全量重导入；尚未独立核实当前正式版真库修订。先核对，不重复导入。
- 单词本/今日到期性能整改：四树 vocabulary-review-refresh 定向测试已通过；仍需把相关源码、构建产物和实际安装版本对应起来，不把 API 耗时当作真实交互体验。
- Windows 快照比较与模型同步新后端尚未冻结部署；旧安装包不能代表含有这些增量。
- 更新 PROJECT_INDEX.md、NOW.md、remediation-followup-2026-09-11.md 和本月 history；完成项移入历史，当前文档只保留有效摘要。
- 四树有大量既有脏成果。阶段结束复查 git status、git diff --check、暂存区及关键资产，区分既有成果和本次修改，不擅自清理。
- 全部获准实施任务完成后，才能按既有授权进行窄范围本地提交；当前尚未达到条件。提交不等于推送或发布。

## 四、请接手英语刷题机多端整改任务。以下是截至 2026-09-12 的交接状态。不要把本提示词中的历史设备状态当作当前状态；先按需核验，再继续实施。不要从头重做已经通过且输入未变化的验证。

## 一、我的目标和已确定的选择

1. 我的练习记录以平板端现存记录为准，因为最近主要在平板练习。
2. 原失败同步批次有 32 个会话：旧备份审计显示 5 份等价、27 份有真实内容冲突。对 27 组冲突逐项甄别，优先合并，独立历史最后考虑。不要再询问我整体冲突策略；遇到确实无法安全合并的具体项目，再说明差异和待决策点。
3. 优先完成“模型配置与 Key 以平板为源同步到 Windows 内测”和“校勘证据收口”，再处理练习记录冲突与其余交付映射。
4. 将剩余工作分成非实机验收部分和实机验收部分推进。签名打包、部署、真实 Key 同步、真实记录合并属于实施，不要因它们涉及设备就误称为最终用户验收，也不要因为排除最终体验验收而漏做这些实施。
5. 最终平板性能/交互与 Windows 视觉体验由我确认。你负责受影响构建、定向自动化验证和数据保护核对，不无限扩大验收。

## 二、工作树与上下文入口

四个独立权威树：

- Android 内测开发（AD）：E:/EnglishPracticeMachine/Codex/english-multiple-choice-practice-machine-android
- Android 公测（AP）：E:/EnglishPracticeMachine/Codex/english-multiple-choice-practice-machine-android-github-v2
- Windows 内测（WD）：E:/EnglishPracticeMachine/Codex/2026-08-02/ba
- Windows 公测（WP）：E:/EnglishPracticeMachine/Codex/english-practice-machine-github

先读取目标树实际 AGENTS.md、PROJECT_INDEX.md。开发读 docs/context/NOW.md；版本/路径读 MAP.md；构建/安装读 RUNBOOK.md；高风险数据修改读 RISKS.md；必要时读 DECISIONS.md。不要默认全文加载整个历史。

本轮 Android 开发仓关键文件：

- docs/context/remediation-followup-2026-09-11.md
- docs/context/history/2026-09-remediation-followup.md
- docs/context/remediation-plan-2026-09.md

注意：上述旧台账尚未吸收本轮后半程成果，仍可能写“27组冲突等待用户策略”“模型同步仅部分实现”。这些表述已经过时，按本提示词、源码和证据核验后修正；不要按旧文档再次询问已确定的策略。

原任务 ID：01a086ad-a2d9-7503-9d51-68f59f974e20；续接任务 ID：01a090f7-f1c1-7411-ae2c-f28b7a6bce11。只在具体授权或事实有歧义时查相关片段，不再完整展开聊天记录。

## 三、第一部分：非实机验收工作

### A. 校勘证据收口——优先

私有证据根：E:/EnglishPracticeMachine/verification/remediation-20260910

已有 followup-source-evidence-20260911.json，由 audit_followup_evidence.py 生成。它是定向证据，不是全题库逐字认证。四树清单的 65 个单元 after/findings 已核验一致，reviewedBefore 可以不同。

已经得到的定向结论：

- F005：2016 英一完型第17空前的孤立 G，来源支持移除。
- F007：2025 第21题 B 选项与补充来源对应选项一致。
- F008：2023 英二第37题 A 选项与补充来源对应选项一致。
- F029：2025 O'Hanlon 三处名称修复核实。
- F025：2021 sentence_insertion 类型、说明和 A–G 七候选结构已核实。候选全文未被认证；既有 BY、anaudit、· contracts 等疑点不能未经来源擅改。
- F027：2014 英二七个修复候选短语与补充来源一致，亦有既有可信 Word 证据。
- F028：2013 七段结构、空位顺序和 That should 分词核实；保留可信 Word 的 have increased，不静默采用补充网页 has 变体。
- F024：初版报告 fullCandidateDMatches 为 false。之后已用 inspect_f024_diff.py 定位：2026 D 段文字相同，差异为标点后的空格，例如 Jack,or Jill,dull.The 与 Jack, or Jill, dull. The；末句归属正确，正文不再残留。尚未将此解释写入第二版报告。应保留严格比较 false 的事实，另加限定的“标点空格差异”核对证据，不要宽泛忽略所有空白来掩盖词内变化，更不必只为通过比较去改题库。
- F033：初版报告独立核实 8/9 年。2010/2011/2014/2017/2018/2019 来自可信 Word VML 同行绝对横坐标；2025/2026 来自补充 HTML 的明确预给位置链。2023 在最后一步也取得了新的补充来源位置链：41=B → 预给A → 42=F → 预给E → 43=D → 预给H → 44=C → 45=G，与当前 [41,A,42,E,43,H,44,45] 一致。新文件 supplemental-sources/lazynote-2023-one-followup.html 及同名 .receipt.json 已保存来源 URL、抓取时间和 SHA-256；fetch_2023_slot_evidence.py 打印了该链。尚未将2023补入第二版审计报告。这个证据是补充网页交叉核对，不要写成可信 Word 原图已渲染通过。

下一步：

1. 复核以上两项新增证据，生成 followup-source-evidence-20260911-r2.json 或新的明确日期版本，保留初版报告。
2. 每项写明核实范围、来源、hash、比较方法和剩余边界；2026 完型20空证据不能拿来证明 Part B。
3. 更新校勘台账。不要把九项定向问题收口写成1525题/全部候选已逐字认证。

脚本注意：audit_followup_evidence.py 使用 open('x')，直接重跑会因既有输出而失败；先改为新的输出版本。coverage_r3.py、verify_remaining_source_r2.py 可能覆盖旧报告，不盲跑。inspect_supplemental_units.py 底部有写报告副作用，不直接 import 整个文件。原始 Word、数据库和既有证据不覆盖。

### B. 模型配置与 Key 同步——代码已完成，真实同步未完成

已实现并在四树适用位置落地：

- Windows 两树：backend/app/services/model_snapshot.py、model_key_transaction.py、routers/sync.py，以及 tests/test_model_snapshot.py。
- 独立 authoritative_push / snapshot_version:1 全配置快照；同名覆盖原 id，缺失补建，电脑独有配置和 Key 保留；模型字段、endpoint、adapter、enabled/default、命名 Key、selected Key 一并处理。
- 配置歧义、重复名称/模型ID、坏Key标识/hash/selected、多个默认等整批拒绝；目标匹配 profile 的模型列表按源替换，全局默认标记以源为准。
- 真 Key 使用 Windows DPAPI 侧文件，不写入 SQLite；带加密 recovery journal 和 SQLite commit marker 的失败回退/恢复机制。已有事务 fail closed。不要夸大为全部跨进程普通 Key 编辑并发场景已验证。
- Android 两树：model-key-sync.ts、lan-sync.ts、local-api.ts、AndroidUpdatesView.vue 及 frontend/tests/model-snapshot.mjs。
- 已有“以本机模型配置发送到电脑”确认入口，必须 TLS、对端能力、models 权限和明确确认；严格校验 ack 版本与数量；不运行学习记录同步。POST /android/lan-sync/models/authoritative 要求 confirm === true。

已通过的验证（相关输入未变时复用）：

- Windows 内测原 Key 7 项和新增快照10项通过；Windows 公测合计17项通过。
- Android 两树普通 model-keys 和新增 model-snapshot 合成测试通过。
- Android 两树前端 build、cap sync android、Gradle assembleDebug 均通过。
- Debug APK 只是构建验证，不是能覆盖正式签名安装的交付 APK。

待做：审阅目标差异，确认当前代码和证据对应；按现有 RUNBOOK 准备正式签名 Android 候选和包含新后端的 Windows 冻结包，做阶段特有轻量检查。尚未签名交付、部署或真实 Key 同步，不能宣称已完成同步。

### C. 27组练习记录冲突——先只读逐项方案，再真实实施

快照等价补丁与测试已经完成：Windows 内测接入 snapshots_equivalent；两 Windows 保持 JSON 布尔值/数字不同和大整数精确性；Android 补充等价和真实差异测试。不可为了消除冲突而放宽正文、候选、顺序、评分校验。

旧批次32会话全部同ID，5等价/27真实差异；当时重放仍保护性拒绝整个失败批次。真实学习库未因本轮改动而合并。

待完成：

1. 在真实操作前取得当前平板和Windows的安全备份/快照；旧32会话报告只是起点，不能直接当当前状态。
2. 逐项列出会话、题目快照版本、正文/选项/顺序、作答、评分、时间和来源的差异，明确内容修订与学习行为差异。
3. 以平板现存练习记录为主，保留电脑独有且不冲突的有效信息；有对应关系才合并，不能把答案硬套到不同选项顺序或题目内容。
4. 不静默重判分、删快照、覆盖原答案。仅在无法合理合并时提出具体独立历史方案并说明原因。
5. 用备份副本或合成数据测试幂等、重复同步不重复计数、失败回退和统计一致；再实施真实同步。

### D. 其他实施与文档收口

- 校正题库应用平板内测：旧回执是 r3 修订98实例、保护32会话，不是全量重导入；尚未独立核实当前正式版真库修订。先核对，不重复导入。
- 单词本/今日到期性能整改：四树 vocabulary-review-refresh 定向测试已通过；仍需把相关源码、构建产物和实际安装版本对应起来，不把 API 耗时当作真实交互体验。
- Windows 快照比较与模型同步新后端尚未冻结部署；旧安装包不能代表含有这些增量。
- 更新 PROJECT_INDEX.md、NOW.md、remediation-followup-2026-09-11.md 和本月 history；完成项移入历史，当前文档只保留有效摘要。
- 四树有大量既有脏成果。阶段结束复查 git status、git diff --check、暂存区及关键资产，区分既有成果和本次修改，不擅自清理。
- 全部获准实施任务完成后，才能按既有授权进行窄范围本地提交；当前尚未达到条件。提交不等于推送或发布。


## 六、请这样开始并交付

先给出简洁的“非实机工作 / 真实设备实施 / 最终实机验收”清单，核实源码与关键证据后，优先完成校勘第二版报告和模型交付准备，再继续真实同步及冲突处理。不要再从头问我平板与电脑谁优先。

每项结果分清：已实现、已测试、已打包、已部署、已真实同步、仍待用户验收。最终交付说明修改范围、验证证据、未完成项与具体阻塞；不要把全部代码测试通过写成真实Key和记录已同步，不要把Debug构建写成正式交付。
