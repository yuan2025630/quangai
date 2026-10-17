using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Quangai;

internal sealed partial class EditorWindow
{
    private ProjectLibrary? _projectLibrary;
    private readonly SemaphoreSlim _projectCommandGate = new(1, 1);
    private Task _legacyProjects = Task.CompletedTask;
    private readonly Dictionary<string, string> _pickedProjectFiles = [];

    private string? PickedProjectFile(JsonElement request, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (request.TryGetProperty("fileToken", out var token))
        {
            var value = token.GetString()!;
            if (!Guid.TryParseExact(value, "D", out _) || !_pickedProjectFiles.TryGetValue(value, out var path))
                throw new InvalidDataException("文件选择已失效，请重新选择。");
            return path;
        }
        return args.AdditionalObjects.Count == 1 && args.AdditionalObjects[0] is CoreWebView2File file ? file.Path : null;
    }

    private void InitializeProjects(CoreWebView2 core)
    {
        var settings = _dataDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Quangai");
        var defaultRoot = _dataDirectory is null
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "圈改项目")
            : Path.Combine(_dataDirectory, "projects");
        _projectLibrary = new ProjectLibrary(Path.Combine(settings, "project-library-settings.json"), defaultRoot);
        if (_dataDirectory is null)
            _legacyProjects = _projectLibrary.ImportLegacyProjectsAsync(_pickerLocations.RememberedDirectory("save-project", ""));
        core.WebMessageReceived += HandleProjectCommandAsync;
    }

    private async void HandleProjectCommandAsync(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!args.Source.StartsWith(LocalOrigin + "/", StringComparison.OrdinalIgnoreCase) || _projectLibrary is null) return;
        string? requestId = null;
        var ownsGate = false;
        try
        {
            using var message = JsonDocument.Parse(args.WebMessageAsJson);
            var request = message.RootElement;
            if (request.ValueKind != JsonValueKind.Object || !request.TryGetProperty("type", out var type)
                || type.GetString() != "project-command") return;
            requestId = request.GetProperty("requestId").GetString();
            if (!Guid.TryParseExact(requestId, "D", out _)) return;
            await _projectCommandGate.WaitAsync();
            ownsGate = true;
            await _legacyProjects;
            object? result;
            var command = request.GetProperty("command").GetString();
            var id = request.TryGetProperty("id", out var identifier) ? identifier.GetString() : null;
            switch (command)
            {
                case "list": result = new { root = _projectLibrary.Root, projects = _projectLibrary.List() }; break;
                case "create":
                case "adopt":
                    var projectJson = request.GetProperty("projectJson").GetString()!;
                    var imported = command == "adopt" ? PickedProjectFile(request, args) : null;
                    var entry = await _projectLibrary.CreateAsync(projectJson);
                    if (imported is not null)
                    {
                        try { AdoptPresentationSource(entry.Id, projectJson, imported); }
                        catch { _projectLibrary.Trash(entry.Id); throw; }
                    }
                    result = new { entry, projectJson = _projectLibrary.Read(entry.Id) };
                    break;
                case "save": result = await _projectLibrary.SaveAsync(id!, request.GetProperty("projectJson").GetString()!); break;
                case "read": result = new { projectJson = _projectLibrary.Read(id!) }; break;
                case "trash": result = new { folder = _projectLibrary.Trash(id!) }; break;
                case "open":
                    OpenProjectFolder(_projectLibrary.Resolve(id!)); result = new { opened = true }; break;
                case "resolve-export":
                    result = new { folder = _projectLibrary.ResolveExportFolder(id!, request.GetProperty("folder").GetString()) }; break;
                case "open-export":
                    var export = _projectLibrary.ResolveExportFolder(id!, request.GetProperty("folder").GetString());
                    OpenProjectFolder(export); result = new { opened = true }; break;
                case "open-root": OpenProjectFolder(_projectLibrary.Root); result = new { opened = true }; break;
                case "open-trash":
                    var trash = Path.Combine(_projectLibrary.Root, ".项目回收站");
                    Directory.CreateDirectory(trash); OpenProjectFolder(trash); result = new { opened = true }; break;
                case "change-root":
                    await Task.Yield();
                    using (var picker = new FolderBrowserDialog { Description = "更换统一项目文件夹并迁移全部项目", UseDescriptionForTitle = true, InitialDirectory = _projectLibrary.Root, ShowNewFolderButton = true })
                    {
                        if (picker.ShowDialog(this) != DialogResult.OK) result = new { cancelled = true };
                        else
                        {
                            _projectLibrary.ChangeRoot(picker.SelectedPath);
                            result = new { cancelled = false, root = _projectLibrary.Root, projects = _projectLibrary.List() };
                        }
                    }
                    break;
                case "presentation-import":
                    var file = PickedProjectFile(request, args);
                    if (file is null)
                        throw new InvalidDataException("无法读取所选 PPT，请通过“导入文件”重新选择。");
                    var jobs = Path.Combine(_dataDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Quangai"), "presentation-jobs");
                    var rendered = await PresentationRenderer.ImportAsync(file, jobs, text => PostProjectCommand(new { type = "project-progress", requestId, message = text }));
                    var snapshot = Path.Combine(jobs, rendered.AssetId, "source" + Path.GetExtension(file).ToLowerInvariant());
                    try { _projectLibrary.StoreSource(id!, rendered.AssetId, snapshot); }
                    finally { PresentationRenderer.CleanJob(jobs, rendered.AssetId); }
                    result = rendered;
                    break;
                case "presentation-export": result = await PresentationExport.WriteAsync(_projectLibrary, request); break;
                default: throw new InvalidDataException("未知的项目管理操作。");
            }
            PostProjectCommand(new { type = "project-command-response", requestId, ok = true, result });
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException or JsonException
            or ArgumentException or InvalidOperationException or FormatException or KeyNotFoundException or TimeoutException
            or System.Runtime.InteropServices.COMException)
        {
            if (Guid.TryParseExact(requestId, "D", out _))
                PostProjectCommand(new { type = "project-command-response", requestId, ok = false, message = error.Message });
        }
        finally { if (ownsGate) _projectCommandGate.Release(); }
    }

    private void AdoptPresentationSource(string id, string projectJson, string projectFile)
    {
        using var document = JsonDocument.Parse(projectJson);
        if (!document.RootElement.TryGetProperty("presentation", out var deck) || deck.ValueKind != JsonValueKind.Object) return;
        var parent = Path.GetDirectoryName(projectFile)!;
        var assets = new List<(string Id, string Name)> { (deck.GetProperty("assetId").GetString()!, "original") };
        if (deck.TryGetProperty("revisedAssetId", out var revised) && revised.ValueKind == JsonValueKind.String)
            assets.Add((revised.GetString()!, "revised"));
        foreach (var asset in assets)
        {
            if (!Guid.TryParseExact(asset.Id, "N", out _)) throw new InvalidDataException("PPT 副本标识无效。");
            var found = false;
            foreach (var extension in new[] { ".pptx", ".ppt" })
            {
                foreach (var candidate in new[] { Path.Combine(parent, "源文件", asset.Id + extension), Path.Combine(parent, "source", asset.Name + extension) })
                {
                    if (!File.Exists(candidate)) continue;
                    ProjectLibrary.RejectLink(candidate);
                    _projectLibrary!.StoreSource(id, asset.Id, candidate);
                    found = true;
                    break;
                }
                if (found) break;
            }
            if (!found) throw new FileNotFoundException("PPT 项目缺少源文件副本，请把项目文件与“源文件”或 source 文件夹一起保留。");
        }
    }

    private void OpenProjectFolder(string folder)
    {
        if (_dataDirectory is null) Process.Start(new ProcessStartInfo(folder) { UseShellExecute = true });
    }

    private void PostProjectCommand(object response)
    {
        if (!_webView.IsDisposed) _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
}
