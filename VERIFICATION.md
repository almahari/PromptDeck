# Electron verification — 2026-10-28

## Dark appearance (desktop 0.4.6 — 2026-10-29)

Applied dark semantic color tokens to the sidebar, conversation, inputs, selected worktrees, dialogs, edit review, properties tables and diagnostics. Native Electron theme and startup background are dark as well. Retained visible focus rings, green connection status, blue selection and amber Full access styling. Electron and packaged UI flows pass; the dark screenshots were visually inspected. Windows build: `artifacts/dark-mode/PromptDeck-win32-x64/PromptDeck.exe`.

## Projects-only sidebar (desktop 0.4.4 — 2026-10-29)

Removed Chat sessions, its New action, and the reserved sidebar space. The project list now fills the available sidebar height. With no projects selected, the main view asks the user to add a project; sending is disabled until a worktree is selected. The UI check passes for the empty state, worktree selection and independent worktree drafts, connection testing, project collapse, file edits and access/restart controls. Windows build: `artifacts/projects-only/PromptDeck-win32-x64/PromptDeck.exe`.

## Compact workspace layout (desktop 0.4.3 — 2026-10-29)

Replaced sidebar action labels with small labelled SVG icon buttons, removed the visible connection/help/footer text, and retained an accessible status icon with a detailed tooltip. Projects receive the flexible sidebar area; each project expands/collapses with a keyboard-accessible toggle, worktree count, and locally remembered state. Worktree/session actions, Send/Cancel, connection test/log actions, model and access controls are grouped in the header. Diagnostics is a native details panel, initially collapsed, which returns its space to the conversation when closed.

Electron UI verification passes for collapse/expand across state updates, readable default-checkout labels, status icon state, action placement in the header, diagnostic content retention and released conversation height. Existing model/chat/worktree/edit/access/restart flows still pass. Inspected screenshots at 1180×850 and 900×700; no horizontal page overflow. Windows build: `artifacts/compact-sidebar/PromptDeck-win32-x64/PromptDeck.exe`. Bridge 0.4.0 remains compatible; inference behavior is unchanged.

## Session file access (desktop 0.4.2 — 2026-10-29)

Added **Session access** with Review every edit (default) and Full access (automatic file edits in the selected worktree). The edit dialog also offers **Allow all edits for this session**, which resolves that session's pending review and enables automatic future edits. Modes are independent across sessions and can be changed while an agent is working. Starting a new conversation resets to review. Full access retains path restrictions, stale-file hash checks, cancellation, credential-file exclusions and the existing file-tool scope; it does not enable terminal commands or other folders.

`npm test`: **25 tests PASS**, including automatic writes with no approval, independent simultaneous sessions with a pending review in the other worktree, revocation restoring review, pending-review permission grants, stale-hash protection in Full access, and reset to review. The Electron smoke test exercises the review-dialog grant, dropdown state, automatic write without a dialog, session isolation, and reset. Provider responses are scripted fixtures. Windows build: `artifacts/session-access/PromptDeck-win32-x64/PromptDeck.exe`; bridge 0.4.0 remains compatible.

## Bridge restart recovery (desktop 0.4.1 — 2026-10-29)

The previous guard rejected stale extension-host conversation IDs correctly, but worktree pages offered no action to start a replacement conversation. Reproduced with a changed bridge identity: the new regression tests failed before the fix. Added **Start new conversation** to both chat and worktree pages. It keeps the selected worktree, model, draft and up to ten read-only prior transcripts while assigning a fresh ID and empty model context. A stale conversation now disables Send and explains the recovery action. Active requests/reviews must finish or be cancelled first. No replay or filesystem change is performed by reset.

`npm test`: **23 tests PASS**. The regression exercises the stale guard, replacement ID/context, draft/model/worktree retention, prior transcript access and a successful new agent turn over real IPC. A second test rejects reset during a pending edit review. The Electron UI check verifies reset within the same worktree, preserved draft, empty current transcript and visible prior transcript. Models remain scripted fixtures; this does not verify live agent tool calling. Desktop 0.4.1 remains compatible with bridge 0.4.0; no extension reinstall is needed for this fix.

Windows packaging and `npm run test:packaged`: **PASS**. Build: `artifacts/restart-recovery/PromptDeck-win32-x64/PromptDeck.exe`. The currently running older desktop must be closed before launching the new build. Closing the older app discards its in-memory transcripts; reset in the new build retains read-only history for subsequent bridge restarts during that desktop run.

## Projects and worktree agents (0.4.0)

Implemented multiple local repositories, existing-worktree discovery, current-branch default checkouts, new worktrees on new branches from current HEAD, persisted project selection, independent worktree agent conversations, and Open folder in VS Code. The agent uses documented VS Code model tool calling through the existing account. File edits require review and hash checks; there is no shell-command tool or automatic commit/push. Bridge 0.4.0 is required for agents.

`npm test`: **21 tests PASS**, including actual Git repositories and worktrees in disposable folders, two-project persistence/deduplication, unchanged dirty default checkout, local container exclusion, invalid/duplicate branches, file listing/read/search/replacement, three concurrent worktree agents over real authenticated IPC, approved edits isolated to each root, rejected edits, stale-file protection, cancellation/disconnection during review, duplicate-send protection, path traversal and symlink/junction rejection. Provider responses are scripted fixtures in these tests.

`npm run test:electron`: **PASS** in an actual Electron window. The test exercises adding two projects via a stubbed native directory picker, selecting the current branch, creating a real Git worktree through the name dialog, selecting the new worktree, the documented VS Code folder URI (OS launch intercepted), and applying a proposed agent edit. The new file is verified in that worktree and absent from the parent checkout. Existing chat/security/connection-properties checks still pass.

Bridge VSIX packaging and Windows x64 packaging: **PASS**. `npm run test:packaged`: **PASS**, running the same UI checks against the actual executable. Artifacts: `artifacts/projects-worktrees-final/PromptDeck-win32-x64/PromptDeck.exe`, `artifacts/promptdeck-bridge-0.4.0.vsix`, and `artifacts/electron-packaged-smoke.png`. Install the new VSIX, reload VS Code, and reconnect before using worktree agents. The packaged folder includes that VSIX in `resources`. Generated artifacts remain excluded from Git.

Live Copilot tool calling, real corporate model compatibility for agents, and the external VS Code folder-opening result remain **unverified** by these automated checks. Prior successful live chat evidence below does not verify agent behavior. The UI reports older bridges and actual model errors without fallback. The application does not extract credentials or alter corporate networking.

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
