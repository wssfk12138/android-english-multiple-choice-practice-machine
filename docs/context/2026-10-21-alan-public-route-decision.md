# Alan 在 P（公测）的路线决定

日期：2026-10-21；2026-10-22 更新：**路线已按树实装，W 双音/P 单美音候选已构建并通过资源扫描；未发布。** 当前验证见[实施回执](2026-10-22-desktop-port-implementation.md)，下方“未做”保留最初决定阶段的历史范围。

## 决定

- **W 内测树**：保留英音 Alan medium INT8 + 美音 LJSpeech medium。用户已确认 Alan 用于本地离线发音，内测树可以继续使用。
- **P 公测树**：只提供美音 LJSpeech（public domain）。不打包、不加载、不显示英音 Alan；待取得明确书面再分发许可后，再增加英音。
- **D01 验收按树区分**：W 为“英美双口音”；P 为“美音单口音 + 能力接口可扩展”。P 不再以双口音作为本轮硬性通过条件。
- **P 产物边界**：Alan 的 `model.onnx`、`tokens.txt`、`MODEL_CARD`、`LICENSE` 和 espeak 数据不得进入 P 源码、`frontend/dist`、zip、EXE 或更新包。

## 依据

- [en_GB LICENSE](E:/EnglishPracticeMachine/Codex/english-multiple-choice-practice-machine-android/frontend/android/app/src/main/assets/tts/en_GB/LICENSE) 原文为 `Copyright 2022 Mycroft AI` / `All Rights Reserved`；[Alan 来源核查](2026-10-21-alan-source-review.md) 记录上游根许可与音色独立许可存在歧义，用户决定只覆盖本地使用，不构成公开再分发授权。
- [en_US MODEL_CARD](E:/EnglishPracticeMachine/Codex/english-multiple-choice-practice-machine-android/frontend/android/app/src/main/assets/tts/en_US/MODEL_CARD) 标明 LJSpeech 数据集，License 为 public domain。
- en_US 资源指纹：`model.onnx` 19,349,795 字节，SHA-256 `206a8403baad4df7642156918a6ebe205798290d82f24d0d0119d7afa8a2738e`；`tokens.txt` 940 字节，SHA-256 `ef3a7e4a8d1af0c9d4dc45aaae1a6242ebe24a7ed6f3d025a49eb29682784c6d`；`MODEL_CARD` 517 字节，SHA-256 `fbee1529c89d36b3fe76d7e9f3f832dce17f44900a52d76a9bda735654766b4d`。
- P 是公测发布树，把音色模型放进安装包属于再分发；公开发布与本地内测分别判断授权。

## 技术契约

1. 新增 `/api/speech/status` 返回引擎、模型版本和可用口音列表；P 返回 `accents: ["us"]`，W 返回 `["us", "gb"]`。
2. `PronunciationButtons.vue` 从 status 渲染按钮，不硬编码 `['us', 'gb']`；P 不显示英音按钮，也不发送 `accent=gb` 请求。
3. `POST /api/speech/synthesize` 对 P 的 `gb` 请求返回受控的不可用错误，不偷偷回退联网或系统音色。
4. P 打包只收集 `tts/en_US`；W 收集 `tts/en_US` 和 `tts/en_GB`。两树都需加入 `sherpa-onnx` 依赖及实际 wheel/DLL/espeak 数据收集步骤。
5. P 验收：断网美音冷/热启动、未缓存词、三入口、切词停止；产物扫描确认无 `en_GB`/Alan 资源。W 验收：英美双口音同样链路。
6. 将来取得书面许可时，只需增加 `tts/en_GB`、把 status 的 `accents` 加回 `gb` 并补双口音测试，不改 UI 结构。

## 影响与未做

- P 的 D01 范围缩小为美音；G7 的 P 资源清单相应减少，Alan 许可不再阻塞 P 的美音打包。
- W 的 D01 不变；Android 当前安装和 Alan 本地使用不变。
- 本轮未修改 W/P 业务代码，未构建、未安装、未联系作者、未删除任何音色资源。
