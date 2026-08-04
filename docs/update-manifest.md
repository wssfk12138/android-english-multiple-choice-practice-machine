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
- `apkUrl`：APK 的 HTTP 或 HTTPS 下载地址。
- `apkSha256`：APK 文件 SHA-256。
- `releaseNotes`：可选的更新说明。

## 发布要求

- 所有覆盖更新 APK 必须使用相同的 `applicationId`。
- 所有覆盖更新 APK 必须使用相同签名证书。
- 已发布的 `versionCode` 不得重复或降低。
- 更新清单应最后上传，避免用户先读取到尚未完成上传的版本。
- 正式渠道使用 HTTPS；局域网 HTTP 只用于调试构建。

应用校验哈希成功后只会打开系统安装器，不能绕过 Android 的安装确认。
