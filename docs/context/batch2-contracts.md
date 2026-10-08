# 第二批迁移事实表：首页数据、题库列表、回收站与基础路由兼容
-
# 第二批迁移事实表：首页数据、题库列表、回收站与基础路由兼容

依据 docs/context/2026-09-android-to-windows-port-plan.md 第二批范围（HOME-04/05/07、DATA-01、NAV-05/06）；证据基于 2026-09-23 源码与本机验证。

## 已完成项

| 编号 | 安卓证据 | Windows 内测现状与改动 | 状态 |
|---|---|---|---|
| HOME-03/04 首页数据聚合 | DashboardView studyTodos 直接取 /startup 的 resume_session/review_count/frequent_count | backend/app/routers/dashboard.py /startup 新增同三字段，复用 services/study_todos.py 抽出的 study_todo_counts()/resumable_session()（含 wrong_current_questions 过滤，与 /study-todos 永不漂移）；DashboardView.vue 模板改用 StudyTodos 组件，不再重复请求 /study-todos | 已实施，验证通过 |
| HOME-05 题库概览 | DashboardView 题库概览区（试卷/篇目/客观题计数） | 两端同构，data.paper_count/unit_count/question_count 同源 | 已一致 |
| 首页死代码清理 | 安卓竖屏的真题试卷区未移植 | DashboardView.vue 删除 papers ref、papersLoad、loadSecondaryHomeData()（Windows 模板无消费），首页不再多发一条 /papers 请求 | 已实施，验证通过 |
| DATA-01 回收站确认 | TrashView 用 confirmDialog（title/message/confirmLabel/danger） | TrashView.vue purge 改走 platform/dialogs.ts confirmDialog，保留 Windows typeLabel 差异 | 已实施，验证通过 |
| 弹层统一（DATA-01/STATE-05 支撑） | platform/dialogs.ts、overlay-history.ts、AppDialogHost.vue、OptionSheet.vue | 四文件自安卓原样复制（哈希一致），App.vue 挂载 AppDialogHost；LibraryView.vue 删除/批量移动/移动目标弹窗改 confirmDialog + OptionSheet | 已实施，验证通过 |
| confirmDesktop 退场 | 安卓无此机制 | NamedModelKeys.vue、SettingsView.vue、VocabularyView.vue、WrongView.vue 四处调用改 confirmDialog（删除类 danger:true）；删除 services/desktopConfirm.ts 与 components/DesktopConfirm.vue，rg 确认无残留引用 | 已实施，验证通过 |
| NAV-06 错题分析路由兼容 | 安卓路径 /wrong/analysis/:unitId | frontend/src/router.ts:24 新增该路径，与原 /wrong/:unitId/analysis 共用 WrongAnalysisView（参数名同为 unitId） | 已实施，验证通过 |
| 弹层样式段补齐（ba） | 安卓 styles.css 6635-6681 行 .app-overlay/.app-dialog/.app-sheet/.option-sheet | ba 树 styles.css 原缺该段，已原样追加至尾部（现 1012 行起），AppDialogHost/OptionSheet 有样式支撑 | 已实施，验证通过 |
| 公测 /api/papers 缺列修复 | 公测基线自带缺陷：papers.py 查 practice_sessions.updated_at 但建表与迁移均无该列，全新库 /api/papers 必 500 | database.py _run_migrations 在 sync_id 行后加 _ensure_column(connection, 'practice_sessions', 'updated_at', 'TEXT') | 已实施，验证通过 |
| 公测树第二批移植 | 弹层四文件复制 + styles.css 追加同段；App.vue DesktopConfirm→AppDialogHost；6 处原生对话框替换（4 处 confirmDesktop + LibraryView prompt/confirm + QuestionBankSwitcher 整文件自 ba 复制）；NAV-06 路由已加；公测首页 StudyTodos 为自包含组件走 /study-todos，功能等价按最小 diff 未动 | 公测验证：vue-tsc 通过、vite build 通过（8767 实测）、Playwright 冒烟通过（18 张题库卡、homeTodos=1、trashChars=166、appOverlayCssRule:true、控制台无错误） | 已实施，验证通过 |

## 接口契约表（第二批涉及）

| 接口 | 方法 | 路径 | 新增/涉及字段 | 两端一致性 |
|---|---|---|---|---|
| 首页聚合 | GET | /api/startup | resume_session{id,mode,title}\|null, review_count, frequent_count | 与 /study-todos 同口径（study_todo_counts 共用实现）；本机实测与 /api/study-todos 数值一致 |
| 题库列表 | GET | /api/papers | papers[]（LibraryView 渲染源） | 两端 LibraryView 均为 papers 循环卡片 |

## 验证记录（2026-09-23）

- npx vue-tsc --noEmit -p tsconfig.app.json：通过。
- npx vite build：通过（1738 模块，603.96 kB JS / 122.15 kB CSS）。
- 后端：uvicorn 起服务实测 /api/startup 返回 resume_session（id/mode/title）、review_count、frequent_count；与 /api/study-todos 计数一致。
- Playwright 冒烟（8766 新构建实例，1440×900）：/ 渲染 StudyTodos 与题型区、/library 43 张卡片与后端数据一致、/trash 正常，控制台无错误。截图存安卓树 tmp-batch2/smoke-home.png、smoke-library.png。

## 未知与待验收

- HOME-07 窗口适配（1024/1280/1440/1920 × 浅深色）：需用户目视确认（Gate 2），首页在 1440 宽度已冒烟无溢出。
- 弹层交互（删除确认、移动目标弹窗）建议用户实际点一遍确认观感与返回键行为。
- 8765 端口现运行旧版实例（无新字段），用户重启应用后即加载新构建。
- 公测树第二批已移植并通过 vue-tsc、vite build、Playwright 冒烟（18 张题库卡、首页待办、回收站、弹层样式规则断言、无控制台错误）；第一批提交授权仍未获用户批准，两树文件均未提交。
