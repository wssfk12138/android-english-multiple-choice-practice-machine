<div align="center">

  <img src="frontend/public/assets/icons/brand-mark.png" alt="英语刷题机 Logo" width="96">

  # 英语刷题机 Android

  **题库自由 · 模型自由 · 数据本地 · 自由刷题**

  面向 Android 手机、平板的英语客观题训练应用

  <p>
    <a href="README.en.md">English</a> ·
    <a href="docs/question-bank-format.md">ESQ 题库格式</a> ·
    <a href="docs/update-manifest.md">更新清单格式</a> ·
    <a href="LICENSE">GPL-3.0-only</a>
  </p>
</div>

英语刷题机 Android 是 Windows 版英语刷题机的独立发行项目。它的核心卖点是：用户可以导入和分享自己的题库，接入自己选择的大模型，并通过打乱选项、整篇练习和错题重做，让有限的真题保持“自由刷题”的新鲜感，而不是反复背答案。

## Android 版的重点：为竖屏和大屏重新设计

Android 版不是把桌面页面缩小到手机上，而是根据窗口宽度切换交互密度。平板大屏采用横屏双栏；手机或窄窗口采用竖屏信息架构，也支持平板分屏。

- **四项底部导航**：首页、笔记、AI、设置。错题本与单词本集中在笔记入口，导入、回收站、更新、帮助和模型配置集中在设置。
- **首页按当前题库动态显示**：顶部切换题库，下面只显示当前题库实际存在的听力、完形、阅读、Part B 入口；没有听力时不会显示听力入口。试卷列表只显示试卷名称，词汇回顾以五秒一组上下翻页。
- **竖屏练习上下分区**：上方文章或听力控制区、下方题目与选项区，两个区域独立滚动；中间分隔条可以拖动，按阅读需要调整上下占比。
- **横屏练习双栏**：左侧文章/材料，右侧题目和选项；听力使用完整音轨和紧凑播放器。计时模式锁定音频进度，非计时模式允许拖动。
- **横竖屏统一主题**：亮色模式使用米白宣纸纤维纹理，暗色模式使用蓝紫油画星空；手机与平板共用同一组 4K 背景并按窗口居中裁切，文章、选项、弹窗和 AI 消息继续使用高不透明度表面保证可读性。详见 [背景资源说明](docs/ui-background-assets.md)。
- **紧凑工具栏**：退出、计时/暂停、答题卡和更多操作使用图标按钮，答题卡从顶部打开抽屉，底部集中显示单篇提交和整卷提交，避免挤压选项区域。
- **笔记界面**：错题本按题库配置 → 年份 → 篇目组织，单词本跨题库共享；设置页收纳显示偏好和回收站。
- **AI 对话**：竖屏时对话填充导航栏与系统状态栏之间的区域，顶部只保留当前对话名称和历史入口，模型选择器靠近发送按钮，长消息不会撑宽页面。

## 界面预览

下面的截图来自当前 Android 竖屏版，展示从开始练习到复习、AI 对话和设置的主要使用路径。

### 首页与练习

<table>
  <tr>
    <td align="center"><img src="docs/images/readme/home-main.jpg" alt="首页主界面" width="49%"><br>首页主界面</td>
    <td align="center"><img src="docs/images/readme/home-paper-list.jpg" alt="首页试卷列表" width="49%"><br>首页试卷列表</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/readme/practice-reading.jpg" alt="阅读题答题界面" width="49%"><br>阅读题答题</td>
    <td align="center"><img src="docs/images/readme/practice-part-b-ordering.jpg" alt="Part B 段落排序练习" width="49%"><br>Part B 段落排序</td>
  </tr>
</table>

### 笔记与词汇

<table>
  <tr>
    <td align="center"><img src="docs/images/readme/notes-overview.jpg" alt="笔记入口" width="31%"><br>笔记入口</td>
    <td align="center"><img src="docs/images/readme/wrong-answers.jpg" alt="错题本" width="31%"><br>错题本</td>
    <td align="center"><img src="docs/images/readme/vocabulary-main.jpg" alt="单词本主界面" width="31%"><br>单词本</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/readme/vocabulary-meaning.jpg" alt="单词释义" width="31%"><br>单词释义</td>
    <td align="center"><img src="docs/images/readme/vocabulary-relations.jpg" alt="同义词反义词与形近词辨析" width="31%"><br>词汇辨析</td>
    <td></td>
  </tr>
</table>

### AI 与设置

<table>
  <tr>
    <td align="center"><img src="docs/images/readme/ai-chat.jpg" alt="AI 助手对话" width="31%"><br>AI 助手对话</td>
    <td align="center"><img src="docs/images/readme/ai-history.jpg" alt="AI 历史对话" width="31%"><br>历史对话</td>
    <td align="center"><img src="docs/images/readme/settings.jpg" alt="设置界面" width="31%"><br>设置</td>
  </tr>
</table>

## 功能

### 题库与导入

- 默认内置考研英语（一）和考研英语（二）客观题 ESQ 题库，可离线开始练习。
- 支持 ESQ 1.0/1.1 导入、预览、校验、冲突确认和导出分享。
- 支持 DOC、DOCX、文本型 PDF 题目与答案附件，以及 MP3/M4A/WAV/OGG 听力音频。
- 导入页支持模型辅助定位题目、题号和答案；模型只修改结构化草稿，用户逐字段校对并批准后才入库。
- 批准入库后可按本次导入、年份或全部题库执行智能标注；听力题不发送给标注模型。
- 扫描版或水印严重、没有可靠文字层的 PDF 会明确提示人工 OCR/整理，不把失败伪装成成功。
- 一个文档目前只导入首套试卷；开始导入前会弹窗提醒，避免多套真题互相错位。

### 练习与判分

- 按题库配置、年份练习，或随机抽取完整篇目：完形为一篇文章加题目，阅读/Part B 为一篇材料加该篇题目。
- 支持完形、阅读、Part B、四六级选词填空/段落匹配和听力客观题。
- 可在开始前选择是否打乱选项；判分使用稳定选项键，不受显示顺序影响。
- 可选计时，暂停按钮只暂停计时；未答完时阻止提交并定位到第一道未答题。
- 单篇提交即时显示本篇得分和错题数，整卷提交显示整卷成绩和各篇结果。
- 听力不显示原文、不做错题分析；整段播放、整段提交，退出未完成听力时提示本次记录不保留。

### 错题本与单词本

- 错题本随当前题库配置筛选，记录每次选择、近期权重、高频错题和重做历史；错误答案回顾不直接显示正确答案。
- 同一篇分析结果缓存到本地；完成下一次错题重做前不重复调用模型，重做后才允许提交新的错误选项快照。
- 文章、题干和选项中长按选词即可加入单词本；加入时不显示翻译，退出答题页或打开单词本后后台处理待翻译词。
- 普通释义优先，语境释义放在“真题中的遇见”旁边；同词重复加入两次及以上显示 `🌟` 高频标记。
- 支持搜索、筛选、编辑、重试翻译、阶段性复习和同义/反义/形近词辨析（默认关闭，可在设置中统一开启）。

### AI 与模型配置

- 保存多个 API 配置，设置 Base URL、API Key、默认模型、Temperature、启用状态和模型选择器显示状态。
- 自动拉取可用模型并支持模型切换；兼容 OpenAI-compatible、Ollama、LM Studio 等服务。
- AI 可用于学习问答、单词翻译、错题建议、题库导入校正和题目考点标注。
- API Key 仅通过 Android Keystore/AES-GCM 安全存储；未启用 AI 时基础刷题和判分完全离线可用。

### 更新与隐私

- 点击检查更新后，系统后台按顺序尝试 GitHub Release 清单和预设 HTTPS 镜像，不向用户展示来源地址，也不要求手动选择站点。
- 下载包必须通过文件大小和 SHA-256 校验，再交给 Android 系统安装确认；应用不会静默安装。
- 更新通道不写入局域网内测地址。正式发布前需要配置实际的 GitHub Release 清单和可信镜像地址。
- 诊断日志只保存在本机，支持脱敏查看、复制、导出和系统分享，不包含自动上传接收端。
- ESQ 包不含 API 配置、API Key、聊天记录、练习记录、错题本或单词本。

## 默认题库

| 题库 | 文件 | SHA-256 |
| --- | --- | --- |
| 考研英语（一）2010–2026 | `frontend/public/internal-question-bank.esq` | `ede30fae65f2fbab53c830ba39ef618e5e82f0fa7ebc789d363093c5c1b47075` |
| 考研英语（二）2010–2025 | `frontend/public/internal-question-bank-english-two.esq` | `d25ac946fa0543a61beb88eb02664d1e3a55eb819632667603268a6346fe2e83` |

两份题库均为考生回忆整理/本地导出内容，不代表官方试题发布。题库内容、答案和 AI 标签不自动继承程序代码的 GPL 许可，来源和传播权限以包内 `manifest.json` 为准，详情见 [默认题库清单](docs/bundled-question-banks.md)。

## 从源码构建

环境：Windows 10/11、Node.js、Corepack/pnpm 11、JDK 21、Android Studio、Android SDK Platform 36。

```powershell
cd frontend
corepack.cmd pnpm install
corepack.cmd pnpm run build
corepack.cmd pnpm exec cap sync android
cd android
.\gradlew.bat assembleDebug
```

Debug APK 输出在 `frontend/android/app/build/outputs/apk/debug/app-debug.apk`。正式发布必须使用固定签名、递增 `versionCode`，并单独保管签名文件；APK/AAB、数据库、日志、API Key 和签名材料不得提交到 GitHub。

## 项目边界

Android 与 Windows 使用独立数据库、版本号、签名、提交历史和发布节奏；ESQ 是兼容交换边界，不是实时同步机制。Android 的文件导入与模型标注在设备端执行，具体能力受设备性能和用户配置的模型服务影响。当前生产构建、Capacitor 同步和 Debug APK 构建已通过；实体设备的完整兼容性仍需在正式发布前继续验收。

## 许可证与作者

程序代码采用 GNU General Public License v3.0 only（`GPL-3.0-only`）。作者：往事随风k。
