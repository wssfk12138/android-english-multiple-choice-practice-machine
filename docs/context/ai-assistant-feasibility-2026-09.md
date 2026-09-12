# AI 对话助手三项能力可行性调查（2026-09）

> 本文为最初调查与后续扩展建议。2026-09-09实际最小实现与验证以 [实施回执](history/2026-09-assistant-agent.md) 为准；本轮没有实现ai_runs/events、SSE、后台保活或公测同步。

## 修改前现状

- Windows（`E:/EnglishPracticeMachine/Codex/2026-08-02/ba`）和 Android 均有 `ai_conversations`/`ai_messages`，历史消息可查询。
- 两端 `/ai/chat` 都等待完整回答一次性返回；Windows OpenAI Chat明确stream:false，Android该接口默认非流式，部分其他适配器缓冲上游流。前端占位不能视为真实模型进度。
- `AiAssistant.vue` 将输入、消息和 `AbortController` 保存在组件内，组件卸载时主动 abort；运行中的用户消息、部分回答和进度没有持久化。因此切换到其他功能会丢失当前轮次。
- Windows 已有 `docx_parser.py`、导入草稿校验、模型辅助导入和 DOCX 片段生成；Android 原生 `DocumentExtractorPlugin` 可读取 DOC/DOCX/PDF 文本，但没有通用 Word 写回能力。

## 可行性结论

| 需求 | Windows | Android/平板 | 结论 |
| --- | --- | --- | --- |
| 实时任务进度/思考显示 | 高：FastAPI 可增加 SSE/WebSocket，后端已有独立服务和流式依赖实践 | 中高：本地 API 可增加事件流或轮询，原生层需处理后台生命周期 | 可行，需统一事件协议 |
| 受限 Agent 工具修改 Word | 高：复用 `python-docx`/现有解析与草稿服务 | 中：应在 JS/原生本地生成 DOCX，或把受限修改交给配对 Windows 服务 | 可行，但必须采用白名单工具和预览/批准 |
| 切换功能后对话不消失 | 高 | 高 | 可行，关键是把运行轮次变成持久 Job，并取消“组件卸载即 abort” |

## 推荐架构

### 1. 统一运行与事件协议

新增 `ai_runs`（run_id、conversation_id、status、started_at、finished_at、last_seq、error）和 `ai_run_events`（run_id、seq、type、payload、created_at）。事件类型建议：`run.started`、`step.started`、`reasoning.delta`、`assistant.delta`、`tool.call`、`tool.result`、`step.finished`、`run.completed`、`run.failed`、`run.cancelled`。

“思考过程”只显示模型或 Agent 明确输出的可展示摘要、阶段名、工具调用和结果；不要把供应商隐藏 chain-of-thought 原样写入数据库或 UI。没有 reasoning 流的模型显示阶段进度和已用时间即可。

Windows 使用 `POST /ai/runs` 创建任务、`GET /ai/runs/{id}/events?after=` SSE（断线可用序号续传）、`POST /ai/runs/{id}/cancel`。Android 本地 API 复用同一语义：前台优先事件流，后台/不支持流时按 `after_seq` 轮询；事件先落 SQLite，再推送到 Vue。

适配器层新增 `stream_chat`，把 OpenAI/DeepSeek SSE 的 reasoning、content、tool-call 增量映射到上述协议；Responses、Anthropic、Kiro 无统一流格式时做适配器专用解析，失败则回退同步调用并产生阶段事件。

### 2. 受限 Word Agent 工具

第一期只提供面向题库导入的工具，不提供任意路径读写：

- `import.inspect_document`：读取已选文件并返回结构摘要、文字层可靠性和页/段落范围。
- `import.get_draft`：读取当前导入草稿及字段路径。
- `import.patch_draft`：按 JSON Patch 修改允许字段，服务端做类型、长度、题号连续性和答案范围校验。
- `import.validate_draft`：调用现有 `validate_draft`，返回警告/错误。
- `import.generate_docx_preview`：生成隔离的预览 DOCX，不覆盖源文件。
- `import.approve`：仅在用户明确点击批准后写入题库。

工具需限制在用户选择的文档副本内。用户明确要求修改并输出即授权副本修改，不逐段重复确认；覆盖原文件和正式入库需单独用户操作。扫描版或无可靠文字层PDF继续明确提示人工处理。

Windows 优先复用 `docx_parser.py`/`import_assist.py` 和 `python-docx`。Android 先复用现有解析结果和草稿 JSON；DOCX 写回可采用受限 JS/原生 ZIP XML 生成，复杂版式则通过已配对 Windows 服务执行并回传预览，不能把 Windows 数据库或密钥复制到 Android。

### 3. 跨页面持久化

后续持久任务方案可在发送时立即落库user消息与ai_runs、逐序保存事件。Android后台继续运行须另行实现原生任务服务；不能从应用内切页成功推断系统后台保活或杀进程恢复。当前最小实现仅通过共享状态实现应用内切页继续运行。

前端建议抽出共享 `useAiConversationStore`（Windows/Android 各自适配 API），维护 `activeRunId`、消息草稿、步骤、工具卡片和订阅；历史列表显示运行状态。

## 分阶段实施与验收

1. **基础持久化与不中断**：先加 `ai_runs/events`、全局 store、卸载不 abort、恢复未完成轮次。验收：发送后切换首页/题库/设置再返回，用户消息、阶段和最终答复完整；断网/进程终止显示可重试状态。
2. **真实流式进度**：实现 OpenAI/DeepSeek SSE 到统一事件，增加 reasoning 摘要、阶段时间线、工具调用卡片和取消接口；再接 Responses/Anthropic/Kiro。验收：增量顺序、断线续传、重复事件去重、取消和错误状态。
3. **导入 Agent 工具**：先接 inspect/get/patch/validate，加入人工批准和预览下载；再评估 Android 本地 DOCX 写回或 Windows 配对执行。验收：只能修改当前导入草稿，源文件不变，非法 patch 被拒，批准前不入库。
4. **跨端一致性与发布门禁**：Windows 两树和 Android 两树逐项同步协议/类型/测试；执行前端构建、Capacitor sync、Gradle Debug、Windows 定向测试和真实切页/旋转/后台场景。

## 主要风险与取舍

- 不同供应商对 reasoning、SSE、tool calling 支持不一致，必须能力探测与同步回退。
- 真正隐藏思维链不应展示；产品应展示可审计的任务进度/摘要。
- Android 后台执行受系统限制，长任务应使用前台服务或可恢复 Job；第一期可在进程存活时完成，进程被杀后提供恢复/重试。
- Word 任意编辑的安全和版式风险高，题库导入场景的字段级 patch 与预览批准比“开放文件系统 Agent”更可控。
- 四个工作树独立，协议可逐项同步，禁止整仓覆盖；实现阶段仍需保持 Android/Windows 数据库、密钥和发布边界。
