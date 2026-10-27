using System.IO;
using System.Windows;
namespace PromptDeck;
public partial class App : Application
{
    private async void Application_Startup(object sender, StartupEventArgs e)
    {
        if (e.Args.Contains("--smoke-test"))
        {
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            var window = new MainWindow();
            var passed = false;
            try
            {
                window.Show();
                await Dispatcher.InvokeAsync(() => { }, System.Windows.Threading.DispatcherPriority.ApplicationIdle);
                if (!window.IsLoaded || window.Sessions.Count != 3 || window.Sessions.Select(s => s.Id).Distinct().Count() != 3)
                    throw new InvalidOperationException("Window startup or unique session check failed.");
                window.Sessions[0].Input = "session-one-input";
                window.Sessions[0].Transcript = "session-one-history";
                window.Sessions[0].SelectedModel = "local-test-model";
                if (window.Sessions.Skip(1).Any(s => s.Input != "" || s.Transcript != "" || s.SelectedModel != null))
                    throw new InvalidOperationException("Session state isolation failed.");
                passed = true;
                await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, "smoke-test.txt"),
                    "PASS: WPF window loaded; three unique session IDs; input, history, and model state isolated. No Copilot requests made.");
            }
            catch (Exception ex)
            {
                await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, "smoke-test.txt"), Diagnostics.Redact(ex.Message));
            }
            finally
            {
                var finished = new TaskCompletionSource();
                window.Closed += (_, _) => finished.TrySetResult();
                window.Close(); await finished.Task;
                Shutdown(passed ? 0 : 1);
            }
            return;
        }
        if (!e.Args.Contains("--test-connection")) { new MainWindow().Show(); return; }
        ShutdownMode = ShutdownMode.OnExplicitShutdown;
        var log = new Diagnostics(); var report = new List<string>();
        log.Written += line => report.Add(line);
        var success = false;
        try
        {
            await using var service = new CopilotService(log);
            using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(4));
            success = await service.TestConnectionAsync(null, timeout.Token);
        }
        catch (Exception ex) { log.Failure("SDK startup/shutdown", ex); success = false; }
        try { await File.WriteAllLinesAsync(Path.Combine(AppContext.BaseDirectory, "connection-test.txt"), report); }
        catch (Exception ex) { log.Failure("Report write (use local log)", ex); }
        Shutdown(success ? 0 : 1);
    }
}
