# 英语刷题机 ESQ 1.0/1.1 题库格式

ESQ（English Study Question bank）是英语刷题机的公开题库交换格式。
`.esq` 文件本质上是 ZIP，所有 JSON 文件使用 UTF-8 编码。

## 目录结构

```text
question-bank.esq
├── manifest.json
├── papers/
│   ├── 2025.json
│   └── 2026.json
├── answers/
│   ├── 2025.json
│   └── 2026.json
├── labels/                 # 可选
│   └── 2026.json
├── assets/                 # 可选
│   ├── index.json
│   ├── images/
│   └── audio/
├── LICENSE.txt             # 建议提供
└── README.md               # 可选
```

## 版本与稳定标识

- `schemaVersion`：格式版本，支持 `"1.0"` 与 `"1.1"`。1.1 在 1.0 基础上增加四六级考试类型 `examType`、`examMonth`、`setNumber` 和听力轨道元数据，其余结构与 1.0 完全一致。
- `packageId`：题库包的稳定标识，发布后不改变。
- `contentVersion`：内容版本，使用语义化版本号。
- `paperKey`、`unitKey`、`questionKey`：跨电脑稳定标识，不能使用本地 SQLite ID。

推荐标识：

```text
cn.exam.english1.2026
cn.exam.english1.2026.reading.text1
cn.exam.english1.2026.q21
```

## 内容块

文章使用 `blocks` 保存，ESQ 1.0/1.1 支持：

- `paragraph`
- `quote`
- `image`
- `table`
- `audio`
- `separator`

题库正文不得包含可执行 HTML 或脚本。图片和音频只能引用包内
`assets/index.json` 声明的 `assetId`。

完形填空用 `{{blank:1}}` 表示第 1 个空。

## 资产声明

`assets/index.json` 声明包内媒体文件，每个条目包含：

- `assetId`：包内唯一标识，正文 blocks 通过它引用；
- `path`：包内相对路径；
- `mediaType`：MIME 类型（图片或音频）；
- `sha256`：文件内容的 SHA-256；
- `size`：文件字节数（**权威字段**，导入端据此逐字节核对）；
- `originalName`、`label`：可选。

历史兼容：早期 Windows 导出曾把字节数写作 `bytes`。Android 导入端
同时接受 `size` 与 `bytes`，`size` 优先；新导出一律使用 `size`。

## 标准答案

正式题库默认必须包含 `answers/*.json`。没有答案的包仍可导入预览，
但只能保存为未完成草稿，不能发布为可判分题库。

## AI 标签

`labels/*.json` 是可选文件。导入器只在以下条件全部满足时导入：

- 题目的 `questionKey` 存在；
- `questionContentHash` 与当前题目一致；
- 本地标签没有被人工编辑或锁定。

AI 标签不能修改文章、题干、选项或标准答案。

## 冲突处理

本地已经存在同一 `paperKey` 或同一年份时，导入器不会自动覆盖。
用户必须在发布前为每个冲突年份选择：

- `keep_existing`
- `replace_with_imported`

替换时按稳定键更新已有题目，尽量保留练习记录和错题统计。

## 安全限制

Android 端（原生远程下载与本地导入一致采用以下上限）：

- 压缩包最大 2 GiB；远程导入由 Android 原生层流式下载并校验，不把完整压缩包送入 WebView；
- 解压后总大小最大 8 GiB，单个 JSON 最大 64 MiB，全部 JSON 合计最大 256 MiB；
- 文件数量最大 10,000，ZIP 压缩比最大 250:1。

Windows 端本地导入上限更严格（单包 100 MiB、1000 个文件、
压缩比 100:1、单个 JSON 20 MiB）。**跨平台互导安全区间**：要让同一个
`.esq` 包能被所有平台的全部导入路径接受，请控制在
包 100 MiB、1000 个文件、单个 JSON 20 MiB、压缩比 100:1 之内；
超出安全区间的包可能只被 Android 端接受。

- 禁止绝对路径、`..`、符号链接和加密 ZIP；
- 禁止 EXE、DLL、脚本、HTML 和带宏 Office 文件；
- 媒体必须通过文件头、大小和 SHA-256 校验；
- 导入文本只能作为普通文本渲染。

## 校验

```powershell
.\.venv\Scripts\python.exe .\tools\validate_question_bank.py path\to\bank.esq
```

格式定义位于：

```text
docs/schemas/esq-1.0.schema.json
```
