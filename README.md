# PromptDeck

A minimal **Node.js + Electron** desktop app for Windows that uses the Copilot account **already signed in to VS Code**. Three independent conversations, per-session model selection, concurrent requests, cancellation, and a diagnostic connection test are included.

The companion extension calls VS Code's documented Language Model API. GitHub credentials stay in VS Code. PromptDeck does not start a GitHub/CLI login, require an OpenAI key, copy tokens, or fall back to another provider. This replaces the earlier C#/.NET implementation; .NET and the standalone Copilot SDK are no longer required.

## Run from source

Requirements: Windows 10/11, Node.js **22+**, npm, and VS Code with Copilot already working in the intended profile. Your organization must permit the companion extension and its normal model-access consent.

```powershell
npm ci
npm --prefix vscode-bridge ci
npm run package:bridge
code --install-extension artifacts/promptdeck-bridge-0.3.0.vsix
npm start
```

Reload the VS Code window after installing bridge **0.3.0** to enable connection-property snapshots. The Electron local IPC protocol remains version 2; older bridge versions can chat but cannot provide the new properties. Close the old WPF window to avoid confusing the two applications; its source and dependencies are removed from this repository.

## Connect the existing VS Code account

1. Start PromptDeck.
2. In the **VS Code profile where Copilot already works**, open the Command Palette and run **PromptDeck: Connect Desktop**.
3. Allow VS Code's normal request to let this extension use its language models, if prompted. This is model-access consent, not another GitHub login.
4. In PromptDeck, click **Test Connection**, select a discovered model, and chat.

**Connect VS Code** opens the extension's connection URI. If that opens the wrong profile, use the Command Palette in the intended profile instead. Keep VS Code open. The extension checks existing account metadata and refuses to create an authentication session if there is no signed-in GitHub account.

The app reuses VS Code's **account/model access**, not the contents of an existing editor chat. PromptDeck conversations are separate and held in memory. The desktop does not invoke `authentication.getSession`, access token properties, private GitHub endpoints, or the Copilot CLI.

## Build the Windows executable

```powershell
npm ci
npm --prefix vscode-bridge ci
npm run package:bridge
npm run package:win
```

Launch `artifacts/electron/PromptDeck-win32-x64/PromptDeck.exe`. Keep the entire generated folder together. It includes Electron/Node and the companion VSIX in its `resources` directory; end users do not need .NET or a separate Node installation. Install that VSIX into the signed-in VS Code profile with **Extensions: Install from VSIX**. This is an unsigned local prototype, not an installer or Marketplace publication.

Close an older packaged app before rebuilding its output directory. If Windows still holds the old files open, choose a fresh folder with `node scripts/package.cjs --out=artifacts/connection-properties`. The current 0.3.0 verification build is in `artifacts/connection-properties/PromptDeck-win32-x64/`.

The app uses Electron **45.1.0** and Node's built-in modules. Its renderer is sandboxed with context isolation, no Node integration, a restrictive Content Security Policy, and a small validated preload API. Model output is rendered as plain text rather than executable HTML. Only bundled local UI files are loaded.

## Sessions and cancellation

- Three sessions appear at startup. **New** adds another; each has its own ID, draft, transcript, selected model, and extension-side history.
- Switch sessions while responses are running; different conversations can overlap. One request at a time is allowed within each session. Provider limits still apply.
- **Ctrl+Enter** sends; Enter inserts a newline. **Cancel request** signals only that request's VS Code cancellation token. Requests have a 120-second operation timeout. Provider completion/cancellation can take longer, particularly if a consent prompt is pending.
- A model change retains that session's context. If a model disappears, the app asks for an explicit selection rather than falling back.
- Disconnections fail pending work without replaying it. Reloading/stopping the VS Code extension clears its in-memory histories; old desktop conversation handles are rejected. Create a new session after a bridge restart.
- **PromptDeck: Disconnect Desktop** in VS Code cancels work and disconnects. Closing the Electron app removes its registered local endpoint and discards desktop history. No app-level conversation restore is implemented.
- Prototype limits: 100 conversations, 100,000 characters per prompt, and bounded conversation/response/message sizes. Tools and attachments are not exposed.

## Connection test and diagnostics

**Connection properties** opens a read-only panel with **Refresh from VS Code**. It shows:

- VS Code's `http.proxy`, proxy mode, bypass list, TLS verification and certificate settings, including configuration source hints.
- Allowlisted proxy environment variables from the **VS Code bridge extension host**, not the Electron process. Proxy URLs show only scheme/host/port; userinfo, paths, query strings and fragments are stripped. Proxy authorization and credential stores are not read.
- Available signed-in GitHub account labels, GitHub provider base URL, and configured enterprise URL origins. **Available accounts are not proof of the account Copilot selected.**
- VS Code / Copilot / bridge versions, editor window session ID, extension-host PID, remote context, local pipe/bridge identifiers, and selected-model metadata.
- Snapshot time, last handshake, latest connection-test result and successful-response metadata. Disconnected editor snapshots are explicitly marked historical. These details are displayed in memory, not appended to the diagnostic log.

The public Language Model API does **not** expose the actual inference service URL, selected Copilot account, resolved proxy/PAC route, or request transport. The panel marks those fields unavailable rather than guessing or claiming that a successful test proves a particular network route. An unset proxy field does not mean a direct connection: system/PAC/provider behavior may still apply. No traffic interception or private Copilot API is used. Network settings are inspected only and never changed.

The test reports these stages separately: local bridge connection, VS Code model catalog access, model discovery, temporary conversation creation, inference, exact response verification, and cleanup. It sends `Reply with exactly: Connection successful`. Catalog access alone does not establish inference permission.

Diagnostics are displayed in the bottom panel and saved to `%LOCALAPPDATA%\PromptDeck\logs\`. **Open logs** opens that folder. VS Code has a **PromptDeck Bridge** output channel. Normal prompts/responses are omitted from logs; the fixed connection-test response is included. Credential patterns are redacted from errors. Log retention is manual.

The main process creates a **random Windows named pipe** and registers an endpoint under `%LOCALAPPDATA%\PromptDeck\bridge-endpoint.json`. That file contains a random local connection capability, **not a GitHub access token**. The companion extension reads it from the same user profile and authenticates its pipe handshake; the capability never reaches the renderer or diagnostic logs. The file relies on the normal Windows user-profile ACLs. Other processes running as the same user are within this prototype's trust boundary. There is no TCP/HTTP listener or network proxy.

VS Code continues to enforce account, extension-consent, model, quota, and organization policies. The app does not change proxy configuration, certificates, security settings, or provider identities. Generic errors are reported with the exposed code/message; ambiguous failures are not presented as a proven entitlement or policy diagnosis. A corporate environment may still deny the bridge extension or model usage.

## Verification

```powershell
npm test
npm run test:electron
npm run package:bridge
npm run package:win
npm run test:packaged
```

Tests use real local IPC and fake VS Code model responses, exercising independent concurrent histories, cancellation, timeouts, disconnection, IPC authentication, model switching, restart behavior, and sanitized connection-property refreshes. Metadata tests reject token/session/authorization reads and verify that proxy passwords and URL secrets cannot reach the desktop. Playwright also launches the actual Electron window and packaged Windows executable to verify UI behavior, renderer isolation, literal model-output rendering, and the properties panel. These checks do **not** prove live GitHub inference or a resolved network route. See [VERIFICATION.md](VERIFICATION.md) for exact results and remaining limits.

`PROMPTDECK_DATA_DIR` can select an isolated local app/profile directory for automated checks; the VS Code extension intentionally looks only in the normal user profile. No credential values are needed for tests. Generated executables, screenshots, logs, endpoint files, node_modules, and VSIX files are excluded from Git.

Official references: [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Electron preload scripts](https://www.electronjs.org/docs/latest/tutorial/tutorial-preload).
