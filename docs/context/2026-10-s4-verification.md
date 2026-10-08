# S4 每日一学开发验证回执

> 2026-10-08。对应用户要求“先执行 S4，验收放到最后一起进行，及时进行本地提交”。代码、所述自动化和前端构建完成；安装与用户联合验收留到 S5。当前阶段以[综合阶段回执](2026-10-integrated-progress.md)为准。

## 实现范围

方案 A 独立页面路由为 /vocabulary/daily-study，从 Android 横屏单词本进入并传递当前筛选、搜索和题库范围。顶部显示范围与位置，横向导航最多 41 项，固定词头/前后按钮及单一纵向阅读区；释义、有效语境、真题原句与已有模型例句位于左栏，关联词、词形、记忆与笔记位于右栏。空栏目省略，重开默认展开。

左滑前词、右滑后词，水平位移须大于 72 且大于纵向位移的 1.6 倍。纵滑、多指、取消、文字选择、控件和导航排除误触；首尾不循环。切词过渡每段 260 ms，减少动态效果时使用 60 ms 透明度过渡；横竖屏、缩放和长内容保持控制区可达，尺寸变化后显露当前导航项。

整范围目录仅持有 id、term、sync_id 身份；复用既有列表筛选与稳定排序，短事务冻结目录与版本。数据库随机身份、题库真实身份、筛选/搜索与版本契约共同隔离阅读范围，避免数字 ID 复用串词。详情最多缓存 5 个，相邻预取最多 2 个在途；内容版本只清详情缓存，不重排本次目录。重新进入重查成员，失效当前项移到有效邻词。

每个范围保存当前词与最多 200 个滚动位置，最多保留 8 个范围。阅读状态保存到本地存储；失败显示“续看未保存”，可继续阅读。独立页面仅调用 GET 目录、状态与详情接口，不挂载单词本维护逻辑，不发起翻译/补缺、不修改复习字段。

## 文件与兼容性

| 文件（相对仓库根） | 目的 |
| --- | --- |
| frontend/src/platform/android/database.ts | 幂等增加本地数据库与题库身份；题库软删除/恢复保留身份，物理删除再创建改变身份 |
| frontend/src/platform/android/vocabulary.ts | 共用列表筛选和排序，新增轻量目录与 O(1) 状态读取 |
| frontend/src/platform/android/local-api.ts | 两个只读每日一学入口，复用既有词条详情 |
| frontend/src/services/dailyStudy.ts | 冻结会话、身份校验、有界缓存/续看、版本刷新和迟到保护 |
| frontend/src/views/DailyStudyView.vue | 方案 A 页面、手势/键盘、滚动/旋转及异常状态 |
| frontend/src/views/VocabularyView.vue、frontend/src/router.ts | 横屏入口、筛选往返与独立路由 |
| frontend/tests/daily-study-*.mjs | 真 SQLite 目录、会话不变量与真实 Vue 浏览器交互 |
| frontend/tests/run-all.mjs、frontend/tests/vocabulary-layout.mjs | 纳入浏览器前置检查，旧布局按钮定位明确为“每日一背” |

S4 未修改 ESQ 或 LAN 数据协议，身份表仅为 Android 本地附加数据；未向 Windows 同步源码、数据库、版本或签名。

## 自动化与构建

命令均在 Android 权威树的 frontend 执行，Node 24.18.1。浏览器测试挂载当前真实 Vue 组件与路由，使用合成 API、原生方向标记和隔离 Chromium；目录测试使用临时真实 SQLite。均未连接真实用户数据库或付费供应商。

| 命令 | 结果与证明范围 |
| --- | --- |
| node tests/daily-study-catalog.mjs | PASS；1203 项轻量目录、筛选/排序、数据库/题库/词条身份与只读边界 |
| node tests/daily-study-session.mjs | PASS；第 1203 词续看、删除/身份复用、版本不重排、缓存上限、200 位置上限、失败重试与迟到/卸载保护 |
| node tests/daily-study-browser.mjs | PASS；真实入口至页面、全部导航组到末词、滚动/重开、手势排除、旋转、版本、零新增写请求、错误/空/退出、长词长内容、明暗主题及最大 200% 字号 |
| node tests/vocabulary-layout.mjs | PASS，168 场景；既有单词本、编辑与两种复习滚动模式及首屏加载状态 |
| node tests/vocabulary-content-revision.mjs | PASS；内容版本与范围回归 |
| node tests/database-migration.mjs | PASS；数据库迁移回归 |
| node tests/vocabulary-due-queue.mjs、node tests/vocabulary-review-revision.mjs | PASS；到期队列与复习版本回归 |
| node tests/vocabulary-context-remediation.mjs、node tests/vocabulary-identity.mjs、node tests/vocabulary-snapshots.mjs | PASS；语境、身份与快照回归 |
| corepack.cmd pnpm run build | 退出 0；vue-tsc 和 Vite 生产构建通过，保留已有混合导入与大分块提示 |
| git diff --check、git diff --cached --check | 退出 0，无新增空白错误 |

旧布局测试最初因新增入口使通用按钮选择器匹配两项而失败，现明确匹配“每日一背”，原业务断言保留。每日一学浏览器测试有一次入口加载超时，单独复跑通过；其 Vite 优化缓存随后改为测试专属目录，修改后再次通过，并增加失败时的页面错误输出。该次超时的根因未取得完整现场证据，不据此认定应用故障或声称并发测试稳定性已证明。

S4 当时没有重跑全量 strict，S2/S3 历史 89 PASS/2 FAIL 保留。随后整体审查实测 91 PASS/3 FAIL/94 TOTAL，新增确认 vocabulary-manual-edit 缺少 S4 路由和图标桩，20 个场景失效。2026-10-08 收尾已修复这三个失效门禁，人工编辑 20/20 及最终 strict 95 PASS/0 FAIL/0 PREREQ 通过；当前源码/前端构建绑定与剩余 S5 项统一见[综合阶段回执的收尾证据](2026-10-integrated-progress.md#收尾-c0c5当前代码与自动化证据)。下文源码指纹仍为原 S4 历史构建。

基于 s4-development-20261008 的任务差异报告已生成，文件变化仅计本轮增量。静态图差异为 partial（基线或当前图不是 fresh），节点/关系计数不作为完整调用影响或 API 兼容性证明；结论以当前源码、定向测试和实际构建为准。

## 源码、产物与运行证据

S4 最终代码提交为 e0bd119b004885e63dba0b275ad6153289830919，分支 main。最终构建时的相关未提交源码随后原样保存到该提交；绑定清单采集时已跟踪工作树无差异。前端构建输入 172 文件、输出 frontend/dist 共 50 文件/14,417,059 字节，逐文件 SHA-256 清单保存在私有回执；清单指纹使用按路径排序的记录 JSON（含路径、字节和 SHA-256）计算：

    源码输入：4324e71e619a593e6b20e27365a22a492c52c2bacd02b59df0b5c9ca84a1dd5c
    前端产物：d58959242db4d9d7ce53514fd55f26233bcd6f668bcf2eeaa6409905de9cd0d8

实际运行证据来自随机回环端口的 Vite/Chromium 测试服务，加载本权威树当前源码；测试结束服务与浏览器关闭。浏览器用户入口路径“单词本 → 每日一学 → 读卡/导航/返回”通过，但数据和原生信号为合成环境；这不证明 Android 安装实例加载了本轮前端产物。

本轮未执行 Capacitor 同步、Gradle APK 构建、安装或设备验收。S2/S3 旧 Debug APK 不含本轮 S4 页面，不能作为 S4 安装包。前端 dist 及私有证据未提交；后续仅文档收尾不改变上述构建输入。

## 本地回退点与 S5

| 提交 | 保存内容 |
| --- | --- |
| 397b527 | 进入 S4 前已有工程成果，包含此前 S1/S2/S3 工作；不计作本轮新功能 |
| 6c2306a | S4a 冻结目录、稳定身份与续看会话 |
| d3d2f2d | S4b 只读横屏页面、入口/路由与浏览器检查 |
| e0bd119 | 导航缩放可见性、容量/全目录补充验证与旧布局测试适配 |

这些提交仅在本地；回退时按需撤销所选后续提交，避免硬重置覆盖新成果。原有未跟踪资产保留，源码提交不备份设备数据库，也不能把旧程序与新数据库的兼容性视为已经实机证明。

S5 仍需在同一最终源码上核对受影响集成门禁、获批签名/递增版本构建与产物来源、目标安装版本，以及真实 Android 横竖屏/字体/滚动/重开、SQLite 升级与数据保留、计时/音频/前后台组合和原生请求桥。真实供应商格式、慢响应、截断、用量与费用仍未实测。安装、付费请求、推送、发布、通道更新与跨仓同步不从本地开发/提交授权自动推导。
