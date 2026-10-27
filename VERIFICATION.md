# Verification on 2026-10-27

Environment: Windows x64, .NET SDK 10.0.403 building `net8.0-windows`; .NET 8 Windows Desktop runtime installed. Official NuGet package `GitHub.Copilot.SDK 1.0.27`, bundled Windows runtime 1.0.104.

| Criterion | Result |
| --- | --- |
| Build solution | PASS, Release: zero warnings and zero errors |
| Windows app startup and clean shutdown | PASS, actual WPF window smoke test; process exit 0 |
| Three independent local sessions | PASS, unique IDs and separate draft/history/model state |
| SDK/runtime initialization | PASS, stdio connection established |
| Supported existing authentication detected | PASS, `gh-cli`, account `almahari` |
| Same identity as corporate VS Code account | UNVERIFIED; compare displayed account with your corporate identity |
| Official fresh interactive login | IMPLEMENTED via official CLI `/login`; unverified here; interactive CLI not found on PATH |
| Retrieve usable models | FAILED: SDK returned an empty list |
| Account entitlement / organization authorization | UNVERIFIED; auth status alone is insufficient |
| Create temporary or chat SDK sessions | SKIPPED because no models were discovered |
| Send prompt / receive response | SKIPPED because no models were discovered |
| Three independent remote conversations | UNVERIFIED |
| Concurrent inference | IMPLEMENTED with separate session tasks; UNVERIFIED live |
| Cancellation, timeouts, model switching, network/policy failure paths | IMPLEMENTED; not induced/verified live |

Exact relevant connection-test diagnostics:

```text
1. SDK initialization: PASS (runtime connected).
2. Authentication: authenticated=True; method=gh-cli; account=almahari; status=almahari (via gh)
2. Authentication: PASS. Copilot entitlement and organization/model authorization remain unverified until inference succeeds.
3. Model discovery: FAIL [Model discovery unavailable; cause undetermined] InvalidOperationException: Model discovery returned no available models. Account entitlement, policy, or SDK support may be responsible; cause undetermined.
4. Temporary session creation: SKIPPED (previous step failed).
5. Inference request: SKIPPED (previous step failed).
6. Response verification: SKIPPED (previous step failed).
7. Temporary session cleanup: SKIPPED (no session created).
```

The SDK returned no explicit entitlement, policy, model-denial, HTTP, or proxy error in this run. There is insufficient evidence to assign the empty list to authentication, corporate network controls, entitlement, policy, or SDK/runtime compatibility. Package compatibility and process startup were verified; end-to-end inference compatibility was not. No credentials were extracted and no provider fallback, arbitrary model ID, or restriction workaround was attempted.

Next verification: use Official Login to authenticate the intended corporate account through the approved CLI, restart the app, and rerun Test Connection. If the empty result persists, provide the sanitized diagnostics and pinned versions to the organization administrator or SDK maintainers. Successful VS Code inference by itself does not establish CLI/SDK access.
