# S0–S4 质量收口与 S5 联合交付执行方案

> 2026-10-08。供低性能模型按小步骤执行。本文只处理 2026-10 综合方案 S0–S4 的质量缺口，并在满足门槛后进入 S5。产品语义以[综合方案](2026-10-integrated-development-plan.md)为准，历史实现状态以[阶段回执](2026-10-integrated-progress.md)为线索；执行时必须重新核对当前源码和测试，不能把本文记录的 HEAD、测试数量、设备或产物当作未来现场事实。

## 当前执行位置（2026-10-08 记录核对）

C0–C5 已完成，不再将下文开工时的三个门禁失败、截断分类或安全停止提示列为待修项。S5 D0–D2 已完成；后续每日一学原生数据库身份修复已覆盖安装平板公测 beta.16 / 134、内测 alpha.120 / 135，两版真实读取成功，最新 strict 执行回执为 96/96。D3 仅有首页与每日一学读取等部分现场证据，完整联合路径尚未完成；D4 新桥真实供应商兼容性与费用仍未验证。当前源码、未提交修复、验证层级与剩余项统一以[阶段回执](2026-10-integrated-progress.md)为准。下文保留执行方法及原始门槛，不把历史开工状态当作当前失败。

## 1. 最终目标与完成定义

本轮有两个连续目标，必须分层报告：

1. **代码与自动化收口**：修复 3 个已确认质量缺口，修复当前 3 个全量门禁失败，使当前源码的相关定向测试、全量 strict 和前端构建通过。
2. **S5 联合交付**：在取得对应授权后，从同一最终源码构建目标 APK，核对应用 ID、版本、签名和 SHA-256，安装到获批设备，并完成 S1–S4 的真实组合路径验收。

只有代码、自动化、目标产物、安装实例和真实操作路径属于同一源码状态，且适用关键路径通过，才能写“联合交付完成”。否则必须分别写“代码完成”“自动化通过”“构建通过”“安装验证”“用户验收”及未验证项。

不属于本轮目标：

- 不新增翻译任务管理页、未知批次控件、范围确认区或费用面板。
- 不重写词汇调度架构，不顺手重构练习页、单词本或更新页。
- 不修改默认模型、推理强度、批量上限或全局网络等待。
- 不把 Android 改动整仓同步到 Windows 或公测树。
- 不自动安装、调用付费供应商、推送、发布、更新通道或跨仓同步。
- 不删除原有未跟踪资产，不用硬重置清理工作树。

## 2. 低性能模型的上下文装载规则

### 2.1 每次只读最小上下文

开始任一步时只读取：

1. 根目录 `AGENTS.md`（若环境已注入且仍有效，不重复读取）。
2. 本文的“当前步骤”小节。
3. 当前步骤列出的源码和测试文件。
4. 当前失败的首个完整错误输出。
5. 一个直接相关的现有通过测试或同类实现。

不要默认全文读取所有历史对话、NOW、综合方案、RUNBOOK、全部测试或整个源码树。只有本文与现场冲突、证据不足或进入 S5 时，才按本文指定入口扩读。

### 2.2 每步执行格式

每次只执行一个编号步骤，并在开始时登记：

```text
步骤：C… / D…
工作树与 cwd：绝对路径
分支 / HEAD：现场值
已跟踪改动：现场值
原有未跟踪文件：只计数，不删除
本步允许修改：文件白名单
成功标准：本步列出的测试和行为
禁止动作：安装 / 付费 / 提交 / 推送等是否获批
```

步骤完成后只记录：实际改动、命令与退出码、行为证据、未验证项和下一步。不要用“应该”“看起来”“文件已生成”代替结果。

### 2.3 失败纪律

- 先保存首个完整错误，再定位根因；不要先改断言或降低测试要求。
- 同一命令、补丁或引号形态连续失败两次后必须切换方法。
- 测试桩过期时只修测试桩；只有源码行为与产品要求冲突时才改生产代码。
- 一个步骤未通过时，不进入依赖它的下一步，不构建或安装“半修复”版本。
- 发现会改变产品语义、数据库兼容、费用风险或授权范围的歧义时停止并询问用户。

## 3. 当前已知基线（只作开工线索）

2026-10-08 审查现场：

| 项目 | 已知值 | 使用限制 |
| --- | --- | --- |
| 开发权威树 | 以 `MAP.md` 的“Android 开发”项为准 | 不在本方案复制个人设备绝对路径；执行时核对 MAP 与 cwd |
| 分支 / HEAD | `main` / `3faca36eaeddf8868bed11b244f66b4108bd8a8b` | 只是审查时快照 |
| 已跟踪改动 | 0 | 执行时重新核对 |
| 原有未跟踪条目 | 458 | 不属于清理授权，不删除或纳入提交 |
| 全量 strict | 91 PASS / 3 FAIL / 0 PREREQ / 94 TOTAL | 当前三个失败见 C1；未来按实际发现数为准 |
| 现存 Debug APK | SHA-256 `e4e3052b17db6c3be55e083197cc67dfe4cb90b8d8805cf76b0e33d126f440e3` | S2/S3 旧包，不含 S4，不得用于最终安装验收 |
| S4 提交 | `6c2306a`、`d3d2f2d`、`e0bd119`，记录提交 `3faca36` | 可定位 S4；不代表已装机 |
| S0 检查点 | `397b527` | 混合 195 个文件，只能作整体前态；不得直接撤销来选择性回退 S1–S3 |

当前 3 个已确认质量缺口：

1. S4 新增 `useRouter` 和 `BookOpenCheck` 后，`vocabulary-manual-edit.mjs` 测试桩未同步，20 个场景全部失效。
2. 截断/未完整生成的响应被调度器记成 `validation`，诊断文字错误地指向缺字段或词条不匹配。
3. 后端已提供“未知结果停止、需显式重试、可能重复计费”的安全提示，但 `VocabularyMaintenance.vue` 把异常覆盖成通用失败。

当前全量门禁失败：

| 测试 | 当前直接证据 | 初步归类 |
| --- | --- | --- |
| `maintenance-pages.mjs` | 点击检查程序更新后等待已不存在的 `.update-result`，当前页面使用 `.update-summary` / `.version-list` | 测试选择器漂移；尚未证明生产缺陷 |
| `vocabulary-display.mjs` | 当前有 12 个显示项，测试仍断言 11 | 测试数据与断言漂移 |
| `vocabulary-manual-edit.mjs` | 缺少 `useRouter` 与 `BookOpenCheck` 桩，20 项全部失败 | S4 引入的确定测试回归 |

## 4. 代码与自动化收口顺序

以下 C0–C5 严格串行。每一步通过后才能进入下一步。

### C0：重新登记现场和可回退基线

**只读入口：**

- `PROJECT_INDEX.md`
- 本文
- `docs/context/MAP.md` 的工作树边界
- 当前 `git status --short --branch`
- 当前 `git log --oneline -8`

**动作：**

1. 核对实际 cwd、分支、HEAD、已跟踪差异和未跟踪条目数量。
2. 确认没有另一个任务正在修改本轮白名单文件。
3. 为本任务保存编辑前基线或前态副本；已有工具基线可以增量复用，但要核对是否对应当前 HEAD。
4. 记录现存 APK 的路径、时间、大小和 SHA-256，仅用于防止把旧包误当成新产物。

**通过条件：**目标树、已有修改、旧产物来源和本轮白名单可定位。若已有修改与本轮文件重叠，先区分来源；不能安全区分时停止询问。

### C1：先恢复三个失效门禁，不改生产行为

**允许修改：**

- `frontend/tests/vocabulary-manual-edit.mjs`
- `frontend/tests/maintenance-pages.mjs`
- `frontend/tests/vocabulary-display.mjs`

**禁止修改：**生产源码、测试运行器、全局超时、断言严格度和产品配置。

**C1a 人工编辑测试桩：**

1. 在 `vue-router` 桩中保留 `useRoute()`，增加最小 `useRouter()`，其 `push()` 只记录或安全完成，不执行真实导航。
2. 在图标桩中增加 `BookOpenCheck`，不要删除现有图标。
3. 不跳过任何 portrait/landscape、pending/failed/queued/translating/no-model/ready 场景。
4. 完整运行到进程退出，不能把第一条 PASS 当成脚本完成。

**C1b 更新页测试：**

1. 删除对已不存在 `.update-result` 的等待。
2. 改为验证生产页面当前稳定语义：点击后出现更新摘要，显示合成新版本与已安装版本，且长说明/布局检查仍执行。
3. 不靠增加固定等待时间掩盖元素不存在；优先用可见文本或当前稳定结构等待。

**C1c 显示配置测试：**

1. 覆盖当前 12 个 `VOCAB_DISPLAY_OPTIONS`，补合成“语境释义”内容和对应独立开关验证。
2. 优先从生产配置导出推导选项数量/顺序；若测试结构无法直接导入，显式列 12 项并与生产配置做一致性断言。
3. 保留每项独立开关、持久化、展开/收起、换词和旋转断言；不能只把 `11` 改成 `12` 后省略第 12 项行为。

**本步验证：**在 `frontend` 目录分别执行：

```powershell
corepack.cmd pnpm run test:vocabulary-manual-edit
node tests/maintenance-pages.mjs
node tests/vocabulary-display.mjs
```

每条都必须等到退出码 0。随后运行一次：

```powershell
node tests/run-all.mjs --strict
```

**通过条件：**三个原失败脚本及 strict 均通过；没有生产文件变化。若测试修复暴露真实生产行为失败，保留失败并停止 C1，不为保持“只改测试”而伪造通过。

### C2：修正截断响应的故障分类

**先读：**

- `frontend/src/platform/android/errors.ts`
- `frontend/src/platform/android/vocabulary-request-result.ts`
- `frontend/src/platform/android/ai.ts` 的 `chatCompletion()` 元数据与截断分支
- `frontend/src/platform/android/vocabulary-request-runner.ts` 的 catch 分类
- `frontend/tests/vocabulary-request-metadata.mjs`
- `frontend/tests/vocabulary-request-scheduler.mjs` 的 HTTP/解析分类用例

**允许修改：**

- `frontend/src/platform/android/vocabulary-request-result.ts`
- `frontend/src/platform/android/ai.ts`
- `frontend/src/platform/android/vocabulary-request-runner.ts`
- 上述两个相关测试

**固定语义：**

1. 在受控 `VocabularyFailure` 中增加独立的截断/不完整类别，例如 `truncated`；不要复用 `validation`。
2. `ai.ts` 识别 `length`、`incomplete`、`content_filter`、`max_tokens` 时，通过 `LocalApiError.detail` 的安全代码或词汇路径专用错误类型传递该类别；不得保存供应商正文、URL、Key 或原始异常。
3. runner 分类顺序必须先识别真实 HTTP 状态，再识别未知传输、保存失败、受控截断、业务校验和解析失败。
4. 截断仍然停止当前运行、保留元数据、不落库为有效词、不自动降级或重发。
5. 不把所有 `502` 都当截断；结构无效、字段缺失和词条不匹配仍属于验证失败。

**必须新增的行为断言：**

- `status=incomplete` 或 `finish_reason=length` 最终 attempt/category 为截断类别。
- 用户可见的逐词安全原因是“响应被截断或未完整生成”，不是“缺少必需字段”。
- 只发送一次请求，不自动重发。
- HTTP 401/403/429/5xx、非法 JSON、字段校验、保存失败和 unknown 原有分类不退化。

**本步验证：**

```powershell
corepack.cmd pnpm run test:vocabulary-request-metadata
corepack.cmd pnpm run test:vocabulary-request-scheduler
corepack.cmd pnpm run test:vocabulary-request-api
node tests/vocabulary-model-validation.mjs
```

**通过条件：**新增截断用例先能证明旧实现失败，再在新实现上通过；相关原有用例全部通过；没有网络调用或付费请求。

### C3：在原有补缺界面显示安全停止原因

**先读：**

- `frontend/src/components/VocabularyMaintenance.vue`
- `frontend/src/api.ts` 的 Android 错误透传
- `frontend/src/platform/android/vocabulary-request-store.ts` 的 unknown/continue 文案
- `frontend/src/platform/android/vocabulary-enrichment-runner.ts` 的状态返回
- `frontend/tests/maintenance-pages.mjs`

**允许修改：**

- `frontend/src/components/VocabularyMaintenance.vue`
- `frontend/tests/maintenance-pages.mjs`，或一个名称明确、仅覆盖该组件的新测试文件及 `run-all.mjs` 注册

**固定语义：**

1. 不新增任务面板、确认区或未知批次控件。
2. 状态区至少区分：用户暂停、配置变化、预算停止、验证/解析停止、截断停止和未知结果停止；未知结果必须说明“点击原有重试按钮才重发，可能重复产生费用”。
3. `act()` 捕获 Android 本地 API 的 `Error.message`，只显示项目生成的安全消息；未知对象使用通用兜底，不序列化 `detail`、响应正文、URL 或 Key。
4. 普通继续不得解除 unknown；“重试失败词条”仍是显式、有限范围的原入口。
5. 读取状态失败与执行操作失败分开显示；成功刷新后只清除已经恢复的瞬时错误，不隐藏持久停止原因。

**必须覆盖：**

- 普通暂停显示“已暂停”，继续成功后更新状态。
- unknown 下点击继续，界面显示后端安全原因，不启动请求。
- 显式重试仍走原按钮和对应 action；测试只验证调用范围，不连接供应商。
- 文案不包含合成 Key、URL 或供应商正文。

**本步验证：**

```powershell
node tests/maintenance-pages.mjs
corepack.cmd pnpm run test:vocabulary-request-api
corepack.cmd pnpm run test:vocabulary-request-scheduler
node tests/vocabulary-enrichment-jobs.mjs
```

若新增测试文件，确认 `tests/run-all.mjs` 能自动发现，且 package.json 仅在确需单独脚本时增加具名入口。

### C4：相关回归、全量门禁与前端构建

先执行与变更直接相关的定向检查：

```powershell
corepack.cmd pnpm run test:vocabulary-manual-edit
corepack.cmd pnpm run test:vocabulary-request-metadata
corepack.cmd pnpm run test:vocabulary-request-scheduler
corepack.cmd pnpm run test:vocabulary-request-api
node tests/maintenance-pages.mjs
node tests/vocabulary-display.mjs
node tests/vocabulary-enrichment-jobs.mjs
node tests/daily-study-browser.mjs
node tests/daily-study-catalog.mjs
node tests/daily-study-session.mjs
node tests/practice-timer.mjs
node tests/practice-timer-lifecycle.mjs
node tests/practice-timer-browser.mjs
```

然后执行：

```powershell
node tests/run-all.mjs --strict
corepack.cmd pnpm run build
```

最后在仓库根执行只针对本轮文件的空白检查：

```powershell
git diff --check -- frontend/src/platform/android/vocabulary-request-result.ts frontend/src/platform/android/ai.ts frontend/src/platform/android/vocabulary-request-runner.ts frontend/src/components/VocabularyMaintenance.vue frontend/tests/vocabulary-request-metadata.mjs frontend/tests/vocabulary-request-scheduler.mjs frontend/tests/vocabulary-manual-edit.mjs frontend/tests/maintenance-pages.mjs frontend/tests/vocabulary-display.mjs
```

**通过条件：**

- 所有定向命令退出 0。
- strict 为 0 FAIL、0 PREREQ-SKIPPED；测试总数按现场报告，不硬编码为 94。
- `vue-tsc` 和 Vite 构建退出 0；已知分块提示可记录，但不得把警告写成失败或静默忽略新增错误。
- 没有安装、真实供应商调用或用户数据访问。

### C5：只读复盘、阶段记录与可回退保存

**动作：**

1. 复查实际 diff，只允许 C1–C3 的必要文件和状态文档；出现无关文件立即排除并查来源。
2. 核对公开差异不含 Key、URL 凭据、私有题库、数据库、日志、设备地址或个人路径。
3. 生成仅本任务增量的变更报告，列出文件、增删、行为变化、测试和剩余风险。
4. 更新 `docs/context/2026-10-integrated-progress.md` 的当前权威状态：保留历史 89/2 作为历史证据，同时写入当前 strict 的实际结果；不要删除历史来伪装从未失败。
5. 若 S4 验证回执需更正人工编辑测试缺口，只做最小事实更新；详细过程不追加到 PROJECT_INDEX。
6. 本地提交只在能定位当前提交授权时执行；提交应只包含本轮文件。没有授权则报告建议提交，不自动暂存。

**推荐提交边界（有授权时）：**

- 提交 1：三个测试门禁修复。
- 提交 2：截断分类与补缺停止提示及对应测试。
- 提交 3：阶段回执更新；若内容很小，可与提交 2 合并，但不得混入 S5 产物。

本地提交不推送，也不备份设备数据库。

## 5. S5 联合构建、安装与验收

完成 C0–C5 后才能进入本节。D0–D4 中存在四个独立授权门：目标签名构建、覆盖安装、付费供应商验证、推送/发布。一个授权不能推导另一个。

### D0：S5 开工登记与授权核对

按需读取：

- `docs/context/RUNBOOK.md` 的前置、构建、风险验收和发布门禁
- `docs/context/MAP.md` 的 Android 权威树与同步边界
- `docs/context/RISKS.md` 中与安装、签名、数据库、Key 有关的小节
- 当前设备/渠道的最新可定位回执；旧日期记录只能作线索

登记：

```text
源码：工作树、分支、HEAD、已跟踪差异
构建：目标渠道、应用 ID、版本名、递增 versionCode、签名来源
产物：计划输出路径、是否允许覆盖旧产物
设备：获批设备身份、现装包名/版本/签名、ADB 或无线调试状态
数据：数据库与配置备份方式、SecureStore/Key 边界
用户路径：从哪个图标/入口打开，验证哪些行为
授权：构建、安装、付费请求、提交、推送、发布分别是否存在
```

若不能确认目标签名或现装应用身份，不得覆盖安装；若用户数据没有可回退安排，不得进行高风险升级验证。

### D1：从最终源码生成并绑定目标产物

先在 `frontend` 执行：

```powershell
corepack.cmd pnpm run build
corepack.cmd pnpm exec cap sync android
```

再按获批渠道选择一个构建入口：

- 仅验证编译链且不安装：在 `frontend/android` 执行 `.\gradlew.bat --no-daemon --max-workers=1 assembleDebug`。
- 需覆盖现有内测应用：按 RUNBOOK 使用当前内测签名脚本，并现场传入递增 `versionCode`、版本名和获批清单地址。
- 公测/发布：不属于默认收尾；只有明确授权且在对应公测树按逐文件同步流程执行。

构建完成后必须记录：

- 构建前 HEAD 和所有相关未提交源码哈希。
- 实际命令、退出码、JDK/SDK/Gradle 版本和渠道参数。
- APK 绝对路径、大小、生成时间、SHA-256。
- APK 内 applicationId、versionCode、versionName 和签名证书摘要。
- 前端 `dist`、Capacitor assets 与 APK 内前端资源的一致性证据。

任何一项来源不明时停止，不用旧 APK 顶替。

### D2：获批设备安装与加载版本核验

安装前：

1. 核对设备身份、现装包名、版本、签名和用户数据备份/导出路径。
2. 确认新 APK 的签名可覆盖现装包，且 versionCode 递增。
3. 确认不需要清数据、卸载或换包名；这些动作若出现必须重新授权。

安装后：

1. 回读设备上的包名、版本、versionCode、签名和 APK 路径/摘要线索。
2. 从用户真实图标启动，确认不是旧进程或另一渠道包。
3. 验证原数据库、题库、练习进度、设置和 SecureStore 配置是否保留；不读取或输出 Key 明文。

只有安装目标和加载版本与 D1 产物一致，才能写“安装验证完成”。

### D3：S1–S4 真机与组合路径

每组单独记录操作、预期、实际结果、截图/日志证据及是否需要用户视觉判断。

**S1 费用保护：**

- 暂停发生在下一请求发送前时，不产生新请求，未发送成员保持排队。
- 应用重启、重新进页和更改配置不自动释放 unknown 或失败停止。
- 当前词重试只处理当前 ID 和任务类型；补缺重试只处理点击时冻结的失败集合。
- 补缺界面能解释 unknown，普通继续无效，显式重试提示可能重复计费。

优先使用本地合成服务或可控测试配置验证未知、迟到、截断和慢响应；不要为了制造场景发送私有题库或多次付费请求。

**S2 计时：**

- 前台做题一段可记录时间，Home/锁屏/切应用期间不增加，返回后从新起点继续。
- 手动休息后重开仍暂停，必须点击继续。
- 自动暂停听力，返回前台不自动播放；手动继续行为符合原约定。
- 路由取消、分篇提交、整卷成功/失败、退出先结算再收词均符合方案。
- 旧计时记录不把离线时长补入，也不静默清零已有累计。

**S3 请求可靠性：**

- 词汇路径使用专用连接/读取/总期限，非词汇 AI 调用保持原行为。
- 截断显示真实类别并停止，不自动重发。
- 本地传输槽在物理请求结束前不释放；迟到响应最多落库一次。
- 日志和状态不含 Key、完整提示词、完整供应商正文或带凭据 URL。

**S4 每日一学：**

- Android 横屏单词本显示入口，竖屏不误显示可用页。
- 从当前题库/筛选/搜索进入，目录完整，首尾、按钮、键盘、左滑前词/右滑后词一致。
- 长内容、横竖屏旋转、200% 字号、深浅主题、减少动态效果下控制区可达。
- 退出重开恢复当前词和滚动位置；删除、数据库身份变化或 ID 复用不串词。
- 阅读、相邻预取和读取失败重试不新增模型请求，不修改复习次数、掌握状态或复习日期。

**组合路径：**

```text
进入练习并计时
→ 收词并正常离开（先停计时）
→ 后台词汇请求按门控运行或停止
→ Home/锁屏后返回，离开时间不计入
→ 打开单词本和每日一学
→ 已有内容可读、复习数据不变、没有隐式新增付费请求
```

组合路径未通过时，保留现场并回到对应阶段修复；不能在设备上反复覆盖安装不同来源的包来试错。

### D4：可选真实供应商验证

本步骤必须有单独、可定位的付费验证授权。授权应明确：供应商、模型、使用合成词条、最大词数、最大请求数、停止条件和可接受费用风险。

推荐最小范围：

- 不含私有题库内容的 1–2 个合成词条。
- 先验证 Responses `text.format` 是否被接受和返回元数据。
- 最多一次主翻译请求；如需补缺，另行计为一次并先确认。
- 不用多次请求人为制造 180 秒慢响应；慢响应、断连和迟到主要由本地可控服务验证。
- 缺 usage 记未知，不记 0；客户端取消不声称供应商停止计费。

真实供应商未验证时，S3 仍可交付“本地传输与协议代码完成”，但必须保留供应商兼容性缺口。

## 6. 最终记录、提交与交付结论

### 6.1 权威记录

完成实际工作后更新：

- `docs/context/2026-10-integrated-progress.md`：唯一当前阶段状态。
- 新建或更新一份 S5 验证回执：保存源码、APK、安装版本和真实路径证据；避免在多个文件复制同一事实。
- `PROJECT_INDEX.md`：只保留一句当前摘要和上述入口，不追加执行流水。

只有事实发生变化时更新；文档计划本身不能把代码、安装或验收状态改成完成。

### 6.2 分层结论模板

```text
代码完成：是 / 否；对应 HEAD 和文件
自动化通过：命令、通过/失败/跳过数量
构建通过：产物、来源、版本、SHA-256
安装验证：设备、安装包、加载版本是否一致
用户验收：真实入口、操作与观察
真实供应商：已验证 / 未授权 / 未验证；请求范围
发布授权：有 / 无；不得由前述状态推导
未解决：风险、影响、下一动作
```

### 6.3 Git 与发布边界

- 本地提交只包含用户已授权范围和本轮白名单文件；提交前复核 `git diff --cached`。
- 不把 APK、AAB、数据库、签名、`signing.properties`、日志、私有题库或用户数据提交。
- 未经授权不推送、不创建 Release、不更新内测通道、不向公测或 Windows 树同步。
- 回退优先使用本轮小提交的 `git revert` 或前态副本；不使用 `git reset --hard`，不撤销 `397b527` 来选择性回退 S1–S3。

## 7. 必须停止并请求用户决定的情况

出现以下任一情况时停止相关步骤：

- 当前工作树、分支或目标包与本文不同，且会影响产物或用户数据。
- 本轮文件与另一任务的未提交改动重叠，无法区分所有权。
- 修测试后暴露真实人工编辑、更新页或显示配置业务故障。
- 截断分类需要改变数据库 schema、公开 API 或旧数据迁移，而现有受控字段不足。
- 为显示停止原因需要暴露供应商正文、URL、Key 或未脱敏异常。
- strict、构建、Capacitor 同步或 Gradle 构建未通过。
- APK 来源、版本、签名或 SHA-256 不能与当前源码绑定。
- 需要卸载、清数据、降级、换签名、永久删除或覆盖未知用户数据。
- 需要付费请求、安装、推送、发布或跨仓同步，但没有对应授权。

停止时仍可完成不依赖该阻塞的只读检查；不要把阻塞写成“总体已完成”。

## 8. 换窗交接模板

```text
目标：S0–S4 质量收口 / S5 联合交付
当前步骤：C… / D…；状态：未开始 / 实施中 / 通过 / 阻塞
现场：cwd、分支、HEAD、已跟踪差异、未跟踪数量
本步改动：文件与目的；区分既有修改
验证：命令、退出码、通过/失败/跳过数量
产物：路径、版本、SHA-256、源码来源（如适用）
运行：设备/实例加载版本（如适用）
用户路径：已验证与未验证
授权：提交、构建、安装、付费、推送、发布分别列明依据
阻塞：首个根因、影响和所需决定
下一步：只列紧接的一步及需读取的文件
```

新窗口先重新核对现场，不能把交接摘要直接当作当前证据。
