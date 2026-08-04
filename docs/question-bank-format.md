# 英语刷题机 ESQ 1.0 题库格式

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

- `schemaVersion`：格式版本，ESQ 1.0 固定为 `"1.0"`。
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

文章使用 `blocks` 保存，ESQ 1.0 支持：

- `paragraph`
- `quote`
- `image`
- `table`
- `audio`
- `separator`

题库正文不得包含可执行 HTML 或脚本。图片和音频只能引用包内
`assets/index.json` 声明的 `assetId`。

完形填空用 `{{blank:1}}` 表示第 1 个空。

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

- 压缩包最大 100 MiB；
- 解压后总大小最大 300 MiB；
- 文件数量最大 1,000；
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
