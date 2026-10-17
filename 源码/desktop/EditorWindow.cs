using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Quangai;

internal sealed partial class EditorWindow : Form
{
    private const string LocalOrigin = "https://quangai.local";
    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill };
    private readonly string? _smokeDirectory;
    private readonly string? _dataDirectory;
    private readonly List<CoreWebView2DownloadOperation> _downloads = [];
    private bool _closingAfterSave;
    private AgentWorkspace? _agentWorkspace;
    private readonly FilePickerLocations _pickerLocations;
    private string? _smokeChosenFile;
    private string? _nextAgentRoot;


    internal EditorWindow(string? smokeDirectory, string? testDirectory = null)
    {
        _smokeDirectory = smokeDirectory;
        _dataDirectory = smokeDirectory ?? testDirectory;
        _pickerLocations = new FilePickerLocations(_dataDirectory is null
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Quangai", "file-picker-locations.json")
            : Path.Combine(_dataDirectory, "file-picker-locations.json"));
        Text = "圈改 · 把修改意见画出来";
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        ClientSize = new Size(1380, 880);
        MinimumSize = new Size(940, 650);
        StartPosition = FormStartPosition.CenterScreen;
        WindowState = FormWindowState.Maximized;
        BackColor = Color.FromArgb(245, 245, 241);
        Controls.Add(_webView);
        FormClosed += (_, _) => _agentWorkspace?.Dispose();
        if (smokeDirectory is not null)
        {
            Directory.CreateDirectory(smokeDirectory);
            ShowInTaskbar = false;
            Opacity = 0;
        }
        Shown += InitializeWebViewAsync;
        FormClosing += SaveDraftBeforeClosingAsync;
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        TitleBarAppearance.Apply(Handle);
    }

    private async void InitializeWebViewAsync(object? sender, EventArgs e)
    {
        try
        {
            string webDirectory = Path.Combine(AppContext.BaseDirectory, "web");
            if (!File.Exists(Path.Combine(webDirectory, "index.html")))
                throw new FileNotFoundException("界面文件缺失。请保留程序旁边的 web 文件夹。");
            string profileDirectory = _dataDirectory is null
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Quangai", "WebView")
                : Path.Combine(_dataDirectory, "webview-profile");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profileDirectory);
            await _webView.EnsureCoreWebView2Async(environment);
            var core = _webView.CoreWebView2;
            InitializeMemoryManagement();
            core.SetVirtualHostNameToFolderMapping("quangai.local", webDirectory, CoreWebView2HostResourceAccessKind.DenyCors);
            InitializeWallpapers(core, webDirectory);
            InitializeProjects(core);
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsNonClientRegionSupportEnabled = false;
            core.NavigationStarting += (_, args) =>
            {
                if (!args.Uri.StartsWith(LocalOrigin + "/", StringComparison.OrdinalIgnoreCase)) args.Cancel = true;
            };
            core.NewWindowRequested += (_, args) => args.Handled = true;
            core.DownloadStarting += ChooseDownloadLocation;
            // Old sessions remain readable; new exports always use a chosen folder.
            var legacyRoot = _dataDirectory is null
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "圈改协作")
                : Path.Combine(_dataDirectory, "agent-workspaces");
            var locationsFile = Path.Combine(_dataDirectory
                ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Quangai"),
                "agent-workspace-locations.json");
            _agentWorkspace = new AgentWorkspace(legacyRoot, locationsFile, payload => core.PostWebMessageAsJson(JsonSerializer.Serialize(payload)));
            core.WebMessageReceived += HandleAgentMessageAsync;
            core.WebMessageReceived += HandleFilePicker;
            core.WebMessageReceived += HandleProjectSaveAsync;
            core.WebMessageReceived += HandleWindowMessage;
            core.WebMessageReceived += HandleExitResponse;
            core.PermissionRequested += (_, args) =>
            {
                if (!args.Uri.StartsWith(LocalOrigin + "/", StringComparison.OrdinalIgnoreCase))
                    args.State = CoreWebView2PermissionState.Deny;
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var origin)
                    && origin.Scheme == Uri.UriSchemeHttps
                    && origin.Host.Equals("quangai.local", StringComparison.OrdinalIgnoreCase)
                    && args.PermissionKind == CoreWebView2PermissionKind.MultipleAutomaticDownloads)
                    args.State = CoreWebView2PermissionState.Allow;
            };
            core.Navigate(LocalOrigin + "/index.html");
            if (_smokeDirectory is not null) await RunSmokeTestAsync(core);
        }

        catch (Exception error)
        {
            if (_smokeDirectory is not null)
            {
                if (_webView.CoreWebView2 is not null)
                {
                    string state = await _webView.CoreWebView2.ExecuteScriptAsync("JSON.stringify({toast:document.getElementById('toast')?.textContent,busy:document.body.getAttribute('aria-busy'),dialog:document.querySelector('dialog[open]')?.id,button:document.getElementById('download-package')?.textContent})");
                    await File.WriteAllTextAsync(Path.Combine(_smokeDirectory, "native-failure-state.json"), state);
                    await using var capture = File.Create(Path.Combine(_smokeDirectory, "native-failure.png"));
                    await _webView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, capture);
                }
                await File.WriteAllTextAsync(Path.Combine(_smokeDirectory, "native-smoke-error.txt"), error.ToString());
                Environment.ExitCode = 1;
                _closingAfterSave = true;
                Close();
            }
            else
            {
                MessageBox.Show(this, "无法启动圈改：" + error.Message + "\n\n若提示缺少 WebView2，请安装 Microsoft Edge WebView2 Runtime。", "圈改", MessageBoxButtons.OK, MessageBoxIcon.Error);
                _closingAfterSave = true;
                Close();
            }
        }
    }

    private async void HandleAgentMessageAsync(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!args.Source.StartsWith(LocalOrigin + "/", StringComparison.OrdinalIgnoreCase) || _agentWorkspace is null) return;
        string? id = null;
        try
        {
            using var message = JsonDocument.Parse(args.WebMessageAsJson);
            if (message.RootElement.GetProperty("type").GetString() != "agent-request") return;
            id = message.RootElement.GetProperty("requestId").GetString();
            if (!Guid.TryParseExact(id, "D", out _)) return;
            object? result;
            if (message.RootElement.GetProperty("command").GetString() == "agent-begin")
            {
                var root = _nextAgentRoot ?? throw new InvalidDataException("请先选择协作目录的保存文件夹。");
                _nextAgentRoot = null;
                result = await _agentWorkspace.BeginAsync(root);
            }
            else result = await _agentWorkspace.DispatchAsync(message.RootElement);
            _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "agent-response", requestId = id, ok = true, result }));
        }
        catch (Exception error) when (error is IOException or InvalidDataException or JsonException or InvalidOperationException or KeyNotFoundException or FormatException or UnauthorizedAccessException or ArgumentException)
        {
            if (id is not null && _webView.CoreWebView2 is not null)
                _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "agent-response", requestId = id, ok = false, message = error.Message }));
        }
    }

    private void ChooseDownloadLocation(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        string filename = Path.GetFileName(e.ResultFilePath);
        var key = Path.GetExtension(filename).ToLowerInvariant() switch
        {
            ".zip" => "save-package",
            ".png" => "save-annotated",
            _ => "save-project"
        };
        e.Handled = true;
        if (_smokeDirectory is not null)
        {
            e.ResultFilePath = Path.Combine(_smokeDirectory, filename);
            _pickerLocations.RememberFile(key, e.ResultFilePath);
            _downloads.Add(e.DownloadOperation);
            return;
        }
        using var dialog = _pickerLocations.SaveDialog(key, filename,
            Path.GetExtension(filename).ToLowerInvariant() switch
            {
                ".zip" => "圈改修改包 (*.zip)|*.zip",
                ".png" => "PNG 标注图 (*.png)|*.png",
                _ => "圈改项目 (*.json)|*.json"
            });
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            e.ResultFilePath = dialog.FileName;
            _pickerLocations.RememberFile(key, dialog.FileName);
        }
        else e.Cancel = true;
    }

    private void HandleFilePicker(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!args.Source.StartsWith(LocalOrigin + "/", StringComparison.OrdinalIgnoreCase)) return;
        var request = args.WebMessageAsJson;
        // Show modal Windows dialogs after the WebView callback has returned.
        BeginInvoke(new Action(() => ChooseInputFile(request)));
    }

    private void ChooseInputFile(string request)
    {
        if (_webView.IsDisposed || !_webView.CoreWebView2.Source.StartsWith(LocalOrigin + "/", StringComparison.OrdinalIgnoreCase)) return;
        string? requestId = null;
        var responseType = "file-picker-response";
        try
        {
            using var message = JsonDocument.Parse(request);
            var data = message.RootElement;

            if (data.GetProperty("type").GetString() == "agent-folder-request")
            {
                responseType = "agent-folder-response";
                requestId = data.GetProperty("requestId").GetString();
                if (!Guid.TryParseExact(requestId, "D", out _)) return;
                var projectId = data.TryGetProperty("storageId", out var storage) ? storage.GetString() : null;
                if (_smokeDirectory is null && _projectLibrary is not null && Guid.TryParseExact(projectId, "D", out _))
                {
                    var folder = Path.Combine(_projectLibrary.Resolve(projectId!), "导出");
                    Directory.CreateDirectory(folder);
                    ProjectLibrary.RejectLink(folder);
                    _nextAgentRoot = folder;
                    _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = responseType, requestId, ok = true, cancelled = false, folder }));
                }
                else ChooseAgentDirectory(requestId!);
                return;
            }

            if (data.GetProperty("type").GetString() == "project-folder-request")
            {
                responseType = "project-folder-response";
                requestId = data.GetProperty("requestId").GetString();
                if (!Guid.TryParseExact(requestId, "D", out _)) return;
                ChooseProjectDirectory(requestId!);
                return;
            }
            if (data.GetProperty("type").GetString() != "file-picker-request") return;
            requestId = data.GetProperty("requestId").GetString();
            if (!Guid.TryParseExact(requestId, "D", out _)) return;
            var inputId = data.GetProperty("inputId").GetString();
            var role = data.GetProperty("role").GetString();
            var definition = inputId switch
            {
                "image-input" when role is "original" or "reference" or "revised"
                    => (Key: "image-" + role, Title: role == "original" ? "导入文件" : role == "reference" ? "选择参考图" : "导入修改稿", Filter: role == "reference"
                        ? "图片 (*.png;*.jpg;*.jpeg;*.webp;*.svg;*.bmp;*.gif)|*.png;*.jpg;*.jpeg;*.webp;*.svg;*.bmp;*.gif|所有文件 (*.*)|*.*"
                        : "支持的文件 (*.ppt;*.pptx;*.png;*.jpg;*.jpeg;*.webp;*.svg;*.bmp;*.gif)|*.ppt;*.pptx;*.png;*.jpg;*.jpeg;*.webp;*.svg;*.bmp;*.gif|PowerPoint (*.ppt;*.pptx)|*.ppt;*.pptx|图片 (*.png;*.jpg;*.jpeg;*.webp;*.svg;*.bmp;*.gif)|*.png;*.jpg;*.jpeg;*.webp;*.svg;*.bmp;*.gif|所有文件 (*.*)|*.*"),
                "project-input" => (Key: "project-open", Title: "打开圈改项目", Filter: "圈改项目 (*.json)|*.json|所有文件 (*.*)|*.*"),
                "wallpaper-input" => (Key: "wallpaper-open", Title: "选择壁纸图片或视频", Filter: "壁纸 (*.png;*.jpg;*.jpeg;*.webp;*.mp4;*.webm)|*.png;*.jpg;*.jpeg;*.webp;*.mp4;*.webm|所有文件 (*.*)|*.*"),
                _ => throw new InvalidDataException("未知的文件选择入口。")
            };
            using var dialog = _pickerLocations.OpenDialog(definition.Key, definition.Title, definition.Filter);
            var choice = _smokeChosenFile;
            var selected = _smokeDirectory is not null && choice is not null
                ? string.IsNullOrEmpty(choice) ? DialogResult.Cancel : DialogResult.OK
                : dialog.ShowDialog(this);
            if (selected == DialogResult.OK)
            {
                var filename = choice ?? dialog.FileName;
                if (!File.Exists(filename)) throw new FileNotFoundException("选择的文件已不存在。");
                _pickerLocations.RememberFile(definition.Key, filename);
                var core = _webView.CoreWebView2;
                var handle = core.Environment.CreateWebFileSystemFileHandle(filename, CoreWebView2FileSystemHandlePermission.ReadOnly);
                var fileToken = Guid.NewGuid().ToString("D");
                if (_pickedProjectFiles.Count >= 100) _pickedProjectFiles.Remove(_pickedProjectFiles.Keys.First());
                _pickedProjectFiles[fileToken] = filename;
                if (!core.Source.StartsWith(LocalOrigin + "/", StringComparison.OrdinalIgnoreCase)) return;
                core.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "file-picker-response", requestId, ok = true, cancelled = false, fileToken }), [handle]);

                return;
            }
            _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "file-picker-response", requestId, ok = true, cancelled = selected != DialogResult.OK }));
        }
        catch (Exception error) when (error is IOException or InvalidDataException or JsonException or InvalidOperationException or KeyNotFoundException or FormatException or UnauthorizedAccessException or ArgumentException or System.Runtime.InteropServices.COMException)
        {
            if (requestId is not null && !_webView.IsDisposed)
                _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = responseType, requestId, ok = false, message = error.Message }));
        }
    }

    private void ChooseAgentDirectory(string requestId)
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "选择协作目录的保存文件夹",
            UseDescriptionForTitle = true,
            InitialDirectory = _pickerLocations.RememberedDirectory("agent-export", AppContext.BaseDirectory),
            ShowNewFolderButton = true
        };
        _nextAgentRoot = null;
        var selected = _smokeDirectory is not null ? DialogResult.OK : dialog.ShowDialog(this);
        var folder = _smokeDirectory is not null ? Path.Combine(_smokeDirectory, "agent-workspaces") : dialog.SelectedPath;
        if (selected == DialogResult.OK)
        {
            if (_smokeDirectory is not null) Directory.CreateDirectory(folder);
            _pickerLocations.RememberDirectory("agent-export", folder);
            _nextAgentRoot = folder;
        }
        _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "agent-folder-response", requestId, ok = true,
            cancelled = selected != DialogResult.OK, folder = selected == DialogResult.OK ? folder : null
        }));
    }

    private void ChooseProjectDirectory(string requestId)
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "选择新项目文件夹",
            UseDescriptionForTitle = true,
            InitialDirectory = _pickerLocations.InitialDirectory("project-new"),
            ShowNewFolderButton = true
        };
        var cancelled = dialog.ShowDialog(this) != DialogResult.OK;
        if (!cancelled) _pickerLocations.RememberDirectory("project-new", dialog.SelectedPath);
        _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "project-folder-response", requestId, ok = true, cancelled,
            folder = cancelled ? null : dialog.SelectedPath
        }));
    }

    private async Task RunSmokeTestAsync(CoreWebView2 core)
    {
        ArgumentNullException.ThrowIfNull(_smokeDirectory);
        await WaitForScriptAsync(core, "document.documentElement.dataset.appReady === 'true'");
        await LoadSmokeProjectAsync(core);
        await WaitForScriptAsync(core, "document.getElementById('note-count').textContent === '4' && document.body.getAttribute('aria-busy') !== 'true'");
        await core.ExecuteScriptAsync("document.getElementById('save-project').click()");
        await WaitForScriptAsync(core, "document.body.getAttribute('aria-busy') !== 'true'");
        await core.ExecuteScriptAsync("document.getElementById('export').click(); document.getElementById('download-package').click()");
        await WaitForScriptAsync(core, "document.body.getAttribute('aria-busy') !== 'true'");
        var timer = Stopwatch.StartNew();
        // Project save now uses the native atomic-write bridge; only the ZIP
        // export appears in WebView's downloads collection.
        while (_downloads.Count < 1 || _downloads.Any(download => download.State == CoreWebView2DownloadState.InProgress))
        {
            if (timer.Elapsed > TimeSpan.FromSeconds(40)) throw new TimeoutException("原生文件导出测试超时。");
            await Task.Delay(100);
        }
        if (_downloads.Any(download => download.State != CoreWebView2DownloadState.Completed))
            throw new IOException("原生文件导出未完成。");
        await core.ExecuteScriptAsync("document.getElementById('export-dialog').close(); document.querySelector('[data-mode=review]').click()");
        await WaitForScriptAsync(core, "document.getElementById('difference-summary').textContent.includes('全图像素变化')");
        await LoadSmokeWallpaperAsync(core);
        await WaitForScriptAsync(core, "document.getElementById('wallpaper-video').readyState >= 2 && document.getElementById('wallpaper-video').videoWidth === 320");
        await core.ExecuteScriptAsync("document.getElementById('wallpaper-dialog').close()");
        await using (var screenshot = File.Create(Path.Combine(_smokeDirectory, "native-preview.png")))
            await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, screenshot);
        string report = await core.ExecuteScriptAsync("JSON.stringify({title:document.title,origin:location.origin,secureContext:isSecureContext,appReady:document.documentElement.dataset.appReady,noteCount:document.getElementById('note-count').textContent,difference:document.getElementById('difference-summary').textContent,wallpaper:document.body.dataset.wallpaper,videoReady:document.getElementById('wallpaper-video').readyState,videoWidth:document.getElementById('wallpaper-video').videoWidth,videoMuted:document.getElementById('wallpaper-video').muted,videoLoop:document.getElementById('wallpaper-video').loop})");
        string decoded = JsonSerializer.Deserialize<string>(report) ?? throw new InvalidDataException("原生页面报告为空。");
        await File.WriteAllTextAsync(Path.Combine(_smokeDirectory, "native-smoke.json"), decoded);
        await RunAgentSmokeTestAsync(core);
        await RunFilePickerSmokeTestAsync(core);
        await RunPresentationSmokeTestAsync(core);
        _closingAfterSave = true;
        Close();
    }

    private async Task<JsonElement> ReadSmokeDraftAsync(CoreWebView2 core)
    {
        await core.ExecuteScriptAsync("window.quangaiDesktop.requestSave()");
        await WaitForScriptAsync(core, "document.documentElement.dataset.draftFlushed === 'true'");
        await core.ExecuteScriptAsync("(() => {window.quangaiSmokeDraft = null; const r = indexedDB.open('quangai',1); r.onsuccess = () => {const db=r.result;const q=db.transaction('drafts').objectStore('drafts').get('current');q.onsuccess=()=>{const saved=q.result;window.quangaiSmokeDraft=saved?.workspaceVersion===1?(saved.tabs.find(tab=>tab.id===saved.activeId)??saved.tabs[0]).project:saved;db.close()}}})()");
        await WaitForScriptAsync(core, "window.quangaiSmokeDraft !== null");
        var encoded = await core.ExecuteScriptAsync("JSON.stringify(window.quangaiSmokeDraft)");
        using var document = JsonDocument.Parse(JsonSerializer.Deserialize<string>(encoded)!);
        return document.RootElement.Clone();
    }

    private async Task RunAgentSmokeTestAsync(CoreWebView2 core)
    {
        ArgumentNullException.ThrowIfNull(_smokeDirectory);
        ArgumentNullException.ThrowIfNull(_agentWorkspace);
        await core.ExecuteScriptAsync("document.getElementById('export').click();document.getElementById('export-agent').click()");
        await WaitForScriptAsync(core, "document.getElementById('agent-folder').value.length > 0 && document.body.getAttribute('aria-busy') !== 'true'");
        var folder = JsonSerializer.Deserialize<string>(await core.ExecuteScriptAsync("document.getElementById('agent-folder').value"))!;
        var sessionId = Path.GetFileName(folder);
        using var snapshot = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(folder, "project.quangai.json")));
        var previousImages = snapshot.RootElement.GetProperty("images");
        var source = previousImages.GetProperty("original").GetProperty("src").GetString();
        var previousRevised = previousImages.GetProperty("revised").GetProperty("src").GetString();
        if (File.Exists(Path.Combine(folder, "transfer.zip")) || !File.Exists(Path.Combine(folder, "agent-prompt.txt")))
            throw new InvalidDataException("协作目录未完整导出。");
        var previousClipboard = Clipboard.GetDataObject();
        try
        {
            await core.ExecuteScriptAsync("document.getElementById('copy-agent-prompt').click()");
            await WaitForScriptAsync(core, "document.getElementById('toast').textContent.includes('Agent 提示词已复制')");
            var prompt = await File.ReadAllTextAsync(Path.Combine(folder, "agent-prompt.txt"));
            if (Clipboard.GetText().Replace("\r\n", "\n") != prompt.Replace("\r\n", "\n") || !prompt.Contains(Path.Combine(folder, "submit_result.py")))
                throw new InvalidDataException("复制的提示词未包含实际协作目录和提交步骤。");
        }
        finally
        {
            if (previousClipboard is not null) Clipboard.SetDataObject(previousClipboard, true);
            else Clipboard.Clear();
        }
        await using (var screenshot = File.Create(Path.Combine(_smokeDirectory, "agent-export-preview.png")))
            await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, screenshot);
        await core.ExecuteScriptAsync("document.getElementById('export-dialog').close();document.querySelector('[data-mode=edit]').click()");

        var marker = Path.Combine(folder, "result", "ready.json");
        await File.WriteAllTextAsync(marker, JsonSerializer.Serialize(new { version = 1, sessionId = Guid.NewGuid().ToString(), fileName = "revised.png", sha256 = new string('a', 64) }));
        await WaitForScriptAsync(core, "document.getElementById('agent-live-state').textContent.includes('轮次')");
        var invalid = await ReadSmokeDraftAsync(core);
        if (invalid.GetProperty("images").GetProperty("revised").GetProperty("src").GetString() != previousRevised)
            throw new InvalidDataException("不匹配的 Agent 回传覆盖了修改稿。");

        var fixture = Path.Combine(_smokeDirectory, "agent-finished.png");
        using (var bitmap = new Bitmap(Path.Combine(folder, "revised.png")))
        {
            var random = new Random(42);
            for (var y = 0; y < Math.Min(650, bitmap.Height); y++)
                for (var x = 0; x < Math.Min(360, bitmap.Width); x++)
                    bitmap.SetPixel(x, y, Color.FromArgb(255, random.Next(256), random.Next(256), random.Next(256)));
            bitmap.Save(fixture, System.Drawing.Imaging.ImageFormat.Png);
        }
        if (new FileInfo(fixture).Length <= 524288) throw new InvalidDataException("回传测试图片未跨传输块。");
        var start = new ProcessStartInfo("python") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add("-X");
        start.ArgumentList.Add("utf8");
        start.ArgumentList.Add(Path.Combine(folder, "submit_result.py"));
        start.ArgumentList.Add(fixture);
        using (var helper = Process.Start(start) ?? throw new IOException("无法启动回传脚本。"))
        {
            var output = helper.StandardOutput.ReadToEndAsync();
            var error = helper.StandardError.ReadToEndAsync();
            await helper.WaitForExitAsync();
            await File.WriteAllTextAsync(Path.Combine(_smokeDirectory, "agent-submit.txt"), await output + await error);
            if (helper.ExitCode != 0) throw new IOException("回传脚本运行失败。");
        }
        await WaitForScriptAsync(core, "document.getElementById('agent-live-state').textContent.includes('已收到修改稿') && document.body.getAttribute('aria-busy') !== 'true' && document.querySelector('[data-mode=review]').classList.contains('active')");
        var received = await ReadSmokeDraftAsync(core);
        var newSource = received.GetProperty("images").GetProperty("revised").GetProperty("src").GetString();
        if (newSource == previousRevised || received.GetProperty("images").GetProperty("original").GetProperty("src").GetString() != source)
            throw new InvalidDataException("自动回传未载入新修改稿，或改变了原图。");
        await core.ExecuteScriptAsync("document.querySelector('[data-note=demo-title]').click();document.getElementById('note-status').value='accepted';document.getElementById('note-status').dispatchEvent(new Event('change',{bubbles:true}))");
        var accepted = await ReadSmokeDraftAsync(core);
        await core.ExecuteScriptAsync("document.getElementById('use-revised').click()");
        var promoted = await ReadSmokeDraftAsync(core);
        if (promoted.GetProperty("images").GetProperty("original").GetProperty("src").GetString() != newSource
            || promoted.GetProperty("images").GetProperty("revised").ValueKind != JsonValueKind.Null
            || promoted.GetProperty("agentSessionId").ValueKind != JsonValueKind.Null
            || promoted.GetProperty("annotations").GetRawText() != accepted.GetProperty("annotations").GetRawText()
            || promoted.GetProperty("images").GetProperty("reference").GetRawText() != accepted.GetProperty("images").GetProperty("reference").GetRawText())
            throw new InvalidDataException("用修改稿替换原图未正确保留意见和参考，或未清空修改稿与连接。");
        await core.ExecuteScriptAsync("document.getElementById('undo').click()");
        var undone = await ReadSmokeDraftAsync(core);
        if (undone.GetProperty("images").GetRawText() != accepted.GetProperty("images").GetRawText()
            || undone.GetProperty("annotations").GetRawText() != accepted.GetProperty("annotations").GetRawText())
            throw new InvalidDataException("替换原图无法完整撤销。");

        await core.ExecuteScriptAsync("document.documentElement.dataset.appReady = 'false'");
        core.Reload();
        await WaitForScriptAsync(core, "document.documentElement.dataset.appReady === 'true' && document.getElementById('agent-live-state').textContent.includes('已收到修改稿')");
        var restored = await ReadSmokeDraftAsync(core);
        if (restored.GetProperty("agentSessionId").GetString() != sessionId
            || restored.GetProperty("annotations").GetRawText() != accepted.GetProperty("annotations").GetRawText())
            throw new InvalidDataException("重启恢复连接时重复回传改变了核对状态。");
        var pathRejected = false;
        using (var bad = JsonDocument.Parse("{\"command\":\"agent-bind\",\"sessionId\":\"../../outside\"}"))
        {
            try { await _agentWorkspace.DispatchAsync(bad.RootElement); }
            catch (InvalidDataException) { pathRejected = true; }
        }
        if (!pathRejected) throw new InvalidDataException("非法协作目录路径未被拒绝。");
        var report = new { passed = true, folder, directoryExport = true, promptCopied = true, helperExecuted = true, chunkedResultBytes = new FileInfo(fixture).Length, automaticImport = true, mismatchedRoundRejected = true, originalUnchanged = true, revisedPromoted = true, revisedCleared = true, annotationsAndReferencePreserved = true, promotionDisconnected = true, undoRestored = true, sessionRestored = true, duplicatePreservedAcceptance = true, pathRejected };
        await File.WriteAllTextAsync(Path.Combine(_smokeDirectory, "agent-smoke.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
    }

    private static async Task WaitForScriptAsync(CoreWebView2 core, string predicate)
    {
        var timer = Stopwatch.StartNew();
        while (await core.ExecuteScriptAsync(predicate) != "true")
        {
            if (timer.Elapsed > TimeSpan.FromSeconds(30)) throw new TimeoutException("等待界面操作完成超时。");
            await Task.Delay(100);
        }
    }

    private async Task RunFilePickerSmokeTestAsync(CoreWebView2 core)
    {
        ArgumentNullException.ThrowIfNull(_smokeDirectory);
        var inputRoot = Path.Combine(_smokeDirectory, "picker-fixtures");
        var originalDirectory = Path.Combine(inputRoot, "原图");
        var referenceDirectory = Path.Combine(inputRoot, "参考图");
        var revisedDirectory = Path.Combine(inputRoot, "修改稿");
        var projectDirectory = Path.Combine(inputRoot, "项目");
        var wallpaperDirectory = Path.Combine(inputRoot, "壁纸");
        foreach (var directory in new[] { originalDirectory, referenceDirectory, revisedDirectory, projectDirectory, wallpaperDirectory })
            Directory.CreateDirectory(directory);
        var collaboration = Directory.GetDirectories(Path.Combine(_smokeDirectory, "agent-workspaces")).Single();
        var original = Path.Combine(originalDirectory, "选择原图.png");
        var reference = Path.Combine(referenceDirectory, "选择参考图.png");
        var revised = Path.Combine(revisedDirectory, "选择修改稿.png");
        var project = Path.Combine(projectDirectory, "选择项目.quangai.json");
        var wallpaper = Path.Combine(wallpaperDirectory, "选择壁纸.png");
        File.Copy(Path.Combine(collaboration, "original.png"), original, overwrite: true);
        File.Copy(Path.Combine(collaboration, "reference.png"), reference, overwrite: true);
        File.Copy(Path.Combine(collaboration, "revised.png"), revised, overwrite: true);
        File.Copy(Path.Combine(collaboration, "project.quangai.json"), project, overwrite: true);
        File.Copy(original, wallpaper, overwrite: true);
        await core.ExecuteScriptAsync("window.quangaiSmokePickerResponse = null;chrome.webview.addEventListener('message',({data})=>{if(data.type==='file-picker-response')window.quangaiSmokePickerResponse=data})");

        await core.ExecuteScriptAsync("window.quangaiSmokeConfirm = window.confirm; window.confirm = () => true");
        try
        {
            var cases = new[]
            {
                (Key: "image-original", File: original, Script: "document.querySelector('[data-mode=edit]').click();document.querySelector('[data-source=original]').click();document.getElementById('import-image').click()", Role: "original"),
                (Key: "image-reference", File: reference, Script: "document.querySelector('[data-mode=edit]').click();document.querySelector('[data-source=reference]').click();document.getElementById('import-image').click()", Role: "reference"),
                (Key: "image-revised", File: revised, Script: "document.querySelector('[data-mode=review]').click();document.getElementById('import-revised').click()", Role: "revised"),
                (Key: "project-open", File: project, Script: "document.getElementById('open-project').click()", Role: "project"),
                (Key: "wallpaper-open", File: wallpaper, Script: "document.getElementById('wallpaper-button').click();document.getElementById('choose-wallpaper').click()", Role: "wallpaper")
            };
            foreach (var test in cases)
            {
                _smokeChosenFile = test.File;
                await core.ExecuteScriptAsync("window.quangaiSmokePickerResponse=null;");
                if (test.Role == "project") await OpenLegacyProjectPickerAsync(core);
                else await core.ExecuteScriptAsync(test.Script);
                File.AppendAllText(Path.Combine(_smokeDirectory, "file-picker-events.txt"), "Waiting for response: " + test.Key + "\n");
                var inputId = test.Role == "project" ? "project-input" : test.Role == "wallpaper" ? "wallpaper-input" : "image-input";
                var selectedName = JsonSerializer.Serialize(Path.GetFileName(test.File));
                var imported = test.Role == "wallpaper" ? "document.body.dataset.wallpaper === 'custom'"
                    : "document.getElementById('" + inputId + "').files[0]?.name === " + selectedName;
                await WaitForScriptAsync(core, "window.quangaiSmokePickerResponse !== null && " + imported + " && document.body.getAttribute('aria-busy') !== 'true'");
                File.AppendAllText(Path.Combine(_smokeDirectory, "file-picker-events.txt"), "Response received: " + test.Key + "\n");
                await WaitForScriptAsync(core, "window.quangaiSmokePickerResponse.ok === true");
                if (test.Role is "original" or "reference" or "revised")
                {
                    var draft = await ReadSmokeDraftAsync(core);
                    if (draft.GetProperty("images").GetProperty(test.Role).GetProperty("name").GetString() != Path.GetFileName(test.File))
                        throw new InvalidDataException("原生选择的图片未通过现有导入流程载入。");
                }
                if (test.Role == "wallpaper")
                {
                    await WaitForScriptAsync(core, "document.body.dataset.wallpaper === 'custom'");
                    await core.ExecuteScriptAsync("document.getElementById('wallpaper-dialog').close()");
                }
                using var dialog = _pickerLocations.OpenDialog(test.Key, "Test", "All|*.*");
                if (dialog.InitialDirectory != Path.GetDirectoryName(test.File))
                    throw new InvalidDataException("文件选择窗口没有恢复上次选择目录：" + test.Key);
            }
            var beforeCancel = File.ReadAllText(Path.Combine(_smokeDirectory, "file-picker-locations.json"));
            _smokeChosenFile = "";
            await core.ExecuteScriptAsync("window.quangaiSmokePickerResponse=null;");
            await OpenLegacyProjectPickerAsync(core);
            await WaitForScriptAsync(core, "window.quangaiSmokePickerResponse?.cancelled === true");
            if (File.ReadAllText(Path.Combine(_smokeDirectory, "file-picker-locations.json")) != beforeCancel)
                throw new InvalidDataException("取消选择不应改变目录记忆。");

            var restored = new FilePickerLocations(Path.Combine(_smokeDirectory, "file-picker-locations.json"));
            foreach (var test in cases)
                if (restored.InitialDirectory(test.Key) != wallpaperDirectory)
                    throw new InvalidDataException("重新加载后目录未保留。");
            if (restored.InitialDirectory("new-picker") != wallpaperDirectory)
                throw new InvalidDataException("首次使用的入口未沿用最近目录。");
            var saveRoot = Path.Combine(inputRoot, "导出");
            Directory.CreateDirectory(saveRoot);
            foreach (var key in new[] { "save-project", "save-package", "save-annotated" })
            {
                var folder = Path.Combine(saveRoot, key);
                Directory.CreateDirectory(folder);
                restored.RememberFile(key, Path.Combine(folder, "output.test"));
                var reopened = new FilePickerLocations(Path.Combine(_smokeDirectory, "file-picker-locations.json"));
                using var dialog = reopened.SaveDialog(key, "output.test", "All|*.*");
                if (dialog.InitialDirectory != folder || dialog.FileName != "output.test")
                    throw new InvalidDataException("保存窗口未恢复目录或文件名错误。");
                foreach (var test in cases)
                    if (reopened.InitialDirectory(test.Key) != folder)
                        throw new InvalidDataException("导入入口未沿用最近保存目录。");
            }
            var vanished = Path.Combine(inputRoot, "never-created", "child");
            restored.RememberFile("missing-directory", Path.Combine(vanished, "test.png"));
            if (restored.InitialDirectory("missing-directory") != inputRoot)
                throw new InvalidDataException("目录消失后应回退到最近存在的父目录。");
            var report = new { passed = true, importedViaNativePicker = cases.Select(test => test.Key), rememberedSavePickers = new[] { "save-project", "save-package", "save-annotated" }, survivesRestart = true, newPickerUsesRecentDirectory = true, cancellationKeepsDirectory = true, missingDirectoryFallsBack = true, dialogInitialDirectoriesVerified = true, selectionAutomatedInIsolatedProfile = true };
            await File.WriteAllTextAsync(Path.Combine(_smokeDirectory, "file-picker-smoke.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        }
        finally
        {
            _smokeChosenFile = null;

            await core.ExecuteScriptAsync("window.confirm = window.quangaiSmokeConfirm; delete window.quangaiSmokeConfirm");
        }
    }
}
