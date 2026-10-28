# Electron rebuild verification — 2026-10-28

The application has been rebuilt with **Node.js and Electron 45.1.0**, replacing the C#/.NET/WPF source and dependencies. VS Code bridge **0.2.0** is the only model connection. It reuses model access from the existing signed-in VS Code profile; it does not create a GitHub/CLI authentication session or export GitHub credentials.

Test machine: Windows x64, Node.js 24.18.0, npm 12.1.0. Windows 10, ARM64, other accounts/profiles, and corporate deployment policies were not separately tested.

| Check | Result |
| --- | --- |
| `npm test` | PASS — 10 tests |
| Three concurrent conversations and independent two-turn recall | PASS through real Node named pipes with fake VS Code models |
| Per-request cancellation and timeout | PASS; another conversation continues |
| Pending work after disconnect | PASS; rejected without replay |
| Incorrect local capability / competing bridge connection | PASS; rejected |
| Editor restart and unavailable model behavior | PASS; no context replacement or model fallback |
| Normal prompt/response omission and credential-pattern redaction | PASS |
| `npm run test:electron` | PASS — actual Electron window |
| Three UI sessions and independent drafts | PASS |
| Renderer sandbox, context isolation, disabled Node integration | PASS |
| Model output containing HTML/event handlers | PASS — rendered literally; no injected DOM/image/code |
| Connection-test UI | PASS against fake VS Code models |
| `npm run package:bridge` | PASS — local bridge 0.2.0 VSIX |
| `npm run package:win` | PASS — Windows x64 app folder |
| `npm run test:packaged` | PASS — actual packaged Windows executable and UI checks |
| Live GitHub response through the Electron rebuild | Not verified by the automated checks |
| Concurrent live provider responses, real model switching, quota/policy/network failure behavior | Not verified live |

The production app contains no hardcoded model catalog. Test fixtures deliberately use fake `model-a` / `model-b` entries; those exist only in test code. Packaged source excludes tests, former .NET artifacts, development tools, logs, and endpoint keys. The VSIX has no third-party runtime dependencies. Root npm dependency audit reported zero vulnerabilities during the rebuild; the VSIX packaging tool is a separate development dependency tree and is not shipped in the extension.

Artifacts (excluded from Git):

- `artifacts/electron/PromptDeck-win32-x64/PromptDeck.exe`
- Final build: `artifacts/electron-final/PromptDeck-win32-x64/PromptDeck.exe` (fresh output directory used after Windows locked the earlier `app.asar` against overwrite)
- `artifacts/promptdeck-bridge-0.2.0.vsix`
- `artifacts/electron-smoke.png`
- `artifacts/electron-packaged-smoke.png`

## Prior connection evidence and its limits

Before the Electron rewrite, VS Code 1.142.0 successfully connected to the WPF bridge and supplied seven model entries. A live model request then displayed VS Code's normal language-model **Allow** dialog; that test timed out while consent was pending. This established catalog access but did not establish successful bridge inference. The Electron rewrite preserves the extension's documented `vscode.lm` model API and independent history behavior, while replacing the .NET transport with Node's local IPC protocol.

A separate earlier standalone Copilot CLI/SDK login did produce `Connection successful` and concurrent SDK responses. The user subsequently ruled out a separate authentication session, so that path has been removed and those results are **not evidence for the current connection**. The desktop does not silently fall back to it.

To finish live verification, reload VS Code after installing bridge 0.2.0, run **PromptDeck: Connect Desktop** in the existing signed-in profile, allow its normal model-access prompt if permitted, and run **Test Connection** in Electron. Then send distinct markers in three sessions concurrently and check that each conversation recalls only its own marker. Existing account identity and corporate permission remain controlled by VS Code and the user/administrator.
