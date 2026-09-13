# Android 卡顿优先修复方案与 UI 问题定位（2026-09-13）

## 结论与优先级

本轮把交互卡顿列为 P0。现有源码显示单词本三个卡顿现象共享高成本路径：进入今日到期调用完整 `status=review&limit=all`；每次评分前再次刷新完整到期队列；评分接口返回完整详情，而详情序列化会读取出现记录并执行整本词库的本地相似词匹配。详情切换也会触发同一序列化。因此优先拆分“提交评分”和“刷新展示数据”，先让下一张卡片即时出现，再在后台同步统计和队列。

## P0：先测量再修复

1. 在 `VocabularyView.vue`、`platform/android/vocabulary.ts`、`platform/android/local-api.ts` 增加临时或可控诊断计时：点击到期卡片、首个 review GET、review POST、`serializeDetails`、`localSimilarMatches`、occurrences 查询分别记录耗时和行数。
2. 用真实手机数据采集 cold/warm 两次：进入单词本、进入今日到期、连续点击两张评分、列表切换三次；同时记录数据库查询次数、返回 payload 大小、主线程长任务。
3. 以 200ms 交互反馈为目标；网络/模型翻译属于后台任务，不阻塞卡片翻面与下一张卡片渲染。

## P0：建议修复顺序

### A. 复习流程

- `startReview` 只加载必要的复习字段和 ID 队列；卡片内容按当前索引预取下一张，不在点击前重新拉全量列表。
- `rate` 提交成功后立即依据本地队列移除当前项、显示下一项；统计和一致性校验改为后台刷新，冲突时再提示用户。
- review API 返回轻量结果（revision、next_review_at、计数），不要返回包含 occurrences/local_similar 的完整详情。
- 保留并发保护、expected_revision 和跨设备变更检测；后台刷新失败不阻塞当前复习。

### B. 单词详情切换

- 列表点击先展示已有行数据，详情查询完成后增量补全；对相邻词做单项预取。
- 将 `localSimilarMatches` 从每次详情读取移到按词库版本缓存的后台任务；缓存未命中时先显示详情，其结果稍后填充。
- occurrences 只在开启“真题遇见/语境”区块时读取，避免详情页默认查询全部出现记录。

### C. 启动与其它功能区举一反三审查

- 首页：检查 `DashboardView` 的 mounted 与 `android-startup-prepared` 重复 reload，合并为单次请求状态机。
- 题库/导入/更新/同步：检查是否在点击反馈前串行执行全量目录下载、ESQ 解析、数据库迁移或 LAN 请求；所有长任务采用立即显示 busy 状态、分阶段进度和可取消/后台执行。
- 错题本：检查重做启动和分析是否在同一点击链路中加载整篇数据；重做按钮只等待 session 创建，分析异步展开。
- 模型设置：检查同步模型是否把网络请求、模型列表重排和整页响应式重渲染绑在一起；输入框采用按需保存，避免每次输入触发全量配置序列化。
- 竖屏：对上述每个入口用 1.35 字体和窄宽度重复点击测试，特别检查折叠区展开后是否一次性渲染隐藏内容。

## UI 问题逐项方案

1. “查看全部题库”移入题库配置卡片操作区，与“管理/回收站”同一排；桌面横屏保持紧凑，竖屏允许换行。
2. 单词本筛选项默认折叠为“筛选”按钮，展开后显示今日复习、高频词、学习中、已掌握、等待翻译等选项；保留当前选中项摘要和数量。
3. 卡顿按 P0 方案处理；不以增加 loading 动画掩盖阻塞。
4. 错题本将“重做/分析”改为紧凑图标或短文本操作，分析移入更多菜单或二级行；标题和完型填空信息区域优先保留宽度。
5. 模型配置重排为窄表单：名称、协议、Base URL、密钥采用两列/自适应网格；高级参数和系统提示折叠；模型管理工具栏只占一行并允许横向换行。参考 OpenAI 官方 API 文档对 base URL、认证和模型参数的分组语义，不复制桌面视觉。
6. 自动同步页：同步地址、口令、自动同步归入“连接”折叠区；同步类别、状态和操作分为两列；远程题库目录与程序更新独立折叠，横屏利用右侧空间，竖屏单列。
7. 删除诊断日志隐私说明等小字辅助文案；保留必要的错误、数量和操作反馈。
8. 所有筛选选项统一使用带勾选指示的 checkbox/radio 视觉组件，组件状态、键盘焦点和禁用态一致；同步类别作为基准样式扩展到单词本、错题本、题库目录和更新筛选。
9. 单词本补全改为翻译请求参数：用户启用“补全词形与例句”后，翻译任务同时要求词性、词形变化和例句；移除独立补全按钮。提示词明确使用中文描述单复数、过去时等时态/词形，不输出英文标签。失败和重试仍走原有后台队列。
10. 单词显示界面重构为记忆优先：词形与音标置顶，常用释义为主层，语境义/例句/辨析/记忆提示分层折叠；操作固定在底部，窄屏一次只显示一个详情层。GitHub 项目仅作交互参考，最终以本项目数据字段和复习流程为准。
11. 题库页去掉题库配置上方独占图标和多余留白；题库配置、管理、回收站、批量管理置于同一操作行；“查看全部题库”并入该行。横屏按四项并列，竖屏两行自适应。

## 验收门槛

- 手机竖屏/横屏、系统字体 1.35：首次点击今日到期在 200ms 内出现明确反馈；评分点击在 200ms 内显示下一张或明确处理中状态。
- 单词详情切换不因相似词或出现记录查询阻塞主内容。
- 题库、错题、同步、模型、导入、更新各有一次点击响应计时；发现任一 >500ms 需纳入同一轮性能修复。
- P0 修复前后保留查询数、payload、端到端耗时证据；性能优化不能破坏 expected_revision、同步一致性、SecureStore 和后台翻译语义。

## 资料

- Vue 官方性能指南：https://vuejs.org/guide/best-practices/performance.html
- Vue 官方异步组件与代码拆分：https://vuejs.org/guide/components/async.html
- MDN Long Tasks API：https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming
- Capacitor 官方性能与调试入口：https://capacitorjs.com/docs/guides

这些资料用于测量和拆分渲染/异步任务；具体修复仍以本项目源码和真机数据为准。

## 实施结果（2026-09-13）

本轮按 P0–P3 四级推进，全部改动已在本地源码与门禁中验证；真机横竖屏和 1.35 倍字体验收由用户执行。

| 级别 | 范围 | 落地改动 |
| --- | --- | --- |
| P0 | 复习路径（今日到期、评分） | `frontend/src/views/VocabularyView.vue` 进入复习先渲染等高骨架卡（`reviewLoading` / `reviewLoadToken`），到期队列在后台落地后替换内容，卡片出现前不再停留在列表页；`frontend/src/platform/android/vocabulary.ts` 新增 `reviewAck`，评分响应只回传 `review_revision`、`next_review_at`、`review_count`、`review_stage`、`study_status`，单次评分不再付出出现记录查询和整本词库相似词匹配；复习队列刷新改为单飞 `dueRefreshPromise`。 |
| P1 | 详情与列表切换 | 既有提交 `f73f0bf` 已落地：`localSimilarMatches` 按词库版本缓存并加 2-gram 预筛（编辑距离 > 2 不上 DP），列表按 500 条批量读取出现记录，详情与列表共用轻量投影。 |
| P2 | 启动与其它功能区 | `content-remediation.ts`：新增 `readContentUnits` 批量投影（400 条一块）替换逐单元 3 条查询，`remediationSettled` 用 `app_migrations` 标记 + `content_revision` 计数探针跳过已收敛修订，`applyContentWithBackup` 在无待修单元时也写标记；`database.ts`：试卷元数据扫描与 `ordering-fixed-slots` 回填增加 pending 探针和一次性标记；`lan-sync-versions.ts`：`_sync_seq=0` 改为探针后按需 touch；`question-bank.ts`：新增 `probeBundledManifest`，已安装包只读 `manifest.json` 即返回 `alreadyInstalled`；`local-api.ts`：首页读路径不再等待内容修正（写入路径仍在 `publishEsqImport` 内 `await ensureContentRemediation`）。 |
| P3 | 首页与观感 | `DashboardView.vue`：`onMounted` 与 `android-startup-prepared` 合并为单飞 `homeLoad`，加载期间再次触发只补跑一次；`StudyTodos.vue`：加载文案换等高骨架，不再出现整块“正在加载”停顿；单词本骨架卡的按钮去掉了点击绑定。 |

验证：`frontend` 下 `corepack.cmd pnpm run test:all` = 63 passed / 0 failed（新增 `question-bank-bundled-probe.mjs`）；`pnpm run build`（`vue-tsc --noEmit` + `vite build`）通过；`cap sync android` 与 `gradlew assembleInternal -PappVersionCode=86 -PappVersionName=0.1.0-alpha.86` 通过；APK SHA-256 `D7595AFD02005E99CABB214B8B8A24D9F6EBDFBB24297E3168B87DB6CF217E4C`，签名 SHA-256 `b50d155c…de0a7` 与既有内测包一致，已覆盖安装到平板（HEY2-W09）和手机（PHK110），首次安装时间与用户数据保留。

未覆盖：真机端到端分段计时（点击到首帧、评分到下一张）、横竖屏与 1.35 倍字体的实际观感。
