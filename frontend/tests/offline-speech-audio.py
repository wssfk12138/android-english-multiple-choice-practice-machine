"""Focused real-model regression, run explicitly with sherpa-onnx==1.13.8 + numpy.

Uses the same config as TtsPlugin; never downloads models or touches device data.
This checks the observed prolonged /d/ defect, not subjective pronunciation quality.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import sherpa_onnx

parser = argparse.ArgumentParser()
parser.add_argument('--assets', type=Path, default=Path(__file__).resolve().parents[1] / 'android/app/src/main/assets/tts')
args = parser.parse_args()
failures = []
for accent in ('en_GB', 'en_US'):
    directory = args.assets / accent
    vits = sherpa_onnx.OfflineTtsVitsModelConfig(
        model=str(directory / 'model.onnx'), tokens=str(directory / 'tokens.txt'),
        data_dir=str(directory / 'espeak-ng-data'), noise_scale=0.667,
        noise_scale_w=0.333, length_scale=1.0)
    config = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
        vits=vits, num_threads=1, debug=False, provider='cpu'), max_num_sentences=1)
    engine = sherpa_onnx.OfflineTts(config)
    # Controls protect complete short/long words, phrases, apostrophes and hyphens.
    for word, limit in [('odd', 1.5), ('respond', 1.8), ('add', 1.5), ('bed', 1.5),
                        ('further', 1.5), ('good', 1.5), ('world', 1.8),
                        ('interdisciplinary', 3.0), ('as a result', 3.0),
                        ("don't", 1.8), ('well-known', 2.5)]:
        durations = []
        for _ in range(3):
            audio = engine.generate(word, sid=0, speed=1.0)
            samples = np.asarray(audio.samples)
            duration = len(samples) / audio.sample_rate
            durations.append(round(duration, 3))
            if not (np.isfinite(samples).all() and 0.12 < duration < limit
                    and float(np.max(np.abs(samples))) > 0.005):
                failures.append((accent, word, round(duration, 3)))
        print(json.dumps({'accent': accent, 'word': word, 'durations': durations}), flush=True)
assert not failures, f'Unexpected empty/nonfinite/prolonged synthesis: {failures}'
print('PASS: 66 real-model generations; final-d duration, valid PCM and control words')
