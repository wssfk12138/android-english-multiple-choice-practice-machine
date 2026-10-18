# 单词本离线发音、每日一学与复习实施回执

> 2026-10-17 开发，2026-10-18 真机修复与验收。范围：Android 本地开发树的单词本离线发音、每日一学筛选、首页两列等高、评分衍生未学习范围、形近词组提示与可选辨析。权威方案见[统筹开发方案](2026-10-vocabulary-offline-audio-study-review-plan.md)。本回执只记录实际执行和证据，不把未安装、未真机听审的项目写成通过。

## 1. 基线与授权边界

- 工作树：`E:/EnglishPracticeMachine/Codex/english-multiple-choice-practice-machine-android`；分支 `main`；开发前 HEAD `7b29bc39472c5e6e69775a01e896271a6695b28e`。
- 开发前已有 22 个已跟踪文件处于未提交修改状态，已用 `.codex-local/review-baseline/` 保存 `preflight.json`、`tracked-working-tree.patch`、`git-status-short.txt`；未重置、未整仓覆盖。
- 已获授权：按方案进行正常编辑、自动化检查、前端构建、本地 Android 构建；2026-10-18 用户明确要求通过无线调试安装内测/公测包、做真机验证并做必要的本地提交（仅本地，不推送）。未获授权：写入真实学习记录、推送、发布、跨仓同步。

## 2. 实施内容

- 内置语音：Sherpa-ONNX 1.13.8 AAR 放入 `android/app/libs`；美音 LJSpeech medium INT8 与英音 Cori medium INT8 放入 `android/app/src/main/assets/tts/en_US|en_GB`；[prepare-tts-assets.ps1](../../frontend/scripts/prepare-tts-assets.ps1)按上游 SHA-256 下载和复制。AAR、模型和 `.tts-cache` 已被 `.gitignore` 忽略，不进入提交。
- 原生桥：[TtsPlugin.java](../../frontend/android/app/src/main/java/com/wssfk/englishpracticemachine/TtsPlugin.java) 提供 `speak`、`stop`、`getStatus` 和 `speechState` 事件；单线程合成、美英两个引擎各缓存一份、AudioTrack 静态播放、音频焦点、前后台/销毁清理。`MainActivity` 已注册。
- 2026-10-18 真机修复：Sherpa 不能直接读取 APK assets 里的 `espeak-ng-data`，首次使用某口音时复制到应用私有目录，再把绝对路径传给 `dataDir`（复制约 0.85–0.88 秒）。AudioTrack 静态模式创建后的状态是 `STATE_NO_STATIC_DATA`，现在同时接受该状态，避免把正常轨道判为失败。两个引擎缓存后，口音切换从约 5 秒降到约 0.24 秒。
- 2026-10-18 排版修复：详情页把词性/原形从发音行拆到独立元信息行，原形比较忽略大小写（`As a result` 不再重复显示）；“常用释义”标签与词性左右分栏，词性和音标统一 13px，并移除标题区与释义区的重复词性/音标。每日一学的词性仍随发音行自动换行，释义区不重复。
- 前端发音：[pronunciation.ts](../../frontend/src/services/pronunciation.ts)、[PronunciationButtons.vue](../../frontend/src/components/PronunciationButtons.vue)。首页只在实际选中的单词详情显示美音/英音，按钮文本使用实际展示的 `term`，不使用 `lemma` 替换（例如 `further` 不会朗读成 `far`）。
- 每日一学：入口固定 `status=new`；页内保留七项筛选；返回首页把 `new` 映射为 `all`，其他筛选带回首页；首页不新增可见“新词”项。
- 未学习范围：`vocabulary_reviews` 中最新一条 `mode='scheduled'` 评分不是 `fluent` 时保留；无记录、`again`、`know`、旧 `hard` 保留；`fluent` 移出；`reinforcement` 不参与判定；异常日期保守保留。按 `created_at DESC`、身份降序和 `id` 稳定排序。新增覆盖索引 `idx_vocab_reviews_latest`。
- 首页横屏：只对既有双列布局（Android 横屏宽度 ≥1200px）设置同一行高、左右各自滚动；600–1199px 继续沿用上下堆叠。
- 评分语义：“不认识”改为提交 `again`；“认识”仍为 `know`；“熟练”仍为 `fluent`。
- 形近词组：新增 [vocabulary-review-groups.ts](../../frontend/src/vocabulary-review-groups.ts)，在原复习队列快照内向前看最多 8 项，只配同优先级段的两词；不新增、不删除、不重排到期词。评分后保留组身份，组内两词都完成后显示非阻塞“查看辨析”，展示拼写差异、已知释义和美英发音。

## 3. 数据与自动化证据

- `pnpm run build`：通过（`vue-tsc --noEmit` + Vite 构建）。
- `daily-study-catalog.mjs`：通过；覆盖无记录、`again`、`know`、旧 `hard`、`fluent`、熟练后再次认识、仅巩固、异常日期、最新时间顺序、重复读取稳定顺序、索引存在和只读性。
- `daily-study-session.mjs`：通过；覆盖持久化、删除、身份复用、冻结顺序、版本刷新、缓存上限、释放和手势；新增“旧筛选的慢目录响应不能覆盖新筛选”用例。
- `daily-study-browser.mjs`：通过；覆盖固定 `new` 入口、七项筛选切换、`new→all` 返回映射、空态“查看全部单词”、长流程导航、滚动恢复、旋转、只读和错误恢复。
- `vocabulary-review-groups.mjs`：通过；覆盖短词/长词、相邻换位、不同优先级/不同到期日不配对、窗口上限、稳定组 id 和拼写差异。
- `vocabulary-layout.mjs`：通过（168 个场景 + 专项页）；覆盖横屏双列上下边界一致、左右独立滚动、`further` 使用 `term` 而非 `lemma`、形近标签、两词分别评分、辨析面板和关闭。
- `vocabulary-review-refresh.mjs`、`vocabulary-review-revision.mjs`、`vocabulary-snapshots.mjs`、`vocabulary-due-queue.mjs`：通过。
- `node tests/run-all.mjs --strict`（最终源码）：98 通过、1 失败、0 PREREQ、共 99 项，耗时约 240 秒。唯一失败为 `android-review-layout.mjs` 仍在检查旧模板表达式 `{{ job.display_name || job.filename }}`；当前导入页已改为 `{{ entry.job.display_name || entry.job.filename }}`，属于先前导入页改动的既有断言滞后，与本轮单词本改动无关。未修改该无关测试或产品代码。

## 4. Android 构建证据

- 命令：`corepack.cmd pnpm run build` → `corepack.cmd pnpm exec cap sync android` → `.\gradlew.bat assembleInternal --console=plain`。
- 产物：`frontend/android/app/build/outputs/apk/internal/app-internal.apk`；内部通道副本 `outputs/internal-channel/english-practice-machine-android-0.1.0-alpha.130-internal.apk`。两者的字节和哈希一致。
- 大小：159,794,622 字节（152.39 MiB）；SHA-256：`1F94AA1E832062D3396B4DAF2E2819593DC3D108C4DCBA3AC909D2472E2AE55A`。
- 包信息：`com.wssfk.englishpracticemachine`，`versionCode=145`，`versionName=0.1.0-alpha.130`，标签“内测·英语刷题机”；2026-10-18 已通过无线调试在 HEY2-W09（Android 14，arm64）覆盖安装，原 alpha.128 / 143 的应用数据保留。
- 签名：固定发布证书，证书 SHA-256 `b50d155ca946277d598a878d4b02c0994d13bb7038770af52b641731b86de0a7`。
- 覆盖更新身份：alpha.128 / 143 与 alpha.130 / 145 的包名相同、证书 SHA-256 相同，145 高于现有 143；实际覆盖安装已在该平板完成，数据未清除。
- ABI：APK 内仅 `arm64-v8a`、`armeabi-v7a`；`x86`、`x86_64` 未打包。Sherpa AAR 本身含四种 ABI，但 Gradle `abiFilters` 只保留两种 ARM。
- 语音资产：718 个文件，解压后 74,695,709 字节，APK 内压缩后 56,639,909 字节；两个 `model.onnx` 各约 19.35 MB，且以未压缩方式存储，`espeak-ng-data` 各 17.99 MB。
- 包内最终 Web 资源为 `assets/public/assets/index-Dpm9esLW.js`，已包含“形近词组”和 `OfflineSpeech`；包内 `lib/x86`、`lib/x86_64` 数量为 0。
- 模型哈希：美音 `24dc3bd77dd48c291e52c297878d3437c9492f245d823d7f6a06c4bbb67f4b6b`；英音 `169ca8aff3adb271f009a4924c99928a811dbf2b52eaca2dbb460e8c34478c93`；AAR `633c24321e06b1fe79feafa03ea16cbc0f8a286641e2da3559bac91bdb13bd96`。

## 5. 完成层级与未验证项

- 代码完成：是。
- 前端自动化通过：是，除上述与本轮无关的导入页旧断言。
- Android 构建通过：是；AAR、模型和两套 ARM 原生库已进入 APK，包内清单已核对。
- 安装验证：已执行。2026-10-18 通过无线调试在 HEY2-W09（Android 14，arm64-v8a）把 alpha.130 / 145 覆盖安装到 alpha.128 / 143 上，应用数据保留；公测 beta.21 / 139 同版本覆盖安装成功，两个包名可共存。
- 用户验收：部分执行。已听审美音/英音在已有词 `further` 上的实际播放，确认标题区显示实际词形；断网、锁屏、旋转、音频焦点被抢占和长列表尚未在设备上逐项验证。
- 性能：美音首次加载约 5.0 秒、英音首次约 5.0–5.9 秒；两个引擎缓存后再次切换美音，生成耗时约 237 毫秒；`espeak-ng-data` 首次复制约 0.85–0.88 秒。双引擎常驻内存尚未测量。
- 已知代价：APK 因双模型、双 ABI 和两份相同 `espeak-ng-data` 增至约 152 MiB；双引擎常驻会额外占用内存。若后续确认只支持 64 位设备，可按 ABI 拆分或只保留 `arm64-v8a`；在未做真机验证前不擅自改变兼容范围。

## 6. 真机验证顺序与完成情况

1. 已完成：用固定签名、递增 `versionCode` 的 alpha.130 / 145 在现有内测平板上覆盖安装，数据和登录状态保留、包名和证书一致。
2. 断网冷启动，分别用美音/英音朗读未缓存词、短语、撇号词、连字符词和罕见词；记录首次加载和起音时间。
3. 部分完成：美音→英音→美音连续切换已确认不崩溃、缓存后切换约 237 毫秒；停止和退后台未崩溃，锁屏/旋转和音频焦点抢占仍待验证。
4. 在每日一学验证固定 `new` 入口、七项筛选、返回首页 `all`，以及无未学习词时空态和“查看全部单词”。
5. 在每日一背验证“不认识”写入 `again`、最新正式评分驱动新词范围、形近组标签和两词完成后的辨析面板。
6. 用长列表和长详情验证横屏双列上下边界、左右独立滚动、分页哨兵和底部操作可达；窄横屏保持上下堆叠。
