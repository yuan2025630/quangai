using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Quangai;

internal sealed partial class EditorWindow
{
    private bool _projectSaving;

    private async void HandleProjectSaveAsync(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!args.Source.StartsWith(LocalOrigin + "/", StringComparison.OrdinalIgnoreCase)) return;
        string? requestId = null;
        var ownsRequest = false;
        string? responseType = null;
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            var request = document.RootElement;
            if (!request.TryGetProperty("type", out var type)) return;
            var operation = type.GetString();
            if (operation is not ("completed-project-save-request" or "project-save-request")) return;
            responseType = operation == "project-save-request" ? "project-save-response" : "completed-project-save-response";
            requestId = request.GetProperty("requestId").GetString();
            if (!Guid.TryParseExact(requestId, "D", out _)) return;
            if (_projectSaving) throw new InvalidOperationException("已有项目正在保存，请稍候。");
            _projectSaving = ownsRequest = true;
            var filename = request.GetProperty("filename").GetString() ?? throw new InvalidDataException("文件名无效。");
            if (filename != Path.GetFileName(filename) || filename.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
                || !filename.EndsWith(".quangai.json", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("项目文件名无效。");
            var projectJson = request.GetProperty("projectJson").GetString() ?? throw new InvalidDataException("项目数据为空。");
            if (operation == "completed-project-save-request") ProjectFile.ValidateCompleted(projectJson);
            else ProjectFile.Validate(projectJson);
            if (_smokeDirectory is null && _projectLibrary is not null)
            {
                using var project = JsonDocument.Parse(projectJson);
                var managedId = project.RootElement.TryGetProperty("storageId", out var storage) ? storage.GetString() : null;
                var managed = Guid.TryParseExact(managedId, "D", out _)
                    ? await _projectLibrary.SaveAsync(managedId!, projectJson)
                    : await _projectLibrary.CreateAsync(projectJson);
                PostProjectSave(new { type = responseType, requestId, ok = true, cancelled = false, path = managed.ProjectFile, storageId = managed.Id });
                return;
            }
            // Return from WebView's callback before showing the modal native dialog.
            await Task.Yield();
            using var dialog = _pickerLocations.SaveDialog("save-project", filename, "圈改项目 (*.quangai.json)|*.quangai.json");
            dialog.Title = operation == "project-save-request" ? "保存项目" : "完成项目并保存";
            dialog.DefaultExt = "quangai.json";
            dialog.AddExtension = true;
            string destination;
            if (_smokeDirectory is not null) destination = Path.Combine(_smokeDirectory, filename);
            else if (dialog.ShowDialog(this) == DialogResult.OK) destination = dialog.FileName;
            else
            {
                PostProjectSave(new { type = responseType, requestId, ok = true, cancelled = true });
                return;
            }
            await ProjectFile.SaveAsync(destination, projectJson, CancellationToken.None);
            string? warning = null;
            try { _pickerLocations.RememberFile("save-project", destination); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            { warning = "文件已保存，但保存目录记忆未能更新：" + error.Message; }
            PostProjectSave(new { type = responseType, requestId, ok = true, cancelled = false, path = destination, warning });
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException or JsonException
            or InvalidOperationException or ArgumentException or KeyNotFoundException or FormatException)
        {
            if (requestId is not null)
                PostProjectSave(new { type = responseType, requestId, ok = false, message = "项目未完成保存：" + error.Message });
        }
        finally { if (ownsRequest) _projectSaving = false; }
    }

    private void PostProjectSave(object response)
    {
        if (!_webView.IsDisposed && _webView.CoreWebView2 is not null)
            _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response));
    }
}
