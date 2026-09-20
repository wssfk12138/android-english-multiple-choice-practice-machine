# Android 更新清单

英语刷题机 Android 使用一个 UTF-8 JSON 文件描述可用 APK。应用读取清单后比较 `versionCode`，下载 APK，校验 SHA-256，并打开 Android 系统安装器。

## 格式

```json
{
  "schemaVersion": 1,
  "channel": "alpha",
  "versionName": "0.1.0-alpha.2",
  "versionCode": 2,
  "apkUrl": "https://example.com/english-practice-machine-android-alpha-2.apk",
  "apkSha256": "64位小写或大写十六进制SHA-256",
  "releaseNotes": "本次更新内容"
}
```

字段说明：

- `schemaVersion`：清单结构版本，当前固定为 `1`。
- `channel`：更新通道，例如 `alpha`、`beta` 或 `stable`。
- `versionName`：展示给用户的版本名称。
- `versionCode`：Android 内部版本号，必须比已安装版本更大。
- `apkUrl`：APK 的 HTTPS 下载地址。
- `apkSha256`：APK 文件 SHA-256。
- `apkSize`：可选的 APK 字节数；提供后会在安装前核对实际下载大小。
- `releaseNotes`：可选的更新说明。

## 发布要求

- 所有覆盖更新 APK 必须使用相同的 `applicationId`。
- 所有覆盖更新 APK 必须使用相同签名证书。
- 已发布的 `versionCode` 不得重复或降低。
- 更新清单应最后上传，避免用户先读取到尚未完成上传的版本。
- 更新清单和 APK 必须使用 HTTPS。
- APK 下载后会同时核对清单声明的大小（如有）与 SHA-256。

应用校验哈希成功后只会打开系统安装器，不能绕过 Android 的安装确认。

## 固定签名

内测版和正式版使用同一份长期签名配置。真实 `signing.properties`、JKS
私钥和密码只能保存在本机 Git 忽略目录，仓库只提供
`frontend/android/signing.properties.example`。

首次从 Capacitor 默认调试签名切换到固定签名时，Android 会将其视为不同发行者。
需要先卸载旧调试 APK；此后，只要 `applicationId` 与签名证书保持不变并递增
`versionCode`，即可通过应用内检查更新覆盖安装。

## GitHub 与镜像回退

程序默认先读取 GitHub Release 中的 `android-update.json`，仓库地址为：

```text
https://github.com/wssfk12138/android-english-multiple-choice-practice-machine/releases/latest/download/android-update.json
```

GitHub Release 清单是程序更新的官方默认源。受控 HTTPS 镜像列表默认保持为空，
只有在构建时通过 `VITE_APP_UPDATE_MIRROR_MANIFEST_URLS` 显式提供后才会加入回退链，
多个地址使用逗号或换行分隔。源码和公开构建不内置公共代理地址。默认源不可用时，
程序只会按构建时提供的顺序尝试受控镜像。镜像 URL 采用“镜像前缀 + 完整 GitHub
URL”格式时，程序会将同为 GitHub 地址的 `apkUrl` 加上该前缀；普通静态托管镜像
必须在清单内直接提供正确的 APK 下载地址，不会自动推断其目录结构。

镜像清单中的 `apkUrl` 可以指向同一镜像上的 APK，但必须提供对应文件的实际
字节数和 SHA-256。发布时应先上传 APK，再上传更新清单，避免用户读取到尚未
完成上传的版本。

远程 ESQ 题库目录与程序更新通道相互独立。默认目录位于独立题库仓库：

```text
https://raw.githubusercontent.com/wssfk12138/english-question-banks/main/question-bank-catalog.json
```

应用 Release 的 `latest` 不保证包含题库目录，不能用它代替独立内容 Release。
`VITE_QUESTION_BANK_CATALOG_URL` 可在构建时指定官方目录，
`VITE_QUESTION_BANK_CATALOG_MIRROR_URLS` 指定逗号或换行分隔的受控 HTTPS 镜像。
未提供可管理、可审核的端点时，镜像列表保持为空。

- 构建默认值不写入用户设置。没有第三方覆盖时，按“官方 -> 去重后的受控镜像”顺序读取。
- 与当前构建官方 URL 精确相同的设置按官方链处理。使用标准官方构建时，旧官方
  `question-banks-v1.2.0` 目录和旧仓 `releases/latest/download/question-bank-catalog.json`
  也按新官方链处理；不改写数据库，设置页仍保留原值。自定义构建不套用这项旧地址迁移。
- 其他手动 URL 是独立替代来源，失败不会回退。不同 Release、带查询参数的固定地址和
  无法确认的历史构建地址不作自动迁移；清空设置才恢复官方链。
- 镜像目录中的 ESQ `downloadUrl` 必须由运营者填成真实可用的下载地址；不会沿用 APK 的前缀改写。
  客户端核对每包大小与 SHA-256，之后进入冲突预览，不会自动覆盖本地年份。

标准官方目录及两个官方仓库中受限的题库下载路径另有下载回退：官方直链失败后，
依次尝试 `ghfast.top`、`gh-proxy.com` 前缀。该规则不扩展到任意第三方目录、
查询参数、凭据或其他仓库；镜像下载仍须通过大小和 SHA-256 校验。程序 APK
更新的受控镜像配置与这项题库回退分别处理。已有本地题库不会因目录迁移自动改变。

## 受控镜像验收

配置前先确认端点控制权、HTTPS 证书与内容再分发许可。镜像及其重定向、清单和下载
地址均不得含凭据；公开题库链拒绝本机、私网、保留网络、非 443 端口和 HTTP 降级。
先上传包并复算大小及 SHA-256，再发布目录或更新清单；不能只复制目录而保留不可达的包地址。

构建输入在打包时固定，不能将 `VITE_*` 变量当作密钥存储。更换镜像后需重新构建并回读产物：

1. 核验真实镜像目录、包字节数和完整 SHA-256，与获准来源相符。
2. 在受控环境让官方源不可用，确认实际选中镜像，并从镜像完成小包下载。
3. 验证 404、混合失败、无效哈希/大小、HTTPS 降级被拒绝；第三方源失败仍保持隔离。
4. 记录配置、产物指纹、实际选中来源与失败提示。模块模拟测试不能代替真实镜像端点验收。

现有定向回归：`pnpm run test:controlled-catalog-sources`。配置语义参考
[Vite 环境变量文档](https://v6.vite.dev/guide/env-and-mode.html)。

## 启动静默检查

应用启动时会后台静默检查一次程序更新：发现新版本时不打断当前操作，只在页面
顶部显示一条可关闭的提示，点击“查看更新”进入更新页。用户仍可在“更新与远程
题库”页手动点击“检查程序更新”。
