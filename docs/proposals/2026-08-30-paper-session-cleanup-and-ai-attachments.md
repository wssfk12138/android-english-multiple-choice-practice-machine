# 立项方案：整卷空会话修正 + 学习助手文件上传（仅方案，未实施）

> 2026-08-30。两任务均为可行性探索与具体方案，本轮未改任何代码。
> 证据均来自当前四仓源码与真机验收记录（`.codex-local/acceptance-20260830.md`）。

---

## 任务一：整卷入口立即产生"进行中 · 已做 0/6 篇"空会话

### 根因（已源码核实）

- `platform/android/practice.ts` `createSession()`（约 401–471 行）：`mode:'paper'` 进入即
  `INSERT INTO practice_sessions (... status 默认 'active')`，随后逐题插入空 `practice_answers`。
  会话从点"开始整卷/继续练习"那一刻就已落库，与是否作答无关。
- `routers/papers.py`（Windows 同构 SQL，Android 本地 `listPapers()` 同口径）：列表以
  `practice_sessions.status='active' AND mode='paper'` 关联出 `active_session_id`，
  前端据此显示"进行中 · 已做 X/6 篇"徽章和"继续练习/重新开始"按钮。
- 首页题型卡（`mode:'random'`）的会话没有 `paper_id`，所以同样落库但永远不显示徽章——
  这解释了手机端"随机单刷无痕迹"的对照现象。
- 现有复用逻辑（practice.ts 417–429 行）：paper 模式再次进入会自动复用最近 active 会话，
  因此"抑制展示"不会破坏续练能力。
- 风险面：`practice_sessions` 在 `LAN_SYNC_TABLES` 中，任何状态变化都会经既有
  sync_id/updated_at 路径传播（S-01…S-05 传播验收尚未执行，属已知前置阻塞）。

### 备选方案

| 方案 | 做法 | 优点 | 缺点/风险 |
| --- | --- | --- | --- |
| A 惰性建会话 | 不落库，纯前端预览模式，首次作答才创建 | 语义最干净 | PracticeView 全链依赖 session.id 写答案；改动面大、双端后端+前端联动，风险最高 |
| B 退出即作废 | 退出练习时若 0 作答且 0 提交则 `status='abandoned'` | 数据不堆积；改动集中在退出路径 | 需要双端后端新增退出接口/逻辑；用户"只翻一眼"后再进需重建会话（体验无损，但依赖 resume 正确） |
| C 展示口径收敛 | 列表口径改为"有作答或提交才算进行中"；0 进度不显示徽章、按钮显示"开始整卷"（点击复用既有 active 会话，现逻辑天然支持） | 零数据结构变化、零风险、立刻消除噪音 | 空会话仍会在库里堆积 |
| D 周期清扫 | listPapers/启动时把"0 作答且超过 N 天"的 paper 会话置 abandoned | 兜底清理 | 单独使用不解决"刚进入就显示"的主诉求 |

### 推荐组合：C + B（D 作为实现 B 时顺带的启动清扫）

1. **口径收敛（C）**：`listPapers()`（Android `practice.ts` / Windows `routers/papers.py`）的
   `active_session_id` 子查询加存在性条件——该会话在 `practice_answers` 有非空作答或
   `practice_unit_submissions` 有提交记录才算"进行中"。
2. **退出作废（B）**：前端退出练习（X/返回键）且会话 0 作答 0 提交时调用
   `POST /practice/sessions/:id/abandon-if-empty`（Android local-api + Windows FastAPI 各加一路）；
   后端幂等：有任一作答/提交则拒绝并返回 kept。前端在会话有计时且已开始时跳过调用
   （避免"开始计时后秒退"误删——计时状态在 localStorage，可作判断）。
3. **清扫兜底（D）**：两端后端在 listPapers 前顺手 abandon 超 7 天的空 paper 会话（幂等）。

### 四端落点与工作量

| 仓库 | 文件 | 改动 |
| --- | --- | --- |
| Android 开发版 / 公测版 | `frontend/src/platform/android/practice.ts`、`local-api.ts`、`views/PracticeView.vue`（退出调用）、`views/DashboardView.vue`/`LibraryView.vue`（按钮文案按新口径自然回落，预计无需改） | 口径 + 退出调用 |
| Windows 开发版 ba / 公测版 github | `backend/app/services/practice.py`、`routers/papers.py`、`routers/practice.py`（新路由）、共享 `PracticeView.vue` | 同构改动 |

- 工作量估计：开发 0.5 天 + 四端验收矩阵 0.5 天。
- 验收矩阵：进入即退（应无徽章）、答 1 题退（有徽章、可续练）、提交一篇后退、重新开始、
  计时开始后退、双端 LAN 同步后另一端口径一致（依赖 S-01 传播验收，需先补该阻塞或本场次一并验）。
- 风险：对已存在的存量 0/6 会话（平板 2021/2020/2019/2018/2023）——方案 D 清扫会自动收敛；
  同步传播需与 S-01…S-05 验收同场确认。

---

## 任务二：学习助手文件/图片上传（视觉问答）

### 现状（已源码核实）

- 四端共用 `frontend/src/components/AiAssistant.vue`（路由 `/assistant`，横竖屏同组件、CSS 分方向）。
- 发送链路：前端 `sendMessage` → Android `platform/android/ai.ts sendChat()`（读 `ai_messages`
  历史 → 拼 `[{system},{history...},{user:string}]` → 原生 HTTP 调 OpenAI 兼容
  `/chat/completions`）；Windows `backend/app/routers/ai.py chat()` 同构（FastAPI 代理）。
- 两端 `ai_messages.content` 均为 TEXT 存纯字符串；**AI 对话不在 `LAN_SYNC_TABLES`**，
  附件不涉及跨端同步（`ai_profiles` 在同步表内，可承载能力标记）。
- 模型选择器数据源 `/ai/selector-models`：仅 profile+model_id+display_name，
  **无任何能力（视觉）元数据**；OpenAI 兼容 `/models` 接口也不可靠返回能力字段。

### 视觉能力判定（对应需求 2/3 的可行性结论）

无法从 API 可靠预知 → 采用**三层判定**，三层互补：

1. **静态启发式（默认档）**：内置常见视觉模型名匹配（`gpt-4o/gpt-4.1/gpt-5/o3/o4/claude-3+/gemini/qwen.*vl/glm-4v|4\.[56]|doubao.*vision|vision|vl-` 等），
   命中 → 视为支持。维护在共享常量文件，四端同源。
2. **用户显式标记（权威档）**：模型与API 设置里每个模型可勾选"支持视觉"，存
   `ai_profiles.config_json`（随局域网同步）+ localStorage 兜底；标记优先于启发式。
3. **运行时回退（兜底档，即需求 3）**：发送被提供商 4xx 拒绝且错误特征含
   image/vision/multimodal/unsupported/content type → 弹窗"当前模型不支持视觉识别，
   请更换模型后重试"，输入与附件保留不丢；同时把该模型标记为"不支持视觉"缓存，
   下次选择器中直接禁用图片上传并提示。

### 交互与 UI（对应需求 1/4，参考 ZCode 对话窗）

- 加号按钮：置于 `.ai-composer-actions` 最左侧（竖屏/横屏同位）；点击弹系统图片选择器
  （Android `accept="image/*"`，桌面同）；模型判定为不支持视觉时按钮禁用态 + 长按/hover 提示原因。
- 附件条：位于输入框与操作行之间（ZCode 同位），横向滚动芯片：图片缩略图 44px + 文件名 +
  大小 + 移除 ×；最多 4 张/条消息；单张压缩到长边 ≤1600px、JPEG q0.85、≤4MB（前端 Canvas 压缩）。
- 发送：含附件时 user 消息改为多模态数组
  `[{type:'text',text},{type:'image_url',image_url:{url:'data:image/jpeg;base64,…'}}]`。
- 模型选择器：支持视觉的模型名旁加"视觉"小徽标（启发式+用户标记并集）。

### 数据与后端（关键决策点，需用户拍板一项）

| 决策点 | 建议 | 备选 |
| --- | --- | --- |
| 附件持久化 | `ai_messages` 加 `attachments TEXT`（JSON：文件名/缩略图 dataURL/是否图片），正文仍存纯文本；**历史重放仅带文本**（图片只在发送回合上传，避免每轮回传 base64 的费用与体积膨胀） | 新表 `ai_attachments`（更规范但多一次迁移与序列化适配） |
| Android 本地存储原图 | 压缩后 dataURL 直接入库（缩略图 ~30–80KB，可控） | 文件落盘 app-data 目录、库存路径（换机/卸载易失效） |
| Windows 桌面 | 同 JSON 方案，FastAPI 透传多模态数组给提供商 | — |

- Android 需 SQLite 迁移一列（沿用现有迁移测试框架 `test:database-migration`）。
- Windows `routers/ai.py` 的 request 模型与 payload 组装改为接受 `attachments` 数组。
- 两端 `sendChat/chat()` 组装逻辑：最近一条 user 消息若带图片 → content 用数组；历史仅文本。

### 四端落点与工作量

| 仓库 | 文件 |
| --- | --- |
| 共享前端（4 仓） | `components/AiAssistant.vue`（加号、附件条、预览、禁用逻辑、发送组装）、`views/SettingsView.vue`（视觉标记勾选）、能力判定共享常量 |
| Android 本地后端（开发版+公测版） | `platform/android/ai.ts`、数据库迁移、`selectorModels()` 返回视觉标记 |
| Windows 后端（ba+github） | `backend/app/routers/ai.py`、pydantic 模型 |
| 样式 | styles.css：附件条/徽标/禁用态，横竖屏两套断点复核 |

- 工作量估计：开发 1–1.5 天 + 四端验收 0.5–1 天（真机拍照/相册、桌面文件选择、错误回退弹窗、
  横竖屏布局、深色模式、大图压缩、模型切换后按钮态）。
- 风险：base64 经 Capacitor 桥的体积（4MB×4 上限内可接受）；不支持视觉的第三方网关错误形态
  各异（错误特征匹配需在真机用基元律动/true-sota 实测校准）；`ai_profiles` 配置 JSON 变更
  与旧客户端的向后兼容（缺字段视为"未标记，走启发式"）。

### 建议实施顺序

1. 任务一（小、独立、先清噪音）→ 单独内测包四端验收；
2. 任务二按"前端 UI + 能力判定 → Android 链路 → Windows 链路 → 四端验收"两批合入；
3. 两任务都各自走"开发版先行验收 → 四仓窄同步 → 构建验证"的既定流程，不整文件复制。

---

## 待用户拍板

1. 任务一是否按推荐组合 C+B(+D) 实施？
2. 任务二附件持久化按建议方案（attachments JSON 列 + 历史仅文本重放）是否接受？
3. 视觉模型"用户显式标记"入口放在模型与API 设置页是否符合预期？
