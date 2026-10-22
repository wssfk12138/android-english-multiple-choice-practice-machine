# 2026-10-23 桌面横屏一致性修复与 GitHub 推送前准备

## 范围与结论

本轮处理原对话整理的 A01–A04，并在修复后对平板、Windows 内测（W）、Windows 公测（P）做逐页横屏对照；同时完成 A/P 两棵公开树推送前的忽略规则、敏感信息扫描、构建与 UI 回归。W 是内测树，远端 `push` 明确禁用，不纳入公开推送。

当前完成层级：**代码完成、自动化通过、桌面现用安装已部署并验证、三树本地提交完成**。未推送、未发布；Android APK 未重新安装。

## 修改

- 单词本：宽屏只显示右栏详情，列表内副本仅在窄窗口出现，消除同屏两份详情；筛选按钮补足 44px 触控高度、圆角和完整文字；筛选项改为单列，18px 单选点；详情“编辑”按钮保持单行 48px。
- 首页题库行：选择器占用剩余宽度，管理、回收站、查看题库按钮保持同一行；W 与 P 使用同一规则。
- 模型页：恢复单栏、最大宽度约 1280px；把“学习偏好 / 单词本显示 / 历史词条补缺”移入独立“单词本设置”页，设置中枢“外观与显示”新增入口，并显示“已开启 N 项”摘要。
- 单词本设置：12 个栏目、按组全开/全关、本地保存；Windows 两版入口与页面标题一致。
- 每日一学：修复指针捕获释放在 `pointerup` 之前触发、导致有效滑动被回弹覆盖的竞态；卡片与窗口的重复松手只处理一次。方向保持产品既定语义：左滑下一词、右滑上一词。
- Android 单词本设置中的英音说明由已替换的 Cori 改正为 Alan。

## 现用现场

| 渠道 | 现用目录 | 端口 / PID | 实际 JS / CSS |
| --- | --- | --- | --- |
| W | `C:/Users/MEC/AppData/Local/Programs/EnglishPracticeMachine/p5-20261022` | 8765 / 3124 | `index-DH1coxaN.js` / `index-BrztX-_V.css` |
| P | `C:/Users/MEC/AppData/Local/Programs/EnglishPracticeMachinePublic/p3-20261022` | 8775 / 23272 | `index-BW73cgLA.js` / `index-NInOLl2L.css` |

部署只替换 `_internal/frontend/dist`，26/15 个文件逐个 SHA-256 校验一致；后端、原生 EXE、数据库路径和快捷方式未改。部署前目录备份在 `work/port-20261022/vocab-settings-fix-20261023/W-current-dist`、`P-current-dist`。

平板为 HEY2-W09，横屏 1205×721 CSS 视口，DPR 2.125，浅色，安装 alpha.132 / 147。

## 验证

- W/P `pnpm run build` 通过；两版 `pnpm run test:desktop-ui` 各 60 项通过，证据在 `work/port-20261022/vocab-settings-fix-20261023/evidence/desktop-ui-{W,P}/browser-evidence.json`。
- 现用安装实测加载上述新资源，无页面错误；两版请求账本 `used=0`、`active=false`。W 仍保留 215 个待补缺词条，P 为 0，未意外启动模型。
- 电脑 15 页 × 2 版截图与几何数据：`evidence/desktop/{W,P}-*.png`、`all.json`；平板 17 页：`evidence/tablet/*.png`、`index.json`；汇总 `evidence/comparison.json`。
- 电脑两版所有页面横向溢出为 false；平板 17 页 `bodyWidth=1205`，无横向溢出。
- 关键页人工复核：首页、题库、单词本、每日一学、导入、助手、设置、单词本设置、更新、同步、诊断、帮助、模型、回收站。首页题库行、设置摘要、单词详情、筛选控件、模型页已与平板同构。

对照中的剩余差异来自数据或产品边界：W 当前为大学英语六级、约 351 词，P 考研英语一且词库为空，平板考研英语一约 412 词；P 的“更新中心”“帮助与问题反馈”为其公开版命名；平板“每日一学”以当前单词作 `h1`，P 无词时显示空状态。题型卡片列数按各端实际题型数量变化，不判为布局缺陷。

未覆盖：平板竖屏、分屏、更大系统字号，以及真实旋转后的逐项布局。

## GitHub 推送前准备

- A/P/W 均补充本地临时产物规则：`tmp-*`、`preview-*`、`frontend/.tts-cache/`、`.tts-cache/`、`*.bak.*`、`*.pre_batch*`，A 另有 `tmp_*.py`。规则只排除探测脚本、截图、缓存和备份，真实源码、测试、文档及 `frontend/scripts/tts-licenses/` 保留。
- 全量候选文件扫描未发现真实 API Key、私钥、GitHub/Slack/AWS 令牌、设备序列号或明文设备令牌；命中项为测试夹具中的假 `sk-` 字符串、示例 `192.168` 地址及历史文档中的本机路径说明。新增文档未写入密钥或用户数据。
- A `pnpm run build` 通过；P/W 构建与 UI 回归通过；A/P/W `git diff --check` 无空白错误。
- W 远端仍为只读内测历史，push 禁用；P 为 Windows 公开仓，A 为 Android 公开仓。三棵树差异有意保留，不做整仓覆盖或跨树同步。

## 阻塞与未做

- Android 公开 APK 若含英音 Alan，仍受 `Copyright 2022 Mycroft AI / All Rights Reserved` 许可约束；源码保留许可证通知，模型二进制不入库。公开发布前必须解决再分发许可，或按既定路线仅提供美音 LJSpeech。
- 本轮未构建/安装 Android APK；平板当前安装仍是 alpha.132，界面中的英音标签可能仍显示旧文案。源码与前端构建已修正，安装验证留待下一次获批出包。
- 三树本地提交：A 本轮提交见 `git log`（提交说明为 `fix: desktop landscape parity and Android vocabulary settings`）、P `9985acc`、W `c7978e3`；均未推送，未创建 Release，未更新内测通道。
