# 第三批迁移事实表：单词本、每日复习与词汇后台任务

依据 docs/context/2026-09-android-to-windows-port-plan.md 第三批范围（VOC-01～16 + Gate 5）；证据基于 2026-09-23 源码与本机实测。第一批、第二批契约见 batch1-contracts.md、batch2-contracts.md。

## 已完成项

| 编号 | 安卓证据 | Windows 内测现状与改动 | 状态 |
|---|---|---|---|
| VOC-01/02/03/04/05/16 词汇页结构 | 安卓横屏 VocabularyView.vue：顶部统一工具区（搜索、状态筛选、额外巩固）、紧凑统计摘要、约 30% 词表 + 70% 详情两栏、长文案不溢出 | 两树 VocabularyView.vue 整体重写移植（ba 66,524 字节，与安卓视图同源；gongce 旧版仅差英雄区文案与一处措辞，确认同源后直接复制 ba 成品）；共享组件 VocabularyMemoryContent.vue、VocabularyDisplaySettings.vue、services/vocabularyDisplayConfig.ts、vocabularySnapshots.ts、vocabulary-due-queue.ts 均与 ba 一致；两树 vue-tsc + vite build 通过 | 已实施，构建验证通过 |
| VOC-06 显示设置 | 安卓词汇显示设置自包含组件 | VocabularyDisplaySettings.vue 为无 props 自包含组件；SettingsView.vue 既有复用点与新组件兼容（gongce 已验证构建通过） | 已实施，验证通过 |
| VOC-07/08/09 编辑、删除、高频和掌握 | 安卓编辑取消行为、删除前确认、重点/掌握标记 | 前端契约随视图移植；删除确认走第二批统一的 confirmDialog 体系 | 已实施，待用户目视验收 |
| VOC-10 翻译状态 | 安卓待翻译/翻译中/成功/失败/重试状态 | 前端状态随视图移植，数据源与 enrichment-runs 后台一致 | 已实施，待用户目视验收 |
| VOC-11 后台补缺 | 安卓补缺任务可查看、暂停、继续、重试，不重复入队 | ba 后端补齐：schemas.py VocabularyEnrichmentRunRequest.action 增加 inventory；services/vocabulary_maintenance.py update_enrichment_run 对 inventory 复用 start 建队；routers/vocabulary.py 新增 GET /vocabulary/status（revision 取 COALESCE(MAX(id),0)，与 list_entries 一致）；enrichment-run 路由对 action=inventory 不启动 worker。gongce 同款改动另含 command_id/sync_id 链路（见下） | 已实施，接口实测通过 |
| VOC-12/13/14 每日一背、额外巩固、复习详情加载 | 安卓正式复习队列、5/10/20 词快捷练习不改正式计划、详情未就绪时显示加载态 | vocabulary-due-queue.ts 两树与 ba 成品一致；复习队列行为随视图移植 | 已实施，待用户目视验收 |
| VOC-15 分页与并发 | 安卓首次加载、滚动加载、搜索、切换筛选不丢当前选择 | 后端 list_entries 增加 limit/offset 分页并返回 revision；review 接口新增 command_id 幂等与 expected_revision 乐观并发（详见契约表） | 已实施，接口实测通过 |

## 接口契约表（第三批涉及）

| 接口 | 方法 | 路径 | 契约要点 |
|---|---|---|---|
| 词汇列表 | GET | /api/vocabulary | 支持 limit/offset/status/search/scope；返回 items[]、revision、counts；每条 item 含 review_revision（JSON 摘要：[normalized_term, last_reviewed_at, next_review_at, updated_at, review_count]） |
| 词汇状态 | GET | /api/vocabulary/status | 返回 {scope_key, revision, counts, measured_at}；ba revision 取 str(COALESCE(MAX(id),0) FROM vocabulary_reviews)；gongce counts 排除 study_status='mastered'（平台口径） |
| 补缺任务 | POST | /api/vocabulary/enrichment-runs | action 取值含 start/pause/resume/retry/inventory；inventory 返回 200 {queued:N} 且不启动 worker；无效 action 422 |
| 复习评分 | POST | /api/vocabulary/{id}/review | body 含 rating/mode/expected_revision/command_id；command_id 为 32 位十六进制（非 32hex 422）；同 command_id 重放返回相同结果且不重复记账；同 command_id 不同 rating 或不同词条返回 409；expected_revision 与服务端 review_revision 不一致返回 409 |

说明：expected_revision 使用列表接口每条 item 的 review_revision 摘要，不是列表顶层的 revision 字段；顶层 revision 用于 /vocabulary/status 与分页一致性判断。

## 验证记录（2026-09-23）

- ba 后端（8766 端口，隔离数据目录 tmp-batch3/smoke-data，6 条 smoke 词条）：GET /api/vocabulary/status 返回 revision=1、counts 全 6；POST enrichment-runs {action:'inventory'} 返回 200 queued=6 且不启动 worker；无效 action 422；GET /api/vocabulary?limit=2 分页正常带 revision；幂等冲突测试（test-conflicts.ps1）全过。
- gongce 后端（8767 端口，全新空数据目录 tmp-batch3/smoke-data-gongce + seed 播种 6 词条，未从 ba 复制数据库）：/status 空库 revision=0、播种后 counts 全 6；limit=2 分页正常；inventory queued=6 且 waiting_configuration=true；幂等回归（tmp-batch3/test-idempotent-gc.py）8/8 通过：首次提交 200、同 command_id 重放结果逐字节相同、复用 command_id 换 rating 409、复用 command_id 换词条 409、过期 expected_revision 409、非 32hex command_id 422。
- ba 前端：npx vue-tsc --noEmit -p tsconfig.app.json 通过；npx vite build 通过。
- gongce 前端：npx vue-tsc --noEmit -p tsconfig.app.json 零错误；npx vite build 通过（1724 模块）。

## 平台差异（刻意保留）

- gongce rating 枚举含 mastered（schemas.py），ba 无此枚举；gongce review_entry 保留 mastered legacy 分支 _apply_legacy_review_entry。
- gongce submit_review 将 ValueError 与 ConflictError 均映射 409；ba 为 ValueError→400 + ConflictError→409。
- gongce 保留固有的 content_remediation 服务与 review 列表子查询 last_result；ba 无。
- gongce /vocabulary/status counts 排除已掌握词条；ba 不排除。
- 两树 vocabulary_reviews 均新增 sync_id 列与 idx_vocab_reviews_sync 索引支撑幂等（gongce 由 database.py _ensure_column 迁移旧库）。

## 未知与待验收

- Gate 5 页面行为（首次进入、刷新、返回、空数据、窗口缩放、键盘/鼠标）需用户目视验收；本批未跑 Playwright 冒烟。
- enrichment worker 长任务的暂停/继续/重试在真实数据量下的表现未实测。
- components/VocabularyTerm.vue 在 Windows 两树均无引用（仅安卓视图使用）；为与安卓源保持一致随批复制，后续若被引用需另行验证。
- 两树改动均未提交（等用户分批授权），文件清单见计划文档；ba 既有 docx_parser.py.bak.* 为用户文件，不提交。
