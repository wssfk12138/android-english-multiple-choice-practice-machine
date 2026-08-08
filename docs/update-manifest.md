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

源码内置两个 HTTPS 镜像作为自动回退（`ghproxy.net` 与 `gh-proxy.com`），
打包时也可通过 `VITE_APP_UPDATE_MIRROR_MANIFEST_URLS` 覆盖或追加镜像清单地址，
使用逗号或换行分隔。默认源不可用时，程序会在后台按顺序尝试镜像；界面不会
显示具体站点，也不要求用户手动选择。从镜像清单取到更新时，程序会把
`apkUrl` 自动改写为同一镜像前缀下的下载地址，避免清单来自镜像但 APK 仍指向
GitHub 导致无法下载。

镜像清单中的 `apkUrl` 可以指向同一镜像上的 APK，但必须提供对应文件的实际
字节数和 SHA-256。发布时应先上传 APK，再上传更新清单，避免用户读取到尚未
完成上传的版本。

远程 ESQ 题库目录与程序更新通道相互独立。ESQ 下载后会校验目录声明的文件
大小和 SHA-256，再进入冲突预览；程序不会未经确认自动覆盖本地年份。

## 启动静默检查

应用启动时会后台静默检查一次程序更新：发现新版本时不打断当前操作，只在页面
顶部显示一条可关闭的提示，点击“查看更新”进入更新页。用户仍可在“更新与远程
题库”页手动点击“检查程序更新”。
