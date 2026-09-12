# 规则调整前路径地图（历史）

2026-09-12 完整保留原文，旧状态不代表当前事实或授权。当前入口为 ../MAP.md；私有记录不进入公开副本。

# 路径、版本与同步边界

## 续接增量（2026-09-12）

- 本轮平板内测已升级并核验正式非调试 alpha.80（UID 10215/首次安装时间保持；在装 APK 与候选 android-candidate-20260912/AD-0.1.0-alpha.80.apk SHA-256 一致）；下方“未连接/77/79”等现装措辞均为对应日期快照。
- 私有证据根 E:/EnglishPracticeMachine/verification/remediation-20260910；本轮新增 record-conflict-20260912/（Windows 在线备份×2、冲突草案 PLAN.md、合并脚本与副本测试、实施回执 IMPLEMENTATION-RECEIPT.json、UI 转储）与 android-candidate-20260912/（双 Android 候选及签名回执）。校勘 r2 报告 followup-source-evidence-20260912.json（初版保留）。
- 27 组记录冲突已真实合并（平板权威快照替换 + 平板经生产 TLS 路径同步成功，批次 32/32 吸收、幂等、无重复计数）；模型配置/Key 已真实同步（2 配置及 Key，DPAPI 侧文件哈希 61404f8a…→34133ca8…，未进 SQLite）。回退：windows-premerge-1789180726429781900。
- Windows 内测真实目录现为 p2-20260912（2026-09-12 部署，桌面 lnk 备份于 Programs/EnglishPracticeMachine/英语刷题机.lnk.bak-20260912，旧 p1-20260908 目录保留可回退）；公测冻结包在 WP 树 outputs/windows-public-20260912/，未部署。
- 用户已授权全部实施完成后窄范围本地提交；不含推送、Release、通道更新或额外清理。当前实施已收口，提交前待用户对实施结果的认可。

## 本轮整改增量（2026-09-10，r3）

- 四树frontend/public/content-remediation.json为r3/65单元；双Android及WP bundled-banks英一资源为r3、英二仍r2。逐项同步题库、解析/渲染、词汇、公平复习和标题修复，保留平台差异；Android另含滑篇。原始/r1/r2资产与迁移备份留存。
- 私有证据根E:/EnglishPracticeMachine/verification/remediation-20260910。候选android-candidate-r3和windows-candidate-r3。手机已安装79/115，平板未连接且最后核验77/113；双Windows真实安装路径不变，已更新并经原VBS重开。
- finding-coverage-r3.json含36分组、来源指纹及九份固定槽位核验。Windows迁移/交付、手机安装、页面与真实模型证据详见整改方案；设备私有库及触摸验收仍待完成。未更新远端或通道，私有记录不向公开树同步。

## 当前存储位置（2026-09-09）

- 三批交付证据已迁至 E:/EnglishPracticeMachine/archives/codex-evidence/，保留原日期/任务ID层级；本页历史C盘visualizations链接通过Junction继续可用。
- Gradle用户目录为 E:/EnglishPracticeMachine/.toolchains/gradle-user-home，User级GRADLE_USER_HOME已设置；C:/Users/MEC/.gradle保留Junction。Android SDK仍为 E:/EnglishPracticeMachine/.toolchains/android-sdk，C盘旧SDK已核验去重并保留Junction。
- C盘工作树2000的.codex-local/staging-alpha39联接至aac2工作树同名保留副本。后续删除或归档任一工作树前先处理此依赖，不能直接移除aac2保留副本。其余工作树与源码未清理。
- 私有清单、逐文件SHA-256、环境旧值和回退说明：E:/EnglishPracticeMachine/archives/c-drive-migration-20260909/README.md；闭环见history/2026-09-storage-migration.md。这些设备路径与私有回执不得同步到公开副本。

## 历史交付入口（2026-09-09玻璃首页，已由上方r3部分取代）

- 手机、平板现装内测77 / 0.1.0-alpha.77、公测113 / 0.1.0-beta.6-test.9；Windows两版更新并从原快捷方式重开。平板安装回执为下述证据根delivery/tablet-install.json，用户已确认安装完成。
- 四树窄范围仅frontend/src/views/DashboardView.vue及新增frontend/src/dashboard-glass.css；逻辑与Android竖屏模板保持，未发布或更新通道。
- 候选、备份、安装和验证证据：E:/EnglishPracticeMachine/verification/glass-dashboard-20260909/，详见history/2026-09-glass-dashboard.md。

## 历史交付入口（2026-09-09学习待办）

- 手机、平板现装内测76 / 0.1.0-alpha.76及公测112 / 0.1.0-beta.6-test.8。Windows两版已从原快捷方式重开新冻结包，业务表和侧文件保持。
- 四树仅适配学习待办数据、入口与首页布局；保留各版本错题与复习规则，Android竖屏模板未改。未提交、发布或更新通道。
- 构建、候选、备份与安装回执：C:/Users/MEC/.codex/visualizations/2026/09/09/01a084d5-4e0c-7ec3-bf76-70eab41fa59e/study-todos-delivery/。Windows最终实页截图及接口核验：E:/EnglishPracticeMachine/verification/study-todos-20260909/。详见history/2026-09-study-todos.md。
- 下方旧73/109、74/110和75/111记录均为历史快照，不代表当前安装版本。C盘归档已按上方存储位置完成。

## 历史交付入口（2026-09-09双Android布局安装）

- 四个E盘源码目录仍为权威，C盘Codex工作树只是任务载体。按用户追加授权，本次从Android内测向公测窄同步frontend/src/study-theme.css、styles.css中的横屏详情换行规则、frontend/tests/vocabulary-layout.mjs。公测测试桩适配其checkAppUpdate导出；保留两端其他差异，Windows两树只读。
- 当前平板安装为内测73 / 0.1.0-alpha.73、公测109 / 0.1.0-beta.6-test.5。私有交付目录为本轮证据根下install-73-109/，preflight.json与installed.json记录包名、原签名、升级前后身份及设备APK哈希；新旧APK均保留在该目录。安装采用adb install -r，UID和首次安装时间保持，未卸载、清数据或读取业务库。旧install-72-108/为前次交付快照。
- 内测APK SHA256为de09b72d6e5f3df592a3f8fb0dd2aa7edd99b34068f68bc875b0b21cd5450eb5，公测为dd64e4044a0fbdd936ce1245a4636dc75536ea959a3680d21fcbc3d69630f154，均与设备实装字节一致。两端复习主题文件字节相同；未更新内测通道或GitHub发布。
- 本轮私有证据根：C:/Users/MEC/.codex/visualizations/2026/09/09/01a0841e-4ace-7b12-985e-66db27149988/；RESULT.md为总入口，android-preflight/为APK身份/签名/资源核验，vocabulary-layout/为修复前后截图与40场景，windows-reopen/和mirror-audit/记录对应阻塞，final-hygiene/记录工作树基线对比。
- 新Debug验证包：本仓frontend/android/app/build/outputs/apk/debug/app-debug.apk，code1 / 0.1.0-alpha，SHA256 7fae44e1fe658bc5579f760cb75aaf307e09b55011069aef8e717e8b5146635a。其Debug签名与已安装内测不同，不能用于覆盖安装。下方旧71/107候选未改且不含本次布局修复。
- Android私有交付目录：C:/Users/MEC/.codex/visualizations/2026/09/08/01a0803b-b49f-7672-969b-3faa43cc423d/android-p1-71-107/。DELIVERY-INDEX.md为产物入口，candidate-receipt.json为候选核验，publicTest-install-receipt.json为最终公测安装状态；install-preflight.json只是安装前快照。
- 09-08平板公测107、内测70状态已被上方09-09安装回执取代。初次ADB离线后按用户要求连接无线调试；手机仍未连接。旧71/107候选只作为旧产物保留，内测通道未更新。
- Windows私有交付目录：C:/Users/MEC/.codex/visualizations/2026/09/08/01a0803b-b49f-7672-969b-3faa43cc423d/windows-delivery-20260908/。deployment/after.json与deployment/public-physical-launcher.json为09-08切换快照；本轮实时进程/健康见windows-reopen/final.json和health-final.json，内测在线、公测未运行。隔离安装器与真实切换证据分开保存。
- 真实Windows程序目录：C:/Users/MEC/AppData/Local/Programs/EnglishPracticeMachine/p1-20260908/ 和 C:/Users/MEC/AppData/Local/Programs/EnglishPracticeMachinePublic/p1-20260908/。持久VBS及桌面入口已备份并切换，真实AppId注册未改；原安装器仅编译，没有在真实默认环境执行安装/卸载。
- 内测Windows继续使用 E:/EnglishPracticeMachine/Codex/2026-08-02/ba/backend/data；公测VBS固定已核验物理目录 C:/Users/MEC/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/EnglishPracticeMachinePublic。文件ID/句柄证明公测原路径别名是同一数据，没有迁移或合并另一个数据树。独立Explorer用户上下文重开未执行，不把当前父环境的成功派发扩大为该证明。
- 公开源码/文档不得复制本节私人目录、设备状态或数据元信息。完整APK/EXE/安装器/数据库和备份均留在私有交付范围，后续清理另行批准。

## 2026-09-07 二期同步增量（历史快照）

- 2026-09-08 部署修复窄增量：双 Windows 的 backend/app/lan_addresses.py、services/sync.py、tests/test_lan_addresses.py 修正物理网卡地址优先；backend/app/lan_discovery.py、tests/test_lan_discovery.py 改为每个 IPv4/接口独立发布，使用不同 SRV 目标和单条 A 记录，保留相同主机身份。复用 ifaddr/zeroconf，未更改 Android 协议。双 Windows views/UpdatesView.vue 去除标题注解并保留固定二维码框，定向 UI 契约同步跟进。公测冻结包已本地更新且有回退备份，不代表内测版已部署、安装器已生成或 GitHub 已发布；未修改系统防火墙。

- S6 窄白名单：四端 frontend/src/study-theme.css、main.ts、components/NamedModelKeys.vue、tests/lan-s6-ui.mjs；背景仅 frontend/public/assets/backgrounds/study-coast-morning-v1.webp 与 study-coast-dusk-v1.webp（Android 本地原有，其余三端新增）。双 Android styles.css 只迁出旧主题块、views/AndroidUpdatesView.vue 只补布局 CSS、platform/android/lan-categories.ts 只改模型类别显示文案；本地 tests/android-theme-orientation.mjs 跟随新主题入口。双 Windows views/UpdatesView.vue 只补二维码/换行 CSS、components/LanPairedDevices.vue 只修正密钥与题库标签。导航、发行标识、更新渠道、ESQ/数据库/原生实现均未同步或修改。
- S6 四端主题文件和两张资源字节一致；四端构建资源与源码 SHA-256 一致。测试挂载生产更新页及命名密钥组件，仅用隔离模拟 API/题库/诊断/路由/扫描组件，不读取真实数据。截图位于任务 visualization 目录，不进入四仓源码；记录只更新 Android 本地权威文档。本轮未 cap sync、打包、部署、安装、暂存、提交或发布。

- S4 窄白名单：双 Windows .gitignore、backend/app/services/model_keys.py、model_key_sync.py、ai_client.py、sync.py、routers/ai.py、routers/sync.py、tests/test_model_keys.py、test_sync_permissions.py；公开另有 tests/test_sync.py 旧模型测试契约更新。四端 frontend/src/components/NamedModelKeys.vue、views/SettingsView.vue；双 Android 另有 views/MobileSettingsView.vue、platform/model-keys.ts、platform/android/model-key-store.ts、model-key-sync.ts、ai.ts、local-api.ts、lan-sync.ts、tests/model-keys.mjs、lan-categories.mjs；公开 Android tests/lan-sync-settings.mjs 修正分类模块测试桩。双 Android 原生 SecureStorePlugin.java、LanSyncTransport.java；公开 LanSyncTransportTest.java 新增 S4 安全端点用例。路径均相对相应仓根，保留各端既有差异。
- S4 密钥位于系统安全存储或 DPAPI sidecar，不属于 SQLite/公开资产；Windows 新增 sidecar/temp 忽略规则。验证用合成凭据、临时库和 Gradle 本地输出。当前四树仍脏且暂存区为空，Windows 公开 .codex-local/ 仍未忽略，未来发布必须排除；本次未清理或远端同步。C 盘任务工作树不作为源码源头。

- S3 窄白名单：双 Windows backend/app/services/sync_permissions.py、services/sync.py、routers/sync.py、schemas.py、frontend/src/components/LanPairedDevices.vue、tests/test_sync_permissions.py；双 Android frontend/src/platform/android/lan-categories.ts、lan-sync.ts、local-api.ts、frontend/src/views/AndroidUpdatesView.vue、frontend/tests/lan-categories.mjs、lan-category-dependencies.mjs、lan-sync-contract.mjs。保留公开 Windows 历史表迁移、模型默认项/地址保护，以及 Android 两版原有 UI/导入差异。四树仅本地源码同步，不涉及 Git 远端。
- S3 使用内存合成 SQLite 和模拟传输；四前端构建产物不属于源码同步白名单。未改原生工程、数据库格式、ESQ、版本、签名、渠道或防火墙。

- S2d Windows 窄白名单（下列路径均相对双 Windows 根）：backend/app/lan_discovery.py、lan_tls_host.py、services/sync.py、routers/sync.py；frontend/src/components/LanPairedDevices.vue、views/UpdatesView.vue；frontend/tests/lan-devices-ui.mjs；tests/test_lan_discovery.py、test_lan_tls_host.py、test_sync_tls_pairing.py；tools/verify_lan_tls_frozen.py、enable-lan-tls-firewall.ps1；requirements.txt。仅本地版 packaging/windows/EnglishPracticeMachine.spec 补 zeroconf 收集。保留公测服务请求体限制及页面差异，不整文件覆盖不同实现。
- S2d Android 窄白名单（相对双 Android 根）：frontend/android/app/src/main/java/com/wssfk/englishpracticemachine/ 下 LanDiscovery.java、LanSyncPlugin.java、LanSyncTransport.java；frontend/src/platform/android/ 下 lan-transport.ts、lan-recovery.ts、lan-sync.ts、lan-sync-qr.ts；frontend/tests/ 下 lan-recovery.mjs、lan-sync-qr.mjs、lan-sync-pairing.mjs；frontend/package.json 测试入口。保留本地/公测合并与状态差异。
- S2d 验证资产写入本地版已忽略 .codex-local/s2-frozen/ 和任务 visualization 目录；本轮新截图不再写 Windows 公测未忽略的 .codex-local/。APK、冻结产物、临时身份、数据库和截图不属于源码白名单。阶段记录仅更新 Android 本地权威文档，不复制私人路径到公开副本。未改版本、通道或系统防火墙。

- S2c 白名单：双 Windows lan_tls_host.py、lan_sync_host.py、routers/sync.py、services/sync.py、schemas.py、database.py、UpdatesView.vue 及 test_sync_tls_pairing/test_lan_tls_host/test_lan_sync_host；双 Android lan-pairing.ts、lan-sync-qr.ts、lan-sync.ts、local-api.ts、lan-sync-errors.ts、AndroidUpdatesView.vue、lan-sync-pairing.mjs。保留公测请求体限制、模型合并与本地错误状态差异。构建输出不属于源码同步；未更改版本/通道/防火墙。

- S2b 白名单：双 Windows 新增 backend/app/lan_tls.py、tests/test_lan_tls.py、tools/verify_lan_tls_android.py；公开 Windows requirements.txt 增加 cryptography==45.0.6（本地已声明）。双 Android 新增原生 LanTlsTrust.java、测试 LanTlsInterop.java，修改 LanSyncPlugin.java、LanSyncTransport.java 与 frontend/src/platform/android/lan-transport.ts。未修改旧 listener、二维码、配对存储、版本和发布配置。四仓源码逐项迁入，不整仓覆盖；生成的 APK/构建资产不属于公开源码。
- 桌面应用创建的 detached worktree 仅为任务承载目录，不用作第五个开发或发行树；本阶段改动落在下表四个权威目录。
- 下表为旧日期快照，不能视为当前干净状态。Android 两仓现场均为脏工作树，保留原修改。
- 用户授权四端二期功能逐项实现，不包含提交、推送或公开 Release。本次仅同步双安卓扫码生命周期：frontend/src/components/LanSyncScanner.vue、frontend/src/platform/android/barcode-scan-session.ts、lan-sync-qr.ts、frontend/tests/barcode-scan-session.mjs；AndroidUpdatesView.vue 只迁入扫码入口和事件，package.json 只增加 test:lan-scanner。
- 两版另有 tests/barcode-scanner-layout.mjs 隔离 CSS 布局测试；截图仅写入各仓忽略的 .codex-local/，不进入公开源码。扫码修复两版 Debug 编译通过，未安装或发布。新主题仍仅 Android 本地，Windows 两仓及 Android 公测主题待 S6。
- S2a 四端窄增量：双 Windows 的 backend/app/services/sync.py、routers/sync.py、tests/test_sync_devices.py、frontend/src/components/LanPairedDevices.vue、views/UpdatesView.vue、tests/lan-devices-ui.mjs；双 Android 的 frontend/src/platform/android/lan-sync.ts、tests/lan-sync-pairing.mjs 和 package.json 测试入口。保留各仓原有合并、发布和页面差异，不整文件覆盖不同实现。
- Windows UI 隔离截图仅测试虚构安装 ID，无真实用户数据；本地仓 .codex-local/lan-devices-ui/ 已忽略，Windows 公测副本同目录当前未被忽略，须在未来暂存/发布时明确排除，本次未清理或暂存。
- 当前内测在发版本沿用上一闭环 alpha.69，不使用下方旧 alpha.60/48 快照推导安装或发布参数。

> 最后核验：2026-09-01。路径、工作树、远端 main、标签与 Release 已现场检查；远端状态仍须在后续操作前重查。

## 工作树

| 用途 | 绝对路径 | 现场状态 | 边界 |
| --- | --- | --- | --- |
| Android 本地开发版 | `E:\EnglishPracticeMachine\Codex\english-multiple-choice-practice-machine-android` | `main`，HEAD `41e89bd`，脏工作树 | 本项目默认唯一修改目标 |
| Android 公开副本 | `E:\EnglishPracticeMachine\Codex\english-multiple-choice-practice-machine-android-github-v2` | `main`，HEAD/远端 `ec8196a`，工作树干净；`v0.1.0-beta.5` / 104 已发布 | 仅在明确授权的公开同步/发布任务中逐项修改 |
| Windows 本地版 | `E:\EnglishPracticeMachine\Codex\2026-08-02\ba` | `local-development`，脏工作树；导入确认、快捷方式和打包图标源码已修改 | 不得整仓同步；桌面本地启动链已验证 |
| Windows 公开版 | `E:\EnglishPracticeMachine\Codex\english-practice-machine-github` | `main`，HEAD/远端 `11277bd`，工作树干净；`v0.1.0` 已发布 | 不从本地开发仓直接推送；后续发布仍须单独授权 |

公开 Android 远端：`https://github.com/wssfk12138/android-english-multiple-choice-practice-machine.git`。远端事实易变化，操作前必须现场核验。

## Android 主要路径

- 前端源码：`frontend/src/`
- Android 平台适配：`frontend/src/platform/android/`
- 原生工程：`frontend/android/`
- 产品文档：`docs/`
- 项目上下文：`PROJECT_INDEX.md` 与 `docs/context/`
- 本地工具/备份：`.codex-local/`、`work/`、`outputs/`；先检查引用和忽略规则，不得擅自清理或发布。

## 同步规则

- Android 专属 UI、Capacitor、SQLite 和原生插件修改只留在 Android 开发版。
- 与 Windows 共享的题库解析、ESQ、智能标注或练习逻辑，必须列出源文件、目标文件、行为差异和两端验证；默认不自动同步。
- 2026-08-30 获用户明确授权后，四端仅逐项同步 `frontend/src/views/ImportView.vue` 的导入目标确认；2026-08-30 夜获用户授权后完成立项实施四仓窄同步（任务一空会话修正四仓、任务二 AI 图片上传四仓、推理标签仅 Android 开发版+公测版 CSS）；2026-08-30 晚获用户授权后完成横屏验收四仓窄同步（Android 公测版：styles.css 追加 G1/G3/A1、WrongView.vue G2；Windows ba：styles.css G1/G3、WrongView.vue G2；Windows 公测版：styles.css G1/G3，其错题本为旧版 UI 无 G2）；Android 公开副本另窄同步 `DashboardView.vue` 与 `styles.css` 的已验收 UI 收口，Windows 两端窄同步 `setup.ps1` 和品牌图标。未整仓复制或整体 cherry-pick。
- 公开副本可接收已审查的局域网同步源码与功能；真实局域网地址、明文设备令牌、API Key、私有题库、签名、数据库、日志和用户数据不得进入。
- 暂存、提交、推送、Release、内测通道更新和跨仓同步是独立动作，分别需要用户授权。

## 版本边界

- Android `applicationId`：`com.wssfk.englishpracticemachine`。
- Gradle 源码默认值仍是 `versionCode 1` / `0.1.0-alpha`，发布脚本通过属性提供实际版本；发布前以构建参数、APK 和远端清单三方核验。
- 当前公开发行经 2026-09-01 现场复核：Android `v0.1.0-beta.5` / `versionCode 104`（`main`、`origin/main` 与标签均为 `ec8196a`），Windows `v0.1.0` / `versionCode 1`（标签 `11277bd`）；两者均为普通 Latest，latest 更新清单与线上资产一致。
- Android历史run33413205221成功；Windows工作流09-09本地升级Node22.14.0及pnpm退出码，尚未推送或触发。
- 当前局域网内测版本延续旧 alpha 序列，为 `0.1.0-alpha.60` / `versionCode 60`（2026-08-31 通道更新，alpha.39 与旧清单已归档可回退）；它与 beta 公测序列独立，不能用公开版 `versionCode 102` 替代。
- 09-09手机和平板已安装内测74 / alpha.74与公测110 / beta.6-test.6；通道和远端清单未更新。
- 内测在发内容位于忽略目录 `work\internal-channel\`（不属于公开 Release），含 alpha.60 APK、四个现行 ESQ 和 r2probe 探针；六个下载文件（5 ESQ + APK，1.32GB）的 SHA-256 已于 2026-08-31 经 HTTP 全量复核与清单一致（alpha.39 与两份旧清单存于 `.codex-local\channel-rollback-20260831-alpha39\`）。`outputs\internal-channel\` 仅保留最近 10 个内测 APK（alpha.45–48、52-tablet、local-acceptance.55–59）。
- 2026-08-30 经用户逐项批准完成全树本地清理：旧内测 APK、旧通道归档、古早 ESQ（CET v1.0/v1.1、23 个分段包、旧考研卷）、staging-alpha39、ba 导入废稿与 uploads、`.codex-local` 已闭环验收证据及六个废弃整目录（含旧公开副本 v1、migration-backup、_publish_*、两处 20260827 同步 worktree，worktree 注册已 prune）全部移入 `E:\EnglishPracticeMachine\_trash-20260830\`（含 MANIFEST 与 worktree diff 补丁），待最终删除；git 跟踪状态未变。

## 09-09 P1/P2私有回执

- 回执根：C:/Users/MEC/.codex/visualizations/2026/09/09/01a084d5-4e0c-7ec3-bf76-70eab41fa59e。
- RESULT.md总入口；device-install-receipt.json、device-smoke.json、windows-reopen.json、final-audit.json为结构化证据。
- Android候选及手机旧APK、Windows在线数据备份在该私有根，不进入公开源码。
