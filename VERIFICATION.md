# Electron verification — 2026-10-28

## Fresh-checkout VSIX packaging fix

Reproduced the work-PC screenshot's `ENOENT` using the real VSIX packager in a temporary checkout without `artifacts`. The former extension npm script wrote directly into the missing parent folder. A regression test failed with the same error before the fix.

The extension packaging script now invokes `scripts/package-bridge.cjs`, which creates the output directory recursively and derives the VSIX name from the extension manifest. The same real-packager regression then passes on a fresh temporary checkout. Windows packaging now reports an actionable `npm run package:bridge` instruction if its companion VSIX is absent, instead of a raw file error. This change does not alter authentication, extension runtime behavior, or corporate network settings.

## Live connection recovery — 16:32 local time

The user-reported local connection failure was reproduced with the installed **bridge 0.1.0** and the running Electron **0.3.0** app. A minimal read-only connection probe returned `ENOENT` for the legacy deterministic pipe. A separate probe connected successfully to the desktop's registered protocol-2 pipe without sending credentials or a model request. This distinguished the version mismatch from a closed desktop app or a GitHub/network authentication failure.

Installed the existing bridge 0.3.0 VSIX through the official VS Code CLI, reloaded the intended VS Code window, and ran **PromptDeck: Connect Desktop**. The actual desktop log then recorded:

```text
16:32:13 VS Code connected: version=1.142.0; models=7.
16:32:58 1. Local bridge: PASS (authenticated local named-pipe connection).
16:32:58 3. Model discovery: PASS (7 models).
16:32:58 4. Temporary conversation: PASS; model=gpt-4o-mini.
16:32:59 5. Inference request: PASS (existing VS Code model access verified for this request).
16:32:59 6. Test response: Connection successful
16:32:59 6. Exact response: PASS. Connection successful.
16:32:59 7. Temporary conversation cleanup: PASS.
```

**Live inference through the current Electron/VS Code bridge is now verified for this model and existing editor account.** No new GitHub/CLI authentication, token export, proxy change, or policy modification was performed. The user's draft was preserved. The active provider account and resolved remote URL/proxy remain outside the Language Model API's observable metadata; this successful response does not prove a particular network route or corporate identity. Concurrent live provider responses and other models remain unverified. Earlier statements below about pending live verification describe the earlier test state.

## Connection properties update (0.3.0)

The new read-only **Connection properties** panel displays editor-provided proxy/TLS settings, sanitized proxy environment addresses, available GitHub account labels, provider/configured enterprise URL origins, editor/extension/host identity, model metadata, snapshot time, and connection-test evidence. The actual inference URL, selected Copilot account and resolved proxy/PAC route are explicitly unavailable through the public Language Model API. The panel does not equate configuration with an observed route.

`npm test`: **13 tests PASS**. New checks verify that the collector does not invoke `authentication.getSession`, read token properties or `http.proxyAuthorization`, inspect secret environment variables, or expose URL userinfo/path/query/fragment secrets. Unknown report fields are dropped at the desktop boundary. A real IPC refresh test verifies sanitized display state, excluded local capability, and last-test evidence. These metadata snapshots are not appended to the diagnostic log.

`npm run test:electron`: **PASS**, including opening/closing the properties dialog, showing the sanitized proxy origin and unavailable endpoint field, rendering the last successful test, and refreshing metadata without changing settings. These use fixture metadata and fake models. A production editor/network-route snapshot has not been independently verified by these tests.

Bridge 0.3.0 packaging and Windows x64 packaging: **PASS**. The packaged executable also passed the same UI/property-refresh checks (`npm run test:packaged`). Current artifacts: `artifacts/connection-properties/PromptDeck-win32-x64/PromptDeck.exe` and `artifacts/promptdeck-bridge-0.3.0.vsix`. Screenshot: `artifacts/connection-properties-packaged.png`. Artifacts are excluded from Git.

Official references checked: [VS Code networking](https://code.visualstudio.com/docs/setup/network) describes system proxy support and extension-specific limitations; [VS Code API](https://code.visualstudio.com/api/references/vscode-api) documents account metadata, effective configuration, editor identity, and model properties. No new network probe, interception, credential access, or policy modification was introduced.

## Original Electron rebuild (0.2.0)

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
