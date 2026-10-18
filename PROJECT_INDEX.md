# 英语刷题机 Android 项目索引

> 2026-10-08 核对近期开发对话、当前工作树与既有验证回执；本次只修订状态记录，未重新运行测试、构建或设备验收。

## 定位与当前入口

Android 独立产品，Vue/TypeScript/Capacitor/SQLite/Java。本仓为开发权威树，公测与 Windows 独立，见 [路径边界](docs/context/MAP.md)。

业务进度、待验收及阶段授权见 [NOW 对应事项](docs/context/NOW.md) 和可定位的用户依据；不凭旧摘要推断当前状态或新授权。AI 助手、整改和备选计划按主题检索，列入入口不代表自动启动。

## 条件路由

| 当前需要 | 入口 |
| --- | --- |
| 接续工作/排期/待验收 | [NOW](docs/context/NOW.md) |
| 路径/版本/同步/发布 | [MAP](docs/context/MAP.md) |
| 运行/构建/验收步骤 | [RUNBOOK](docs/context/RUNBOOK.md) |
| 设计冲突/相关高风险操作 | [决策](docs/context/DECISIONS.md)、[风险](docs/context/RISKS.md) |
| 导入题库方案一及图标标题同行 | 两树实现与平板核验通过，实际 alpha.128/143、beta.21/139。真实组件 74 个状态与相关持久化/兼容检查通过；主观视觉确认待用户，未正式发布。页头导航位置已修正，见[最新回执](docs/context/2026-10-import-header-position-verification.md)、[原方案回执](docs/context/2026-10-import-ui-scheme1-verification.md) |
| 单词本离线发音、每日一学筛选与成人复习 | 2026-10-18：两套语音模型内置 APK、每日一学固定 new、七项筛选、评分衍生未学习范围、首页横屏双列等高、不认识改为 again、轻量形近词组与可选辨析。alpha.130 / 145 已覆盖安装到 HEY2-W09，美英发音实际播放通过；真机修复 espeak 数据路径和 AudioTrack 状态判断，详情页与每日一学排版已调整。完整 strict 回归 98/99，唯一失败为无关导入页旧断言；未推送/发布/跨仓同步。见[方案](docs/context/2026-10-vocabulary-offline-audio-study-review-plan.md)、[实施回执](docs/context/2026-10-vocabulary-offline-audio-study-review-verification.md) |
| 每日一学最终预览移植与翻译队列停滞修复 | 实际 alpha.123/138 已保留数据覆盖安装，strict 98/98、批量重试与真机队列核验通过；337 词全部翻译完成，0 排队/0 失败。每日一学主观视觉确认 WAIT_USER；定时唤醒已按用户要求删除；未提交、同步或发布。见[本轮回执](docs/context/2026-10-daily-study-ui-port-verification.md)、[方案](docs/context/2026-10-daily-study-ui-port-plan.md) |
| 每日一学、练习计时与翻译队列综合开发 | 当前状态以[阶段回执](docs/context/2026-10-integrated-progress.md)为准：S0–S4 与质量收口已完成；每日一学原生数据库身份修复已随公测 beta.16 / 134、内测 alpha.120 / 135 安装平板，最新执行回执为 strict 96/96；该修复已提交（`a8282d7`，2026-10-11）。续接[执行方案](docs/context/2026-10-s0-s4-closeout-plan.md)中的 S5 剩余联合验收，不重开已解决门禁。原需求见[修订方案](docs/context/2026-10-integrated-development-plan.md)，S4 开发历史见[S4 回执](docs/context/2026-10-s4-verification.md)。付费供应商、同步和发布分别核对授权 |
| 9 月平板横屏整改追溯 | [最后预览与最终方案](docs/design-review-2026-09-16/selected-revision/README.md)、[实施核对记录](docs/context/history/2026-09-16-landscape-remediation-implementation.md)：保留当时源码与验证结果，不作为最新安装状态；当前接手入口见 NOW |
| 09-09 至 09-12 旧整改追溯 | [历史方案](docs/context/remediation-plan-2026-09.md)、[历史续接清单](docs/context/remediation-followup-2026-09-11.md)，不作为 R3 待办或授权 |
| 备选功能评估 | [做题记录计划](docs/context/practice-history-plan.md)，未因此授权开发 |
| 局域网协议/ESQ | [同步](docs/lan-convergence.md)、[格式](docs/question-bank-format.md) |
| 用户操作 | [帮助](docs/帮助文档.md) |
| 历史追溯 | [历史索引](docs/context/history/README.md)、[原索引](docs/context/history/context-routing-before-2026-09-12-INDEX.md) |

先标题或关键词，再必要片段；链接不是全文必读清单。历史证据不代替当前核验。
