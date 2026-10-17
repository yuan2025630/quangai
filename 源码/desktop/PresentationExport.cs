using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Security.Cryptography;

namespace Quangai;

internal static class PresentationExport
{
    internal static async Task<object> WriteAsync(ProjectLibrary library, JsonElement request)
    {
        var projectJson = request.GetProperty("projectJson").GetString()!;
        ProjectFile.Validate(projectJson);
        using var document = JsonDocument.Parse(projectJson);
        var project = document.RootElement;
        var id = project.GetProperty("storageId").GetString()!;
        var deck = project.GetProperty("presentation");
        var source = library.Source(id, deck.GetProperty("assetId").GetString()!);
        if (!Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(source))).Equals(deck.GetProperty("sha256").GetString(), StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("项目里的 PPT 副本已在外部改变，请重新导入后再导出，避免页码与预览错位。");
        var parent = Path.Combine(library.Resolve(id), "导出");
        Directory.CreateDirectory(parent);
        ProjectLibrary.RejectLink(parent);
        var folder = Path.Combine(parent, DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(folder);
        var files = request.GetProperty("files");
        if (files.ValueKind != JsonValueKind.Array || files.GetArrayLength() > 2400)
            throw new InvalidDataException("导出文件清单无效。");
        long bytesWritten = 0;
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in files.EnumerateArray())
        {
            var name = file.GetProperty("name").GetString() ?? "";
            var destination = Path.GetFullPath(Path.Combine(folder, name.Replace('/', Path.DirectorySeparatorChar)));
            if (string.IsNullOrWhiteSpace(name) || name.Contains('\\') || name.Contains(':') || !names.Add(name)
                || !destination.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
                || Path.GetExtension(name) is not (".png" or ".json" or ".txt" or ".md"))
                throw new InvalidDataException("导出文件路径无效。");
            var bytes = file.TryGetProperty("base64", out var binary)
                ? Convert.FromBase64String(binary.GetString()!)
                : Encoding.UTF8.GetBytes(file.GetProperty("text").GetString()!);
            bytesWritten += bytes.Length;
            if (bytesWritten > 180_000_000) throw new InvalidDataException("本轮导出超过 180 MB，请减少圈选或图片素材。");
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            await File.WriteAllBytesAsync(destination, bytes);
        }
        Directory.CreateDirectory(Path.Combine(folder, "source"));
        File.Copy(source, Path.Combine(folder, "source", "original" + Path.GetExtension(source)));
        if (deck.TryGetProperty("revisedAssetId", out var revised) && revised.ValueKind == JsonValueKind.String)
        {
            var revisedSource = library.Source(id, revised.GetString()!);
            File.Copy(revisedSource, Path.Combine(folder, "source", "revised" + Path.GetExtension(revisedSource)));
        }
        string? archive = null;
        if (request.GetProperty("archive").GetBoolean())
        {
            archive = folder + ".zip";
            ZipFile.CreateFromDirectory(folder, archive, CompressionLevel.Optimal, includeBaseDirectory: false);
        }
        return new { folder, archive };
    }
}
