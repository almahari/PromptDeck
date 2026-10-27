using System.IO;
using GitHub.Copilot;
using GitHub.Copilot.Rpc;

namespace PromptDeck;

public sealed class CopilotService(Diagnostics log) : IAsyncDisposable
{
    private CopilotClient? client;
    private readonly SemaphoreSlim initialization = new(1, 1);
    public IReadOnlyList<ModelInfo> Models { get; private set; } = [];

    public async Task InitializeAsync(CancellationToken ct)
    {
        await initialization.WaitAsync(ct);
        try
        {
            if (client != null) { await client.PingAsync(cancellationToken: ct); return; }
            log.Write("1. SDK initialization: starting GitHub.Copilot.SDK 1.0.27, bundled stdio runtime; logged-in-user auth enabled.");
            client = new CopilotClient(new CopilotClientOptions
            {
                Connection = RuntimeConnection.ForStdio(), UseLoggedInUser = true,
                // Keep the official desktop credential/keychain behavior and COPILOT_HOME resolution.
                Mode = CopilotClientMode.CopilotCli
            });
            try { await client.StartAsync(ct); }
            catch { await client.DisposeAsync(); client = null; throw; }
            log.Write("1. SDK initialization: PASS (runtime connected).");
        }
        finally { initialization.Release(); }
    }

    public async Task CheckAuthenticationAsync(CancellationToken ct)
    {
        var auth = await Client.GetAuthStatusAsync(ct);
        log.Write($"2. Authentication: authenticated={auth.IsAuthenticated}; method={auth.AuthType}; account={auth.Login}; status={auth.StatusMessage}");
        if (!auth.IsAuthenticated) throw new InvalidOperationException("Authentication required. Open Official Login, enter /login, then run Test Connection again.");
        if (auth.AuthType is "api-key" or "hmac") throw new InvalidOperationException("Unexpected authentication type for this GitHub user-account prototype: " + auth.AuthType);
        log.Write("2. Authentication: PASS. Copilot entitlement and organization/model authorization remain unverified until inference succeeds.");
    }

    public async Task DiscoverModelsAsync(CancellationToken ct)
    {
        Models = (await Client.ListModelsAsync(ct)).Where(m => !string.IsNullOrWhiteSpace(m.Id)).ToList();
        if (Models.Count == 0) throw new InvalidOperationException("Model discovery returned no available models. Account entitlement, policy, or SDK support may be responsible; cause undetermined.");
        log.Write($"3. Model discovery: PASS ({Models.Count} models). " + string.Join(", ", Models.Select(m => $"{m.Name} [{m.Id}]")));
    }

    public async Task<CopilotSession> CreateSessionAsync(string id, string model, CancellationToken ct)
    {
        if (!Models.Any(m => m.Id == model)) throw new InvalidOperationException("Requested model unavailable in the discovered model list: " + model);
        var session = await Client.CreateSessionAsync(new SessionConfig
        {
            SessionId = id, Model = model, AvailableTools = [],
            EnableSessionStore = false, Memory = new MemoryConfiguration { Enabled = false },
            EnableSkills = false, EnableFileHooks = false, EnableHostGitOperations = false,
            EnableConfigDiscovery = false, SkipCustomInstructions = true,
            // 1.0.27 exposes the callback decision through its experimental typed RPC surface.
#pragma warning disable GHCP001
            OnPermissionRequest = (_, _) => Task.FromResult(PermissionDecision.Reject("This prototype supports chat only."))
#pragma warning restore GHCP001
        }, ct);
        log.Write($"Session creation: PASS id={session.SessionId}; model={model}; no tools exposed.");
        return session;
    }

    public async Task<string> SendAsync(CopilotSession session, string prompt, CancellationToken ct)
    {
        log.Write($"Request: started id={session.SessionId} (content omitted).");
        try
        {
            var result = await session.SendAndWaitAsync(new MessageOptions { Prompt = prompt }, TimeSpan.FromSeconds(120), ct);
            var content = result?.Data.Content;
            if (string.IsNullOrWhiteSpace(content)) throw new InvalidOperationException("SDK returned no assistant response.");
            log.Write($"Response: completed id={session.SessionId}; {content.Length} characters (content omitted).");
            return content;
        }
        catch
        {
            // Cancellation of the wait does not guarantee cancellation of remote work.
            try { using var abort = new CancellationTokenSource(TimeSpan.FromSeconds(5)); await session.AbortAsync(abort.Token); log.Write($"Request abort acknowledged id={session.SessionId}."); }
            catch (Exception ex) { log.Failure("Request abort (remote state may be uncertain)", ex); }
            throw;
        }
    }

    public async Task<bool> TestConnectionAsync(string? requestedModel, CancellationToken ct)
    {
        string[] steps = ["SDK initialization", "Authentication", "Model discovery", "Temporary session creation", "Inference request", "Response verification"];
        var current = 0;
        CopilotSession? temporary = null;
        try
        {
            log.Write("Connection test: BEGIN. Inference uses your Copilot allowance.");
            await InitializeAsync(ct); log.Write("1. SDK initialization: PASS.");
            current = 1; await CheckAuthenticationAsync(ct);
            current = 2; await DiscoverModelsAsync(ct);
            current = 3;
            var model = requestedModel ?? Models[0].Id;
            log.Write($"4. Temporary session: using model {model}.");
            temporary = await CreateSessionAsync("promptdeck-test-" + Guid.NewGuid().ToString("N"), model, ct);
            log.Write("4. Temporary session creation: PASS.");
            current = 4;
            var response = await SendAsync(temporary, "Reply with exactly: Connection successful", ct);
            log.Write("5. Inference request: PASS. Entitlement and access for this model verified at this time.");
            current = 5;
            log.Write("6. Test response: " + response);
            if (response.Trim() != "Connection successful") throw new InvalidOperationException("Response received but exact-response check failed.");
            log.Write("6. Response verification: PASS. Connection test SUCCESS.");
            return true;
        }
        catch (Exception ex)
        {
            log.Failure($"{current + 1}. {steps[current]}", ex);
            for (var i = current + 1; i < steps.Length; i++) log.Write($"{i + 1}. {steps[i]}: SKIPPED (previous step failed).");
            return false;
        }
        finally
        {
            if (temporary != null)
            {
                try
                {
                    var id = temporary.SessionId;
                    await temporary.DisposeAsync();
                    using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                    await Client.DeleteSessionAsync(id, cleanup.Token);
                    log.Write("7. Temporary session cleanup: PASS.");
                }
                catch (Exception ex) { log.Failure("7. Temporary session cleanup", ex); }
            }
            else log.Write("7. Temporary session cleanup: SKIPPED (no session created).");
        }
    }

    private CopilotClient Client => client ?? throw new InvalidOperationException("SDK has not been initialized.");
    public async ValueTask DisposeAsync() { if (client != null) await client.DisposeAsync(); }
}
