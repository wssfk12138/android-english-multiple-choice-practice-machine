# 2026-09-16 横屏整改实施核对

> 后续更新：09-17 已完成单词本双设备隔离诊断构建、安装和性能对照，详见[性能修复回执](2026-09-17-vocabulary-latency.md)。下文“未安装/待真机”是 09-16 阶段快照，当前状态以 NOW 和该回执为准；其他功能的原生验收不能由词汇测试替代。

## 当前结果和依据

已在 Android 开发权威树实现最终方案的七个 UI 区域和可以由源码、请求次数证明的加载读取整改。依据为旧任务 `01a0a7d2-655c-7a60-844b-11ef1ea52fb9` 最后形成的[方案和预览](../../design-review-2026-09-16/selected-revision/README.md)及[决定清单](../../design-review-2026-09-16/selected-revision/decisions.md)。此前 R3、9 月 15 日方案仅用于追溯，冲突处采用最后预览。

当前任务 `01a0a91a-be52-7402-b073-35c5eb451c2f` 中用户明确要求接手、开始修改、使用新技能、仅针对横屏复原最后预览、沿用旧主题并自行逐项检查，另要求汇报发现的其他问题。已采用 engineering-code-generation 的任务基线和变更报告，以及 powershell-landmines 的 Windows 操作约束。未新建任务。

**这里的完成指源码与本地验证完成。未构建/安装 APK，未做真机重启、原生 SecureStore 端到端或同设备性能前后对照，不能据此称设备上的卡顿已经消除。** 当前状态以 NOW 为准，历史设计材料中的“暂不开发”保留为当时快照。

## 逐项落实

| 项目 | 实现与检查 | 结论/边界 |
| --- | --- | --- |
| 每日一背 | Android 横屏卡片名义宽 680、高 432.67 CSS px；评分按钮宽 156；实际释义/原句和操作区揭示前隐藏并 inert 留位；内容快照防止异步补缺改变当前卡；横屏不显示词形/笔记 | 168 个布局场景通过，涵盖主题、字体、长内容、揭示、旋转及不重复评分。长内容允许自然增高/滚动；真实安全区与物理尺寸待设备验收 |
| 单词本设置 | 原 11 个配置键按 4+6+1 分组、两列；保留已有值；合并维护状态、进度及三个同行按钮；失败可见且可重试 | 亮/暗主题浏览器实页验证。未增加组内全开/全关 |
| 设置首页 | 单列分组、行内留白压缩，点击区域至少 44；单词本设置右侧显示开启数；主题开关右开左关 | 首次无偏好使用亮色；已保存选择保留；复用应用主题状态 |
| 模型与 API | 原折叠卡全部默认关闭；连接/命名密钥两列；常显两行及额外当前名；小开关保留 44 点击区域；默认模型、强度、测试、设默认同行 | 浏览器验证展开、改名、添加表单、额外当前密钥与主题；密钥仍走原 SecureStore 接口。真实原生写入待验 |
| 自动保存 | 文本约 500ms 合并、失焦提交，选择立即提交；配置串行、最新意图优先；无效地址保留草稿；离页/旋转保留配置/密钥草稿与失败状态；成功后才显示已保存 | 队列和快速默认切换测试、失败重试、旋转、无自动测试请求通过。草稿为当前应用会话内存状态，不承诺进程被杀后保留未保存输入 |
| 首页题型图标 | 横屏替换为淡色底线图标，维持旧布局、卡片与显示条件 | 最后截图发现旧玻璃样式覆盖背景，已修正并新增实际背景色断言；亮暗均通过 |
| 错题操作 | 三按钮同排常显、68.3294 CSS px 名义宽、49 高；四字标签两行；有报告时始终可查看，重新分析置于独立页 | 浏览器实页无横向溢出；平板 145/146 物理像素目标待实机缩放核验 |
| 分析独立页 | 横屏入口、完整报告、按时间切换、进度/失败；返回恢复筛选、年份/篇目展开和滚动；分析任务状态跨离页保留 | 离线历史切换及返回浏览器检查通过；恢复字段源码核验，真实设备返回栈/滚动待验 |
| 分析存储与删除 | 复用原报告表和回收站；共享报告按篇目拆关联；恢复合并，过期/彻底删除清理；兼容旧回收条目及题库/试卷删除 | 真实 SQLite 的测试夹具覆盖共享、批量、恢复、旧记录幂等、孤立记录清理；未新增独立永久归档或数据表 |
| 首页读取 | 启动准备仅在内容确有变化时触发后续刷新；避免待办因无关刷新重新挂载 | 浏览器记录首次 startup/todos 各一次；无变化不追加请求，有变化会刷新 |
| 单词本与补缺 | 前台列表先读，后台翻译调度随后；补缺批次主动让出事件循环 | 相关任务/词汇测试通过；不声称已经测得真机耗时改善 |
| 修正清单 | 构建生成摘要，只有摘要/修订状态不一致时重新解析校验；缺失门控信息回退完整校验 | 未变摘要、变更摘要、缺失 revision/header/probe 等门控测试通过 |
| 既有内容/词汇整改 | 总整改计划中的 A/B 既有 R1–R11 按当前实现保留，用完整相关门禁检查 | 未重做已经实现的导入、翻译、手动编辑、队列与 ESQ 能力；没有把旧已交付功能误记为本轮新增 |

## 本轮文件用途

以下均为相对仓库路径；基线是开始编辑前的 `remediation-20260916-takeover`，因此不会把原有设计文档改动计作本次开发。逐文件新增/删除行数及代表性差异在本地 `.codex-local/remediation-change-report.md`，该目录不提交。

| 文件（frontend/ 下） | 目的 |
| --- | --- |
| src/App.vue | 统一主题状态，默认亮色 |
| src/composables/useThemeState.ts | 在设置和应用壳间共享主题选择 |
| src/composables/useAndroidLandscape.ts | 跟随平台/方向标记，旋转响应及卸载清理 |
| src/components/NamedModelKeys.vue | 两行命名密钥、额外当前名、添加改名删除、保存反馈 |
| src/components/StudyTodos.vue | 避免重复挂载带来的重复读取 |
| src/components/VocabularyMaintenance.vue | 复用维护接口，合并状态/进度/操作，轮询单飞和清理 |
| src/main.ts | 启动内容变化事件携带刷新条件 |
| src/platform/android/ai.ts | 接入已有报告的历史查询 |
| src/platform/android/content-remediation.ts | 摘要与修订状态门控，保留首次完整校验 |
| src/platform/android/local-api.ts | 注册分析历史本地只读入口 |
| src/platform/android/practice.ts | 错题删除/恢复联动分析报告 |
| src/platform/android/question-bank-profiles.ts | 回收站旧关联补齐和最终清理 |
| src/platform/android/vocabulary-enrichment-runner.ts | 后台补缺批次让步 |
| src/platform/android/wrong-analysis-history.ts | 报告查询、共享关联拆分/合并及回收生命周期 |
| src/router.ts | 注册独立分析页 |
| src/services/configAutosave.ts | 合并、串行、失败重试的自动保存队列 |
| src/services/keyDrafts.ts | 当前会话密钥编辑草稿及状态保留 |
| src/services/profileDrafts.ts | 配置草稿、全局默认最新意图和串行协调 |
| src/services/wrongAnalysisSessions.ts | 篇目分析请求跨切页的进度/错误状态 |
| src/services/wrongListReturn.ts | 错题列表返回状态 |
| src/settings-hub.css | 横屏设置行、开关、合并页布局 |
| src/study-theme.css | 横屏复习卡比例、预留与按钮位置 |
| src/views/AndroidVocabularyDisplayView.vue | 11 项原配置分组、两列与维护合并 |
| src/views/DashboardView.vue | 横屏淡色底线图标与有效刷新条件 |
| src/views/MobileSettingsView.vue | 设置入口计数、主题开关与去除重复维护入口 |
| src/views/SettingsView.vue | 原折叠卡双列、自动保存与操作排列 |
| src/views/VocabularyView.vue | 留位快照、横屏内容边界、前台读取优先 |
| src/views/WrongAnalysisView.vue | 完整历史、重新分析及错误/进度 |
| src/views/WrongView.vue | 横屏三按钮、保留查看入口与返回状态 |
| tests/config-autosave.mjs | 合并/串行/失败重试行为 |
| tests/profile-drafts.mjs | 多配置切换与默认模型最新意图 |
| tests/remediation-startup-gate.mjs | 摘要门控及回退 |
| tests/wrong-analysis-history.mjs | SQLite 共享/批量删除、恢复和清理 |
| tests/database-migration.mjs | 新增异步让步所需运行沙箱能力 |
| tests/settings-layout.mjs | 最终横屏设置行为适配 |
| tests/ui-omissions.mjs | 最终 UI 范围断言 |
| tests/vocabulary-enrichment-jobs.mjs | 后台让步所需运行沙箱能力 |
| tests/vocabulary-layout.mjs | 当前卡片内容与揭示/旋转布局验证 |
| tests/vocabulary-manual-edit.mjs | 异步让步所需运行沙箱能力 |
| vite.config.ts | 构建修正清单摘要 |

项目记录仅更新 PROJECT_INDEX.md、docs/context/NOW.md 和本文件。历史方案及用户原有资产保留。

## 验证证据

- `node tests/run-all.mjs --strict`（frontend）：73 passed，0 failed，0 prerequisite skipped，149.4 秒。包含 168 个词汇布局场景及既有内容、导入、ESQ、队列等回归。
- `npm.cmd run build`（frontend）：vue-tsc 类型检查和 Vite 构建通过。最后样式覆盖修正后再次构建。
- `node .codex-local/final-remediation-ui.mjs`：实际 App/main/router/样式，合成 API、外网阻断；1280×800 亮暗两套实页验证通过，覆盖七区中非复习页截图、API 保存/无效输入/重试/旋转、历史和启动请求次数。复习页由前述 168 场景矩阵覆盖。
- 浏览器回归另外覆盖模型可见性保存失败后离开设置页、重新进入仍保留失败状态并可重试，以及错题筛选、年份/篇目展开、分析页返回后的筛选/展开/滚动恢复。
- 截图存于 `.codex-local/final-remediation-ui/`，复习矩阵截图位于 `.codex-local/remediation-ui/`；含合成数据，不视为真机截图或真实 API 成功凭证。
- `git diff --check` 用于检查补丁空白；工程技能基线报告包含静态图差异。静态图为 partial 近似，不作为完整架构兼容证明。

## 额外发现与剩余风险

1. **已修正的实现问题：** 最后截图核查修正了显示选项被全局样式挤成行内布局、API 折叠摘要出现浏览器默认 Details、报告存在时仍显示空记录提示、首页淡色图标背景被旧样式覆盖；保存队列补齐快速默认切换/删除后的状态处理。对应测试或最终截图已复核。
2. **构建体积警告：** 主 JS 约 843 kB（gzip 约 265 kB），超过 Vite 默认 500 kB 警告阈值；question-bank、question-bank-profiles、diagnostics 同时静态/动态导入，不能按当前动态入口单独拆块。构建成功，这不直接证明它们是横屏卡顿根因。建议后续以设备加载分段数据决定拆分范围。
3. **分析历史容量风险：** 当前查询读取全部报告正文后按篇目筛选，大量历史会增加读取与解析开销。未做长期容量测量；后续可在有数据证据时改为篇目索引/按需正文加载，保留旧关联兼容。
4. **旧回收数据边界：** 缺少状态关联且删除/新报告发生在同一秒的极旧记录，时间与 ID 证据可能不足以完全重建先后关系；已用删除时间和可用状态 ID 限定，不宣称所有历史损坏数据均可恢复。
5. **待真机验收：** 横竖屏旋转、物理按钮宽度/安全区、字体、原生密钥保存、退出重启后历史、真实回收/恢复；性能按同设备同数据的冷/热启动、首次/重复进入和后台空闲/忙碌分段计时。未经此步骤，最终方案中的“性能改善可量化”尚未完成。

## 保存和交付边界

应用源码已在当前工作树；未暂存、提交、推送、发布、跨仓同步、调用真实付费模型或改设备数据。任务开始前工作树已有文档和设计资产，基线报告将其与本轮开发区分。准备叠加下一阶段前建议保存一次仅包含获批文件的本地提交；这不等于设备数据库备份。
