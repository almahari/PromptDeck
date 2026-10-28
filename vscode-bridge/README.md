# PromptDeck VS Code Bridge

Companion extension for the local Windows PromptDeck proof of concept. It calls the documented VS Code Language Model API with `vendor: 'copilot'`, using the account already signed in to this VS Code instance. It never obtains an access token or starts a GitHub/CLI login.

1. Open PromptDeck on the same Windows user account.
2. In the VS Code profile where Copilot already works, run **PromptDeck: Connect Desktop** from the Command Palette.
3. Approve VS Code's normal request to let this extension use Copilot models, if prompted.
4. In PromptDeck, run **Test Connection**, choose a discovered model, and chat.

The desktop **Connect VS Code** button can also open the extension's connection URI. If that opens the wrong VS Code profile, use the Command Palette in the intended existing profile instead. Keep VS Code open. If there is no existing GitHub account in the profile, the bridge refuses to create a new login.

Bridge **0.4.0** connects to the Electron version of PromptDeck. Reload VS Code after upgrading. The desktop writes a random pipe path and local connection capability to `%LOCALAPPDATA%\PromptDeck\bridge-endpoint.json`; the extension validates that it is a local PromptDeck named pipe and authenticates its handshake. The endpoint file is app-generated, contains no GitHub credential, and is protected by the normal Windows user-profile ACLs. The capability is never sent to the renderer or logs. There is no HTTP listener, direct GitHub endpoint client, credential export, or provider fallback. Processes running as the same user remain within the prototype's trust boundary. VS Code retains its normal consent and policy enforcement.

The desktop's **Connection properties** panel requests a read-only snapshot of documented VS Code proxy/TLS configuration, allowlisted proxy environment variables, existing account labels, editor/extension versions, and model metadata. Proxy URLs are reduced to origins before leaving VS Code. No account ID/token, authentication session, proxy-authorization value, cookie, credential store, certificate contents, or environment dump is requested. The actual model-service URL, selected Copilot account, and resolved proxy/PAC route are not exposed by the Language Model API and are explicitly marked unavailable. These settings are configuration evidence, not a traffic trace; refreshes do not change the connection.

Each local conversation has separate in-memory history and a selected model. Requests in different conversations can overlap. Cancelling a request signals its VS Code cancellation token; incomplete responses are not added to history. Conversations are cleared when the extension is stopped/reloaded. After a reload, the desktop requires a new conversation instead of silently replacing context. Chat content is not written to the extension output log.

**PromptDeck: Disconnect Desktop** stops the connection and clears the extension's in-memory conversations. The PromptDeck Bridge output channel shows connection metadata and local connection errors. Check model/provider errors in the desktop diagnostics and Copilot's own VS Code UI; permission failures are not bypassed.

Development checks: `npm ci`, `npm test`. Package locally with `npm run package` and install the resulting VSIX through **Extensions: Install from VSIX** or `code --install-extension <file.vsix>`. The packaged extension has no third-party runtime dependencies. Installation and usage must be allowed by your organization's extension policies.

Official API reference: https://code.visualstudio.com/api/extension-guides/ai/language-model

Worktree agent conversations use the public Language Model API tool-calling stream and PromptDeck private file tools. Tool calls are routed back to the authenticated desktop request; the desktop resolves the selected worktree and reviews each write. The extension never accepts arbitrary shell commands or filesystem roots from the model. This is a PromptDeck agent loop, not automation of VS Code built-in Agent chat. Models must support tool calling; errors surface without provider fallback. See the root README for workspace tools, file limits, cancellation, and Git workflow.
