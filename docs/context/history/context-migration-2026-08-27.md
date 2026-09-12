# 2026-08-27 上下文分层迁移

## 迁移范围

- 仓库旧滚动记录：`PROJECT_NOTES.md` → `docs/context/history/PROJECT_NOTES-through-2026-08-24.md`。
- Obsidian 旧项目长页：`projects/英语刷题机 Android.md` → `notes/archive/英语刷题机 Android-legacy-through-2026-08-25.md`。
- 原路径分别建立短兼容入口和项目仪表盘。

## 完整性校验

- 仓库记录迁移前后 SHA-256：`0AF967A69771FCB8E666B8C47DC12FA0B915278DFF55E71C8831B686F1FE3804`。
- Obsidian 项目页迁移前后 SHA-256：`12BDEA5B45C285BB4CD182FCA076D4B5C5CCDCB7AB10F36BE5F55A65FB9194EC`。
- 两项移动后的哈希均与源文件一致；没有删除历史内容。

## 回退方法

如需撤销分层结构，先确认两个原路径的短入口没有新增独有事实，再将上述归档文件移回原路径。回退会恢复旧的全文读取模式，因此只在分层路由不可用时执行。

## 边界

本次只调整项目规则、上下文文档和 Obsidian 仪表盘。未修改、清理、暂存、提交、推送或发布任何功能源码、数据库、备份、构建产物或远端状态。

