# Android 启动性能审查（2026-09-13）

本记录是报告性审查，未修改性能路径。结论来自当前源码和可重复的模块级合成探针，不能替代真机端到端计时。

## 已确认的工作量

- `frontend/src/platform/android/content-remediation.ts`：启动相关请求经过 `ensureContentRemediation`。对 65 个已匹配且无需修正的题库单元，探针两次运行均执行 195 次数据库查询（每单元 lookup/options/questions 三次），结果 `needed=0`。真实工作量还会随实际匹配单元数变化；模块级 memoization 只覆盖同一进程内调用。
- `frontend/src/platform/android/question-bank.ts`：`installBundledQuestionBanks` 先读取并解析 ESQ，再检查已安装包/版本；内测构建启用 bundled question banks，两个资源按顺序处理。已安装且版本满足时仍存在读取和解析成本。
- `frontend/src/views/DashboardView.vue`：`/startup`、词汇首页、试卷列表通过 `Promise.allSettled` 并行请求；`onMounted` 与 `android-startup-prepared` 都可能触发 reload。并行降低等待叠加，但重复 reload 会增加数据库和渲染工作。
- `frontend/src/platform/android/database.ts`：每个新建数据库连接会对 9 张表执行缺列/缺时间字段的 UPDATE 检查（18 次条件扫描），连接缓存后不会每次 API 调用重复创建。
- `frontend/src/platform/android/local-api.ts`：多数启动首页路由等待内容修正；词汇、AI、设置和模型路由绕过该步骤但仍等待数据库。

## 优先级建议

1. 先采集真机 cold/warm 的页面可见时间，并把 remediation、ESQ 解析、Dashboard reload 分段打点；没有分段计时前不应把某一条路径认定为唯一根因。
2. 若数据证明 remediation 占主导，按单元批量查询或按 manifest/package 版本建立一次性跳过条件，并保留迁移与备份语义。
3. 若 ESQ 读取占主导，先读取包头/版本元数据再决定是否解析完整资源，并保持损坏包可恢复。
4. 若重复 reload 占主导，合并启动事件与 mounted 触发，并以单次请求状态机守住失败重试。

## 限制

当前未取得真实设备端到端页面计时；195 次查询是合成数据证据，不是手机耗时或百分比。性能路径按用户授权保持只读审查。
