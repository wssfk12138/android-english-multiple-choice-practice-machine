# 英语刷题机 Android

> 基于“英语刷题机”电脑版理念独立发展的 Android 英语选择题训练应用。

[English](README.en.md) · [ESQ 1.0 题库格式](docs/question-bank-format.md) · [更新清单格式](docs/update-manifest.md)

英语刷题机 Android 面向需要长期、大量练习英语客观题的 Android 手机与平板用户。项目强调题库自由、模型自由、数据本地和自由刷题：用户通过 ESQ 题库包导入内容，通过自己的 API 接入大模型，并利用选项打乱、错题重做和弱点分析降低“背答案”对重复练习的影响。

本项目与 Windows 电脑版是两个独立发行项目：

- Android 版使用 Capacitor、Vue 3、TypeScript 和原生 SQLite。
- Windows 版继续使用 Vue 3、FastAPI 和 SQLite。
- 两个项目通过 ESQ 1.0 保持题库兼容，不共享数据库、练习记录或发布版本号。
- Android 功能会参考电脑版，但根据移动端文件、权限、触控和大屏交互重新实现。

详细移植边界见[与 Windows 电脑版的关系](docs/upstream-compatibility.md)。

## 当前版本

`0.1.0-alpha`

首要测试设备为荣耀平板 9：12.1 英寸、2560×1600、Android 14。界面同时按实际窗口宽度适配横屏、竖屏和分屏。

## 已实现功能

- ESQ 1.0 题库导入、预览、校验和冲突处理。
- 按年份练习、随机抽取整篇、错题重做。
- 完形填空、阅读和 Part B 客观题。
- 选项打乱、答案保存、单篇提交和整卷提交。
- 未答完时阻止提交并定位到对应题目。
- 错题统计、高频错题和不泄露答案记忆的 AI 错题分析。
- 右键或长按加入单词本、重复遇见计数、高频词标记、批量翻译和复习调度。
- 多套 API 配置、模型自动拉取、模型显示开关和 AI 学习助手。
- API Key 使用 Android Keystore 与 AES/GCM 加密。
- APK 更新清单检查、下载、SHA-256 校验和系统安装器更新。
- 远程题库目录检查、ESQ 下载、文件大小与 SHA-256 校验、冲突预览和确认导入。
- 内测构建可携带一份经过校验的首次启动题库；只在本地无冲突时自动入库，升级时不会静默覆盖已有年份。
- 平板大屏双栏布局、中等窗口导航轨道、紧凑窗口单栏布局。

## Android 版不提供的功能

- Word、PDF 题库解析。
- Android 端题库模型智能标注。
- Windows 与 Android 实时同步。
- 普通应用无法实现的静默 APK 安装。

题库可以先在 Windows 电脑版完成 Word/PDF 导入和人工校正，再导出为 ESQ 供 Android 使用。

## 开发环境

- Windows 10/11
- Node.js 与 Corepack
- pnpm 11
- JDK 21
- Android Studio
- Android SDK Platform 36
- Android SDK Build Tools 36.0.0

## 构建调试 APK

首次安装前端依赖：

```powershell
cd frontend
corepack.cmd pnpm install
```

在项目根目录构建：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-android-debug.ps1
```

生成位置：

```text
frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

也可以打开原生工程：

```powershell
cd frontend
corepack.cmd pnpm run android:open
```

## 测试版更新

每个可覆盖安装的版本必须满足：

1. `applicationId` 保持为 `com.wssfk.englishpracticemachine`。
2. 使用同一枚长期保存的 Android 签名证书。
3. `versionCode` 严格递增。
4. 更新清单中的 APK 地址、版本号和 SHA-256 与实际文件一致。

调试构建允许使用局域网 HTTP 更新源；正式构建应使用 HTTPS。Android 系统仍会要求用户确认安装。

内测题库局域网服务可通过 `start-internal-update-server.ps1` 启动，通过
`stop-internal-update-server.ps1` 停止。平板需要与电脑处于同一局域网，且
Windows 防火墙允许 TCP 8877 入站；若网络环境不允许，内测 APK 中仍携带首次
启动题库，不影响第一次使用。

首次使用局域网更新时，以管理员身份运行
`enable-internal-update-firewall.ps1`。该规则只允许本地子网访问 8877 端口，
不会对公网开放更新目录。

清单示例位于 [examples/update-manifest.alpha.json](examples/update-manifest.alpha.json)。

## 数据与隐私

- 题库、练习记录、错题、单词本、AI 对话和配置保存在应用本地。
- API Key 只通过 Android 原生安全存储读取和保存。
- 应用关闭 Android 系统备份，避免密钥密文和学习数据进入云备份。
- ESQ 题库包不包含个人练习记录、错题、单词本、对话或 API 配置。
- 远程模型可能接收用户主动提交的聊天内容、错题分析信息或待翻译单词。

## 项目结构

```text
.
├── frontend/
│   ├── src/                  # Vue 界面与 Android TypeScript 业务层
│   ├── public/               # 公共图标与静态资源
│   ├── android/              # Capacitor Android 原生工程
│   └── capacitor.config.ts
├── docs/
│   ├── question-bank-format.md
│   ├── update-manifest.md
│   └── schemas/
├── examples/                 # ESQ 示例与更新清单示例
└── build-android-debug.ps1
```

## 当前限制

- ESQ 多媒体资源尚未真正落盘，第一版优先支持纯文本题库。
- 内测版首次从旧调试签名切换到固定签名时，需要卸载旧 APK；之后可以保持数据覆盖更新。
- 首版尚未完成荣耀平板 9 真机交互验收。
- 当前仓库只生成调试 APK；公开发布前需要建立独立且安全保存的测试/正式签名流程。

## 许可证

程序代码采用 GNU General Public License v3.0 only（`GPL-3.0-only`）。

题库、题目文本、答案和 AI 标签不自动继承程序代码许可证，应以每个 ESQ 包中的来源和许可声明为准。

作者：往事随风k
