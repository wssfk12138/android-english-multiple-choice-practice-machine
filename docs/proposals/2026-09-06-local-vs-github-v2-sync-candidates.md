# 安卓本地开发版与公测仓功能差异及同步候选清单

> 核查时间：2026-09-06 20:37。口径：以两仓工作树静态对比为主（公测仓 remote github.com:443 当时不通，远端状态按本地 refs 与 2026-09-06 文档记录）；公测修复仓全部 09-05~09-06 源码改动未同步回本地开发版，本地开发版 HEAD 41e89bd + 大量未提交工作树。

## 差异概览

- 同源基线：v0.1.0-beta.3 / fbba2b4。公测仓已到 ec8196a（beta.5 / versionCode 104），另有约 20 个未提交文件（+411/-127）；本地开发版停在 41e89bd（8-31），工作树约 45 个源码文件未提交（+3561/-892）。
- 两仓工作树在六协议 AI 适配（ai-adapters.ts / ai.ts）、LAN 同步核心算法、database/vocabulary、听力入口、ESQ 中文显示上内容级一致或仅个位行差。
- 真正差异集中在：原生 LAN 传输层（公测专有）、AI 密钥同步守卫、导入目的地与文档解析、更新中心双分支、公测仓 09-06 三文件 UI 修复、本地独有的内测发布链与上下文文档。

## 仅本地开发版

1. 内测发布链与构建脚本：build-android-internal.ps1、build-android-beta.ps1、start/stop-internal-update-server.ps1、enable-internal-update-firewall.ps1、diagnostic_receiver.py、android-update.json。
2. Gradle 本地独有：applicationIdOverride（-PappApplicationId）、internal buildType 与签名门禁。
3. 本地独有源码/文档：update-settings.ts、PROJECT_INDEX.md、docs/context/（NOW/MAP/RUNBOOK/DECISIONS/RISKS/history）、docs/proposals/、docs/question-bank-catalog.md。
4. 本地独有内容行：styles.css 740 行（公测 344）、AndroidUpdatesView.vue 144 行（公测 107）、NotesHubView.vue 36 行（公测 3）、App.vue 39 行（公测 18）、AppUpdaterPlugin.java 56 行（公测 37）——对应内测更新源与本地服务地址实现。
5. 本地独有测试/脚本：test:update-settings、test:android-review-layout、android-ui-density-contract.mjs、question-bank-catalog.mjs、question-labeling-isolation.mjs、shared-candidate-interactions.mjs、ai-reasoning-effort.mjs。

## 仅公测版或公测仓未提交

1. 09-06 三文件 UI 修复（已真机通过）：VocabularyView.vue 空复习遮罩加"退出复习"按钮；ImportView.vue 导入页重设计（删 5 处非必要小字、ESQ 预览显示导入目标、assist-actions 换行重构）；styles.css 深色图标 brightness 1.5 + .page-title-icon。
2. 原生 LAN 传输层：lan-transport.ts、LanSyncPlugin.java、LanSyncTransport.java、LocalizedWebChromeClient.java、confirmation_strings.xml、network_security_config.xml；MainActivity 注册；build.gradle 加 okhttp 4.12.0。本地 lan-sync 仍走 CapacitorHttp。
3. lan-sync.ts 四项守卫：ai_profiles 的 api_key/api_key_encrypted 不随同步、is_default 默认模型留本地、base_url 不被远端覆盖、passcode 空值跳过。
4. 导入目的地与文档解析：import-destination.ts、document-import.ts、question-bank.ts、json-response.ts 及配套测试（import-destination / document-partial / document-model-retry / remote-destination-ui / esq-public-example）。
5. 更新中心：app-update.ts、updates.ts、AndroidUpdatesView.vue 双分支差异，配套测试 dashboard-resume.mjs、lan-sync-settings.mjs。
6. MobileSettingsView.vue：LAN 同步设置项、同步按钮横排（UI02 真机通过）、反馈链接更换。
7. LAN 专项测试：lan-sync-ai-profiles.mjs、lan-sync-conflict-atomicity.mjs、lan-sync-feedback.mjs、android-public-ui-contract.mjs（+20 行）。
8. 公测已提交工程项：release-android.yml（Node 22.14.0）、签名密钥路径恢复、gradlew 可执行位、nanoid 补丁锁定、CI 加固、beta.5 发布。
9. 其他未提交差异：PracticeView.vue、HelpView.vue、ListeningPlayer.vue、local-api.ts、practice.ts、diagnostics.ts、package.json 测试脚本、examples/demo-bank.esq、QuestionBankSizeTest.java。

## 内容级一致

- ai.ts / ai-adapters.ts：逐字节一致。
- database.ts / vocabulary.ts：CRLF 归一后一致。
- SettingsView.vue 一致；AiAssistant.vue 仅 8/5 行差；ListeningPlayer.vue 2/7 行差。
- 听力四入口判定、横屏图标、竖屏 Part B 入口、ESQ 中文显示：两仓已统一。

## 同步到本地开发版的建议优先级

1. 高：公测 3 文件 UI 修复（VocabularyView 退出复习 / ImportView 重设计 / styles.css 深色图标）。今日真机通过，文件级直迁风险低。
2. 高：原生 LAN 传输层全组 + lan-sync.ts 四项 AI/安全守卫。涉及 manifest / 依赖 / 原生代码，需按白名单迁移并跑 LAN 对应测试。
3. 中：导入目的地组（import-destination.ts + ImportView / document-import / question-bank 关联）+ json-response.ts 及测试。
4. 中：更新中心差异，需保留本地内测更新源与镜像回退逻辑，避免覆盖本地独有行。
5. 工程：release-android.yml、签名路径、nanoid 锁定、gradlew 可执行位。
6. 保留不迁：internal 构建与应用 ID 覆盖、本地上下文文档、本地独有测试集。

## 验收历史背景（09-05~09-06，Codex 与 ZCode 窗口）

- 已闭环：P1 LAN 三闭环（LWW 双向冲突 / 推送失败恢复 / 墓碑传播，lan5-* 隔离库六要素审计 FK0）；P4 网络项全闭环（中断不留空配置 / 批量混合失败隔离 / 第三方 404 不静默回退）；CET-4（418MB）与 CET-6（825MB）真机下载-发布-听力音频可用性；阶段1/2 远程导入批准-作答-冷启与重名拦截；B4 部分完成（docx 草稿 + 模型辅助失败保留 + 记录重开）；D01~D09 修复；UI07/UI10 已关闭。
- 已跳过/阻塞：B4 四子项（编辑保存持久化异常、扫描 PDF 提示、文本 PDF 配对、发布门禁实测）按用户指示 NOT_RUN 留专项；坏哈希真机注入 BLOCKED（URL 双层强制公网 HTTPS 属安全特性）；U 行真实升级用户移出；P1 自动调度 NOT_RUN。
- 改进类待实施：词汇编辑门控放开（无模型环境下词条永久不可编辑）；UI05 反馈离屏；听力"正在载入音频…"滞留；导入预览按钮低滚动位被底栏遮挡。

