# AI 助手基础 Agent 与切页修复

核验日期：2026-09-09。状态：本地源码实现与合成验证完成，未部署到当前安装版，未同步公测。

## 已实现

- 模块级 assistantSession 保留消息、当前会话、草稿、附件、模型目录、请求和加载状态；离开路由不取消请求，返回继续显示。运行中禁止切换/删除会话，避免结果串入其他会话。
- 添加 Word 后进入受限文档任务：read_document、replace_paragraph、export_document。每轮模型返回 JSON 指令，应用解析、校验、执行，将真实工具结果回传下一轮。最多12轮，无任意路径、命令执行或自动入库。
- 展示真实等待、执行、完成和工具失败进度；不展示隐藏思维链，不提供 token 流式输出。
- DOCX 8 MiB、解压声明32 MiB、1000项、正文XML4 MiB、读取文字60000字符限制；原文件保留，按段落索引加 expected 原文匹配修改。表格单元格文字沿相同段落接口处理。
- DOCX 原包资源保留；混合字体文字替换集中到首个文字节点，复杂字段/图片/修订段落拒绝。复杂排版、DOC、PDF、OCR和题库自动批准不在本期。
- 工作副本按会话ID存入本机 IndexedDB，历史会话可继续编辑；Windows 浏览器下载，Android 使用原生系统分享面板保存或分享副本。当前副本可随时手动下载，模型未完成导出会明确提示。
- Windows 和 Android 都新增 agent-turn 与 agent-exchange；消息对原子保存。Android 历史读取改用标准解析，修正附件字符串和列表50条范围造成的读取问题。

## 验证

- 两端 frontend/tests/assistant-agent.mjs：真实 Chromium + 生产组件卸载/重挂载 + 延迟请求；消息、响应和输入草稿恢复。真实 DOCX ZIP 工具多轮、段落/表格修改、错误原文拒绝、源文件/图片不变、取消后拒绝迟到修改、Vue响应式对象持久化/回读/删除均通过。
- Android frontend/tests/assistant-agent-api.mjs：SQLite故障注入验证对话整轮回滚、历史解码和大小限制通过；既有 ai-adapters 合约通过。
- Windows tests.test_assistant_agent + tests.test_ai_client + tests.test_ai_adapters：15项通过；验证模型选择门禁、上下文透传及原子保存。
- 两端前端类型检查与生产构建通过；Android Capacitor sync、Gradle assembleDebug通过；两仓 git diff --check通过（既有CRLF提示）。

## 实际边界与后续

- 使用合成模型响应验证工具闭环，未调用真实付费模型；具体供应商的指令遵循率需一次实际体验。不是供应商原生function-calling接口，使用受限JSON工具协议适配现有文本模型接口。
- 应用内切页已覆盖；系统杀进程、刷新、Android后台保活/续跑不保证。普通对话仍在回答完成后落库；未完成轮次和进度仅在当前进程保存。当前会话选择不跨冷启动恢复，可从历史打开已保存会话。
- 文件只存当前会话一份工作副本及原始数据；再次上传替换该会话附件。不是完整文件版本库。IndexedDB受当前应用/WebView或浏览器来源约束，换端口或清数据不自动迁移。
- Android原生分享编译通过，未进行真机保存/Word打开验证；Windows未重新冻结或部署现有安装程序。Debug APK不能直接作为正式签名覆盖安装包。
- 公测两仓未改，未暂存、提交、推送、发布、清理或动真实数据库。两个开发树保留既有多批修改，终态为本地开发稳定态。

## 源码入口

- frontend/src/services/assistantSession.ts
- frontend/src/services/documentAgent.ts
- frontend/src/services/saveAssistantDocument.ts
- frontend/src/components/AiAssistant.vue
- Android frontend/src/platform/android/ai.ts、local-api.ts、DocumentExtractorPlugin.java
- Windows backend/app/routers/ai.py

