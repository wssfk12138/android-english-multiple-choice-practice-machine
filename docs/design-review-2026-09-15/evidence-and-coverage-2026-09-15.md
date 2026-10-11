# 证据与覆盖范围

## 历史覆盖
DeepSeek Harness 元数据位于 `E:\DSHData\home\storages\workspace.json`；英语刷题机项目共 3 个顶层会话、11 个子会话、14 份日志。提取物与原始会话 JSON、可见回复和用户消息清单位于本目录。

## 源码覆盖
核验了 `VocabularyView.vue`、`VocabularyMemoryContent.vue`、`vocabularyDisplayConfig.ts`、`SettingsView.vue`、`AndroidSyncView.vue`、`AndroidDiagnosticsView.vue`、`AndroidUpdatesView.vue`、`ImportView.vue` 及相关样式。确认 note 字段、同步/诊断/导入动作和 API 菜单裁切风险均有真实实现依据。

## 已完成验证
- 原型为单文件 HTML，可直接用浏览器打开。
- 页面导航覆盖 11 个页面状态；主题切换、A/B/C 文案切换、API 省略号菜单均有脚本交互。
- 示例词汇、句子和题库名称均为合成内容。

## 尚未执行
尚未进行 Playwright/Edge 截图、真实平板无线验收、Android 构建、安装、性能 profiling 或源码测试；这些属于用户确认设计后的下一阶段。

## 风险边界
历史报告中关于必然滚动溢出、所有 rem 溢出、GPU blur 根因、统计数量矛盾和 1–2px 缺陷的表述均已降级或排除，需以现场证据为准。
