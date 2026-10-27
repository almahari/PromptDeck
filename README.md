# PromptDeck: Copilot multi-session proof of concept

A minimal Windows 10/11 WPF application targeting **.NET 8**, using the official **GitHub.Copilot.SDK 1.0.27** NuGet package. It tests whether your authorized GitHub account can use Copilot outside VS Code. No OpenAI key, alternate provider, token extraction, browser automation, or network interception is implemented.

## Current result

The Release build and local Windows startup/session-state smoke test pass. The SDK runtime starts and detects supported existing GitHub CLI authentication for `almahari` (`gh-cli`). **Model discovery returns an empty list.** No model is hardcoded to get around this, so inference, entitlement, remote session creation, and concurrent requests have not been verified here. See [VERIFICATION.md](VERIFICATION.md) for the exact result and acceptance checklist. This does not establish that the detected account is the same corporate identity used in VS Code.

## Prerequisites

- Windows 10/11, .NET 8 SDK or a newer SDK that can build .NET 8, and the .NET 8 Windows Desktop runtime. Visual Studio 2022 with .NET desktop development is optional.
- An authorized GitHub Copilot account. Your organization's **Copilot CLI policy must permit access**; VS Code access alone is insufficient.
- Approved access to NuGet for restore and GitHub releases for the SDK runtime download. This package pins runtime **1.0.104**, downloaded and checksum-verified by its build targets. Preserve the entire output folder when moving the app.
- For fresh interactive login, the official **interactive Copilot CLI** on PATH. The bundled SDK runtime works without that installation for existing supported auth; the packaged runtime is not the interactive login UI. Install the CLI through your organization's approved software process. GitHub documents `winget install GitHub.Copilot`, or `npm install -g @github/copilot` with Node.js 22+.

## Build and run

From this repository in PowerShell:

```powershell
dotnet restore PromptDeck.sln
dotnet build PromptDeck.sln -c Release
dotnet run --project PromptDeck -c Release --no-build
```

Alternatively, launch `PromptDeck\bin\Release\net8.0-windows\PromptDeck.exe`. The SDK's native runtime files must remain alongside the application in their generated subdirectories. The current build was tested on Windows x64; ARM64 is unverified.

## Authentication and connection test

1. Click **Test Connection**. The app uses the SDK's `UseLoggedInUser = true`, default official credential resolution, and `GetAuthStatusAsync`. The diagnostic panel identifies the account and auth method without logging credentials.
2. If login is required, click **Official Login…**. A visible PowerShell terminal starts the official interactive `copilot` command. Enter `/login` and complete GitHub's official flow yourself. The app does not handle your password or OAuth token. If the interactive CLI is absent, the terminal displays installation guidance.
3. Close the interactive CLI, then test again. Restart PromptDeck if authentication changes are not reflected by the running runtime.
4. The test initializes the SDK, checks authentication, discovers models, creates a **unique temporary session**, sends `Reply with exactly: Connection successful`, displays the returned text, checks the response after trimming surrounding whitespace, and disposes/deletes that temporary session. Every stage reports PASS, FAIL, or SKIPPED separately.

Authentication status is **not an entitlement check**. A successful inference verifies access only for the account and model used at that time. A generic 403 or empty model list cannot reliably distinguish subscription, organization policy, model access, or SDK behavior; diagnostics explicitly retain that uncertainty. A connection test consumes Copilot allowance if it reaches inference.

Official ambient credentials can include supported token environment variables or GitHub CLI authentication, in addition to a Copilot CLI login. For example, an inherited `GH_TOKEN` may select a different identity from VS Code. Inspect the displayed auth method/account and use your approved login process. This app never reads VS Code credential storage or copies credentials. It supplies no explicit token and no custom model provider.

## Sessions

- Three local sessions appear at startup; **New Session** adds more. Each has a GUID-based ID, its own draft, transcript, model selection, cancellation token, and lazy-created SDK session.
- After model discovery, select a model from the SDK-provided names. The first returned model initializes new selections; there is no baked-in model list. The connection test uses the selected model, or the first discovered model on the initial test, and logs that choice.
- Send a message, switch sessions, and send another while the first is running. Only each individual session is serialized; there is no global request lock. Server limits and account policy may still restrict parallelism.
- **Cancel request** cancels that session's wait and attempts SDK `AbortAsync` with a separate five-second budget. Chat inference has a 120-second SDK timeout and a 150-second overall operation budget. Cancellation/timeout does not promise immediate remote termination.
- Changing models uses SDK `SetModelAsync` on the same session so its conversation remains intact. An unavailable selection requires an explicit new selection; failures do not switch providers or silently start a replacement conversation.
- Finish/cancel active chats before retesting the connection; chat sends wait until a running connection test finishes. Normal chat sessions can run concurrently with each other.
- Ctrl+Enter sends; Enter inserts a line break. Status text and a progress indicator show each session's activity.

Conversations are held in memory in the UI; there is no app-level restore feature. The official runtime may retain its own session data in its normal Copilot home. The app preserves SDK `CopilotClientMode.CopilotCli` credential/keychain behavior and inherits `COPILOT_HOME` if configured. Sessions have an explicit empty tool allowlist, no custom tools, and a rejecting permission handler. Cross-session store and persistent memory are explicitly disabled, along with skills, file hooks, host Git operations, and local configuration/instruction discovery. This is a chat prototype; tool execution is excluded. It does not change enterprise policy settings.

## Diagnostics and corporate networks

Diagnostics appear in the bottom panel and `%LOCALAPPDATA%\PromptDeck\logs\`. Each process creates a timestamped log. The panel keeps a bounded amount of text; the log contains all app diagnostic entries for that run. Normal prompts and responses are omitted from logs; the fixed connection-test response is included as required. SDK objects, HTTP headers, raw SDK debug traces, and exception data are not serialized. Known credential patterns and secret-valued environment variables are redacted from error messages. Logs include account names and session IDs; review them before sharing and manage retention locally.

The app inherits the runtime's supported network configuration. It does not disable certificate validation, change proxies, install certificates, or bypass corporate restrictions. Ask your IT team to confirm approved Copilot CLI/model access and proxy/certificate configuration if diagnostics indicate a network or policy problem.

If runtime acquisition is blocked, follow the official package's build options with an **approved** runtime or corporate mirror:

```powershell
# Copy an approved preinstalled runtime, instead of downloading it at build time:
dotnet build PromptDeck.sln -c Release -p:CopilotCliBinaryPath=C:\ApprovedTools\copilot.exe
```

The package also documents `CopilotCliReleaseBaseUrl` / `COPILOT_CLI_DOWNLOAD_BASE_URL` for an approved release mirror, and `CopilotSkipCliDownload=true` to omit acquisition (you must then provide a compatible runtime through the SDK-supported configuration). Do not point these at an untrusted binary or mirror. Restore/build errors occur before the app starts and are available in the build output; runtime launch errors appear in diagnostics.

When a runtime connection is lost, the request fails with its sanitized SDK error. Existing sessions are not automatically replaced or replayed. Restart the app to establish fresh sessions after restoring connectivity. Per-session transcripts indicate failures; no response is fabricated.

## Repeatable checks

```powershell
# Local window startup, clean shutdown, unique IDs, and separate local state; no Copilot requests:
dotnet run --project PromptDeck -c Release --no-build -- --smoke-test

# Same connection test/service as the UI, without opening the main window:
dotnet run --project PromptDeck -c Release --no-build -- --test-connection
$LASTEXITCODE
```

The checks write `smoke-test.txt` / `connection-test.txt` beside the executable. The connection check also writes the normal local log. Exit code 0 means the check passed; 1 means failure. Missing runtime/package failures before application startup are reported by Windows/.NET or build output.

To verify remote isolation and concurrency once model discovery works: choose models in three sessions; in each, send a different marker and ask it to remember the marker. Start the requests in quick succession. Ask each session for its marker and confirm the three SDK session IDs and replies remain independent. Also test cancel on one session while another completes, and change one session's model while preserving its context. These live checks remain pending in this environment.

## Official references and API compatibility

- [Official .NET SDK documentation and examples](https://github.com/github/copilot-sdk/blob/main/dotnet/README.md)
- [Official SDK authentication](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate)
- [Official Copilot CLI setup, login, and organization policy prerequisite](https://docs.github.com/en/copilot/get-started/cli-quickstart)
- [Pinned NuGet package](https://www.nuget.org/packages/GitHub.Copilot.SDK/1.0.27)

Implementation was checked against current official docs and the **installed 1.0.27 assembly/XML**, rather than assuming main-branch examples match the published binary. It uses `StartAsync`, `PingAsync`, `GetAuthStatusAsync`, `ListModelsAsync`, `CreateSessionAsync`, `SendAndWaitAsync`, `AbortAsync`, `SetModelAsync`, and `DeleteSessionAsync`. In this package, the typed rejecting permission decision is in `GitHub.Copilot.Rpc` and is marked experimental (`GHCP001`); its use has a narrowly scoped diagnostic suppression. No other experimental warnings are globally suppressed. SDK and bundled runtime upgrades require another build and live connection test.
