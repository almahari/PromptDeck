using System.ComponentModel;
using System.Runtime.CompilerServices;
using GitHub.Copilot;
namespace PromptDeck;
public sealed class ChatSession : INotifyPropertyChanged
{
    public string Id { get; } = "promptdeck-" + Guid.NewGuid().ToString("N");
    public required string Title { get; init; }
    public CopilotSession? Remote { get; set; }
    public string? RemoteModel { get; set; }
    public CancellationTokenSource? Cancellation { get; set; }
    private string? model;
    public string? SelectedModel { get => model; set { model = value; Changed(); } }
    private string input = "";
    public string Input { get => input; set { input = value; Changed(); } }
    private string transcript = "";
    public string Transcript { get => transcript; set { transcript = value; Changed(); } }
    private string status = "Ready";
    public string Status { get => status; set { status = value; Changed(); } }
    private bool busy;
    public bool IsBusy { get => busy; set { busy = value; Changed(); Changed(nameof(IsIdle)); } }
    public bool IsIdle => !IsBusy;
    public event PropertyChangedEventHandler? PropertyChanged;
    private void Changed([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new(name));
}
