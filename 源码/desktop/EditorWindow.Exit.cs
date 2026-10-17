using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Quangai;

internal sealed partial class EditorWindow
{
    private bool _exitPending;
    private string? _exitRequestId;
    private TaskCompletionSource<bool>? _exitApproval;

    private async void SaveDraftBeforeClosingAsync(object? sender, FormClosingEventArgs e)
    {
        if (_projectSaving) { e.Cancel = true; return; }
        if (_closingAfterSave || _webView.CoreWebView2 is null) return;
        e.Cancel = true;
        if (_exitPending) return;
        _exitPending = true;
        try
        {
            var core = _webView.CoreWebView2;
            if (!await ConfirmProjectExitAsync(core)) return;
            await core.ExecuteScriptAsync("window.quangaiDesktop.requestSave()");
            await WaitForScriptAsync(core, "document.documentElement.dataset.draftFlushed === 'true'");
            _closingAfterSave = true;
            Close();
        }
        catch (Exception error)
        {
            MessageBox.Show(this, "退出前的保存检查未完成，程序仍保持打开。请保存项目后重试。\n\n" + error.Message,
                "尚未退出", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally { _exitPending = false; }
    }

    private async Task<bool> ConfirmProjectExitAsync(CoreWebView2 core)
    {
        _exitRequestId = Guid.NewGuid().ToString("D");
        _exitApproval = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            var accepted = await core.ExecuteScriptAsync($"window.quangaiDesktop?.requestClose('{_exitRequestId}') === true");
            if (accepted != "true") throw new InvalidOperationException("界面尚未准备好处理退出，请稍后重试。");
            // The user may keep the save question or native file picker open indefinitely.
            return await _exitApproval.Task;
        }
        finally
        {
            _exitRequestId = null;
            _exitApproval = null;
        }
    }

    private void HandleExitResponse(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!args.Source.StartsWith(LocalOrigin + "/", StringComparison.OrdinalIgnoreCase) || _exitApproval is null) return;
        try
        {
            using var message = JsonDocument.Parse(args.WebMessageAsJson);
            var response = message.RootElement;
            if (!response.TryGetProperty("type", out var type) || type.GetString() != "window-close-response") return;
            if (!response.TryGetProperty("requestId", out var requestId) || requestId.GetString() != _exitRequestId) return;
            _exitApproval.TrySetResult(response.TryGetProperty("approved", out var approved) && approved.ValueKind == JsonValueKind.True);
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException)
        {
            Trace.WriteLine($"Exit response was invalid: {error.Message}");
        }
    }
}
