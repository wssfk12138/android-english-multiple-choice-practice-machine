# Alan 离线音色来源复核

核查日期：2026-10-21。范围：本地脚本/模型卡/许可文件、近期相关对话、上游公开来源；未联系作者、未换音色、未发布或安装。

## 本轮最后决定

用户在本轮先要求回查近期项目与对话历史，再曾选择许可明确的候选、另做试听；随后明确表示认为 GitHub 开源且项目非商业，可以继续使用 Alan 作为本地离线音色。**以最后决定为准，保留 Alan，不执行换声或新候选试听。** Windows 两树规划使用相同本地离线实现；Android 当前安装不变。前一项候选研究没有成为选型决定。

事实边界：公开托管、应用开源和非商业用途不自动证明音色有明确的再分发许可。本轮记录用户接受继续本地使用，不把这个决定改写为上游已授予无条件公开再分发权。许可歧义不阻断本轮方案和本地移植，正式公开发行仍走独立发布流程并呈现该事项。

## 近期对话证据

本轮通过 read_thread 核查《修复每日学习发音与布局》，对话 ID `01a151eb-6f8f-7a00-be72-66982e013a91`。相关 turn 为 `01a15311-70fa-71d0-b818-3f03a14f537e`。

- 原 Cori 尾音 d 异常；更换 Southern English 后用户反馈“整体语音模糊不清”。
- 比较 A/B 样本后，用户明确选择：“A 男声清晰，采用 A”。A 为 Alan medium INT8，22.05 kHz。
- 平板安装 alpha.132 / 147 后，用户再次确认：“现在清晰，发音问题已解决”。
- 原对话最终答复同时记载：“Alan 上游数据的公开再分发许可仍需解决，本次没有进行公开发布。”未在该相关对话中找到已获得作者明确再分发许可的记录。

因此 Alan 的音质选择和本地验收确有用户依据，不应在移植计划中当作未经确认的随机音色。它们也不能代替 Windows 宿主实际播放验证。

## 资源来源链

1. **录音来源：Alan Pope。** [Alan Pope 的本人文章](https://blog.popey.com/2022/10/blog-to-speech-in-my-voice/)介绍为 Mycroft 录制语句；Mycroft 音色的 SOURCE 指向 [popey.me](https://popey.me/)。
2. **数据/原始语音模型入口：Mycroft `voices/en_UK/apope_low`。** [音色目录](https://github.com/MycroftAI/mimic3-voices/tree/master/voices/en_UK/apope_low)的 README 指向 Alan Pope，并要求查看该目录 LICENSE。README 中 U.S. English 标题与目录 en_UK 不一致，不能用它否定 Piper 的 en_GB 元数据。
3. **Piper 模型：`en_GB-alan-medium`。** [MODEL_CARD](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/alan/medium/MODEL_CARD)标明 en_GB、单说话人、22,050 Hz；Dataset URL 指向上述 Mycroft 目录，License 写“See URL”；训练说明是从 lessac medium 微调。
4. **本项目下载的转换包：Sherpa-ONNX `vits-piper-en_GB-alan-medium-int8.tar.bz2`。** [下载来源](https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_GB-alan-medium-int8.tar.bz2)由 `frontend/scripts/prepare-tts-assets.ps1` 固定，运行时 AAR 为 Sherpa-ONNX 1.13.8。

本地压缩包 SHA-256 本轮重算并与脚本固定值一致：

`f0b2526c9600657141ccbbe412f6159dceedab5bab4ba4e8857d9443acb50de4`

实际 Android assets 的模型哈希、字节数及来源脚本/模型卡证据见[本轮 audit JSON](2026-10-21-android-desktop-port-audit.json)。本轮没有重新下载大型模型，Windows 重新取包时仍需校验；本地归档哈希匹配只证明资源身份，不证明许可已澄清。

## 许可证据与矛盾

| 来源 | 本轮看到的内容 | 能证明与不能证明的事 |
| --- | --- | --- |
| [Mimic3 voices 根 LICENSE](https://github.com/MycroftAI/mimic3-voices/blob/master/LICENSE) | CC Attribution-ShareAlike 4.0 International | 仓库有总许可；不单独证明覆盖带独立许可文件的每个音色 |
| [apope_low 独立 LICENSE](https://github.com/MycroftAI/mimic3-voices/blob/master/voices/en_UK/apope_low/LICENSE) | `Copyright 2022 Mycroft AI` / `All Rights Reserved` | 正是当前项目保留的两行原文；没有在此看到一般性再分发授予 |
| [2023 年 Alan 商用讨论](https://community.openconversational.ai/t/can-i-use-alan-piper-model-for-commercial-purposes/13744) | synesthesiam 表示依据早前沟通应是 CC-BY-SA，同时说不能确定仍是如此 | 存在支持 CC-BY-SA 的作者解释线索；不能去掉其不确定性或当成新的明确许可文本 |
| [上游 Issue #14](https://github.com/MycroftAI/mimic3-voices/issues/14) | 2025 年提出根许可与 apope 许可冲突；本轮 API 返回 open、1 条评论 | 冲突确实被报告；评论是解释，不是许可授予，API author_association 为 NONE |
| 当前 Piper MODEL_CARD | License: See URL | 没有自行将音色明确改为 MIT；不能把代码仓许可证套到训练音色 |

核查结论：**音色来源明确、用户音质选择明确、当前资源身份可核对；公开再分发许可存在未消除的上游歧义。** 不在本文件断言“肯定禁止使用”，也不写“GitHub 上开源，所以当然可任意分发”。用户最后决定继续本地使用，移植方案据此推进并保留透明记录。

## 本轮外部核查限制

模型卡、Mycroft LICENSE/SOURCE 和 Issue/评论公开接口读取成功；批量查询 Sherpa `tts-models` Release 资产列表遇 GitHub 匿名 API 403 配额限制。因此未声称本轮重新验证所有候选包在线可下载。原 Alan 的脚本固定链接、已有归档与实际本地模型已核对，足以支持本轮来源调查。

中途查询的 Alba / northern_english_male 模型卡有较清楚的数据集许可入口，但未取得用户最终选用，也未完成完整模型链许可/Windows 音质验收，不作为已批准替代方案。
