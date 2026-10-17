using System.Drawing.Drawing2D;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Quangai;

internal sealed record WallpaperEntry(string Id, string Name, string Kind, string Source,
    string Src, string Thumbnail, string BaseUrl, string? Video, long Bytes,
    [property: JsonIgnore] string Folder, [property: JsonIgnore] string Host);

internal sealed record WallpaperInventory(IReadOnlyList<WallpaperEntry> Items,
    IReadOnlyList<string> Roots, IReadOnlyList<string> Warnings);

internal sealed class WallpaperLibrary : IDisposable
{
    private const int MaximumProjects = 2000;
    private readonly string _settingsFile;
    private readonly CancellationTokenSource _stop = new();
    internal string PreviewDirectory { get; }

    internal WallpaperLibrary(string directory)
    {
        _settingsFile = Path.Combine(directory, "wallpaper-library.json");
        PreviewDirectory = Path.Combine(directory, "wallpaper-previews");
    }

    internal Task<WallpaperInventory> ScanAsync() => Task.Run(() => Scan(FindRoots()), _stop.Token);

    internal async Task<WallpaperInventory> AddDirectoryAsync(string directory)
    {
        var candidate = Path.GetFullPath(directory);
        var probe = await Task.Run(() => Scan([candidate]), _stop.Token);
        if (probe.Items.Count == 0)
            throw new InvalidDataException("此目录没有可用的壁纸工程。请选择含 project.json 的壁纸目录，或 Steam 的 workshop/content/431960 目录。");
        var saved = ReadSavedRoots().Append(candidate).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        Directory.CreateDirectory(Path.GetDirectoryName(_settingsFile)!);
        var temporary = _settingsFile + ".tmp";
        await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(saved), _stop.Token);
        File.Move(temporary, _settingsFile, true);
        return await ScanAsync();
    }

    private IEnumerable<string> ReadSavedRoots()
    {
        if (!File.Exists(_settingsFile)) return [];
        try { return JsonSerializer.Deserialize<string[]>(File.ReadAllText(_settingsFile)) ?? []; }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        { return []; } // A corrupt source list must not prevent automatic Steam discovery.
    }

    private IEnumerable<string> FindRoots()
    {
        var steamFolders = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var key in new[] { Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"),
            Registry.LocalMachine.OpenSubKey(@"SOFTWARE\WOW6432Node\Valve\Steam"),
            Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Valve\Steam") })
        {
            using (key)
            {
                var path = key?.GetValue("SteamPath") as string ?? key?.GetValue("InstallPath") as string;
                if (!string.IsNullOrWhiteSpace(path)) steamFolders.Add(path);
            }
        }
        steamFolders.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Steam"));
        foreach (var drive in DriveInfo.GetDrives().Where(drive => drive.IsReady))
            foreach (var name in new[] { "Steam", "SteamLibrary" })
                steamFolders.Add(Path.Combine(drive.RootDirectory.FullName, name));
        foreach (var folder in steamFolders.ToArray())
        {
            var libraries = Path.Combine(folder, "steamapps", "libraryfolders.vdf");
            if (!File.Exists(libraries)) continue;
            try
            {
                foreach (Match match in Regex.Matches(File.ReadAllText(libraries), "\"path\"\\s*\"([^\"]+)\""))
                    steamFolders.Add(match.Groups[1].Value.Replace("\\\\", "\\"));
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { continue; }
        }
        return ReadSavedRoots().Concat(steamFolders.SelectMany(folder => new[] {
            Path.Combine(folder, "steamapps", "workshop", "content", "431960"),
            Path.Combine(folder, "steamapps", "common", "wallpaper_engine", "projects", "myprojects")
        })).Where(Directory.Exists).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private WallpaperInventory Scan(IEnumerable<string> directories)
    {
        var roots = directories.Where(Directory.Exists).Select(Path.GetFullPath)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var entries = new Dictionary<string, WallpaperEntry>();
        var warnings = new List<string>();
        foreach (var root in roots)
        {
            _stop.Token.ThrowIfCancellationRequested();
            try
            {
                if (IsReparsePoint(root)) { warnings.Add("已跳过链接目录：" + root); continue; }
                var projects = File.Exists(Path.Combine(root, "project.json"))
                    ? [root] : Directory.EnumerateDirectories(root).Take(MaximumProjects).ToArray();
                foreach (var project in projects)
                {
                    _stop.Token.ThrowIfCancellationRequested();
                    try
                    {
                        var entry = ReadProject(project);
                        if (entry is not null) entries.TryAdd(entry.Id, entry);
                    }
                    catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException
                        or ArgumentException or InvalidOperationException or NotSupportedException)
                    { warnings.Add(Path.GetFileName(project) + "：" + error.Message); }
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            { warnings.Add(root + "：" + error.Message); }
        }
        return new(entries.Values.OrderBy(entry => entry.Name, StringComparer.CurrentCultureIgnoreCase).ToArray(), roots, warnings);
    }

    internal WallpaperEntry? ReadProject(string folder)
    {
        if (IsReparsePoint(folder)) return null;
        var projectPath = SafeFile(folder, "project.json");
        if (projectPath is null || new FileInfo(projectPath).Length > 4 * 1024 * 1024) return null;
        using var project = JsonDocument.Parse(File.ReadAllText(projectPath));
        var definition = project.RootElement;
        var kind = Text(definition, "type").ToLowerInvariant();
        if (kind is not ("video" or "scene" or "web" or "image")) return null;
        var entryFile = Text(definition, "file");
        var media = SafeFile(folder, entryFile);
        var package = SafeFile(folder, "scene.pkg");
        if (kind == "scene" ? package is null && media is null : media is null) return null;
        if (kind == "video" && Path.GetExtension(media!).ToLowerInvariant() is not (".mp4" or ".webm" or ".m4v" or ".mov")) return null;
        if (kind == "web" && Path.GetExtension(media!).ToLowerInvariant() is not (".html" or ".htm")) return null;
        if (kind == "image" && Path.GetExtension(media!).ToLowerInvariant() is not (".png" or ".jpg" or ".jpeg" or ".webp" or ".gif" or ".bmp" or ".svg" or ".avif")) return null;
        if (HasLinkedAssets(folder)) throw new InvalidDataException("壁纸目录含链接文件，已跳过。");
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(folder).ToLowerInvariant())))[..20];
        var host = "entry-" + hash + ".quangai-wallpaper.local";
        var baseUrl = "https://" + host + "/";
        var previewName = Text(definition, "preview");
        var preview = SafeFile(folder, previewName);
        if (preview is null && kind == "image") { preview = media; previewName = entryFile; }
        var src = kind == "image" ? baseUrl + EncodePath(entryFile)
            : preview is null ? "https://quangai.local/wallpaper.svg" : baseUrl + EncodePath(previewName);
        var thumbnail = preview is null ? src : CreateThumbnail(preview, hash) ?? src;
        var title = Text(definition, "title");
        var size = new FileInfo(package ?? media!).Length;
        return new("we-" + hash, string.IsNullOrWhiteSpace(title) ? Path.GetFileName(folder) : title,
            kind, "Wallpaper Engine · 本机工程", src, thumbnail, baseUrl,
            kind == "video" ? baseUrl + EncodePath(entryFile) : null, size, folder, host);
    }

    internal static string? SafeFile(string directory, string relative)
    {
        if (string.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative)) return null;
        var root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var file = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!file.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(file)) return null;
        for (string? current = file; current is not null && current.StartsWith(root, StringComparison.OrdinalIgnoreCase);
            current = Path.GetDirectoryName(current))
            if (IsReparsePoint(current)) return null;
        return file;
    }

    private bool HasLinkedAssets(string folder)
    {
        var pending = new Queue<string>();
        pending.Enqueue(folder);
        var count = 0;
        while (pending.TryDequeue(out var directory))
            foreach (var path in Directory.EnumerateFileSystemEntries(directory))
            {
                _stop.Token.ThrowIfCancellationRequested();
                if (++count > 20000) throw new InvalidDataException("壁纸工程文件过多，暂未载入。");
                if (IsReparsePoint(path)) return true;
                if (Directory.Exists(path)) pending.Enqueue(path);
            }
        return false;
    }

    private string? CreateThumbnail(string file, string key)
    {
        var metadata = new FileInfo(file);
        var name = key + "-" + metadata.LastWriteTimeUtc.Ticks + "-" + metadata.Length + ".jpg";
        var target = Path.Combine(PreviewDirectory, name);
        if (!File.Exists(target))
        {
            try
            {
                using var image = Image.FromFile(file);
                var ratio = Math.Min(1, 480.0 / Math.Max(image.Width, image.Height));
                using var thumbnail = new Bitmap(Math.Max(1, (int)(image.Width * ratio)), Math.Max(1, (int)(image.Height * ratio)));
                using var graphics = Graphics.FromImage(thumbnail);
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.DrawImage(image, 0, 0, thumbnail.Width, thumbnail.Height);
                Directory.CreateDirectory(PreviewDirectory);
                thumbnail.Save(target, System.Drawing.Imaging.ImageFormat.Jpeg);
            }
            catch (Exception error) when (error is ArgumentException or IOException or UnauthorizedAccessException
                or OutOfMemoryException or System.Runtime.InteropServices.ExternalException) { return null; }
        }
        return "https://preview.quangai-wallpaper.local/" + name;
    }

    private static bool IsReparsePoint(string path) => (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;
    private static string Text(JsonElement element, string name) => element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
    private static string EncodePath(string path) => string.Join('/', path.Replace('\\', '/').Split('/').Select(Uri.EscapeDataString));
    public void Dispose() { _stop.Cancel(); _stop.Dispose(); }
}
