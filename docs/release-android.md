# Android 发布流程

## 历史发布方式（现场核实，2026-08-31）

GitHub 上现有 3 个 Release，全部为**手动上传**：

| 标签 | 资产 | 问题 |
| --- | --- | --- |
| v0.1.0-alpha / v0.1.0-beta.1 | APK + android-update.json（beta.1） | 指向重建前的旧历史 |
| v0.1.0-beta.2 | 仅 APK | 未上传更新清单 |
| v0.1.0-beta.3 | 仅 APK | 未上传更新清单 |

因为 `releases/latest/download/android-update.json` 实际解析到 beta.3
（无清单资产），**当前应用内"检查更新"线上是断的**（404）。
新流水线上线后，首次发布即可修复该问题。

仓库在 2026-08-31 前没有任何 GitHub Actions 工作流。

## 自动流水线（推荐）

`.github/workflows/release-android.yml` 提供手动触发的发布流水线：
构建 web 资产 + cap sync → 还原正式签名 → `assembleRelease` →
apksigner 验签 → 生成 `android-update.json` → 创建 Release 并上传
APK 与更新清单（清单最后上传语义由同一步保证）。

### 前置条件（一次性，由仓库维护者在本机完成）

1. 导出 keystore 的 base64：
   `certutil -encode work\signing\english-practice-machine-release.jks keystore.b64`
   （或 `base64 -w0`），内容存入 Secret `ANDROID_KEYSTORE_B64`。
2. 口令存入 Secret `ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_PASSWORD`
   （keyAlias 固定 `english-practice-machine`）。
3. 建议发布后评估口令轮换：口令已在多个本机副本明文存在。

### 发布步骤

1. 确认本地构建、真机验收通过；`versionCode` 大于所有已发布版本。
2. GitHub → Actions → **Android Release** → Run workflow，填写
   `tag`（建议 `v0.1.0-beta.4` 起的新线）、`version_name`、
   `version_code`、`release_notes`。
3. 发布完成后核对：
   - `releases/latest/download/android-update.json` 可读且 SHA-256 与
     APK 资产一致；
   - 真机"检查更新"能发现新版本并覆盖安装（同 applicationId +
     同签名 + 递增 versionCode）。

## 约束

- 清单字段由 `frontend/src/platform/android/app-update.ts` 严格校验；
  `apkUrl` 必须是 GitHub 域名 HTTPS 直链（国内镜像由客户端自动回退）；
- 覆盖更新必须同 `applicationId`、同签名证书、递增 `versionCode`；
- 内测通道（局域网 alpha 序列）与公开 Release（beta 序列）是两条
  独立发布线，versionCode 需要通盘考虑避免倒挂。
