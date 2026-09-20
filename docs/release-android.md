# Android 发布流程

本页说明正式签名 APK 的构建与发布检查。实际发布前重新核验线上版本与已分发版本。

## 线上基线（核验日期：2026-09-20）

最新已发布版本为 `v0.1.0-beta.5`，版本代码 `104`。GitHub API 可读取
该 Release 的 `android-update.json`，对应 APK 已下载核验；旧版文档中
“最新为 beta.3、缺少更新清单”的结论已过期。此次未做设备内检查更新验收。

- applicationId：`com.wssfk.englishpracticemachine`。
- APK 大小：45,962,954 字节。
- APK SHA-256：`87c630c65f9a927c6bccf8e0bd49a8c978a927f8daf1ef51f7a57f1d75425f88`。
- 签名证书 SHA-256：`b50d155ca946277d598a878d4b02c0994d13bb7038770af52b641731b86de0a7`。

这些是已发布 beta.5 的基线，不是下一版 APK 的验收结果。发布前重新核验线上状态。

## 自动流水线（推荐）

`.github/workflows/release-android.yml` 提供手动触发的发布流水线：
核对完整提交 SHA 与远端版本 → 严格前端回归和生产构建 → cap sync →
Java 单元测试和正式签名构建 → 核验 APK → 生成清单 → 上传草稿并重新下载比对哈希。

工作流只创建草稿，不自动公开。构建提交必须与输入的完整 `source_sha` 一致；
versionCode 必须超过所有已有公开、预发布及草稿更新清单中的版本，标签必须尚不存在。
APK 必须是原 applicationId、不可调试，并使用上列已发布版本的证书。
校验脚本为 `scripts/release_guard.py`，测试命令为
`python -m unittest discover -s scripts -p 'test_*.py'`。

CI 无法知道未上传 GitHub 的试装包版本；维护者仍须核对实际分发过的同包名版本。
脚本本地验证通过不代表 GitHub Actions 已完整运行或最终 APK 已验收。

### 前置条件（一次性，由仓库维护者在本机完成）

1. 导出 keystore 的 base64：
   用 `base64 -w0` 生成纯 Base64，存入 Secret `ANDROID_KEYSTORE_B64`。
   使用 Windows `certutil -encode` 时去掉 BEGIN/END 包装行，只保留 Base64 正文。
2. 口令存入 Secret `ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_PASSWORD`
   （keyAlias 固定 `english-practice-machine`）。
3. 签名文件、口令及中间导出文件不得提交；按仓库维护者的秘密管理流程保存。
   Secret 名称存在不代表其值正确，仍须对实际构建产物核验证书。

### 发布步骤

1. 确认候选范围、回归测试和必要设备验收通过；公开内容扫描必须包含
   所有待上传提交，不能仅扫描工作树；排除私人记录、签名文件、数据库和构建产物。
2. 确定新版本；`versionCode` 大于线上版本，并考虑同包名已分发的试装版本。
   Gradle 未传参数时默认 `1 / 0.1.0-alpha`，不能直接作为新发布版本。
3. 构建并验收 `release`：必须使用原 applicationId、匹配的正式证书且不可调试。
   `publicTest` 使用 `.publictest` 后缀且可调试，是独立试装包，不能作为线上覆盖更新包。
4. 获得构建及草稿上传授权后，GitHub → Actions →
   **Android Release** → Run workflow，填写
   `tag`（必须等于 `v` + `version_name`）、`version_name`、
   `version_code`、`release_notes`、已审查的完整 `source_sha`。
5. 从草稿下载正式 APK，完成必要的覆盖安装与数据保留验收。已验证且实现未变的
   普通界面无需重复全量验收。确认资产校验步骤成功后，再获准手动公开草稿。
6. 发布完成后核对：
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
