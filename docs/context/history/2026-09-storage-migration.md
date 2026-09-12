# 2026-09-09 C盘迁移与去重

用户先要求只读排查，随后以“按照你的建议执行”授权六项迁移/去重。范围仅限私有migrate.ps1列出的精确目录，未暂存、提交、发布、跨仓同步或清理其余工作树。

## 已完成

| 对象 | 处理 | 原文件逻辑大小 |
| --- | --- | --- |
| 三批Codex交付证据 | 迁至E盘archives/codex-evidence，原日期和任务ID层级保持 | 10.68 GiB |
| C盘旧Android SDK | 与E盘既有SDK核验去重 | 0.55 GiB |
| 2000工作树staging-alpha39 | 与aac2副本核验去重，保留aac2 | 2.37 GiB |
| Gradle用户目录 | 迁至E盘.toolchains/gradle-user-home并设置用户环境变量 | 1.49 GiB |

六处原路径均保留Junction。2000的staging联接依赖aac2保留副本，未来清理工作树须先解除或迁移该依赖。完整绝对路径以MAP和私有逐项回执为准。

C盘可用空间从7,888,486,400字节（7.35 GiB）增至约24.2 GB（22.54 GiB），净增约15.2 GiB；E盘剩余约356 GiB。可用空间会受后台活动影响，逐项文件逻辑大小不能直接当作实际释放量。最终精确快照保存在final-verification.json。

## 验证与保留边界

- 六项均保存源文件相对路径、大小、SHA-256；复制/去重目标逐文件核验后再复核源未发生并发修改，随后移除原副本并建立联接。SDK唯一差异为.knownPackages，C盘原件已单独保留。
- Gradle的37,577个文件核验通过；JDK21下离线help任务成功，初始化脚本确认实际Gradle用户目录为E盘。旧C盘SDK路径执行adb version成功。该验证覆盖缓存读取和项目配置，未重复完整APK构建或设备安装。
- 正式签名备份、signing.properties、Debug签名和ADB私钥共四项SHA-256保持不变。学习数据库未列入迁移范围。JDK、npm缓存和其余备份保留。
- 迁移后、文档更新前，主仓144条git status记录与基线完全一致。本阶段仓库手工修改仅限项目索引和当前上下文/历史记录；未回退既有修改。

## 回退与审计

私有审计根为`E:/EnglishPracticeMachine/archives/c-drive-migration-20260909/`。README.md包含逐项回退步骤；`0`至`5`的回执与源清单保存完整证据，environment-before.json保存原用户Gradle变量（空），context-before保留本次文档修改前副本。

回退前停止使用目标的进程、确认空间充足并核对联接目标；仅移除联接本身，复制目标回原路径并按清单核验，验证完成前保留E盘副本。Gradle回退还需恢复原用户环境变量。私有路径、回执和备份不得进入公开副本。
