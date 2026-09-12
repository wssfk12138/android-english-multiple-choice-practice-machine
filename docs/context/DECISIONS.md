# 有效设计决策

> 最后核验：2026-09-08。只记录仍有效的决策；实施进度见 NOW.md。


## 项目与发行

- Android 是独立产品工作树；Windows 只提供产品逻辑和 ESQ 兼容参考。两端不共享数据库、版本、签名、提交历史或发布节奏。
- 共享功能按明确逻辑逐项移植，不做整仓覆盖。公开副本和本地开发版之间也不自动同步。
- 局域网同步允许进入公开源码与公开构建，但必须按四仓边界逐文件迁移；私有更新地址、私有题库、真实局域网地址、设备令牌和用户数据不得进入公开面。

## 数据与安全

- API Key 仅保存在 Android 原生 SecureStore，不进入 SQLite、日志或源码。
- ESQ 是跨端题库交换边界；兼容性修改需要 schema/测试和 Windows 互操作证明。
- 扫描版或无可靠文字层 PDF 失败时明确转人工，不将 OCR 不确定结果伪装为成功导入。

## 智能标注

- 一次运行绑定启动时的题库配置、年份/试卷范围和覆盖策略，后续请求以 `run_id` 读取持久上下文，不受 UI 切换题库影响。
- 模型成功写入或人工校正标签后自动锁定；只有明确解除锁定的标签可重新标注，空标签不因迁移误锁。
- “当前篇后暂停”在篇目边界持久化状态；页面循环仍是调度者，真正后台 worker 尚未采纳。

## AI 模型协议适配

- 当前适配器注册表稳定覆盖 `openai-chat`、`openai-responses`、`anthropic`、`google`、`kiro` 和 `command-code` 六协议；设置页全部作为可选协议显示，不再保留“二期禁用占位”。
- 既有模型配置迁移后默认使用 `openai-chat`，避免存量配置因新增协议字段改变行为。
- 推理强度与协议适配是两项独立能力。OpenAI Chat/Responses 与 Command Code 按“未设置不发送、低/中/高”规则透传；Kiro 仅对 OpenCodex 已验证的 `gpt-5.6-sol`、`claude-opus-5` 做映射；Anthropic 和 Google 不做未经验证的参数映射。
- Kiro 仅支持刷题机独立 `ksk_` API Key，不导入或复用 OpenCodex OAuth、refresh token 或 Profile ARN；event-stream 必须同时校验 prelude CRC 和 message CRC。Command Code 固定使用 `/alpha/generate`、`/provider/v1/models` 和 NDJSON 响应契约。
- 可运行闭环必须同时覆盖配置持久化、请求分发、模型列表、设置页协议选择与端点预览，并以协议契约测试证明；任一孤立模块不代表功能已经实现。Android、Windows 及其公开副本仍按 `MAP.md` 分别实施和授权同步。

## 练习与布局

- 同一试卷存在 active 会话时默认续做；用户明确重新开始才放弃旧会话。
- Android 信息架构以运行时 `html[data-platform=android][data-orientation]` 为布局权威状态；旋转和回前台需重新同步方向。

## 局域网同步

- 电脑作为局域网主机，Android 作为客户端；同步学习进度，按 profile 隔离，删除用墓碑传播。普通行按 (updated_at, _sync_rev, _sync_origin) 确定性裁决；wrong_stats 尝试账本按集合合并，不以整行胜者覆盖独立尝试。详见 [协议说明](../lan-convergence.md)。
- 同步默认关闭；用户主动启用并生成配对口令后启动独立 LAN 监听。本机 Web 服务保持只监听回环地址；旧版 HTTP 学习同步与独立 TLS 监听并存，不将旧学习链路描述为全部 HTTPS。LAN 仅挂载数据路由，不公开本机管理路由；除 handshake/pull/push 外，还包含 model-keys 与 question-banks/catalog、question-banks/download，后两类必须通过 TLS 和类别授权。端口允许隔离实例配置。
- 首次配对使用口令并固定 TLS 身份，后续绑定可续接；支持权限撤销和整体禁用。模型类别获授权时经专用受保护链路交换命名密钥，不进入普通学习表、日志或公开文件。不得沿用旧版“所有 API Key 永不交换”的描述。
- 各同步表及墓碑用本地持久 _sync_seq 作为增量水位；时间戳和 rowid 保留为兼容字段，旧游标无 seq 时重新扫描。序列不是跨设备版本，不可用于远端胜负比较；权限/profile 可见性继续约束同步。
- Android 仅在完整 `pull -> merge -> push` 成功后提交本地/远端游标；可见 profile 集合指纹变化时重置四类相关游标，防止新可见 profile 被旧水位跳过。
- 单次 push 最多 64 张表、10,000 行和 16 MiB 请求体；超过边界在进入合并事务前拒绝。
- 缺少必要稳定外键映射时拒绝并回滚本类别批次，不向非空外键写 NULL，也不推进失败游标；无学习数据的空孤立会话保留既定窄例外。该门禁已有生产实现与回滚回归。

## 远程题库与大文件

- 官方目录使用 Windows 公共仓独立内容 Release `question-banks-v1.2.0` 的固定 URL。2026-09-09 用户允许公共代理；ghfast.top 与 gh-proxy.com 的目录及小包 HTTP 200 且字节一致，已接入四端官方题库下载回退。它们由第三方运营，不称为项目自控镜像。
- 公测构建官方默认不落库为用户覆盖；精确等于当前官方源或已知旧官方 latest 别名的存量值按“官方 -> 受控镜像”读取但不改写设置。其他第三方/固定版本 URL 只尝试自身，不回退。内测显式构建覆盖仍维持原固定单源策略，不与公测混同。
- 用户已确认全部题库无版权风险，不要求补充 CET 内容来源记录或版权来源说明。
- Android 与 Windows 统一使用流式下载、下载前空间预检、目录声明大小和 SHA-256 校验。单个 ESQ 最大恰好 2 GiB，并额外预留至少 64 MiB 可用空间；失败、中断或校验不通过时清理临时 `.part` 文件，不发布不完整题库。

## 性能与门禁收尾决策（2026-09-12）

- `idx_answers_session` 暂不删除（A1）：已在真实库副本实测，无该索引时 `UNIQUE(session_id, question_id)` 自动索引顶替同一查询计划（`SEARCH ... USING sqlite_autoindex_practice_answers_1 (session_id=?)`），300 次查询中位耗时 47.8ms vs 有索引 56.5ms，无退化。删除收益为零，留待下轮与孤儿行策略一起决策。
- `idx_vocab_due` 不建（B5）：EXPLAIN 证明清单里 6 条候选索引中只有它没有被任何真实查询使用；review 过滤与首页到期排序实际走 `idx_vocab_status`。
- 单词翻译状态轮询保持 5000ms（A3，原 2500ms）：翻译补全为异步流程，5 秒刷新对体验无感，减少全量重取与 DOM 重建。
- `journal_mode` 保持 delete，不转 WAL（B10）：改 WAL 会改变掉电/被杀时的持久性语义并引入 `-wal`/`-shm` 副文件，属产品级决策；事务化已把丢失窗口从「一次开始练习」压到「单次逻辑动作」。剩余风险：单次逻辑动作内的最后提交若正好被杀仍会整体回滚（数据库不损坏）。
- 单词本浏览列表为 100 行分页 + 滚动加载（B4，默认 100、上限 500）；到期复习与额外巩固仍走 `limit=all` 全量，复习队列完整性不受分页影响。
- `chooseSnapshot`（修订续练）批量化后保持普通 INSERT、不加 `OR IGNORE`（B7）：新会话来自刚校验过的题目集合，出现重复题即数据异常，应响亮失败；与 `createSession` 的 `OR IGNORE` 语义差异是有意的（后者有重入续练场景）。
- `sessionId` 取不到有效 id 即抛错（B/复审 4.5）：`practice.ts` 与 `practice-snapshots.ts` 两处不再静默写 0，错误文案「练习会话创建失败，请重试」。
