# 平板切词卡顿与 reform 卡片恢复修复

2026-09-19，仅 Android 本地树。用户授权定位修复、沿诊断包版本序列安装、内测 WebView 调试；后续练习测试只点“不认识”。未提交、推送、发布或跨仓同步。

## 已确认原因与修复

- LanSyncPlugin 的 discover/post 原用 Bridge.execute，将网络等待放在 CapacitorPlugins 共享线程上，阻塞 SQLite。现场 discover 4013ms、评分查询约 3123ms、切词约 3255ms。改用独立单线程 LanNetworkExecutor，销毁时关闭；保留 LAN 地址/TLS/错误处理。
- reform 已排到未来复习日期，却留在缓存第 69 张。评分校验拒绝过期卡片后，仅刷新首 12 条并保留后方缓存，导致旧 reform 循环。现对 404/409 淘汰被拒缓存行再刷新；刷新失败仍保留重试状态。正常评分移除后台队列缓存行，防止补页复活。恢复至队尾时回到其余卡片，避免提前结束。
- WebView 调试由构建资源控制：debug/internal true，release 默认 false；生成 config 无全局覆盖。release 仅检查资源，未重新交付。

## 验证与边界

- 同条件 SELECT 1 与发现并发：改前 3812.6ms，最终 alpha.107 7.4ms；发现总耗时 4711.9ms（含可能排队）。证据 outputs/tablet-stutter-20260919/contention-before.json、internal107-contention.json。
- 保留数据和旧缓存，alpha.106 一次“不认识”让 reform 切到 Dilemma；该修复包含于最终 alpha.107。证据 internal106-reform.json。过期评分被拒，未强改学习进度。
- 最终 alpha.107 连续 16 次“不认识”，切词 47.2–106.5ms，释义就绪最大116.3ms；同时 discover 4010.6ms，16次全完成。证据 internal107-hard.json。中间版本的脚本超时/提前结束不计通过。
- 原生 testDebugUnitTest、LAN coordinator/errors/recovery 通过；review-refresh（新增第69张过期/删除卡、补页不复活、恢复至队尾）、review-revision、due-queue、snapshots、exit-flow 通过；类型检查/Vite、Capacitor copy、两变体 Gradle 构建通过。
- “不认识”仍写复习记录及下次时间，并非完全不影响学习统计。严格“每两词一次”的周期未建立；不宣称全部场景零卡顿。长时体验由用户验收；真实电脑端端到端同步未重验。

## 最终装机

- 内测 com.wssfk.englishpracticemachine：0.1.0-alpha.107 /107。
- 原诊断 com.wssfk.epm.selftest0917：0.1.0-selftest-0919-fixed3 /1001，版本递增。
- 均 install -r 成功，未卸载或清数据；内测首次安装时间仍2026-08-05 23:59:22。签名 SHA256 b50d155ca946277d598a878d4b02c0994d13bb7038770af52b641731b86de0a7。
- 内测 APK SHA256 88bf131bc6a2884c32ca415420adfeba01dcd9c1575c60204bc236103e5db6bb。
- 诊断 APK SHA256 210865a4e20181111378561d4038dada2d03a242b040a8de87037e4e27d98e52。
- APK/诊断/日志存于被忽略的 outputs/tablet-stutter-20260919，不得提交用户数据/APK。

## 变更范围

LanNetworkExecutor.java、LanSyncPlugin.java、MainActivity.java、app/build.gradle、LanNetworkExecutorTest.java、VocabularyView.vue、vocabulary-review-refresh.mjs。另更新本记录和 NOW。已有工作树改动保留；未改 ESQ 协议或 Windows 树。基线报告包含生成资源/探针，Gradle 未被索引统计，已另行人工核验；图分析仅为部分静态证据。
