using System.Diagnostics;
using System.Text.Json;

namespace Quangai;

internal sealed class FilePickerLocations
{
    private readonly string _settingsFile;
    private readonly Dictionary<string, string> _directories;
    private const string RecentKey = "recent";

    internal FilePickerLocations(string settingsFile)
    {
        _settingsFile = settingsFile;
        try
        {
            _directories = File.Exists(settingsFile)
                ? JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(settingsFile)) ?? []
                : [];
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            // Directory preferences are recoverable; a damaged preference must not block the editor.
            Trace.WriteLine("File picker preferences could not be restored: " + error.Message);
            _directories = [];
        }
    }

    internal string InitialDirectory(string key)
    {
        foreach (var candidate in new[] { _directories.GetValueOrDefault(RecentKey), _directories.GetValueOrDefault(key) })
        {
            var existing = ExistingAncestor(candidate);
            if (existing is not null) return existing;
        }
        return Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
    }

    internal string RememberedDirectory(string key, string defaultDirectory) =>
        ExistingAncestor(_directories.GetValueOrDefault(key)) ?? defaultDirectory;

    private static string? ExistingAncestor(string? directory)
    {
        if (string.IsNullOrWhiteSpace(directory) || !Path.IsPathFullyQualified(directory)) return null;
        try
        {
            for (var current = Path.GetFullPath(directory); current is not null; current = Path.GetDirectoryName(current))
                if (Directory.Exists(current)) return current;
        }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or IOException)
        {
            Trace.WriteLine("File picker directory is no longer usable: " + error.Message);
        }
        return null;
    }

    internal void RememberFile(string key, string filename)
    {
        var directory = Path.GetDirectoryName(Path.GetFullPath(filename))
            ?? throw new InvalidDataException("选择文件的目录无效。");
        RememberDirectory(key, directory);
    }

    internal void RememberDirectory(string key, string directory)
    {
        directory = Path.GetFullPath(directory);
        _directories[key] = directory;
        _directories[RecentKey] = directory;
        Directory.CreateDirectory(Path.GetDirectoryName(_settingsFile)!);
        var temporary = _settingsFile + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(_directories));
        File.Move(temporary, _settingsFile, overwrite: true);
    }

    internal OpenFileDialog OpenDialog(string key, string title, string filter) => new()
    {
        Title = title,
        Filter = filter,
        InitialDirectory = InitialDirectory(key),
        RestoreDirectory = true,
        CheckFileExists = true,
        Multiselect = false
    };

    internal SaveFileDialog SaveDialog(string key, string filename, string filter) => new()
    {
        Title = "保存圈改文件",
        FileName = filename,
        Filter = filter,
        InitialDirectory = InitialDirectory(key),
        RestoreDirectory = true,
        OverwritePrompt = true
    };
}
