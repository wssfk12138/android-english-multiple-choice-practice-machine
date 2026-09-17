# 公测 beta.6-test.16（versionCode 120）平板自测记录（2026-09-17）

> 本文记录同一批加载路径修复同步到公测树并出包后，在平板（HEY2_W09，物理屏 1600x2560 @340dpi，ROTATION_90 横屏）上的自测过程与证据。
> 结论只覆盖「公测包内运行的确实是修复后的读取路径」与「各加载面在夹具数据下可用、载荷与内测一致」；帧统计的绝对值不能与 119 基线直接相减，原因见第 4 节。
> 全部原始产物在 `.codex-local/self-test-0917/`（该目录整体 git 忽略，禁止提交）。相关交接见[加载路径治本优化与平板交付交接说明](2026-09-17-load-surfaces-handoff.md)。

## 1. 被测对象与设备

| 项 | 值 |
| --- | --- |
| 包名 | `com.wssfk.englishpracticemachine.publictest` |
| 版本 | versionName 0.1.0-beta.6-test.16 / versionCode 120 |
| APK | 公测树 `frontend/android/app/build/outputs/apk/publicTest/app-publicTest.apk`，74,617,067B，SHA-256 `23EDE31D8B9E18F28F2BFA299B9E45FA5C02349C3A4EC663B4282AD3AB120696` |
| 设备 | `adb-AWMDUN4201G02529-FIfHZL (2)._adb-tls-connect._tcp`（HEY2_W09 / Android 14 / 192.168.3.25） |
| 数据 | 216 词夹具（`.codex-local/vocabulary-latency-20260916/fixture.db`：216 词 / 224 出现 / 948 复习 / 51 卷 / 2290 题） |
| 干扰包 | 诊断包 `com.wssfk.epm.latency0916fixed` 已 `am force-stop`（原 pid 7890 占前台会打断截图） |

## 2. 采集方式

三个只读脚本，都限制只允许公测包与两个隔离诊断包（`com.wssfk.epm.latency0916` / `com.wssfk.epm.latency0916fixed`）：

- `.codex-local/self-test-0917/measure-publictest.mjs`：桥接计量，逐场景 4 次取中位数，产出 `screens-publictest-after.json`。
- `.codex-local/self-test-0917/gfx-publictest-120.mjs`：冷启动 / 单词本首开 / 复习首开三个 `dumpsys gfxinfo` 窗口 + 6 张截图。
- `.codex-local/self-test-0917/gfx-publictest-120-model-config.mjs`：补测模型配置首开窗口与截图（前一个脚本的「下一张」按钮文案匹配会随机失败，导致整轮中断，故单独拆出）。

三个脚本都经 WebView 调试端口（`adb forward tcp:9229` → `localabstract:webview_devtools_remote_<pid>`）包装 `Capacitor.nativePromise`，逐次记录跨桥调用的耗时与载荷字节，结束时恢复原函数。

## 3. 结果

### 3.1 桥接计量（4 次中位数，216 词夹具）

| 场景 | visible/paint (ms) | 桥调用 | 同批 SQL (ms) | 载荷 (B) |
| --- | --- | --- | --- | --- |
| dashboard | 273 / 301 | 6 | 400 | 7,964 |
| vocabulary-due-queue | 362 / 382 | 2 | 295 | 50,451 |
| vocabulary-list | 428 / 500 | 2 | 273 | 25,705 |
| wrong-book | 214 / 221 | 3 | 94 | 4,503 |
| model-config | 134 / 154 | 2 | 57 | 6,197 |

内测同夹具对照（`.codex-local/vocabulary-latency-20260916/screens-after7.json`，同为 4 次中位数）：dashboard 219 / 234 / 6 calls / 7,941B；due-queue 204 / 222 / 3 / 51,452B；vocabulary-list 161 / 198 / 2 / 8,331B（该次命中滚动增量页，见第 4 节）；wrong-book 197 / 199 / 3 / 4,503B；model-config 116 / 142 / 2 / 6,197B。

两树的**载荷与桥调用次数一致**（模型配置 6,197B/2 与错题本 4,503B/3 逐字节相同；dashboard 7,964 对 7,941B 差 0.3%、due-queue 50,451 对 51,452B 差 1.98%，为同源夹具下的分页与抖动）。visible 绝对差（如 due-queue 362 对 204ms）与设备当时负载相关，不能归因于代码差异。

### 3.2 单次首开（无预热，只作功能与量级参考，不与 3.1 中位数混用）

| 场景 | visibleMs | sqlMs | 载荷 (B) | 桥调用 |
| --- | --- | --- | --- | --- |
| 单词本列表首开（首页 → 单词本） | 1,110 | 3,179 | 43,067 | 46 |
| 复习卡片首开（点「每日一背」） | 536 | 505 | 50,451 | 2 |
| 展开释义与原句 | 9 | 57 | 200 | 4 |
| 模型配置首开（错题本 → 设置） | 1,393 | 156 | 6,425 | 6 |

单词本列表首开这次 46 次调用 / 3,179ms 含 WebView 冷启动与应用启动期的其它查询（脚本此时刚连上调试端口，包装器会把启动期调用一并计入），不是列表自身的稳态成本；稳态值见 3.1 的 2 次调用 / 273ms。

### 3.3 gfxinfo 帧窗口

| 窗口 | 帧数 | janky | 50th | 90th / 95th / 99th | missed vsync | high input latency | slow UI | slow draw | deadline missed | 50th gpu |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 冷启动（120） | 6 | 5 (83.3%) | 133ms | 250 / 250 / 250 | 3 | 2 | 3 | 3 | 5 | 2ms |
| 单词本列表首开（120） | 9 | 4 (44.4%) | 36ms | 101 / 101 / 101 | 1 | 10 | 2 | 4 | 4 | 10ms |
| 复习首开（120） | 2 | 2 (100%) | 85ms | 85 / 85 / 85 | 1 | 0 | 0 | 2 | 2 | 18ms |
| 模型配置首开（120） | 12 | 6 (50.0%) | 17ms | 34 / 53 / 53 | 1 | 7 | 2 | 3 | 6 | 5ms |
| 119 基线（旧包） | 7 | 5 (71.4%) | 46ms | 150 / 150 / 150 | 3 | 7 | 4 | 5 | 5 | 21ms |

### 3.4 截图（均在 `.codex-local/self-test-0917/`）

`publictest-120-01-home.png`（首页，夹具已注入）、`-02-vocabulary.png`、`-03-review.png`、`-05-vocab-list.png`（216 词列表）、`-06-review-card.png`（每日一背 01 / 155，词条 accountable）、`-07-review-revealed.png`、`-08-review-next.png`（翻页）、`-09-wrong-book.png`、`-10-model-config.png`（3 个 API 配置卡片：基元律动 / true-sota / 新 API 配置）。序号缺 `-04`，无对应产物。

截图与 3.2 的数据分两次运行产生（05/06/07 与三个 gfx 窗口为 15:08 那一轮；08/09 为 15:07 那一轮；10 与模型配置窗口为 15:10 补测），同一装机同一夹具，画面状态一致。

## 4. 对照口径与不能下的结论

- **119 基线不是合格的 before**：`gfx-publictest-119-before.png` 显示的是「今天没有待复习的单词」的**空复习态**，采集时间 13:35，早于夹具注入（14:07 的 `publictest-120-seeded-home.png`）。那张基线反映的是「待复习队列为 0 时点开复习」的一次交互，与 120 的冷启动、列表首开、有数据复习首开都不是同一事件，两个窗口的 50th / 90th **不能直接相减**。
- **帧窗口普遍太短**（2 / 6 / 9 / 12 帧）且每事件只采 1 次，抖动主导。单词本列表 44.4% janky 不能解释为「公测比内测差」，因为内测同口径没有同长度、同事件的对照窗口。
- 有效的前后对照仍然是内测树的 `screens-before3.json`（10:07）→ `screens-after7.json`（13:15）：到期队列是**行集合相同**的对照，载荷 261,886 → 51,452B、可见 859 → 204ms；首页桥调用 17 → 6、同批 SQL 641 → 195ms；模型配置 13 → 2 次调用。
- `vocabulary-list` 载荷 25,705B（公测）对 8,331B（内测 3.1 引用值）的差异来自**分页位置**：前者命中第 1 页（101 行），后者是滚动增量页（32 行）。用夹具直接验证：page1 101 行 full 116,334B / summary 25,616B，page2 32 行 full 34,079B / summary 8,020B，summary 投影在两棵树都生效。

因此本轮公测自测的可靠结论是：**公测包内运行的确实是修复后的代码路径（同一批桥调用次数与载荷），各加载面在 216 词夹具下可正常打开、可交互、无白屏或数据缺失**。帧率层面既没有测得可归因于本次修复的独立证据，也没有测得回归。

## 5. 未覆盖

- 内测 alpha.92 与公测 120 本次都只在平板横屏（ROTATION_90）测过，未复测竖屏与手机。
- 复习流只测到「展开释义 → 下一张」，未在公测包测评分按钮与巩固流程。
- 平板公测库当前是该 216 词夹具数据，**不是用户真实公测库**；旧库已备份为 `.codex-local/self-test-0917/publictest-119-db.sqlite`（7,720,960B，无学习进度，题库可由内置 ESQ 重建）。是否恢复旧库或重装干净包待用户决定。
