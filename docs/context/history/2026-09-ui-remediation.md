# Android UI 整改（Zcode 实施规格）交付回执

> 2026-09-12 完成；实施规格：C:/Users/MEC/.codex/visualizations/2026/09/12/01a095ac-6a8e-7603-aa34-27e7afbdc51c/EPM-UI整改-Zcode实施规格-20260912.md。仅改 Android 开发权威树；未同步公测，未构建 APK，未触数据库/签名/包名。

## 交付范围（按规格四阶段）

1. **基础设施**：新增 `frontend/src/platform/dialogs.ts`（confirm/prompt 全局主题化弹层）、`frontend/src/platform/overlay-history.ts`（返回键=popstate 关闭弹层且不离开页面）、`frontend/src/components/AppDialogHost.vue`（挂载于 App.vue；Escape/取消/返回只关闭；busy 防重复）、`frontend/src/components/OptionSheet.vue`（主题化选择弹层：标题/关闭/搜索/选中标记/空结果/不可用语义）、`frontend/src/services/vocabularyDisplayConfig.ts`（单词本显示唯一配置定义：键/中文名/默认值）。
2. **设置中枢**：`MobileSettingsView` 按规格分组：外观与显示（深色模式、单词本显示含摘要）、题库与数据（题库管理/导入题库/回收站）、AI 与模型（模型与 API）、设备与维护（设备同步/更新与远程题库/诊断日志，带 `?section=` 定位）、帮助（使用帮助/问题反馈）。全部 Lucide 图标；去掉旋转自动跳模型页（App.vue 两处 replace 删除）；/mobile-settings 横竖屏均可用。
3. **模型与 API**：`SettingsView` 重建：列表只显示名称/地址摘要/默认标记/启用状态/详情入口；详情分连接与密钥、默认模型、高级参数、模型管理（搜索、显示/隐藏、同步状态、本次同步未发现单独表达）；输出 Token 上限移入“兼容信息”；删除移入“更多”并主题化确认；智能标注工作区从模型页移除（唯一入口在导入题库页，双端三种标注范围保留）；协议/默认模型/推理强度/题库配置等原生 select 全部替换为 OptionSheet（AiAssistant 的对话模型与推理强度同步替换）。
4. **单词本**：统计改紧凑芯片摘要；搜索+六项筛选置于列表上方；首次进入窄屏不自动展开第一词（宽屏双栏保留默认选中）；详情与复习字段顺序统一（词形→常用释义→本句语境→真题原句→辨析→记忆提示→笔记）；🌟 emoji 替换为 Lucide Star；错误区域可换行；删除走主题化确认；真题遇见只展示最新一条（对齐 R7）。
5. **错题本**：筛选卡等高、窄屏换行；重做为主操作、分析为次、删除入“更多”；分析可收起并恢复列表滚动位置；批量模式整行可点选（≥48dp）、未选择时删除禁用；新增加载失败状态与重新加载；空/无结果/尚未正式重做状态保留；删除确认主题化。
6. **更新与导入**：AndroidUpdatesView 分区重组为设备同步、远程题库（含目录 URL 与包安装）、程序更新、诊断日志；发送模型配置、清空日志走主题化确认；复制/导出/清空分级保留。ImportView 的发布/删除确认主题化，模型选择、已有题库配置、标注级别、答案选择全部 OptionSheet 化。全应用 window.confirm/prompt/alert 清零。

## 验证证据

- `pnpm run build`（vue-tsc + vite）通过；`pnpm run test:all` 61/61 通过（含 4 个 Playwright 真跑测试）。
- 测试契约同步更新：ai-adapters、ai-reasoning-effort、android-review-layout、lan-sync-contract、question-labeling-isolation（改指 services/questionLabeling.ts 并断言模型页无标注入口）、lan-s6-ui（补 useRoute 桩）、vocabulary-layout（显式点击目标词）、vocabulary-manual-edit（窄屏显式点击首词后断言）。
- 截图矩阵 96 张 + 3 张状态截图：`.codex-local/ui-remediation-captures/`（生成脚本 `.codex-local/ui-remediation-captures.mjs`）：6 页面 × 手机/平板 × 横竖屏 × 浅/深 × 字体 1/1.35。
- 行为验证（同目录 behavior.json）：确认弹层 Escape/返回键关闭且 URL 不变；选择弹层返回键关闭且值不变；搜索空结果态；/mobile-settings 横屏不再跳转模型页。全部通过。

## 保留行为

API、路由（保留 /mobile-settings 与 /settings）、数据字段、学习记录、复习计划（5/10/20 巩固、正式到期队列）、评分、错题判定、SecureStore、智能标注三种范围均未改；仅移动展示层与弹层。

## 未验证项

- 真机（手机/平板）横竖屏旋转、系统字体 1.35 倍（截图为 CSS 放大模拟）、键盘弹出与真实 Android 返回键硬件路径（已验证等价 popstate 路径）需实机抽验。
- 中文语音/听力、练习页、AI 助手对话流未在本轮截图范围（未改动核心逻辑，AiAssistant 仅替换两个选择器）。
- 未构建 APK/未 cap sync（交付阶段按 RUNBOOK 执行）；未同步公测树。
