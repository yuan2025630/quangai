using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace Quangai;

internal sealed record ManagedProject(string Id, string Title, string Folder, string ProjectFile, int Pages, DateTimeOffset UpdatedAt);

internal sealed class ProjectLibrary
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _settingsFile;
    private readonly SemaphoreSlim _saveGate = new(1, 1);
    internal string Root { get; private set; }

    internal ProjectLibrary(string settingsFile, string defaultRoot)
    {
        _settingsFile = settingsFile;
        Root = Path.GetFullPath(defaultRoot);
        if (File.Exists(settingsFile))
        {
            try
            {
                using var settings = JsonDocument.Parse(File.ReadAllText(settingsFile));
                Root = Path.GetFullPath(settings.RootElement.GetProperty("root").GetString()!);
            }
            catch (Exception error) when (error is IOException or JsonException or ArgumentException or KeyNotFoundException)
            { Trace.WriteLine("Project folder setting could not be read: " + error.Message); }
        }
        Directory.CreateDirectory(Root);
        RejectLink(Root);
    }

    internal IReadOnlyList<ManagedProject> List()
    {
        var entries = new List<ManagedProject>();
        foreach (var folder in Directory.EnumerateDirectories(Root))
        {
            if (Path.GetFileName(folder).StartsWith('.')) continue;
            var marker = Path.Combine(folder, ".quangai-project.json");
            if (!File.Exists(marker)) continue;
            RejectLink(folder);
            RejectLink(marker);
            try
            {
                var entry = JsonSerializer.Deserialize<ManagedProject>(File.ReadAllText(marker), JsonOptions);
                if (entry is not null && Guid.TryParseExact(entry.Id, "D", out _))
                    entries.Add(entry with { Folder = folder, ProjectFile = Path.Combine(folder, "项目.quangai.json") });
            }
            catch (JsonException error) { Trace.WriteLine("Damaged project marker: " + error.Message); }
        }
        return entries.OrderByDescending(entry => entry.UpdatedAt).ToArray();
    }

    internal string Resolve(string id)
    {
        if (!Guid.TryParseExact(id, "D", out _)) throw new InvalidDataException("项目标识无效。");
        var entry = List().SingleOrDefault(item => item.Id == id)
            ?? throw new FileNotFoundException("项目文件夹不存在，请从项目管理中重新打开。");
        return entry.Folder;
    }

    internal async Task<ManagedProject> CreateAsync(string projectJson)
    {
        ProjectFile.Validate(projectJson);
        using var project = JsonDocument.Parse(projectJson);
        var id = Guid.NewGuid().ToString("D");
        var title = project.RootElement.GetProperty("title").GetString() ?? "未命名修改单";
        var folder = Path.Combine(Root, FolderName(title, id));
        Directory.CreateDirectory(folder);
        var entry = new ManagedProject(id, title, folder, Path.Combine(folder, "项目.quangai.json"), 0, DateTimeOffset.UtcNow);
        WriteMarker(entry);
        return await SaveAsync(id, WithStorageId(project.RootElement, id));
    }

    internal async Task ImportLegacyProjectsAsync(string directory)
    {
        if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory)
            || Path.GetFullPath(directory).Equals(Root, StringComparison.OrdinalIgnoreCase)) return;
        RejectLink(directory);
        var indexFile = Path.Combine(Root, ".legacy-imports.json");
        var imported = File.Exists(indexFile)
            ? JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(indexFile)) ?? [] : [];
        foreach (var file in Directory.EnumerateFiles(directory, "*.quangai.json", SearchOption.TopDirectoryOnly))
        {
            RejectLink(file);
            var json = await File.ReadAllTextAsync(file);
            var hash = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(json)));
            if (imported.ContainsKey(hash)) continue;
            try
            {
                var entry = await CreateAsync(json);
                imported[hash] = entry.Id;
                File.WriteAllText(indexFile + ".tmp", JsonSerializer.Serialize(imported));
                File.Move(indexFile + ".tmp", indexFile, overwrite: true);
            }
            catch (Exception error) when (error is JsonException or InvalidDataException or KeyNotFoundException or InvalidOperationException or FormatException)
            { Trace.WriteLine("Invalid legacy project was preserved: " + file + ": " + error.Message); }
        }
    }

    internal async Task<ManagedProject> SaveAsync(string id, string projectJson)
    {
        ProjectFile.Validate(projectJson);
        await _saveGate.WaitAsync();
        try
        {
            var folder = Resolve(id);
            using var project = JsonDocument.Parse(projectJson);
            var value = project.RootElement;
            var title = value.GetProperty("title").GetString() ?? "未命名修改单";
            var pages = value.TryGetProperty("presentation", out var deck) && deck.ValueKind == JsonValueKind.Object
                ? deck.GetProperty("pages").GetArrayLength() : 0;
            await ProjectFile.SaveAsync(Path.Combine(folder, "项目.quangai.json"), WithStorageId(value, id), CancellationToken.None);
            var renamed = Path.Combine(Root, FolderName(title, id));
            if (!folder.Equals(renamed, StringComparison.OrdinalIgnoreCase))
            {
                Directory.Move(folder, renamed);
                folder = renamed;
            }
            var entry = new ManagedProject(id, title, folder, Path.Combine(folder, "项目.quangai.json"), pages, DateTimeOffset.UtcNow);
            WriteMarker(entry);
            return entry;
        }
        finally { _saveGate.Release(); }
    }

    internal string Read(string id)
    {
        var file = Path.Combine(Resolve(id), "项目.quangai.json");
        RejectLink(file);
        var json = File.ReadAllText(file);
        ProjectFile.Validate(json);
        return json;
    }

    internal string ResolveExportFolder(string id, string? folder)
    {
        if (string.IsNullOrWhiteSpace(folder))
            throw new InvalidDataException("请先导出当前 PPT 的协作目录或 ZIP 修改包。");
        RejectLink(Root);
        using var project = JsonDocument.Parse(Read(id));
        if (!project.RootElement.TryGetProperty("presentation", out var deck) || deck.ValueKind != JsonValueKind.Object
            || !deck.TryGetProperty("exportFolder", out var saved) || saved.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(saved.GetString()))
            throw new InvalidDataException("请先导出当前 PPT 的协作目录或 ZIP 修改包。");
        var savedFolder = ExportPath(saved.GetString()!);
        var requestedFolder = ExportPath(folder);
        var exportRoot = Path.Combine(Resolve(id), "导出");
        var currentFolder = Path.GetFullPath(Path.Combine(exportRoot, Path.GetFileName(savedFolder)));
        if (!currentFolder.StartsWith(exportRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            || !requestedFolder.Equals(savedFolder, StringComparison.OrdinalIgnoreCase)
                && !requestedFolder.Equals(currentFolder, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("导出目录不属于当前项目的最近一次导出，请重新导出。");
        if (!Directory.Exists(exportRoot) || !Directory.Exists(currentFolder))
            throw new InvalidDataException("导出目录不存在，请重新导出。");
        RejectLink(exportRoot);
        RejectLink(currentFolder);
        return currentFolder;
    }

    private static string ExportPath(string path)
    {
        if (!Path.IsPathFullyQualified(path) || path.Split(['\\', '/']).Any(part => part is "." or ".."))
            throw new InvalidDataException("导出目录路径无效，请重新导出。");
        try
        {
            var fullPath = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var name = Path.GetFileName(fullPath);
            if (string.IsNullOrWhiteSpace(name) || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
                || name.TrimEnd('.', ' ') != name)
                throw new InvalidDataException("导出目录名称无效，请重新导出。");
            return fullPath;
        }
        catch (ArgumentException error)
        { throw new InvalidDataException("导出目录路径无效，请重新导出。", error); }
    }

    internal string StoreSource(string id, string assetId, string source)
    {
        if (!Guid.TryParseExact(assetId, "N", out _)) throw new InvalidDataException("文件副本标识无效。");
        var directory = Path.Combine(Resolve(id), "源文件");
        Directory.CreateDirectory(directory);
        RejectLink(directory);
        var target = Path.Combine(directory, assetId + Path.GetExtension(source).ToLowerInvariant());
        File.Copy(source, target, overwrite: false);
        return target;
    }

    internal string Source(string id, string assetId)
    {
        if (!Guid.TryParseExact(assetId, "N", out _)) throw new InvalidDataException("PPT 文件副本标识无效。");
        var directory = Path.Combine(Resolve(id), "源文件");
        RejectLink(directory);
        var files = Directory.GetFiles(directory, assetId + ".*");
        if (files.Length != 1 || Path.GetExtension(files[0]).ToLowerInvariant() is not (".ppt" or ".pptx"))
            throw new FileNotFoundException("项目内的 PPT 源文件副本缺失，请重新导入。");
        RejectLink(files[0]);
        return files[0];
    }

    internal string Trash(string id)
    {
        var folder = Resolve(id);
        var trash = Path.Combine(Root, ".项目回收站");
        Directory.CreateDirectory(trash);
        RejectLink(trash);
        var destination = Path.Combine(trash, Path.GetFileName(folder) + "-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fffffff"));
        Directory.Move(folder, destination);
        return destination;
    }

    internal void ChangeRoot(string destination)
    {
        destination = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar);
        if (destination.Equals(Root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) return;
        if (destination.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            || Root.StartsWith(destination + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("新旧项目文件夹不能互相包含。");
        Directory.CreateDirectory(destination);
        RejectLink(destination);
        var projects = List();
        var extraFolders = new[] { Path.Combine(Root, ".项目回收站") }.Where(Directory.Exists).ToArray();
        var legacyIndex = Path.Combine(Root, ".legacy-imports.json");
        foreach (var extra in extraFolders)
        {
            CheckTree(extra);
            if (Directory.Exists(Path.Combine(destination, Path.GetFileName(extra))))
                throw new IOException("目标位置已有项目回收站，请选择空文件夹迁移。");
        }
        if (File.Exists(legacyIndex) && File.Exists(Path.Combine(destination, ".legacy-imports.json")))
            throw new IOException("目标位置已有项目迁入记录，请选择空文件夹迁移。");
        foreach (var entry in projects)
        {
            var target = Path.Combine(destination, Path.GetFileName(entry.Folder));
            if (Directory.Exists(target)) throw new IOException("目标文件夹已有同名项目，未开始迁移。");
            CheckTree(entry.Folder);
        }
        var copied = new List<string>();
        string? copiedIndex = null;
        try
        {
            foreach (var entry in projects)
            {
                var target = Path.Combine(destination, Path.GetFileName(entry.Folder));
                copied.Add(target);
                CopyTree(entry.Folder, target);
            }
            foreach (var extra in extraFolders)
            {
                var target = Path.Combine(destination, Path.GetFileName(extra));
                copied.Add(target);
                CopyTree(extra, target);
            }
            if (File.Exists(legacyIndex))
            {
                RejectLink(legacyIndex);
                copiedIndex = Path.Combine(destination, ".legacy-imports.json");
                File.Copy(legacyIndex, copiedIndex);
            }
            Directory.CreateDirectory(Path.GetDirectoryName(_settingsFile)!);
            File.WriteAllText(_settingsFile + ".tmp", JsonSerializer.Serialize(new { root = destination }, JsonOptions));
            File.Move(_settingsFile + ".tmp", _settingsFile, overwrite: true);
        }
        catch
        {
            // Preserve a failed copy for recovery; the original library remains active.
            foreach (var folder in copied)
                if (Directory.Exists(folder)) Directory.Move(folder, folder + ".迁移未完成-" + Guid.NewGuid().ToString("N"));
            if (copiedIndex is not null && File.Exists(copiedIndex)) File.Move(copiedIndex, copiedIndex + ".迁移未完成-" + Guid.NewGuid().ToString("N"));
            throw;
        }
        var previous = Root;
        Root = destination;
        // Retain old copies in the old library's recovery folder instead of deleting data.
        try
        {
            var recovery = Path.Combine(previous, ".已迁移备份");
            Directory.CreateDirectory(recovery);
            RejectLink(recovery);
            foreach (var entry in projects)
            {
                try { Directory.Move(entry.Folder, Path.Combine(recovery, Path.GetFileName(entry.Folder) + "-" + Guid.NewGuid().ToString("N"))); }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                { Trace.WriteLine("Migration succeeded; old recovery copy remains: " + error.Message); }
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException)
        { Trace.WriteLine("Migration succeeded; old copies remain at their original location: " + error.Message); }
    }

    private static string WithStorageId(JsonElement project, string id)
    {
        var fields = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(project.GetRawText())!;
        fields["storageId"] = JsonSerializer.SerializeToElement(id);
        return JsonSerializer.Serialize(fields);
    }

    private static string FolderName(string title, string id)
    {
        var safe = string.Concat(title.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c)).Trim().TrimEnd('.');
        if (safe.Length > 60) safe = safe[..60];
        return (string.IsNullOrWhiteSpace(safe) ? "未命名项目" : safe) + "-" + Guid.Parse(id).ToString("N");
    }

    private static void WriteMarker(ManagedProject entry)
    {
        var path = Path.Combine(entry.Folder, ".quangai-project.json");
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(entry, JsonOptions));
        File.Move(path + ".tmp", path, overwrite: true);
    }

    internal static void RejectLink(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("项目文件夹和文件不能使用链接或重解析点。");
    }

    private static void CheckTree(string folder)
    {
        RejectLink(folder);
        foreach (var file in Directory.EnumerateFiles(folder)) RejectLink(file);
        foreach (var child in Directory.EnumerateDirectories(folder)) CheckTree(child);
    }

    private static void CopyTree(string source, string target)
    {
        Directory.CreateDirectory(target);
        foreach (var file in Directory.EnumerateFiles(source)) File.Copy(file, Path.Combine(target, Path.GetFileName(file)));
        foreach (var child in Directory.EnumerateDirectories(source)) CopyTree(child, Path.Combine(target, Path.GetFileName(child)));
    }
}
