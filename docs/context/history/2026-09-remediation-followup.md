# 2026-09-11 整改续接回执

来源为旧任务 01a086ad-a2d9-7503-9d51-68f59f974e20 的用户消息、源码与私有回执。当前待办以 [续接清单](../remediation-followup-2026-09-11.md) 为准；本页不是全部任务完成声明。

## 本轮完成

- Windows 内测 sync.merge 接入 snapshots_equivalent；两 Windows helper 保持 JSON 布尔值与数字不同，避免将大整数转浮点造成内容误等价。仅忽略包元数据和根 revision，不忽略正文、候选、顺序或评分。
- 两 Windows 新增元数据漂移可同步及真实内容/类型差异拒绝测试；先复现内测漏接与误比较，再修复。
- 双 Android 增补快照等价与同会话不重复创建测试。公测原先仅改 revision 的拒绝用例改成正文真实差异，没有因此放宽生产校验。

## 已执行验证

- Windows 内测：tests.test_sync、tests.test_sync_convergence、tests.test_practice_snapshots 共 39 项通过；公测对应 40 项通过。使用各自虚拟环境和测试临时数据库。
- Android 内测：practice-snapshots.mjs 与 lan-sync-convergence.mjs 合计 18 项通过；公测 snapshot 文件通过，convergence 修正旧用例后 17 项全部通过。
- 四树 vocabulary-review-refresh.mjs 全部通过，覆盖删除/同步刷新、失败保存、刷新复用、重复评分、前台刷新、dispose、expected_revision 与延迟响应保护。
- Android/Windows 公测 lan-sync-candidate-integration.mjs 临时数据库联调通过，不读取真实用户数据库。
- 四树 git diff --check 通过，暂存区为空。大量未提交源码及受控本地对象保留，未清理、暂存、提交、推送或发布。
- 本轮 Android 只补测试，Windows 改 Python 比较/调用逻辑；未重复未受影响的前端/原生构建，未生成或部署新的 Windows 冻结包。此前构建不能视为包含本轮后端增量。

## 2026-09-12 校勘证据 r2 收口

- 新增只读脚本 audit_followup_evidence_r2.py 与报告 followup-source-evidence-20260912.json（open('x') 新建；初版 20260911 报告保留未改）。四树 content-remediation.json after/findings 复验一致（SHA-256 af240944…）。
- F024：保留严格比较 fullCandidateDMatches=false 的事实，另加限定核对——仅移除两侧紧跟 `, . ; : ! ?` 的单个空格后完全一致（词内空格保留，不能掩盖词内变化）；difflib 差异块全部为标点后空格。未为通过比较而修改题库。
- F033：2010/2011/2014/2017/2018/2019 可信 Word VML 同行绝对横坐标；2025/2026 补充来源预给链；2023 新增补充来源位置链 `41=B → 预给A → 42=F → 预给E → 43=D → 预给H → 44=C → 45=G`，与库内 fixed_slots [41,A,42,E,43,H,44,45] 一致，且链中答案 B/F/D/C/G 与题库答案一致。来源 lazynote-2023-one-followup.html + receipt（URL/抓取时间/SHA-256 复验一致）。九年 9/9 覆盖；2023 明确标注为补充网页交叉核对，不是可信 Word 原图渲染。
- 边界：九项定向收口不等于 1525 题逐字认证；F025 候选全文排版疑点保留；2026 完型 20 空证据与 Part B 证据分别引用。

## 2026-09-12 候选构建、冲突只读方案与内测部署

- 模型同步复验：双 Windows `tests.test_model_snapshot`+`tests.test_model_keys` 各 17/17 通过；双 Android `model-snapshot.mjs`、`model-keys.mjs` 通过。四树关键文件对应（双 Windows model_snapshot/model_key_transaction 仅行尾空行差异，测试与 TS 文件逐字节相同；routers/sync.py 差异为公测树既有端口常量用法）。
- 正式签名候选：AD `0.1.0-alpha.80`（code 80，SHA-256 cac1afcc…，证书 b50d155c… 与在装 alpha.79 一致，可覆盖安装；清单 URL 按当前 LAN 192.168.3.16:8877 烘焙）；AP `0.1.0-beta.6-test.12`（code 116，SHA-256 a07f4836…，同证书）。回执与签名文件：`verification/remediation-20260910/android-candidate-20260912/`。仅构建验证，未安装、未更新通道。
- Windows 冻结包：内测 ba `build/windows/dist`（exe SHA-256 a7615934…）与公测 WP `outputs/windows-public-20260912/`（exe SHA-256 ec4454d2…）均确认 PYZ 含 `services.model_snapshot`、`services.model_key_transaction`，且不含 backend/data。
- WP 半同步修复：WP `VocabularyView.vue` 模板引用 `reviewKind`/`closeReview` 但脚本定义缺失（vue-tsc 失败，属此前中断的半同步）。按 ba 补齐定义、额外巩固入口与 scoped 样式，保留 WP 自有头部文案；修复后 WP 前端构建与 `vocabulary-review-refresh.mjs` 通过，WP 冻结包用修复后产物重建。
- Windows 内测部署：先做在线备份（`record-conflict-20260912/windows-backup-1789175004129984900`，integrity ok）；新包部署到 `Programs/EnglishPracticeMachine/p2-20260912`，桌面 lnk 已备份并切至 p2 VBS；旧 p1 进程停止后经 VBS 启动新进程（pid/路径核验），`/api/health` 200，8765/8766/8767 监听正常；九张业务表行数部署前后一致。p1-20260908 目录保留可回退。
- 27 组冲突只读逐项方案：Windows 侧自 09-10 备份零漂移；32 组失败批次=5 等价+27 冲突（另有 1 组等价会话不在失败批次内）；27 组全部为平板 r3 对电脑 r1 的内容修订差异（正文 20/段落块 18/候选 15/导语 15/固定槽位 7），作答、is_correct、判分与会话时间戳零差异；无需要独立历史的项目。草案与逐项 JSON：`verification/remediation-20260910/record-conflict-20260912/`。真实合并未实施。

## 2026-09-12 平板接入后的真实实施

- 平板（HEY2-W09）无线调试接入；正式签名 alpha.79 不可 run-as，数据保护改以 Windows 侧备份承担（合并前在线备份 windows-premerge-1789180726429781900，integrity ok；平板侧 32 个旧会话快照按设计不可变，以 09-10 平板备份中的 r3 快照为权威替换值）。
- 记录合并：merge_snapshots.py 先在两份副本通过幂等/零额外变化/统计一致/生产守卫 0 拒绝测试，再停服务应用到真库（27 组 content_snapshot 原子替换，guard_fail 0），重启后健康与行数核验通过。
- 平板真实同步：平板 10:43:05 经生产 TLS 路径同步成功——批次 32/32 快照与平板等价、平板行整行应用（updated_at/_sync_rev/_sync_origin 取平板值），随后重放生产合并返回 0 应用（幂等终态）；73 会话/73 独立 sync_id 无重复计数，答案 1652/事件 334/提交 20 不变。逐字段差异仅剩本地 ID 映射（tablet 本地 id vs Windows 解析 id），属同步协议正确行为。
- 模型配置/Key 同步：平板覆盖安装 alpha.80（UID 10215、首次安装时间保持；在装 base.apk 与候选 SHA-256 逐字节一致 cac1afcc…）后，经“以本机模型配置发送到电脑”确认对话框（语义与设计一致）推送：平板报告“已发送 2 个模型配置及 Key；未处理练习记录”。Windows 侧核验：true-sota enabled 0→1、基元律动默认模型更新、模型列表 18→24 按源替换、DPAPI 侧文件哈希变化（61404f8a…→34133ca8…），Key 未进 SQLite、未打印；练习记录未被该操作处理。
- 平板真库修订：同步载荷 r3 快照与当前 Windows r3 库经 validate_incoming_session_content 校验通过；alpha.80 内置同源 r3 资产；诊断仅余 09-10 旧错误一条，无新启动错误；未重复导入。
- 平板 logcat 无错误/异常/SSL 失败。完整回执：私有 record-conflict-20260912/IMPLEMENTATION-RECEIPT.json。

## 数据与校勘证据边界

- 对原失败批次及 Windows 备份只读审计：32 会话全部命中同 ID，5 份等价、27 份真实内容不同、0 新会话、0 缺失本地快照。修复后内存重放仍拒绝，不能把脚本捕获异常后的零退出码当同步成功。该结论针对备份，不冒称当前真库已完成同步。
- 四树清单的 revision、65 单元 after/findings 与原 r3 一致。选定 F005/F007/F008/F024/F025/F027/F028/F029/F033 来源哈希当前匹配；这是来源未变和修正目标未漂移证据，不是完整官方逐字认证。
- 既有平板 apply-reviewed-result 回执为 r3 修订 98 实例、保护 32 会话，并非重新导入全题库。本轮读到平板内测正式非调试 alpha.79；旧 CDP 无法使用，尚未独立确认当前真库修订。
- 原始数据库、失败批次、审计脚本和回执留在 MAP 指定的私有证据根 tablet-perf 子目录；不复制至公测仓。真实 Key 未读取、输出或同步。

## 未完成与边界

真实记录冲突合并策略已由用户确定（平板为主、逐项合并），尚未实施真实同步；模型 authoritative 源码四树已落地并通过合成测试，正式签名候选、Windows 冻结包与真实 Key 同步未做；当前平板数据及安装产物映射须收口。校勘九项定向证据已于 2026-09-12 收口。最终真机体验/交互与 Windows 视觉验收按本次用户要求排除。本地提交仅在任务完成后按窄范围执行。
