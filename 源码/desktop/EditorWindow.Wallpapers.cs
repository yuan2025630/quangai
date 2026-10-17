using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Quangai;

internal sealed partial class EditorWindow
{
    private WallpaperLibrary? _wallpaperLibrary;

    private void InitializeWallpapers(CoreWebView2 core, string webDirectory)
    {
        var directory = _dataDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Quangai");
        _wallpaperLibrary = new WallpaperLibrary(directory);
        Directory.CreateDirectory(_wallpaperLibrary.PreviewDirectory);
        core.SetVirtualHostNameToFolderMapping("preview.quangai-wallpaper.local",
            _wallpaperLibrary.PreviewDirectory, CoreWebView2HostResourceAccessKind.Allow);
        core.SetVirtualHostNameToFolderMapping("renderer.quangai-wallpaper.local",
            Path.Combine(webDirectory, "assets", "wallpapers"), CoreWebView2HostResourceAccessKind.DenyCors);
        core.WebMessageReceived += HandleWallpaperMessageAsync;
        FormClosed += (_, _) => _wallpaperLibrary?.Dispose();
    }

    private async void HandleWallpaperMessageAsync(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!args.Source.StartsWith(LocalOrigin + "/", StringComparison.OrdinalIgnoreCase) || _wallpaperLibrary is null) return;
        string? requestId = null;
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            var message = document.RootElement;
            if (!message.TryGetProperty("type", out var type) || type.GetString() != "wallpaper-request") return;
            requestId = message.GetProperty("requestId").GetString();
            if (!Guid.TryParseExact(requestId, "D", out _)) return;
            var command = message.GetProperty("command").GetString();
            if (command == "wallpaper-folder")
            {
                var id = requestId;
                BeginInvoke(new Action(() => ChooseWallpaperDirectoryAsync(id)));
                return;
            }
            if (command != "wallpaper-scan") throw new InvalidDataException("未知的壁纸请求。");
            var inventory = await _wallpaperLibrary.ScanAsync();
            PublishWallpaperInventory(requestId, inventory);
        }
        catch (OperationCanceledException) { /* Closing the window cancels library scanning. */ }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException
            or InvalidOperationException or ArgumentException or KeyNotFoundException)
        { ReplyWallpaperError(requestId, error.Message); }
    }

    private async void ChooseWallpaperDirectoryAsync(string requestId)
    {
        if (_wallpaperLibrary is null || _webView.IsDisposed) return;
        try
        {
            using var picker = new FolderBrowserDialog {
                Description = "选择 Wallpaper Engine 壁纸库或含 project.json 的壁纸目录",
                UseDescriptionForTitle = true, ShowNewFolderButton = false,
                InitialDirectory = _pickerLocations.RememberedDirectory("wallpaper-library", AppContext.BaseDirectory)
            };
            if (picker.ShowDialog(this) != DialogResult.OK)
            {
                _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new {
                    type = "wallpaper-response", requestId, ok = true, cancelled = true
                }));
                return;
            }
            var inventory = await _wallpaperLibrary.AddDirectoryAsync(picker.SelectedPath);
            _pickerLocations.RememberDirectory("wallpaper-library", picker.SelectedPath);
            PublishWallpaperInventory(requestId, inventory);
        }
        catch (OperationCanceledException) { /* The owner window has closed. */ }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException
            or InvalidOperationException or ArgumentException)
        { ReplyWallpaperError(requestId, error.Message); }
    }

    private void PublishWallpaperInventory(string requestId, WallpaperInventory inventory)
    {
        if (_webView.IsDisposed || _wallpaperLibrary is null) return;
        var core = _webView.CoreWebView2;
        foreach (var entry in inventory.Items)
            core.SetVirtualHostNameToFolderMapping(entry.Host, entry.Folder, CoreWebView2HostResourceAccessKind.Allow);
        Directory.CreateDirectory(_wallpaperLibrary.PreviewDirectory);
        core.SetVirtualHostNameToFolderMapping("preview.quangai-wallpaper.local",
            _wallpaperLibrary.PreviewDirectory, CoreWebView2HostResourceAccessKind.Allow);
        core.PostWebMessageAsJson(JsonSerializer.Serialize(new {
            type = "wallpaper-response", requestId, ok = true, result = inventory
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }

    private void ReplyWallpaperError(string? requestId, string message)
    {
        if (requestId is null || _webView.IsDisposed) return;
        _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new {
            type = "wallpaper-response", requestId, ok = false, message
        }));
    }
}
