# Bundled offline pronunciation voices

Runtime: [Sherpa-ONNX 1.13.8](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.8).
Assets are prepared by `frontend/scripts/prepare-tts-assets.ps1` with pinned archive SHA-256 values. The upstream model card is included beside each model in the APK.

| Accent | Voice | Dataset / attribution | License stated by model card |
| --- | --- | --- | --- |
| US | Piper LJSpeech medium INT8 | [LJ Speech](https://keithito.com/LJ-Speech-Dataset/) | Public domain |
| GB | Piper Alan medium INT8, 22,050 Hz | [Mycroft Mimic 3 apope_low](https://github.com/MycroftAI/mimic3-voices/tree/master/voices/en_UK/apope_low), converted/quantized by Sherpa-ONNX | Upstream dataset LICENSE states “Copyright 2022 Mycroft AI / All Rights Reserved”; original notice bundled as `tts/en_GB/LICENSE`. No general redistribution permission is asserted. |

The GB voice replaces Cori medium: Cori reproducibly prolonged final /d/ in isolated words such as `odd`, `respond`, `add` and `bed`, including with its non-quantized model. A 16 kHz Southern English candidate removed the prolonged audio but failed user listening acceptance for clarity. The user selected Alan medium after comparing generated samples on 2026-10-19. Alan changes the GB voice to a male voice and retains 22,050 Hz; US pronunciation and offline operation remain unchanged. No generated audio is truncated or word spelling substituted.

Scope is the private development installation. The Alan source license must be resolved before any public redistribution of this model; the downloadable upstream archive and local listening acceptance do not establish a redistribution license. Preparation retains the upstream notice rather than describing this voice as freely distributable.

Focused model regression: run `frontend/tests/offline-speech-audio.py` with Python, `sherpa-onnx==1.13.8` and NumPy installed, after preparing assets. It generates 66 samples with the production synthesis settings and checks the observed prolonged-final-consonant failure plus control words/phrases. Duration and PCM checks do not replace listening on the device.
