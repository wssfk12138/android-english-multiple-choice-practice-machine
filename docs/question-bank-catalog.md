# 远程题库目录契约
远程题库与 Android 程序更新是两个独立通道。两者可以使用同一个 GitHub 仓库，
但必须使用不同清单。题库目录描述可下载的 ESQ 包；程序更新清单只描述 APK。

电脑端和 Android 端使用同一份 `catalogVersion: 1` 契约。用户获取目录后可以逐项
选择、全选或清空选择。每个选中的 ESQ 都会单独下载并校验，成功后只建立现有导入
流程的草稿。只有用户查看内容与冲突并明确批准发布后，题库才真正写入当前题库配置。

## 目录格式

```json
{
  "catalogVersion": 1,
  "updatedAt": "2026-08-27T12:00:00Z",
  "packages": [
    {
      "packageId": "cet4-2026",
      "title": "大学英语四级题库 2026",
      "contentVersion": "1.0.0",
      "fileName": "cet4-2026-v1.esq",
      "downloadUrl": "https://github.com/OWNER/REPO/releases/download/bank-v1/cet4-2026-v1.esq",
      "sha256": "64 位十六进制 SHA-256",
      "size": 123456,
      "license": "题库的授权和使用范围说明",
      "years": [2025, 2026]
    }
  ]
}
```

## 校验边界

- 目录 JSON 最大 2 MiB，`packages` 最多 500 项，`catalogVersion` 当前固定为 `1`。
- `packageId + contentVersion` 必须唯一，`contentVersion` 使用 SemVer。
- `fileName` 必须是单个 `.esq` 文件名，不能包含路径、盘符或首尾空格。
- 正式公网目录和下载地址必须使用无内嵌凭据的 HTTPS；HTTP 只允许本机地址或
  `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16` 私有 IPv4 字面量，用于局域网分发。
- HTTP 主机名、公网 IPv4、带用户名或密码的 URL 均拒绝；局域网地址变化时需更新清单 URL。
- 目录请求和 ESQ 请求都复核 Capacitor 返回的最终响应 URL，防止重定向降级到不安全地址。
- `sha256` 必须是 64 位十六进制，`size` 必须在 1 字节至 2 GiB 之间。
- `license` 必须非空，`years` 只接受 1900 至 2200 的整数年份。

## GitHub 发布建议

Android 官方默认目录使用独立内容 Release，而非应用 Release 的 `latest`：

```text
https://github.com/wssfk12138/english-multiple-choice-practice-machine/releases/download/question-banks-v1.2.0/question-bank-catalog.json
```

2026-09-08 已回读目录及四包资产元数据，并完整下载校验一个小包。受控镜像仍需可管理的
真实 HTTPS 端点；`VITE_QUESTION_BANK_CATALOG_MIRROR_URLS` 默认留空，不内置公共代理。
内测显式构建覆盖或用户设置仍是固定单一来源；均为空时才使用官方与镜像链。
公测的构建默认、存量官方别名和第三方隔离规则见该独立仓库的 `docs/update-manifest.md`，
不得以本仓内测的覆盖策略推断公测行为。ESQ 格式和 Windows 互操作契约未因此改变。

把 ESQ 作为 GitHub Release 资产上传，再把稳定的资产 URL、精确字节数和 SHA-256
写入目录 JSON。最后发布目录 JSON，避免客户端先看到尚未上传完成的文件。目录和 Release
不得包含私有题库、用户数据库、API Key、日志、签名或设备路径；公开前必须确认每个题库
的版权和再分发许可。

Android 远程 ESQ 由原生插件流式写入临时文件，并在下载过程中校验目录声明大小、
2 GiB 上限和 SHA-256；随后原生有界读取 JSON、流式校验并落盘资产，只把结构化题库数据
交给 WebView。发布者仍应控制单包规模，并为解压后的媒体资产预留足够磁盘空间。
