using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Quangai;

internal sealed class AgentWorkspace : IDisposable
{
    private const int ChunkSize = 524288;
    private const long MaxArchiveSize = 536870912;
    private readonly string _legacyRoot;
    private readonly string _locationsFile;
    private readonly Dictionary<string, string> _folders;
    private readonly Action<object> _emit;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 1000 };
    private string? _transferId;
    private string? _activeId;
    private string? _acknowledged;
    private string? _reportedError;
    private DateTime _lastSent;
    private byte[]? _pendingImage;
    private string? _pendingHash;
    private bool _checking;
    private bool _disposed;

    internal AgentWorkspace(string legacyRoot, string locationsFile, Action<object> emit)
    {
        _legacyRoot = Path.GetFullPath(legacyRoot);
        _locationsFile = locationsFile;
        try
        {
            _folders = File.Exists(locationsFile)
                ? JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(locationsFile)) ?? []
                : [];
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            Trace.WriteLine("Agent folder locations could not be restored: " + error.Message);
            _folders = [];
        }
        _emit = emit;
        _timer.Tick += async (_, _) => await CheckResultAsync();
        _timer.Start();
    }

    private string Folder(string id)
    {
        if (!Guid.TryParseExact(id, "D", out var parsed) || parsed.ToString() != id)
            throw new InvalidDataException("协作标识无效。");
        var folder = _folders.GetValueOrDefault(id) ?? Path.Combine(_legacyRoot, id);
        if (!Path.IsPathFullyQualified(folder) || Path.GetFileName(folder) != id)
            throw new InvalidDataException("保存的协作目录位置无效。");
        RejectLink(Path.GetDirectoryName(folder)!);
        if (Directory.Exists(folder) && File.GetAttributes(folder).HasFlag(FileAttributes.ReparsePoint))
            throw new IOException("协作目录不能是链接目录。");
        return folder;
    }

    internal async Task<object> BeginAsync(string root)
    {
        if (!Path.IsPathFullyQualified(root) || !Directory.Exists(root))
            throw new DirectoryNotFoundException("选择的协作保存文件夹已不存在，请重新选择。");
        root = Path.GetFullPath(root);
        RejectLink(root);
        var id = Guid.NewGuid().ToString();
        var folder = Path.Combine(root, id);
        _folders.Add(id, folder);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_locationsFile)!);
            var temporary = _locationsFile + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(_folders));
            File.Move(temporary, _locationsFile, overwrite: true);
        }
        catch
        {
            _folders.Remove(id);
            throw;
        }
        Directory.CreateDirectory(folder);
        await File.WriteAllBytesAsync(Path.Combine(folder, "transfer.zip"), []);
        _transferId = id;
        return new { sessionId = id, folder };
    }

    private static void RejectLink(string path)
    {
        if (File.Exists(path) || Directory.Exists(path))
            if (File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint))
                throw new IOException("协作文件不能是链接文件。");
    }

    private static string Required(JsonElement request, string key) =>
        request.GetProperty(key).GetString() ?? throw new InvalidDataException("请求缺少字段：" + key);

    internal async Task<object?> DispatchAsync(JsonElement request)
    {
        switch (Required(request, "command"))
        {
            case "agent-begin":
                throw new InvalidDataException("请先选择协作目录的保存文件夹。");
            case "agent-append":
                var transferId = Required(request, "sessionId");
                if (transferId != _transferId) throw new InvalidDataException("当前导出轮次不匹配。");
                var bytes = Convert.FromBase64String(Required(request, "base64"));
                if (bytes.Length > ChunkSize) throw new InvalidDataException("传输块过大。");
                await using (var stream = new FileStream(Path.Combine(Folder(transferId), "transfer.zip"), FileMode.Open, FileAccess.Write, FileShare.None))
                {
                    if (stream.Length != request.GetProperty("offset").GetInt64() || stream.Length + bytes.Length > MaxArchiveSize)
                        throw new InvalidDataException("传输顺序错误或协作包超过 512 MB。");
                    stream.Position = stream.Length;
                    await stream.WriteAsync(bytes);
                }
                return null;
            case "agent-finish":
                return await FinishAsync(Required(request, "sessionId"));
            case "agent-bind":
                var binding = request.GetProperty("sessionId").GetString();
                if (binding is null) { Watch(null); return null; }
                var info = ReadInfo(binding);
                Watch(binding, force: true);
                return info;
            case "agent-open":
                var openId = Required(request, "sessionId");
                ReadInfo(openId);
                Process.Start(new ProcessStartInfo(Folder(openId)) { UseShellExecute = true });
                return null;
            case "agent-read-result":
                if (Required(request, "sessionId") != _activeId || Required(request, "sha256") != _pendingHash || _pendingImage is null)
                    throw new InvalidDataException("回传版本已更新，请等待最新修改稿。");
                var offset = request.GetProperty("offset").GetInt32();
                if (offset < 0 || offset >= _pendingImage.Length) throw new InvalidDataException("回传偏移无效。");
                return new { base64 = Convert.ToBase64String(_pendingImage, offset, Math.Min(ChunkSize, _pendingImage.Length - offset)) };
            case "agent-ack":
                if (Required(request, "sessionId") == _activeId && Required(request, "sha256") == _pendingHash)
                {
                    _acknowledged = _pendingHash;
                    _pendingImage = null;
                }
                return null;
            default:
                throw new InvalidDataException("不支持的协作操作。");
        }
    }

    private async Task<object> FinishAsync(string id)
    {
        if (id != _transferId) throw new InvalidDataException("当前导出轮次不匹配。");
        var folder = Folder(id);
        using (var archive = ZipFile.OpenRead(Path.Combine(folder, "transfer.zip")))
        {
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long total = 0;
            if (archive.Entries.Count > 400) throw new InvalidDataException("协作文件数量过多。");
            foreach (var entry in archive.Entries)
            {
                var allowed = entry.FullName is "original.png" or "annotated.png" or "reference.png" or "reference-annotated.png" or "revised.png" or "instructions.md" or "annotations.json" or "project.quangai.json" or "agent-session.json" or "submit_result.py" or "agent-prompt.txt"
                    || Regex.IsMatch(entry.FullName, @"^crops/[1-9][0-9]*-(change|preserve|move|reference)\.png$");
                total += entry.Length;
                if (!allowed || !names.Add(entry.FullName) || total > MaxArchiveSize)
                    throw new InvalidDataException("协作包包含无效路径、重复文件或体积过大。");
            }
            if (!names.IsSupersetOf(["original.png", "instructions.md", "project.quangai.json", "agent-session.json", "submit_result.py", "agent-prompt.txt"]))
                throw new InvalidDataException("协作包缺少必要文件。");
            foreach (var entry in archive.Entries)
            {
                var destination = Path.Combine(folder, entry.FullName.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                await using var input = entry.Open();
                await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                await input.CopyToAsync(output);
            }
        }
        using var metadata = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(folder, "agent-session.json")));
        if (metadata.RootElement.GetProperty("sessionId").GetString() != id)
            throw new InvalidDataException("协作包与当前轮次不匹配。");
        var originalHash = Convert.ToHexStringLower(SHA256.HashData(await File.ReadAllBytesAsync(Path.Combine(folder, "original.png"))));
        await File.WriteAllTextAsync(Path.Combine(folder, "agent-session.json"), JsonSerializer.Serialize(new { version = 1, sessionId = id, originalSha256 = originalHash }));
        Directory.CreateDirectory(Path.Combine(folder, "result"));
        File.Delete(Path.Combine(folder, "transfer.zip"));
        _transferId = null;
        Watch(id);
        return ReadInfo(id);
    }

    private object ReadInfo(string id)
    {
        var folder = Folder(id);
        var path = Path.Combine(folder, "agent-session.json");
        RejectLink(path);
        RejectLink(Path.Combine(folder, "agent-prompt.txt"));
        if (new FileInfo(path).Length > 32768) throw new InvalidDataException("协作信息损坏。");
        using var metadata = JsonDocument.Parse(File.ReadAllText(path));
        var hash = metadata.RootElement.GetProperty("originalSha256").GetString();
        if (metadata.RootElement.GetProperty("sessionId").GetString() != id || hash is null || !Regex.IsMatch(hash, "^[0-9a-f]{64}$"))
            throw new InvalidDataException("协作信息损坏或轮次不匹配。");
        var promptFile = Path.Combine(folder, "agent-prompt.txt");
        if (new FileInfo(promptFile).Length > 32768) throw new InvalidDataException("协作提示词过长。");
        return new { sessionId = id, folder, originalSha256 = hash, prompt = File.ReadAllText(promptFile) };
    }

    private void Watch(string? id, bool force = false)
    {
        if (_activeId == id && !force) return;
        _activeId = id;
        _acknowledged = null;
        _pendingImage = null;
        _pendingHash = null;
        _reportedError = null;
        _lastSent = DateTime.MinValue;
    }

    private async Task CheckResultAsync()
    {
        if (_checking || _activeId is null || _disposed) return;
        _checking = true;
        var id = _activeId;
        try
        {
            var folder = Folder(id);
            var result = Path.Combine(folder, "result");
            RejectLink(result);
            var marker = Path.Combine(result, "ready.json");
            if (!File.Exists(marker)) return;
            RejectLink(marker);
            if (new FileInfo(marker).Length > 32768) throw new InvalidDataException("回传标记过大。");
            using var ready = JsonDocument.Parse(await File.ReadAllTextAsync(marker));
            var data = ready.RootElement;
            if (data.GetProperty("version").GetInt32() != 1 || data.GetProperty("sessionId").GetString() != id || data.GetProperty("fileName").GetString() != "revised.png")
                throw new InvalidDataException("回传标记轮次或文件名不匹配，请重新提交。");
            var hash = data.GetProperty("sha256").GetString();
            if (hash is null || !Regex.IsMatch(hash, "^[0-9a-f]{64}$")) throw new InvalidDataException("回传校验值无效。");
            if (hash == _acknowledged) return;
            if (_pendingHash != hash)
            {
                var picture = Path.Combine(result, "revised.png");
                RejectLink(picture);
                var size = new FileInfo(picture).Length;
                if (size > 40000000 || size < 24) throw new InvalidDataException("回传图片超过 40 MB 或内容不完整。");
                var image = await File.ReadAllBytesAsync(picture);
                if (Convert.ToHexStringLower(SHA256.HashData(image)) != hash) throw new InvalidDataException("回传图片尚未完整写入或校验不匹配，请重新提交。");
                if (!image.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) throw new InvalidDataException("回传成品必须为 PNG。");
                if (id != _activeId || _disposed) return;
                _pendingImage = image;
                _pendingHash = hash;
            }
            if (_pendingImage is null || DateTime.UtcNow - _lastSent < TimeSpan.FromSeconds(3)) return;
            using var info = JsonDocument.Parse(JsonSerializer.Serialize(ReadInfo(id)));
            _emit(new { type = "agent-result", sessionId = id, sha256 = hash, size = _pendingImage.Length, originalSha256 = info.RootElement.GetProperty("originalSha256").GetString() });
            _lastSent = DateTime.UtcNow;
            _reportedError = null;
        }
        catch (Exception error) when (error is IOException or InvalidDataException or JsonException or InvalidOperationException or KeyNotFoundException or UnauthorizedAccessException or FormatException or ArgumentException)
        {
            if (!_disposed && id == _activeId && _reportedError != error.Message)
            {
                _reportedError = error.Message;
                _emit(new { type = "agent-error", sessionId = id, message = "回传未载入：" + error.Message });
            }
        }
        finally { _checking = false; }
    }

    public void Dispose()
    {
        _disposed = true;
        _timer.Dispose();
        _pendingImage = null;
    }
}
