# PromptDeck

Desktop **0.4.2** adds per-session access controls. The latest local Windows build is `artifacts/session-access/PromptDeck-win32-x64/PromptDeck.exe`. Close the older desktop build before opening it; desktop conversations are held in memory. Bridge **0.4.0** remains compatible.

A minimal **Node.js + Electron** desktop app for Windows that uses the Copilot account **already signed in to VS Code**. Add multiple local repositories, create Git worktrees, and ask an agent to implement features in a selected worktree. Independent conversations, model selection, concurrent requests, cancellation, and connection diagnostics are included.

The companion extension calls VS Code's documented Language Model API. GitHub credentials stay in VS Code. PromptDeck does not start a GitHub/CLI login, require an OpenAI key, copy tokens, or fall back to another provider. This replaces the earlier C#/.NET implementation; .NET and the standalone Copilot SDK are no longer required.

## Run from source

Requirements: Windows 10/11, Node.js **22+**, npm, Git for Windows on PATH, and VS Code with Copilot already working in the intended profile. Your organization must permit the companion extension and its normal model-access consent.

```powershell
npm ci
npm --prefix vscode-bridge ci
npm run package:bridge
code --install-extension artifacts/promptdeck-bridge-0.4.0.vsix
npm start
```

Reload the VS Code window after installing bridge **0.4.0**, then reconnect to enable worktree agents. The Electron local IPC protocol remains version 2; older bridges can still chat but do not support worktree agents. Close the old WPF window to avoid confusing the two applications; its source and dependencies are removed from this repository.

## Connect the existing VS Code account

1. Start PromptDeck.
2. In the **VS Code profile where Copilot already works**, open the Command Palette and run **PromptDeck: Connect Desktop**.
3. Allow VS Code's normal request to let this extension use its language models, if prompted. This is model-access consent, not another GitHub login.
4. In PromptDeck, click **Test Connection**, select a discovered model, and chat.

**Connect VS Code** opens the extension's connection URI. If that opens the wrong profile, use the Command Palette in the intended profile instead. Keep VS Code open. The extension checks existing account metadata and refuses to create an authentication session if there is no signed-in GitHub account.

The app reuses VS Code's **account/model access**, not the contents of an existing editor chat. PromptDeck conversations are separate and held in memory. The desktop does not invoke `authentication.getSession`, access token properties, private GitHub endpoints, or the Copilot CLI.

## Projects, worktrees, and agents

1. Click **+ Add** beside Projects and select one or more local Git repository folders. Existing worktrees appear under each project. Selecting another checkout of the same repository does not add a duplicate project.
2. The selected repository's current checkout is the default worktree, labelled with its actual branch name. No branch switch is performed. Detached HEAD checkouts show their commit instead.
3. Click **+** beside a project and enter a new branch name, such as `feature/my-feature`. Git creates that branch from the project's current committed HEAD at `<project>/.promptdeck/worktrees/<branch-slug>-<hash>/`. Uncommitted changes stay in the current checkout. The container is excluded through local Git `info/exclude`; tracked `.gitignore` is unchanged. Existing branches and invalid names produce errors; nothing is forced or deleted. An initial commit is required to create another worktree.
4. Select a worktree, choose a model, and describe the feature. Each worktree has a separate agent conversation, draft, ID, and model. Different worktrees can run concurrently, subject to provider limits.
5. Sessions default to **Review every edit**. Review each proposed edit in **Current file / Proposed file**, then **Apply edit** or **Reject edit**. To stop repeated prompts, choose **Full access — apply file edits automatically** under **Session access**, or **Allow all edits for this session** in the review dialog. The latter applies the pending edit too. This permission covers only that conversation's selected worktree; other sessions remain independent. Switch back to review at any time to require approval for subsequent edits. New conversations and app restarts default to review. Hash/path checks and file exclusions still apply in Full access mode. Applied edits remain for normal Git review. Cancel dismisses pending reviews; it does not roll back edits already applied.
6. **Open folder in VS Code** opens the selected worktree. **Refresh worktrees** updates branches and worktrees created outside the app.

This is PromptDeck's own small agent loop over the [public VS Code tool-calling API](https://code.visualstudio.com/api/extension-guides/ai/tools), using the same existing Copilot model access. It does not control VS Code's built-in Agent chat. Tools can list files, search text, read UTF-8 files, and write files according to the session access setting. Full access covers these file tools; it does not add terminal commands or access to other folders. File paths are relative to the selected worktree. Parent traversal, symlink/junction traversal, Git metadata, `.promptdeck`, `node_modules`, `.env*`, and key/certificate extensions are excluded. File hashes are checked before writing to prevent overwriting an intervening edit. This prototype is not an OS sandbox against another local process racing filesystem changes.

There is no shell-command tool, automatic test execution, commit, push, file deletion, or merge action. Open the folder in VS Code to run project checks and manage Git. Models must support tool calling; unsupported model/provider errors are displayed without fallback. Agent operations time out after 10 minutes and are bounded to 12 model rounds / 24 tool calls per turn. Text-file tools support at most 100 KB per file, with bounded listing/search results and context. A failed turn may already have user-approved edits on disk; review them before retrying.

Selected project paths persist in `%LOCALAPPDATA%\PromptDeck\projects.json`. Restarting the app clears conversations; Git worktrees and applied changes remain on disk. After a bridge restart, click **Start new conversation** on the selected worktree page. This preserves the worktree, model and unsent draft, assigns a new conversation ID, and starts with empty remote context. Up to ten previous transcripts remain available under **Previous conversations (read only)** until the desktop app closes; they are never automatically sent to the model. Finish or cancel active requests before starting a new conversation. Existing file edits are unchanged. Worktree removal, branch merge, and conversation persistence across desktop restarts are outside this prototype.

Official references: [Git worktree](https://git-scm.com/docs/git-worktree), [VS Code folder URLs](https://code.visualstudio.com/docs/configure/command-line#_opening-vs-code-with-urls).

## Build the Windows executable

```powershell
npm ci
npm --prefix vscode-bridge ci
npm run package:bridge
npm run package:win
```

Launch `artifacts/electron/PromptDeck-win32-x64/PromptDeck.exe`. Keep the entire generated folder together. It includes Electron/Node and the companion VSIX in its `resources` directory; end users do not need .NET or a separate Node installation. Install that VSIX into the signed-in VS Code profile with **Extensions: Install from VSIX**. This is an unsigned local prototype, not an installer or Marketplace publication.

Close an older packaged app before rebuilding its output directory. If Windows still holds the old files open, choose a fresh folder with `node scripts/package.cjs --out=artifacts/projects-worktrees-final`. The current 0.4.0 verification build is in `artifacts/projects-worktrees-final/PromptDeck-win32-x64/`.

The app uses Electron **45.1.0** and Node's built-in modules. Its renderer is sandboxed with context isolation, no Node integration, a restrictive Content Security Policy, and a small validated preload API. Model output is rendered as plain text rather than executable HTML. Only bundled local UI files are loaded.

## Sessions and cancellation

- Three sessions appear at startup. **New** adds another; each has its own ID, draft, transcript, selected model, and extension-side history.
- Switch sessions while responses are running; different conversations can overlap. One request at a time is allowed within each session. Provider limits still apply.
- **Ctrl+Enter** sends; Enter inserts a newline. **Cancel request** signals only that request's VS Code cancellation token. Requests have a 120-second operation timeout. Provider completion/cancellation can take longer, particularly if a consent prompt is pending.
- A model change retains that session's context. If a model disappears, the app asks for an explicit selection rather than falling back.
- Disconnections fail pending work without replaying it. Reloading/stopping the VS Code extension clears its in-memory histories; old desktop conversation handles are rejected. Create a new session after a bridge restart.
- **PromptDeck: Disconnect Desktop** in VS Code cancels work and disconnects. Closing the Electron app removes its registered local endpoint and discards desktop history. No app-level conversation restore is implemented.
- Prototype limits: 100 conversations, 100,000 characters per prompt, and bounded conversation/response/message sizes. General chat sessions do not have file tools. Attachments are not exposed.

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

## VSIX packaging on a fresh checkout

`npm run package:bridge` creates the ignored `artifacts` directory automatically before running the VSIX packager. If an older checkout fails with `ENOENT ... artifacts\promptdeck-bridge-0.4.0.vsix`, run `git pull` and retry. As an immediate workaround from the repository root, run `New-Item -ItemType Directory -Force artifacts`, then `npm run package:bridge`. This is a local output-folder issue, unrelated to GitHub authentication, corporate proxy access, or Copilot entitlement.

## Local connection error after an upgrade

If the desktop is open but VS Code reports **PromptDeck local connection failed** with `ENOENT`, check the bridge version in VS Code's Extensions view. Bridge **0.1.0** looks for the retired WPF pipe and cannot connect to Electron's protocol-2 endpoint. Install the bundled `promptdeck-bridge-0.4.0.vsix`, run **Developer: Reload Window** in that VS Code window (or use its Restart Extensions action), and then **PromptDeck: Connect Desktop**. Each already-open VS Code window may need reloading to stop using old extension code. This does not require a new GitHub login.

On 2026-10-28 this exact version mismatch was reproduced and resolved locally: the old pipe returned `ENOENT`, the current registered desktop pipe was reachable, and after updating/reloading the bridge, the existing VS Code account returned exactly `Connection successful` in the desktop test. Other `ENOENT` cases can indicate a stale endpoint or a closed app; restart PromptDeck and reconnect rather than changing authentication or proxy settings.
