using System.IO;
using System.Text.RegularExpressions;

namespace PromptDeck;

public sealed class Diagnostics
{
    private readonly object gate = new();
    public event Action<string>? Written;
    public string LogPath { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PromptDeck", "logs", $"{DateTime.Now:yyyyMMdd-HHmmss}-{Environment.ProcessId}.log");

    public static string Redact(string text)
    {
        // Never serialize SDK objects, HTTP headers, environment, or exception.Data.
        foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            if (Regex.IsMatch(entry.Key.ToString()!, "token|secret|password|cookie|api.?key", RegexOptions.IgnoreCase)
                && entry.Value is string value && value.Length >= 4)
                text = text.Replace(value, "[REDACTED]", StringComparison.Ordinal);
        }
        text = Regex.Replace(text, @"\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b", "[REDACTED]");
        text = Regex.Replace(text, @"(?im)\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=][^\r\n]*", "$1: [REDACTED]");
        text = Regex.Replace(text, @"(?i)\b(access[_-]?token|refresh[_-]?token|password|secret|api[_-]?key)\b[""']?\s*[:=]\s*[""']?[^\s,""'}]+", "$1=[REDACTED]");
        text = Regex.Replace(text, @"(?i)(https?://)[^/\s@]+@", "$1[REDACTED]@");
        text = Regex.Replace(text, @"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b", "[REDACTED]");
        return text;
    }

    public void Write(string message)
    {
        var line = $"{DateTimeOffset.Now:HH:mm:ss zzz} {Redact(message)}";
        lock (gate)
        {
            try { Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!); File.AppendAllText(LogPath, line + Environment.NewLine); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { line += " [Local log unavailable; diagnostics remain visible in the app.]"; }
        }
        Written?.Invoke(line);
    }

    public string Failure(string step, Exception ex)
    {
        var detail = Redact(string.Join(" -> ", Chain(ex).Select(e => $"{e.GetType().Name}: {e.Message}")));
        var lower = detail.ToLowerInvariant();
        var category = ex is OperationCanceledException ? "Cancelled or timed out"
            : lower.Contains("model discovery returned no available models") ? "Model discovery unavailable; cause undetermined"
            : lower.Contains("407") || lower.Contains("proxy") ? "Proxy/network"
            : lower.Contains("policy") || lower.Contains("organization") || lower.Contains("enterprise") ? "Organization policy (reported)"
            : lower.Contains("entitlement") || lower.Contains("subscription") || lower.Contains("license") ? "Copilot entitlement (reported)"
            : lower.Contains("401") || lower.Contains("unauth") || lower.Contains("login") || lower.Contains("authentication") ? "Authentication"
            : lower.Contains("model") && (lower.Contains("denied") || lower.Contains("not found") || lower.Contains("unavailable")) ? "Model access"
            : lower.Contains("403") || lower.Contains("forbidden") ? "Authorization denied; entitlement/policy/model cause undetermined"
            : ex is TimeoutException ? "Timeout"
            : lower.Contains("certificate") || lower.Contains("tls") || lower.Contains("socket") || lower.Contains("network") || lower.Contains("connection") || lower.Contains("dns") ? "Connectivity/runtime connection"
            : ex is FileNotFoundException or DllNotFoundException || lower.Contains("executable") ? "SDK/CLI runtime unavailable"
            : "SDK/runtime failure; cause undetermined";
        var result = $"{step}: FAIL [{category}] {detail}";
        Write(result);
        return Redact(result);
    }

    private static IEnumerable<Exception> Chain(Exception ex)
    { for (Exception? current = ex; current != null; current = current.InnerException) yield return current; }
}
