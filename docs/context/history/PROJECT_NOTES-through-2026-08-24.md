# 英语刷题机 Android · 项目必读

> 当前接手摘要（2026-08-24）：已将 Windows 端智能标注第一、第二阶段修复按逻辑同步到 Android 内测开发版，未提交、未推送、未上传 GitHub。Android 已新增 `question_label_runs` 固定运行上下文，锁定题库配置、年份/试卷范围和覆盖策略；后续请求按 `run_id` 继续，不再受用户切换题库配置影响；新增暂停/失败状态落库、显式试卷归属校验、听力单元排除，并保留模型成功写入/人工校正自动锁定及历史有效标签批量锁定。已加固 SQLite 布尔值解析、非法年份回退和错误状态记录兜底，轻量 TypeScript 语法解析 4/4、`git diff --check` 通过。未运行完整 vue-tsc、Vite、Capacitor 或 Gradle，原因是当前可用内存约 3.94 GB，需保留至少 4 GB；荣耀平板真机快速验证仍待用户执行。

> 项目滚动上下文。固定边界与流程见 AGENTS.md。

## 最近状态摘要

- Android 独立开发版，Vue 3 + TypeScript + Vite + Capacitor 8 + SQLite。
- 支持题库导入（DOC/DOCX/PDF 答案附件、ESQ）、模型辅助定位与逐字段校对、智能标注、
  竖屏/横屏 UI、错题本三级记录、单词本复习计划、AI 助手、局域网数据同步 v1。
- 已发布 GitHub 公开版仓库与正式签名公测包 `v0.1.0-beta.1`；当前重点是真机联调。

## 技术栈与常用命令

- 安装依赖：`cd frontend; corepack.cmd pnpm install`
- 前端构建：`corepack.cmd pnpm run build`
- Capacitor 同步：`corepack.cmd pnpm exec cap sync android`
- Debug APK：`frontend\android\gradlew.bat assembleDebug`（需 `ANDROID_HOME`）
- 内测/公测包：`build-android-internal.ps1` / `build-android-beta.ps1`
- 打开 Android Studio：`cd frontend; corepack.cmd pnpm run android:open`

## 当前开发状态

- 题库导入：Word/PDF 解析、模型辅助、逐字段校对、批准入库、智能标注均可用。
- 智能标注：模型成功标注和人工校正结果自动锁定；仅明确解除锁定后才允许重新标注。
- 练习：按年份/专题/整卷/随机，计时、答题卡、Part B 段落排序与固定段位提示。
- 错题本：三级记录（年份→篇目→重做历史）、回收站、分析缓存门控。
- 单词本：退出答题后翻译、辨析、复习计划、局域网同步。
- 更新：GitHub Release + 镜像回退、局域网内测通道。

## 已知问题与解决方案（持续追加）

- Android WebView 宽度识别不可靠：用物理竖屏 `@media (orientation: portrait)` 兜底。
- SQLite 插件 `run()` 自带事务：显式事务内调用要传 `false`，避免 "Already in transaction"。
- 竖屏 CSS 有历史重复块：以文件末尾最终覆盖块为权威来源。
- 内置题库开关：`main.ts` 用 `VITE_BUNDLED_QUESTION_BANKS !== '0'`，勿叠加 `VITE_BUNDLED_QUESTION_BANK` 条件。
- GitHub 直连不稳：本机 git 走代理 `http://127.0.0.1:11304`，远程操作用 `gh`。
- 局域网同步 v1 已落地，待真机联调；跨设备合并用 stable key（external_key / normalized_term / sync_id）。

## 2026-08-13 暂停计时后答案消失修复（Android 端）

- 按 PROJECT_NOTES 记录的修复方向落地三条（word_bank 在 Android 无此题型，跳过）：
  1. 首页新增“继续上次未完成练习”入口：`dashboard()` 返回 `resume_session`（最近一条 status='active' 的会话），横屏/竖屏首页各加一张 resume 卡片，点击跳 `/practice/:id`，避免重进练习新建会话导致答案“消失”。
  2. Part B/排序题 option_order 空列表回退：`saveAnswer()` 当 `body.option_order` 为空时回退到题目原始选项顺序（按 sequence 查 options.stable_key），不再把空数组写库，避免下次恢复时选项顺序错乱。
  3. 暂停/计时浮层防穿透：`timerPromptVisible` 与暂停浮层 section 加 `@click.self.prevent`、dialog 加 `@click.stop`，防止双击穿透触发下方选项 select。
- 精简验收：`corepack.cmd pnpm run build` 通过。

## 2026-08-11 题库导入代码复用调研（供模拟题生成器）

- 结论：刷题机的题型解析/结构校验能力明显强于模拟题生成器，可直接复用其思路与纯函数模块。
- 可复用模块：`exam-templates.ts`（detectExamType/templateUnits）、`esq-format.ts`（validateEsqManifest）、
  `ordering-fixed-slots.ts`（extractOrderingFixedSlots）、`document-import.ts` 解析子集
  （parseExtractedExam/validateDocumentDraft/parseCloze/parseReading/parsePartB/parseTrueFalsePartB）、
  `question-bank.ts` parseEsqBytes（ESQ→papers/units/questions/options/shared_data/audio_tracks）。
- 生成器短板：题型无枚举、结构止于 section、缺逐题字段（完形空位/Part B 槽位/听力轨/T-F/词库/翻译），
  校验仅递归求和分值。
- 推荐路线：抽共享 TS 纯函数核心（或移植为 Python 工具）→ 生成器增加“结构识别/校验”步骤 →
  移植逐题校验规则；原创性门、年份权重、答案盲审保留生成器自身逻辑。

## 2026-08-11 Windows 练习“暂停计时后答案消失”排查

- 数据流确认：select() 乐观更新 user_answer 并 PUT 到 practice_answers；暂停/恢复只改 timerState，不碰 session。
- 同一页面内“暂停→继续”不会清空答案；最可能路径是重进练习新建会话（首页/题库每次点击都 POST 新 session，无“继续上次”入口），
  或页面刷新后 Part B/排序题因 option_order 空列表触发选项重排、word_bank 本地 selectedWordBank 未从 user_answer 恢复。
- 次要风险：暂停浮层双击穿透会触发下方选项 select。
- 修复方向：增加“继续上次未完成练习”入口；Part B 保存 option_order 时避免空列表；word_bank 从 user_answer 恢复已用标记；浮层加防穿透。

## 2026-08-13 多端局域网同步 v2 方案（Windows 主机 + 多安卓客户端）

> 仅用于安卓与电脑端内测开发版，不进入 GitHub 版。局域网为唯一同步渠道，
> 电脑端为主机，多台安卓设备作为客户端连接。

### 目标与范围

- 无论在哪端做题，单词本、错题本、做题记录这三类影响学习进度的数据都同步到各端。
- 导入历史不纳入同步。
- 删除互相传播；冲突按 `updated_at` 新者赢。
- 题库配置（profile）隔离：设备只收发“本地已拥有 profile”覆盖的数据。

### 核心设计

- 稳定键（stable key）：profile 用 `name`，试卷/篇目/题目用 `external_key`，
  词条用 `normalized_term`，练习/复习/错题记录用新增 `sync_id`（UUID）。
- 两端新增 `sync_tombstones`（表名 + 对象稳定键 + profile + 删除时间），传播删除。
- 主机端新增 `sync_device_state`（device_id 主键，last_pull_seq、profile_names、last_seen_at）。
- 主机端新增 `sync_change_log`（全局自增 seq 主键，table_name + object_key + op），
  用于增量下发与独立游标，避免多设备时钟偏移影响游标。
- 握手协议：安卓上报 device_id + 本地 profile name 列表；主机按该列表过滤下发，
  安卓也只上传自己 profile 覆盖的数据。
- 增量流程：pull（带 last_pull_seq）→ 主机下发新/改/删三类 + 新游标；push 本地增量。

### 数据隔离矩阵

- 词条 vocabulary_entries：全局共享。
- 遇句/复习 vocabulary_occurrences/reviews：按 profile（经 unit→paper→profile）。
- 错题本 wrong_*：按 profile（经 question→unit→paper→profile）。
- 做题记录 practice_*：按 profile（经 unit_ids→paper→profile）。

### 自动同步（用户已确认）

- 拉取：前台每 60s 增量拉取；回前台、网络恢复时立即补拉。
- 推送：加词/删词/做完题后立即推送（3 秒防抖），并每 60s 兜底一次。
- 可达性：同步前 3s 短探测，离线静默跳过不报错；用 `@capacitor/network` 监听重连。
- 生命周期：前台可靠；后台尽力，回前台补一次（接受 Doze 限制，不开常驻通知）。
- 可见状态：首页/更新页显示“上次同步时间 + 在线状态”，长时间离线才提示一句。

### 实施顺序

1. 两端建基础表：sync_tombstones、sync_device_state（主机）、sync_change_log（主机）。
2. 握手协议升级：上报 device_id + profile 列表，实现按配置过滤。
3. 增量 pull/push（游标 + 新/改/删三类），替换 v1 全量快照。
4. 逐表接入：错题本 → 单词本 → 做题记录，含删除墓碑与冲突回环处理。
5. 自动同步调度：3s 防抖推送 + 60s 兜底拉取 + 前台/后台生命周期 + 网络监听。
6. 两端可见状态 UI。
7. 两端构建验收 + 真机联调。

## 2026-08-13 多端同步 v2 落地（已实现）

- 最终采用「全量快照 + 删除墓碑 + profile 隔离 + 自动调度 + 状态 UI」，未引入增量游标/触发器。
  原因：实测 Windows 端同步表合计约 1400 行（个人学习数据量极小），全量快照秒级完成，
  增量游标/触发器的复杂度与故障风险远大于收益；后续若数据量增长再补增量。
- 已实现：
  1. 两端 `sync_tombstones` 表；主机 `sync.py` 重写（profile 解析、sync_id/updated_at 回填、
     LWW 合并、墓碑应用与级联删除传播）。
  2. 握手上报 `device_id + profile_names`，pull 按 profile 过滤，push 客户端只上传本地已有 profile 的数据。
  3. 删除传播：删除单词（vocabulary.ts）、删除 API 配置（ai.ts）、错题归档（practice.ts）时写入墓碑。
  4. 自动同步 `sync-scheduler.ts`：3s 防抖推送 + 60s 拉取 + 前后台/网络监听 + 离线静默跳过。
  5. 状态 UI：安卓「在线/离线 + 上次同步时间」；Windows 同步面板显示上次同步时间。
  6. 修复 v1 遗留 bug：Android `unit_ids` / `wrong_stats` 序列化（原发原始 id 或错误字段名，
     导致安卓→电脑无法正确同步）。
- 注意：`vocabulary_reviews` 无 unit/question 字段，无法按 profile 归属，按全局处理（与词汇条一致）。
- 待办：真机联调（两台安卓 + 电脑，验证删除传播与 profile 隔离）。
- 2026-08-13 已构建 `0.1.0-alpha.30`（versionCode 30）并推送到局域网内测通道（`work/internal-channel`，
  `start-internal-update-server.ps1` 端口 8877，`app-update.json` 指向新 APK）。

## 2026-08-16 试卷续做 (paper resume)
- mode=paper: 点同卷时若有 active 会话则自动续做 (resumed:true)；force_new 时把旧 active 会话标为 abandoned。
- list_papers/listPapers 增加 active_session_id/active_done；LibraryView 增加 继续练习/重新开始 按钮与进行中角标。
- 安卓 alpha.31 已推送局域网；Windows 后端已重启。

## 2026-08-20 四六级 2020-2026 题库导入摸底

- 本轮仅做只读调查，未修改 Windows/Android 数据库、代码或题库素材。目标先补齐电脑端 Windows 本地题库，完成后再按 ESQ 独立同步 Android，避免混用两端数据库。
- Windows 当前数据库：`E:\EnglishPracticeMachine\Codex\2026-08-02\ba\backend\data\question_bank.db`。四级 profile 实际共 27 套/1385 题，其中 2 套、110 题标题为 2025 年 12 月六级，疑似误放；排除后四级为 25 套/1275 题。六级 profile 仅 2 套/110 题（2022 年 6 月、2024 年 6 月各 1 套）。
- `E:\英语题库` 中两个四六级来源目录合计 561 PDF、179 MP3、153 DOCX、6 TXT、4 DOC、2 M4A，约 9.9 GB；重复较多。2020-2025 优先使用“新的四六级题库”，旧目录用于缺件/答案/音频交叉核对；2026 新目录没有 DOC/DOCX 题干，需用旧目录 DOCX 或文本型 PDF 补充。
- 计划：先 dry-run 建立“级别-年月-套次-题干-答案-音频”矩阵，再各取一套四级/六级测试已保存模型；随后分 2020-2022、2023-2024、2025-2026 批次导入。发布前备份数据库，缺失卷新增，已有完整卷保留，不完整/错误卷经确认后重建。
- 待确认：是否覆盖全部可找到场次；是否仅先改 Windows 本地库；是否允许备份后重建异常卷；是否纠正四级 profile 中两套六级卷；无独立听力时是否允许明确标注共用音频。

## 2026-08-20 用户确认的导入边界

- 四级、六级均覆盖 `E:\英语题库` 中实际存在的全部 2020-2026 场次与套次。
- 本轮先只修改 Windows 本地题库；Windows 验收通过后再导出 ESQ，同步 Android。
- 正式处理前先备份数据库；已有完整卷保留，不完整或明显错误的卷允许重建。
- 允许纠正四级 profile 中误放的两套 2025 年 12 月六级卷，但必须先检查练习记录、错题记录和其他引用。
- 第三套没有听力题时直接跳过听力；有听力时必须按卷面/目录说明判断与第一套或第二套共用，不能只按文件名猜测。
- 当前仍未正式写入题库。批量发现工具已修复级别隔离、中文套次、听力原文排除和 M4A/WAV/OGG 音频识别；专项测试 10 项通过。
- 2024 年 6 月四级、六级目录均明确第三套听力与第二套一致，第三套保留自身题目/选项并绑定第二套听力。
- 后续按 2020-2022、2023-2024、2025-2026 三批执行，每批先草稿核验再发布；合并三套文档必须先拆分，第三套无客观题时不创建空卷。

## 2026-08-21 华为 MatePad 11 横竖屏布局异常修复与发布

- 正确设置页截图显示：横屏时完整平板侧栏与手机四项导航同时出现，且仍停留在手机专用 `/mobile-settings`；设置卡片套用横屏栅格，而手机图标尺寸约束因 `max-width: 840px` 未命中而失效，造成图标放大、内容裁切和横向越界。
- 与答题页左侧窄条、右侧大空白、旧提交栏残留属于同一根因：项目混用 JS `data-orientation/data-window-mode`、`matchMedia(orientation)` 和大量 `@media (orientation: portrait) and (max-width: 840px)`，鸿蒙 WebView 的 CSS viewport/旋转事件使同一屏同时进入手机与平板布局。16:10 比例可能触发，但不是比例本身有问题。
- 叠加问题：旋转后没有把 `/mobile-settings` 归一化回 `/settings`；`App.vue` 仅监听 resize/orientationchange，未对鸿蒙 WebView 的延迟 viewport、visualViewport 与恢复事件二次同步。
- 已完成全局修复：方向检测优先读取 `screen.orientation`，再读取 `visualViewport`，旋转后 120ms/320ms 二次同步；前后台切换重新同步；横屏自动把 `/mobile-settings` 归一化到 `/settings`。
- CSS 以 `html[data-platform=android][data-orientation]` 为最终权威状态，使侧栏/底栏、横屏/竖屏答题工具栏严格互斥；设置图标固定为 42px；竖屏答题强制单列、隐藏旧底栏并补齐溢出保护。
- 公开版默认更新清单改为 GitHub `android-update.json`，移除公开构建中的局域网默认地址；局域网同步源码保持未纳入公开提交。
- 前端生产构建和正式签名 Gradle 构建通过；发布提交 `3c15e28`，Release `v0.1.0-beta.2`，APK SHA-256 `2ada1a5e4ce6a96923dd94b272ebc2ccf84fdf90e00916ecc9ed545f644b692f`。

### 公开发布收尾（beta.3）

- 从公开构建移除内测局域网同步引用，提交 `a3afacd`；未跟踪的 `lan-sync.ts`、`sync-scheduler.ts` 仅留本地内测使用。
- 恢复 GitHub 源码内置的英语一、英语二 ESQ；二进制与旧公开提交逐字节一致。公开构建脚本不再依赖私有 `work/internal-channel`，也不会在构建后删除受控题库。
- 因 `beta.2/versionCode 101` 已发布，正式修复提升为 `0.1.0-beta.3/versionCode 102`，确保旧版能检测更新。
- 正式签名构建和前端生产构建通过；APK 45,924,118 bytes，SHA-256 `b60ca82838256a879cc7dffa4d6518ccc4dfab2adae828a5a676ccd07b1bbdec`；GitHub `main=fbba2b4`，Release `v0.1.0-beta.3` 已发布并回读摘要一致。

## 2026-08-22 局域网同步 practice_answers.question_id 非空约束报错诊断

- 本轮只读诊断，未修改两端代码、题库或学习数据。Android 拉取答案时，`lan-sync.ts` 将电脑端的
  `question_id_key` 解析为平板本地 `questions.id`；找不到稳定键时返回 `null`，但
  `upsertRemoteRow()` 仍执行 `INSERT practice_answers`，触发
  `NOT NULL constraint failed: practice_answers.question_id`。
- Windows 主库只读统计：`practice_answers` 共 1111 条，无本地孤儿题目/会话；但题目
  `external_key` 大量为空。考研英语一相关 591 条答案均有题目稳定键；考研英语二 90 条、
  四级 425 条、六级 5 条答案所引用题目的稳定键全部为空。因此这些记录无法跨设备映射。
- profile 过滤目前只比较题库配置名称，不能保证目标设备拥有同一套试卷及同一题目版本；
  这与“缺少对应题库不下发”的既定规则仍有差距。
- 推荐修复：先确定性补齐 Windows 题目稳定键并与 ESQ/Android 使用同一生成规则；同步下发按
  profile + paper/unit/question 复合稳定身份过滤；Android/Windows 写入前校验全部非空外键，
  缺失映射时跳过整条答案并记录 `missing_question_mapping`，不得写入 NULL；为同步表建立依赖顺序
  和原子事务回归测试。Android 当前 apply 使用显式事务，报错批次会回滚，不应形成半批答案。
