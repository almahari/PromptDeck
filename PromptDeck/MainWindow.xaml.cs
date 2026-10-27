using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using GitHub.Copilot;
namespace PromptDeck;
public partial class MainWindow : Window
{
    public ObservableCollection<ChatSession> Sessions { get; } = [];
    public ObservableCollection<ModelInfo> Models { get; } = [];
    private readonly Diagnostics log = new();
    private readonly CopilotService service;
    private readonly CancellationTokenSource lifetime = new();
    private CancellationTokenSource? testCancellation;
    private readonly HashSet<Task> running = [];
    private bool closed, shuttingDown;
    public MainWindow()
    {
        InitializeComponent(); service = new(log); DataContext = this;
        log.Written += line => Dispatcher.InvokeAsync(() =>
        {
            if (DiagnosticsBox.Text.Length > 150_000) DiagnosticsBox.Clear();
            DiagnosticsBox.AppendText(line + Environment.NewLine); DiagnosticsBox.ScrollToEnd();
        });
        for (var i = 0; i < 3; i++) AddSession();
        SessionList.SelectedIndex = 0;
        log.Write("Application ready. No network request until Test Connection or Send. Log: " + log.LogPath);
    }
    private void AddSession()
    {
        var session = new ChatSession { Title = $"Session {Sessions.Count + 1}", SelectedModel = Models.FirstOrDefault()?.Id };
        Sessions.Add(session); SessionList.SelectedItem = session;
    }
    private void NewSession_Click(object sender, RoutedEventArgs e) => AddSession();
    private void SessionList_SelectionChanged(object sender, SelectionChangedEventArgs e) => ChatPanel.DataContext = SessionList.SelectedItem;
    private void RefreshModels()
    {
        var selections = Sessions.ToDictionary(s => s.Id, s => s.SelectedModel);
        Models.Clear(); foreach (var model in service.Models) Models.Add(model);
        foreach (var session in Sessions)
        {
            var previous = selections[session.Id];
            session.SelectedModel = previous == null ? Models.FirstOrDefault()?.Id : Models.Any(m => m.Id == previous) ? previous : null;
            if (previous != null && session.SelectedModel == null) session.Status = "Previously selected model is unavailable. Select another model explicitly.";
        }
    }
    private async void TestConnection_Click(object sender, RoutedEventArgs e)
    {
        if (Sessions.Any(s => s.IsBusy)) { log.Write("Connection test: finish or cancel active chats before retesting."); return; }
        TestButton.IsEnabled = false; CancelTestButton.IsEnabled = true;
        testCancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        testCancellation.CancelAfter(TimeSpan.FromMinutes(4)); ConnectionStatus.Text = "Testing…";
        var task = service.TestConnectionAsync((SessionList.SelectedItem as ChatSession)?.SelectedModel, testCancellation.Token);
        running.Add(task);
        try { var passed = await task; RefreshModels(); ConnectionStatus.Text = passed ? "Connected — inference verified" : "Test failed — see diagnostics"; }
        catch (Exception ex) { log.Failure("Connection test", ex); ConnectionStatus.Text = "Test failed — see diagnostics"; }
        finally { running.Remove(task); testCancellation.Dispose(); testCancellation = null; TestButton.IsEnabled = true; CancelTestButton.IsEnabled = false; }
    }
    private void CancelTest_Click(object sender, RoutedEventArgs e) => testCancellation?.Cancel();
    private async void Send_Click(object sender, RoutedEventArgs e) => await SendSelectedAsync();
    private async void MessageInput_KeyDown(object sender, KeyEventArgs e)
    { if (e.Key == Key.Enter && Keyboard.Modifiers == ModifierKeys.Control) { e.Handled = true; await SendSelectedAsync(); } }
    private async Task SendSelectedAsync()
    {
        if (shuttingDown || SessionList.SelectedItem is not ChatSession session || session.IsBusy) return;
        if (testCancellation != null) { session.Status = "Wait for the connection test to finish."; return; }
        if (string.IsNullOrWhiteSpace(session.Input)) { session.Status = "Enter a message first."; return; }
        if (session.SelectedModel == null) { session.Status = "Run Test Connection to discover models first."; return; }
        var task = SendSessionAsync(session); running.Add(task);
        try { await task; } finally { running.Remove(task); }
    }
    private async Task SendSessionAsync(ChatSession session)
    {
        session.IsBusy = true; session.Status = "Sending…";
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        cancellation.CancelAfter(TimeSpan.FromSeconds(150)); session.Cancellation = cancellation;
        var prompt = session.Input; session.Input = ""; session.Transcript += $"You\n{prompt}\n\n";
        try
        {
            await service.InitializeAsync(cancellation.Token);
            if (session.Remote == null)
            {
                session.Remote = await service.CreateSessionAsync(session.Id, session.SelectedModel!, cancellation.Token);
                session.RemoteModel = session.SelectedModel;
            }
            else if (session.RemoteModel != session.SelectedModel)
            {
                await session.Remote.SetModelAsync(session.SelectedModel!, cancellation.Token);
                session.RemoteModel = session.SelectedModel;
                log.Write($"Model change: PASS id={session.Id}; model={session.RemoteModel}; context retained.");
            }
            var response = await service.SendAsync(session.Remote, prompt, cancellation.Token);
            session.Transcript += $"Copilot ({session.RemoteModel})\n{response}\n\n"; session.Status = "Response received";
        }
        catch (Exception ex)
        {
            var error = log.Failure($"Session {session.Id} request", ex);
            session.Status = ex is OperationCanceledException ? "Request cancelled or timed out; remote abort attempted." : "Request failed — see diagnostics";
            session.Transcript += error + "\n\n";
            ConnectionStatus.Text = "Last request failed — see diagnostics; Test Connection to recheck";
        }
        finally { session.Cancellation = null; session.IsBusy = false; }
    }
    private void CancelRequest_Click(object sender, RoutedEventArgs e) => (SessionList.SelectedItem as ChatSession)?.Cancellation?.Cancel();
    private void Conversation_TextChanged(object sender, TextChangedEventArgs e) => ((TextBox)sender).ScrollToEnd();
    private void Login_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var start = new ProcessStartInfo("powershell.exe") { UseShellExecute = true };
            start.ArgumentList.Add("-NoProfile"); start.ArgumentList.Add("-NoExit"); start.ArgumentList.Add("-Command");
            start.ArgumentList.Add("if (Get-Command copilot -ErrorAction SilentlyContinue) { Write-Host 'Enter /login in the official Copilot CLI, then close it and return to Test Connection.'; copilot } else { Write-Host 'Official interactive Copilot CLI not found on PATH. Install using your approved software process (winget install GitHub.Copilot), then reopen this app.' }");
            Process.Start(start);
            log.Write("Official login: opened visible terminal for Copilot CLI /login. Login completion is checked by Test Connection.");
        }
        catch (Exception ex) { log.Failure("Official login launch", ex); }
    }
    private async void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (closed) return;
        e.Cancel = true; if (shuttingDown) return;
        shuttingDown = true; IsEnabled = false; lifetime.Cancel();
        // Return from the first Closing event before issuing the final Close, even if cleanup completes synchronously.
        await Task.Yield();
        try { await Task.WhenAll(running.ToArray()).WaitAsync(TimeSpan.FromSeconds(20)); }
        catch (Exception ex) { log.Failure("Waiting for cancelled requests", ex); }
        try { await service.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(15)); }
        catch (Exception ex) { log.Failure("SDK shutdown", ex); }
        closed = true; Close();
    }
}
