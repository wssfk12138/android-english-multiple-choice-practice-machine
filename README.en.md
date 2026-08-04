# English Practice Machine Android

> An independent Android multiple-choice practice app derived from the product ideas of the Windows English Practice Machine.

[中文](README.md) · [ESQ 1.0 format](docs/question-bank-format.md) · [Update manifest](docs/update-manifest.md)

English Practice Machine Android is designed for sustained, high-volume practice with English objective questions on Android phones and tablets. It focuses on open question banks, user-selected AI providers, local data, and repeatable practice that does not simply become memorizing answer positions.

This is a separate release line from the Windows application:

- Android uses Capacitor, Vue 3, TypeScript, and native SQLite.
- Windows continues to use Vue 3, FastAPI, and SQLite.
- ESQ 1.0 provides question-bank compatibility between them.
- Databases, learning records, version numbers, signing keys, and release schedules are independent.

See [the upstream compatibility policy](docs/upstream-compatibility.md) for the detailed boundary.

## Current version

`0.1.0-alpha`

The primary test device is the Honor Pad 9 with a 12.1-inch 2560×1600 display and Android 14. Layouts respond to actual window width for landscape, portrait, and split-screen use.

## Implemented

- ESQ 1.0 import, validation, preview, and conflict handling.
- Practice by year, random whole-unit practice, and wrong-answer retry.
- Cloze, reading, and Part B objective questions.
- Option shuffling, answer persistence, unit submission, and full-paper submission.
- Incomplete-answer protection with navigation to the unanswered question.
- Wrong-answer statistics, frequent-error tracking, and answer-memory-safe AI analysis.
- Vocabulary collection, repeated-encounter counts, frequent-word marking, batch translation, and review scheduling.
- Multiple API profiles, automatic model discovery, model visibility controls, and an AI assistant.
- API keys protected through Android Keystore and AES/GCM.
- APK update checks, download, SHA-256 verification, and system-installer handoff.
- Remote question-bank catalog checks, ESQ download, size and SHA-256 verification, conflict preview, and confirmed import.
- Internal builds may carry one validated first-launch question bank; it installs only when no local-year conflict exists and never silently replaces existing years during upgrades.
- Tablet two-pane layouts, medium-width navigation rails, and compact single-pane layouts.

## Not included on Android

- Word or PDF parsing.
- AI question-bank annotation on the Android device.
- Real-time synchronization with Windows.
- Silent APK installation, which is unavailable to ordinary Android apps.

Use the Windows edition to parse and correct Word/PDF sources, then export ESQ packages for Android.

## Development requirements

- Windows 10/11
- Node.js and Corepack
- pnpm 11
- JDK 21
- Android Studio
- Android SDK Platform 36
- Android SDK Build Tools 36.0.0

## Build a debug APK

```powershell
cd frontend
corepack.cmd pnpm install
cd ..
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-android-debug.ps1
```

Output:

```text
frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

## Test-channel updates

Every updatable build must keep the same application ID and signing certificate, increase `versionCode`, and publish an update manifest whose URL and SHA-256 match the APK.

Debug builds may use a local-network HTTP source. Production builds should use HTTPS. Android still requires explicit user confirmation before installation.

Use `start-internal-update-server.ps1` and `stop-internal-update-server.ps1`
for the LAN question-bank channel. The tablet and PC must share a LAN and
Windows Firewall must allow inbound TCP 8877. The internal APK still carries
the first-launch bank when the LAN channel is unavailable.

Run `enable-internal-update-firewall.ps1` once as Administrator before using
LAN updates. Its rule limits access to the local subnet on TCP 8877 rather
than exposing the update directory to the public internet.

See [examples/update-manifest.alpha.json](examples/update-manifest.alpha.json).

## Privacy

Question banks, practice history, wrong answers, vocabulary, chats, and settings remain in local app storage. API keys are stored through the native secure-store plugin. ESQ packages do not include personal learning data or API configuration.

Remote AI providers may receive only the content the user explicitly submits for chat, wrong-answer analysis, or vocabulary translation.

## Current limitations

- ESQ media assets are not persisted in the first alpha; text-only banks are the primary target.
- The first move from the old debug signature to the fixed signing certificate requires uninstalling the old APK; later builds can update in place while preserving app data.
- Honor Pad 9 device testing is still pending.
- Public distribution requires a dedicated, securely backed-up signing workflow.

## License

Application code is licensed under GNU GPL v3.0 only (`GPL-3.0-only`). Question content and ESQ packages retain their own source and license declarations.

Author: 往事随风k
