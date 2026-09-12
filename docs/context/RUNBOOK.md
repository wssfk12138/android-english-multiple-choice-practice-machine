# 运行与验收手册

> 命令与相关边界核验：2026-09-09。旧矩阵只按改动范围复用，不作为当前设备/进程状态。

## 前置检查

1. 在仓库根运行 `git status --short --branch`，记录本任务允许触碰的文件。
2. 读取目标源码、相关测试和一个同类实现；高风险任务再读 `RISKS.md`。
3. 检查可用内存、JDK 21、Android SDK 36 和 `frontend/node_modules`；资源不足时先做低成本定向检查，并明确未运行项。

## 常用命令

2026-09-09缓存迁移后，用户级`GRADLE_USER_HOME`指向`E:/EnglishPracticeMachine/.toolchains/gradle-user-home`，旧`C:/Users/MEC/.gradle`为目录联接。已打开的终端可能保留旧环境，新终端继承新值；未设置该变量的旧进程仍可通过联接访问。SDK位置见MAP。已用JDK21执行`gradlew.bat --offline --no-daemon --console=plain -I <私有回执目录>/verify-gradle-home.gradle help`，断言实际缓存路径为E盘并通过项目配置；此次仅迁移存储，未重复构建APK或做设备安装。

在 `frontend` 目录执行：

```powershell
corepack.cmd pnpm install
corepack.cmd pnpm run build
corepack.cmd pnpm exec cap sync android
```

在仓库根构建 Debug APK：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-android-debug.ps1
```

或在 `frontend/android` 直接执行：

```powershell
.\gradlew.bat assembleDebug
```

打开 Android Studio：在 `frontend` 运行 `corepack.cmd pnpm run android:open`。

## 定向测试

- 一条命令跑全部门禁：在 frontend 运行 `corepack.cmd pnpm run test:all`（tests/run-all.mjs 汇总 61 个 .mjs，PREREQ 项显式标注而非静默通过；CONTENT_MANIFEST 缺省指向 `public/content-remediation.json`）。4 个 Playwright 测试（assistant-agent、barcode-scanner-layout、lan-s6-ui、vocabulary-layout）需以 `PLAYWRIGHT_MODULE` 指定本机 playwright 模块绝对路径，否则计入 PREREQ。
- `test:document-draft-persistence` 已修复（2026-09-12 补 `./content-remediation` 沙箱映射），可独立运行并通过 8 项。
- 61 个测试文件自 2026-09-12 起全部纳入版本管理与 `package.json` 脚本（`test:<文件名>` 逐个可跑）；更新 mock 时注意 connection.run 返回插件形状 `{changes:{changes,lastId}}`。

- 诊断串行队列：`corepack.cmd pnpm run test:diagnostics`
- 单词退出流程：`corepack.cmd pnpm run test:vocabulary-exit-flow`
- 词条手动编辑：`corepack.cmd pnpm run test:vocabulary-manual-edit`
- 单词横屏详情/复习布局：在frontend运行`node tests/vocabulary-layout.mjs`；需可用Playwright，未本地安装时以`PLAYWRIGHT_MODULE`指定其模块绝对路径。`VOCAB_LAYOUT_OUTPUT`可指向私有截图目录；`VOCAB_LAYOUT_STYLES`只用于指定改前CSS快照复现。56场景使用合成数据与隔离浏览器，覆盖4尺寸、明暗主题、3词长、两个复习入口及显示答案前后的卡片密度，不替代真机旋转验收。
- 导入草稿保存/确认答案/失败门禁：`corepack.cmd pnpm run test:document-draft-persistence`
- 数据库迁移：`corepack.cmd pnpm run test:database-migration`
- ESQ 兼容性：`corepack.cmd pnpm run test:esq-compatibility`
- 远程题库目录：`corepack.cmd pnpm run test:question-bank-catalog`
- 更新源优先级：`corepack.cmd pnpm run test:update-settings`
- 公测受控目录源与旧官方别名：在 Android 公测仓 `frontend` 运行 `corepack.cmd pnpm run test:controlled-catalog-sources`；这是模块回归，不代替真实镜像端点验收。
- 局域网同步：`corepack.cmd pnpm run test:lan-sync`
- 两份公测候选联调：在 Android 公测仓 `frontend` 运行 `npm.cmd run test:lan-sync:candidates`。该门禁要求相邻的 Windows 公测仓存在 `.venv` 及当前同步源码；测试只使用随机回环端口和临时 SQLite，不读取真实用户数据库。
- 文本差异：仓库根运行 `git diff --check`，并人工核对 `git diff -- <目标文件>`。

## 风险对应验收

| 改动 | 最低验收 | 追加验收 |
| --- | --- | --- |
| 文档/上下文 | 链接、大小、重复事实和 `git diff --check` | 路由演练与历史可追溯性 |
| Vue/TypeScript | 相关定向测试 + `pnpm run build` | Android WebView 核心交互 |
| SQLite/迁移 | 数据库迁移测试 + 前端构建 | 备份数据上的升级、回滚和真机验证 |
| Capacitor/Java | 前端构建 + `cap sync android` + `assembleDebug` | 真机权限、生命周期和旋转 |
| ESQ | ESQ 兼容测试 + 导入预览 | 与 Windows 逐字段互操作 |
| 同步 | 映射/事务回归 + 公测候选临时数据库联调 + 两端构建 | 多设备真机体验、删除传播、profile 隔离、离线恢复 |

## 真机快速验收

- 09-08 P1核心修复、双版71/107构建与公测107安装证据保留；09-09ADB列表为空，不据旧状态安装。恢复在线后先核验设备身份、当前包/签名、应用已保存退出和回退条件；禁止自动重连、刷机、清数据或强停。用户已接管新功能体验，不重复未改动UI或105同步矩阵。
- 09-09双Android布局修复各56场景通过；正式签名assembleInternal 72及assemblePublicTest 108已构建并覆盖安装，回执见MAP。默认Debug仍为code1/0.1.0-alpha且使用Debug证书，不能覆盖正式签名安装；未来交付继续按实际设备与原证书核对递增候选。
- Windows双版完整冻结程序和安装器已生成，隔离AppId完成同版本payload覆盖/重启/卸载保留合成数据；原AppId安装器仅编译。真实私有版本目录部署、VBS清父环境重启和内测TLS固定身份自动恢复已验证；公测LAN原本关闭，保留关闭。公测VBS已固定现用物理数据目录，独立Explorer桌面双击由用户一次确认。详细边界与回执见本月历史和MAP，旧“仅冻结依赖冒烟”不再是当前交付状态。
- 本轮Windows内测健康200、公测无进程；工具缺少原生Explorer控制，浏览器策略拒绝页面访问。公测可直接由用户双击桌面入口验证原数据；内测的完整冷启动应在正常保存退出且服务进程结束后完成，关闭浏览器或对运行服务再次双击均不能当冷启动证明。
- S2 TLS 使用 TCP 8767，mDNS 使用 UDP 5353，旧 HTTP 保留 8766。双 Windows 的 tools/enable-lan-tls-firewall.ps1 仅添加 Private + LocalSubnet 规则，支持 -WhatIf；已解析检查但未执行，修改系统规则须另行授权。旧 enable-sync-firewall.ps1 不能代表 TLS/发现可达；TLS 故障不得回退 HTTP。
- tools/verify_lan_tls_frozen.py 为早期隔离入口，tools/verify_lan_tls_android.py 为真实 Python TLS 与生产 Java/OkHttp 互操作入口；不得指向真实用户库。早期依赖冒烟与本轮完整冻结交付是不同证据。
- 新 Windows EPM2 紧凑二维码须配套本次 Android 扫码实现；新版 Android 保留旧 v1/v2 JSON 兼容。360/1280 宽度下二维码实际 260/302px，双版共四图已解码并核验 DER 指纹与 SAN；图像解码不等于相机成功率。
- 按相关改动选择用户快速验收：真实扫码并显式保存、SecureStore 冷启动重连、电脑换 IP 后 NSD 自动恢复、组播不可用时安全失败、错误证书拒绝、逐设备撤销、重装明确选择替换及取消、横竖屏旋转和系统字体缩放。发现服务只是地址提示，任何候选仍必须验证原证书与 host_id。既有已通过项不重开；本轮没有调整防火墙。

- 冷启动、升级安装、横屏、竖屏、旋转和分屏。
- 导入、继续练习、计时暂停、听力、词库、段落匹配、提交判分、错题本和单词本。
- 涉及同步时检查在线/离线、自动同步、稳定键缺失、删除传播和失败批次无半写入。

## 局域网内测通道

按旧 alpha 序列构建时，版本名和 `versionCode` 必须显式成对传入；目录地址使用现场 LAN IP，不写入公开上下文：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-android-internal.ps1 `
  -VersionCode <next-version-code> `
  -VersionName '<next-alpha-version>' `
  -AppUpdateManifestUrl 'http://<LAN-IP>:8877/app-update.json' `
  -QuestionBankCatalogUrl 'http://<LAN-IP>:8877/question-bank-catalog.json'

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-internal-update-server.ps1
python -X utf8 .\.codex-local\verify_lan_channel.py --base-url 'http://<LAN-IP>:8877'
```

- 服务必须监听 `0.0.0.0:8877`，防火墙只允许 `LocalSubnet` 入站。
- `server.pid` 只是运行记录；重启或异常退出后须重新检查进程、监听端口和 `/diagnostics/health`，不能只相信 PID 文件。
- 校验脚本应从 HTTP 获取两份清单，并流式下载目录中的四个完整题库和 APK，逐项复算大小与 SHA-256。ESQ 还需按客户端规则验证正文、答案、标签 `questionContentHash` 以及资产大小和摘要。
- 替换已发布题库或 APK 前，先按旧清单校验并把旧文件及两份旧清单移动到带时间戳的可回退归档；新大文件使用临时名称复制并校验后再原子改名。

## 发布门禁

- 现场核对工作树、应用 ID、版本名、递增 `versionCode`、签名证书和 APK SHA-256。
- 回读更新清单与实际 APK 的版本、大小和 SHA-256。
- 扫描公开差异和产物，确认没有真实局域网地址、明文设备令牌、私有题库、数据库、密钥、签名、日志或用户数据；局域网同步源码和文档性质的私网示例允许公开。
- 在存在已安装内测版或用户数据时，默认只运行临时 SQLite、隔离 `ENGLISH_PRACTICE_DATA_DIR` 和随机测试端口下的自动化/健康检查；不得为发布前验证启动一键入口、覆盖安装同应用 ID 的 APK，或对默认数据目录执行安装、升级、卸载冒烟。需要这些测试时必须另设可回退环境并取得明确授权。
- 未经用户明确授权，不暂存、不提交、不推送、不创建 Release、不更新内测通道。
# 09-09增量验收记录

- 四端前端构建/生产审计、Android两端Capacitor同步和正式签名构建、Android公测原生URL测试、Windows公测6项目录测试通过。
- 未变化的两Android各56场景布局和13项受控目录回退测试复用；Windows新构建前端与安装目录逐字节相同，不重复打包安装。
- Windows重开使用在线备份、业务表摘要与侧文件校验、指定进程身份校验、真实桌面lnk ShellExecute、新进程/健康验证。程序没有正常退出服务入口，必须如实区分停止进程和优雅退出。
- 私有回执见MAP，视觉密度由用户确认；真实HTTPS镜像和Windows远端CI尚未验证。
