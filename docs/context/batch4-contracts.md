# 第四批迁移事实表：错题本、错题分析与历史记录

依据 docs/context/2026-09-android-to-windows-port-plan.md 第四批范围（WRONG-01～10）；证据基于 2026-09-23～24 源码与本机实测。第一批至第三批契约见 batch1-contracts.md、batch2-contracts.md、batch3-contracts.md。

## 已完成项

| 编号 | 同步内容 | 现状与改动 | 状态 |
|---|---|---|---|
| WRONG-01 年份与篇目树 | 安卓横屏错题本年份分组、篇目展开与轮次列表 | ba WrongView.vue 补加载失败态后整体移植 gongce（两树文件逐字节一致）；按年份分组、篇目内嵌重做轮次（含正确率、剩余题数） | 已实施，构建验证通过 |
| WRONG-02 当前／全部范围 | 当前错题、历史错题、全部范围语义 | GET /wrong 支持 view=current/mastered/all/frequent 四档（Literal 校验）；current 只含未掌握，mastered 只含已掌握，all 全量，frequent 按高频标记过滤 | 已实施，接口实测四档 200 |
| WRONG-03 批量删除 | 选中、数量、确认、删除结果 | 前端选择模式 + confirmDialog 危险确认（ba 用统一平台对话框替换旧 confirmDesktop）；POST /wrong/archive-delete {unit_ids} | 已实施，接口实测 archived=1 |
| WRONG-04 恢复或归档 | 恢复后列表和统计一致 | gongce trash.py 的 trash_wrong_units/restore 升级为 ba 语义：备份 current/rounds/round_questions 三类数据，不备份不删除 wrong_stats；恢复时轮次 id 重映射、round_number 顺延、INSERT OR IGNORE 防重复。实测删除→恢复闭环通过 | 已实施，接口实测通过 |
| WRONG-05 高频标记 | 单题重点标记与持久化 | PUT /wrong/{question_id}/frequent 写 wrong_stats.manually_frequent；view=frequent 过滤；study_todos.py frequent_question_ids 增加 EXISTS wrong_current_questions 子句（只推当前还在错题池的题） | 已实施，待用户目视验收 |
| WRONG-06 分析入口 | 从篇目进入分析，返回保持原选择 | WrongView analyzeUnit 跳 /wrong/:unitId/analysis；services/wrongListReturn.ts 保存列表选择与展开状态，返回后恢复 | 已实施，两树服务文件一致 |
| WRONG-07 分析历史 | 历史报告、分页、失败重试 | WrongAnalysisView：GET /ai/wrong-analysis-history?unit_id&offset 分页（更早记录按钮）；GET /ai/wrong-analysis-status 提供锁定状态（正式重做完成前锁定新分析）；失败显示错误与重新读取 | 已实施，两树视图一致 |
| WRONG-08 AI 分析范围 | 范围语义不混淆 | POST /ai/analyze-wrong 契约两树一致（AiAnalyzeRequest：question_ids/focus/scope_title，question_ids 为空时回落高频池）；篇目分析入口只传该篇目当前错题 | 已实施，契约核对一致 |
| WRONG-09 无错题状态 | 无错题、无报告、报告失败分别显示 | ba WrongView 本批小补：新增 loadFailed 状态，加载失败显示错误文案与重新加载按钮，与"当前没有待重做错题"空态区分；已移植 gongce | 已实施，构建验证通过 |
| WRONG-10 路由兼容 | 两种历史分析地址定位同一篇目 | 两树 router.ts 均注册 /wrong/:unitId/analysis 与 /wrong/analysis/:unitId，同一 WrongAnalysisView 组件 | 已实施，路由核对一致 |

## gongce 后端补齐明细（本批主体，全部 py_compile 通过）

| 文件 | 改动 |
|---|---|
| backend/app/database.py | 新建 wrong_retry_rounds（含 session_id、三计数）、wrong_retry_round_questions（user_answer/is_correct）、wrong_current_questions（PK unit_id+question_id，since_round_id）；wrong-current-pool-v1 迁移按 wrong_stats.wrong_count>0 播种 |
| backend/app/schemas.py | PracticeSessionRequest.mode 增加 wrong_history；会话请求增加 history_round_id（未加 force_new，最小改动） |
| backend/app/services/practice.py | wrong 模式改从 wrong_current_questions 出题；wrong_history 分支按历史轮次出题；create_session 的 only_by_unit/serialize/inherited_snapshot 提前返回；get_session 支持两种模式；_grade_answer_rows 增加 update_stats 参数并返回结果；新增 _add_current_wrong_questions、_record_wrong_retry_round；submit_unit/submit_session 对 history_only 会话跳过轮次登记与错题池刷新 |
| backend/app/services/practice_snapshots.py | 新增 historical_retry_snapshot |
| backend/app/routers/wrong.py | 整体替换为 ba 版（旧版备份 .pre_batch4） |
| backend/app/services/study_todos.py | frequent_question_ids 增加 EXISTS 子句（见 WRONG-05） |
| backend/app/routers/ai.py | analyze-wrong 全链路接入 retry_session_ids、is_correct=0 错题、current_snapshot；states 写 retry_session_ids.get(unit_id, max_session_id) |
| backend/app/services/wrong_analysis.py | 增加 current_snapshot 参数、current_errors_by_question 过滤与 current_wrong_answer 字段 |
| backend/app/services/trash.py | trash_wrong_units 与 restore wrong_archive 升级为 ba 语义（见 WRONG-04） |

## 接口契约表（第四批涉及）

| 接口 | 方法 | 路径 | 契约要点 |
|---|---|---|---|
| 错题列表 | GET | /api/wrong?view= | view ∈ current/mastered/all/frequent；按年份返回单元聚合：current_question_ids、is_mastered、rounds[]（round_number、correct_count、wrong_count、accuracy、remaining_question_ids） |
| 归档删除 | POST | /api/wrong/archive-delete | body {unit_ids:[...]}；返回 {archived, batch_id, purge_after}；进回收站，wrong_stats 保留 |
| 高频标记 | PUT | /api/wrong/{question_id}/frequent | query enabled=true/false；返回 {question_id, frequent} |
| 回收站恢复 | POST | /api/trash/{trash_id}/restore | body {target_profile_id?}；恢复 current/rounds/round_questions，轮次 id 重映射；不动 wrong_stats |
| 正式重做会话 | POST | /api/practice/sessions | mode=wrong 从当前错题池出题；提交生成新一轮次、按 since_round_id 刷新错题池、wrong_stats 递增 |
| 历史重做会话 | POST | /api/practice/sessions | mode=wrong_history + history_round_id；提交不产生新轮次、不改错题池、不加 wrong_stats（history_only 门控） |
| 错题分析 | POST | /api/ai/analyze-wrong | body {question_ids?, focus?, scope_title?}；question_ids 为空时取 wrong_count>=3 或 manually_frequent 的前 20 题 |
| 分析历史 | GET | /api/ai/wrong-analysis-history | query unit_id、offset；返回 {items, total, unit} |
| 分析状态 | GET | /api/ai/wrong-analysis-status | 返回 units[]，每项含 locked（锁定期间只能查看历史报告） |

## 验证记录（2026-09-23～24）

- ba 前端：npx vue-tsc --noEmit 与 npx vite build 通过（本批仅 WrongView 小补，此前批构建链已过）。
- gongce 前端：npx vue-tsc --noEmit 零错误；npx vite build 通过；WrongView.vue 与 ba 版逐字节一致。
- gongce 后端：本批全部改动文件 py_compile 通过。
- gongce 后端冒烟（8767 端口，隔离数据目录 tmp-batch4-smoke-gc，播种 paper 35 / unit 204 / q1=1526(A) q2=1527(B) q3=1528(C) / 历史会话 1）：wrong 会话创建→答题→提交→round 1 生成→wrong_current_questions 按 since_round_id 刷新→wrong_stats 递增；wrong_history 会话提交后无新轮次、错题池与 wrong_stats 均不变；GET /wrong 四档 view 全 200（frequent 为空是因错误 2 次 < 3 次阈值，属正常）；archive-delete 后错题池与轮次清空、wrong_stats 保留、回收站元数据含三类备份。
- 恢复闭环冒烟（tmp-batch4/smoke_restore.py，本轮补测）：删除前 pool=2、rounds=1；archive-delete 后 pool=0、rounds=0、回收站元数据 current=2/rounds=1；restore 后 pool=2、轮次恢复、回收站条目清除；wrong_stats 维持 (1526,2)(1527,2) 未重复。
- 注意：冒烟库的错题池初始播种是迁移后手动 INSERT OR IGNORE 补的（迁移 key 已在正确时机落库），不影响迁移结论。

## 平台差异（刻意保留）

- ba（内测）与 gongce（公测）不共享数据库、版本号与发布节奏；本批共享逻辑按上述文件逐项移植，均保留平台固有实现。
- /ai/analyze-wrong 在两树均接受自由 question_ids（历史兼容能力）；gongce 旧版 WrongView 的"年级整体分析 + 重做范围选择"UI 入口随视图替换移除，但后端能力未删。

## 未知与待验收

- Gate 8 页面行为（年份展开、批量选择、删除确认、分析页返回保持选择、加载失败态、空态文案）需用户目视验收；本批未跑 Playwright 冒烟。
- gongce 年级范围分析 UI 入口移除是否接受，待用户确认；如需保留可在后续批次补回入口而不动后端。
- wrong_history 会话未实现 force_new 参数（安卓契约的最小子集），如安卓端有强制新开历史会话的场景需在后续批次补。
- 两树改动均未提交（等用户分批授权）；gongce 树 wrong.py.pre_batch4、WrongView.vue.pre_batch4 为移植前备份，不提交。ba 既有 docx_parser.py.bak.* 为用户文件，不动不提交。
