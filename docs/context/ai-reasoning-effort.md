# AI 学习助手：模型推理强度档位 —— 可行性报告与决策参考

> 更新：2026-08-28。用户已确认的决策见文末“决策记录”；本文件作为后续开发的行为与范围基准。

## 结论

可行，且改造面很小。本项目所有 AI 调用都汇聚到 `frontend/src/platform/android/ai.ts` 的 `chatCompletion()` 一个函数，加一个请求体字段即可让助手对话、智能标注、错题分析、单词翻译、文档导入校对同时生效。参照 Codex 档位做 UI 和参数映射没有技术障碍；主要风险在“不同供应商对 `reasoning_effort` 参数的兼容性”。

## 现状调查（源码证据）

| 项 | 现状 |
| --- | --- |
| 对话入口 | `frontend/src/components/AiAssistant.vue`（`/assistant`），发 `profile_id + model + message` 到 `/ai/chat`，无推理参数 |
| 请求构造 | `chatCompletion()` 只发 `model / messages / temperature / response_format`，POST `{base_url}/chat/completions` |
| 调用方 | 8 处：测试连接、助手对话、单词翻译、错题分析、文档导入模型辅助 ×3、智能标注 |
| 配置存储 | `ai_profiles` 已有 `temperature / max_tokens / system_prompt / default_model`；`ai_profile_models` 记录 provider（openai-compatible / ollama） |
| 迁移机制 | `app_migrations` + `ensureColumn()` 幂等加列 |
| 网络 | 非流式单请求，读超时 60 秒（`native-http.ts`） |

现状补充：`max_tokens` 字段存在但当前未发送（设置页已标注“已停用”）；传输为非流式。

## Codex 档位与官方 API 参数

依据 OpenAI 官方文档（[Reasoning models](https://developers.openai.com/api/docs/guides/reasoning)，2026-08 核验）：

- 支持值随模型而定，可包括 `none / minimal / low / medium / high / xhigh / max`；档位越低越快越省 token，越高思考越完整。
- 默认值也因模型而异（示例：gpt-5.5 默认 `medium`）；省略参数即用模型默认。
- 官方推荐新接口为 Responses API 的 `reasoning: { effort }`；本项目所用 `/chat/completions` 为传统端点，推理模型同样接受 `reasoning_effort` 参数，兼容性依供应商而定。

即 Codex 的“档位”是产品层概念，落到 API 就是枚举参数。

## 改造方案（用户已确认范围）

1. 档位：仅 **低 / 中 / 高** 三档（`low / medium / high`），对应 OpenAI 兼容端点最通用的取值；不引入 none/minimal/xhigh/max。
2. 层级：**API 配置级默认值 + 助手对话内会话级切换** 两者都要。
   - profile 级：`ai_profiles` 加 `reasoning_effort TEXT DEFAULT ''`（空 = 跟随模型默认），设置页 API 卡片加下拉。
   - 会话级：助手工具栏模型选择器旁加档位选择，随 `/ai/chat` 请求传入，覆盖 profile 默认。
3. 请求层：`chatCompletion()` 增加 `options.reasoningEffort`，非空时向请求体加入 `reasoning_effort`；未设置（默认）时不发送字段，避免严格端点对未知参数返回 400。
4. 数据：`ai_profiles` 加列走现有 `ensureColumn` 风格迁移；对话消息可选记录档位（第一阶段可不做历史恢复）。
5. 其他：错题分析、单词翻译、智能标注、文档导入等全部调用方自动继承 profile 级档位。

## 风险与决策点

1. 供应商兼容性（最大风险）：严格端点对未知字段可能返回 400。缓解：默认不发送；按 provider/模型判断或手动选择。Ollama 本地端点通常忽略未知字段。
2. 非推理模型不支持：老模型传参可能被忽略或报错，靠“默认不发送 + 手动选择”兜底。
3. 高档位超时：非流式 + 60s 读超时下高档思考可能超时；低/中/高三档中仅“高”需留意。批量标注默认建议中低档。
4. `max_tokens` 缺口：官方规定输出上限包含思考 token；当前不发送 `max_tokens`，若未来补发需把思考 token 计入。
5. 密钥与数据边界：档位为普通请求参数，存 profile 设置表而非 SecureStore，无泄露风险。

## 验证与验收（简化）

- 前端生产构建（vue-tsc + vite）。
- 相关契约/设置测试更新。
- 真机抽查：设置页下拉保存生效、助手工具栏切换后请求体正确、各供应商（OpenAI 兼容、Ollama）低中高三档可用、默认档不发送参数。
- 无原生改动，不需 Gradle 门禁。

## 决策记录

- 2026-08-28：用户确认 ① 低中高三档；② profile 级默认 + 会话级切换都要；③ 本报告存入 `docs/context/` 并更新 NOW.md 待办；④ 开发放入新对话执行。
- 后续开发范围、风险缓解与验收以本文件为准。
