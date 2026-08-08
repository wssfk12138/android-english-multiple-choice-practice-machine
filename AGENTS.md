# 英语刷题机 Android 开发规则

## 项目定位

- 本仓库是英语刷题机 Android 的独立开发与发行项目。
- Windows 电脑版仅作为产品功能和 ESQ 兼容性的上游参考。
- Android 与 Windows 不共享数据库、版本号、签名证书、提交历史或发布节奏。

## 技术栈

- Vue 3、TypeScript、Vite
- Capacitor 8
- `@capacitor-community/sqlite`
- Android Java 原生插件
- JDK 21、Android SDK 36

## 固定边界

- Android 的题库导入工作流与 Windows 版保持功能一致：支持 DOC、DOCX、文本型 PDF
  答案附件、模型辅助定位题目与答案、逐字段草稿校对和批准入库。
- Android 支持题库模型智能标注，并保留按本次导入、按年份和全部题库三种范围。
- 扫描版或水印严重且没有可靠文字层的 PDF 必须明确提示人工处理；不得把 OCR
  失败伪装成成功导入。
- API Key 必须通过原生 SecureStore 保存，不得进入 SQLite、日志或源码。
- APK、AAB、数据库、签名文件、`signing.properties`、日志和用户数据不得提交。
- ESQ 兼容性改动需要说明是否仍与 Windows 电脑版格式兼容。
- 不得从 Windows 仓库整体覆盖本项目；共享功能必须按明确提交或文件逐项移植。

## 开发流程

1. 所有 Android 功能和修复只在本项目完成。
2. 每个完整功能或 Bug 修复单独提交。
3. 使用精简验收：
   - `corepack.cmd pnpm run build`
   - `corepack.cmd pnpm exec cap sync android`
   - `frontend\android\gradlew.bat assembleDebug`
4. 有真机时，再执行与改动相关的荣耀平板核心交互验证。
5. 发布前检查应用 ID、签名证书、递增的 `versionCode`、APK SHA-256 和更新清单。

## 常用命令

- 安装依赖：`cd frontend; corepack.cmd pnpm install`
- 构建 APK：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-android-debug.ps1`
- 打开 Android Studio：`cd frontend; corepack.cmd pnpm run android:open`

## 当前第一版限制

- 远程题库支持目录检查、ESQ 下载、SHA-256 校验与导入预览；仍需用户确认冲突处理后发布。
- ESQ 多媒体资产尚未落盘。
- Word/PDF 解析和智能标注在 Android 本机执行，模型密钥仍只由 SecureStore 提供。
- 尚未完成荣耀平板 9 真机验收。
