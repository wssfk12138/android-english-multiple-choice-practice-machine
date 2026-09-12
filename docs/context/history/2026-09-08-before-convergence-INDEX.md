# 英语刷题机 Android 项目索引

> 最后核验：2026-09-08。这里是项目入口与当前权威状态索引，不记录逐次过程；以下旧日期条目仅代表当时验证范围，当前修复状态以 NOW.md 顶部为准。

## 项目定位

- 独立 Android 本地英语刷题应用，技术栈为 Vue 3 + TypeScript + Vite + Capacitor 8 + SQLite + Android Java。
- 当前工作仓库：`E:\EnglishPracticeMachine\Codex\english-multiple-choice-practice-machine-android`。
- Windows 本地版与 Android 公开副本是独立工作树；同步、提交、推送和发布均不自动发生。

## 当前权威状态

- 2026-09-08 最新验收：三设备真实 TLS 学习同步部分矩阵通过，发现同秒修改同一词条经多轮同步仍不收敛，四端均有相同时间戳跳过逻辑；本轮只测试未修源码。合成数据已清理，原始学习记录接收复核仍通过。当前阻塞和测试边界见 NOW.md 顶部。

- LAN 二期：四端主题/LAN UI 源码已同步，Windows 公测独立入口及下载流修复已部署，独立安装器已编译但未做安装生命周期验收。双 Android ESQ 版本指纹兼容修复通过测试，手机 publicTest 与平板 alpha69 已覆盖安装；LAN 通道完整下载校验通过。平板既有学习/词汇/错题记录及 API Key 在 Windows 内测逐条接收核验仍零缺失。真实命名密钥合并、选择题库下载/重复跳过/关闭共享通过；完整多设备冲突与异常矩阵仍待执行。首页暗色墨绿色板块已记为后续 UI 待办。未改 Git 远端，详情见 NOW.md。

- 当前本地修复版本为 alpha.69 / versionCode 69：已保留数据安装测试手机并发布既有 LAN 通道，HTTP 完整包校验通过；包含数据拒收停止重试、新背景及横竖屏统一石墨灰暗色。获授权的四级/六级归属修复完成且学习表摘要不变；本阶段未改平板数据、未同步公测或变更远端。完整多端同步与最终视觉验收仍待用户，详见 NOW.md 顶部。
- 2026-09-06 剩余验收全清单收口（详见 `docs/context/NOW.md` 顶部与私有 `.codex-local/qa-20260905/NEXT-ACCEPTANCE.md`）：阶段1 QA 批准/作答/冷启、阶段2 异常路径、P1 LAN 三闭环（LWW 双向冲突/推送失败恢复/墓碑传播，lan5-* 隔离库）、P4 网络项（中断不留空配置+重试、混合失败隔离、第三方 404 不回退）、CET-4/CET-6 GitHub 真机下载/发布/听力音频与题面可用性、导入页重设计实施、UI09/UI02、复习遮罩"退出复习"缺陷修复均真机通过；B4 四个子项经用户跳过（NOT_RUN 留专项），坏哈希真机注入=BLOCKED（公网 HTTPS 安全策略），APK 真实升级由用户移出待办。修复仓 android-github-v2 新增 3 文件源码修改未提交；未 push、未 Release、未调用真实模型。
- Git：`main` 位于 `41e89bd`，工作树有用户未提交源码和本地文件；本轮上下文整改未改这些源码。
- 当前开发：四个独立工作树均已加入导入目标确认，上传 DOC/DOCX/PDF 或 ESQ 前必须选择按包名新建题库配置或导入已有配置；四端前端构建已通过。Android 本地版与公开副本已统一听力四入口判定、横屏听力图标、竖屏 Part B 入口及 ESQ 中文显示；本地真机专项已通过，含听力数据时的横屏四入口仍缺设备数据验证。
- Android 公测 B2/B3：已按白名单逐文件迁移既定 UI 与完整局域网同步依赖，保留公测静默更新和六协议模型适配器。外部 handshake/pull/push 响应增加同步表白名单、64 表、10,000 行、16 MiB、游标及计数类型边界；定向测试、生产构建、Capacitor 同步、Debug APK 和隐私扫描通过。设备浏览器启动被管理策略拦截，未覆盖同应用 ID 的用户安装，真页面截图仍待策略恢复后补验。
- Windows 桌面：本地版启动链可用，桌面快捷方式已修复为正确目标、工作目录和品牌 ICO；打包 EXE 的品牌图标、中文元数据及健康接口已验证。公开版 `v0.1.0` 已从公开仓提交 `11277bd` 创建普通 Latest Release，ZIP、更新清单、线上回读和隐私扫描均通过。
- 局域网同步：Android/Windows 公测候选已用临时 SQLite、随机回环端口和 Windows 真实 HTTP 表面完成联调，覆盖双端新增、同对象冲突、双向墓碑、断网恢复、profile 隔离、同时间戳增量游标、失败批次原子性、口令轮换、旧凭据、撤销与重新配对。联调发现 Windows push 缺少 profile 范围过滤，已先在开发仓修复并以明确文件迁入公测；开发仓 26 项、公测仓 29 项 LAN/同步测试通过。8766 仍只公开 handshake/pull/push，默认关闭。
- 远程题库：Android alpha.48 已从局域网目录加载 4 个题库，下载并校验 331 KiB 考研英语一包，进入 18 个年份的 ESQ 冲突预览。已由真机和源码共同确认的“预览无取消/关闭入口”UI 缺陷于 2026-08-28 修复（新增无损关闭按钮）；尚未同步公开仓库。
- 局域网内测通道：按旧内测序列发布 `0.1.0-alpha.39` / `versionCode 39`，保留 CET 下载参数修复并加入完整同步调度。当前目录发布考研英语一、考研英语二、CET-4、CET-6 四个完整 ESQ；共 112 套、5715 题、3815 个已有智能标签和 71 个音频资产。四包与 APK 共 5 个文件、1,320,492,528 字节，已通过 HTTP 大小与 SHA-256 全量复核；旧通道内容保留可回退。
- ESQ 上限：Android 开发版最大恰好 2 GiB，远程包走原生流式下载、下载前空间预检、大小/SHA-256 校验并至少预留 64 MiB；临时文件失败清理已有原生测试。公测副本仍需按明确文件复核迁移，超大包的真机耗时、磁盘余量及 JSON 峰值仍需验证。
- 官方题库：默认地址保留 Windows 公共仓独立题库内容 Release 契约，但 2026-08-31 远端不存在相应 Release、CET ESQ 或目录资产，也没有满足要求的受控镜像；镜像列表为空。用户填写的第三方目录 URL 与官方回退链严格隔离。
- 公开发行：2026-09-01 已将 Android 公开仓 `main` 推至 `ec8196a` 并发布普通 Latest `v0.1.0-beta.5` / `versionCode 104`；线上 APK 为 45,962,954 字节，SHA-256 `87c630c65f9a927c6bccf8e0bd49a8c978a927f8daf1ef51f7a57f1d75425f88`，证书 SHA-256 `b50d155ca946277d598a878d4b02c0994d13bb7038770af52b641731b86de0a7`，更新清单回读一致。Windows 公开版仍为 `v0.1.0` / `11277bd`；远端状态仍属于易变事实，后续发布须重新核验。
- AI 模型适配：已对照 OpenCodex 2.31.0，在 Android/Windows 开发仓及两份公开副本接入 `openai-chat`、`openai-responses`、`anthropic`、`google`、`kiro`、`command-code` 六协议；配置迁移、请求与模型列表分发、端点预览、附件和推理强度边界均有契约测试与构建证明。真实供应商端点未调用，设备交互验收边界见 `NOW.md`。
- 本地发布前验证：Windows 开发版与公测版已在隔离数据目录完成源码、打包目录和安装器健康检查；Windows 公测最终全量后端为 162 项通过、1 项外部语料按预期跳过。开发版安装器为 35,796,780 字节，SHA-256 `C4D3903D2A978D4B1B53B2B25958011E6FE86B23A71EC12F2B4B161EA87B17D4`。Android 开发版与公测版的定向测试、生产构建和 Capacitor sync 通过；alpha.67 已以 `adb install -r` 安装到测试平板并保留数据，更新清单/ APK HTTP 200 与平板端“已是最新版本”验证通过；未触碰荣耀平板本地开发版用户数据。
- 主要阻塞（2026-09-06 更新）：android-github-v2 修复仓工作树混有既有多批未提交成果（本轮新增 VocabularyView/ImportView/styles.css 3 文件）；真实受控题库镜像不存在；模型适配器未做真实供应商调用；B4 余项（编辑保存持久化异常、扫描 PDF 提示、文本 PDF 配对、发布门禁实测）经用户跳过留待专项；坏哈希真机注入=BLOCKED（URL 双层强制公网 HTTPS 属安全特性）；含听力数据时的横屏四入口仍缺设备数据验证；P1 自动调度子项 NOT_RUN。Android Release 工作流已升级 Node 22.14.0 并在 run `33413205221` 成功；Windows 公开仓工作流仍需单独核验和升级。

## 按需入口

- 当前工作、阻塞、待验收：[`docs/context/NOW.md`](docs/context/NOW.md)
- 工作树、版本与同步边界：[`docs/context/MAP.md`](docs/context/MAP.md)
- 构建、测试、真机与发布检查：[`docs/context/RUNBOOK.md`](docs/context/RUNBOOK.md)
- 已生效设计决策：[`docs/context/DECISIONS.md`](docs/context/DECISIONS.md)
- 当前风险与保护规则：[`docs/context/RISKS.md`](docs/context/RISKS.md)
- 旧滚动记录和迁移说明：[`docs/context/history/README.md`](docs/context/history/README.md)
- AI 推理强度档位决策参考：[`docs/context/ai-reasoning-effort.md`](docs/context/ai-reasoning-effort.md)

## 本机 Android 调试路径

- ADB 可执行文件：`C:\Users\MEC\AppData\Local\Android\Sdk\platform-tools\adb.exe`
- Android SDK 根目录：`C:\Users\MEC\AppData\Local\Android\Sdk`
- 真机验收台账：`.codex-local\acceptance-20260830.md`
- 设备截图、UI XML、日志和只读数据库证据：`.codex-local\device-captures`
- 设备序列号、无线调试端口和 WebView 进程号属于易变状态；每次调试前用上述 ADB 执行 `devices -l` 重新发现，不在索引中固化。

## 相关产品文档

- 用户帮助：[`docs/帮助文档.md`](docs/帮助文档.md)
- ESQ 格式：[`docs/question-bank-format.md`](docs/question-bank-format.md)
- 上游兼容：[`docs/upstream-compatibility.md`](docs/upstream-compatibility.md)
- 更新清单：[`docs/update-manifest.md`](docs/update-manifest.md)
- 远程题库目录：[`docs/question-bank-catalog.md`](docs/question-bank-catalog.md)
