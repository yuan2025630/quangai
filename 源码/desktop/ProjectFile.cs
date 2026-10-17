using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Quangai;

internal static class ProjectFile
{
    internal static void Validate(string projectJson)
    {
        if (Encoding.UTF8.GetByteCount(projectJson) > 180_000_000)
            throw new InvalidDataException("项目文件超过 180 MB，请缩小图片后再保存。");
        using var document = JsonDocument.Parse(projectJson);
        var project = document.RootElement;
        if (project.ValueKind != JsonValueKind.Object
            || !project.TryGetProperty("schemaVersion", out var version) || !version.TryGetInt32(out var schema) || schema != 1
            || !project.TryGetProperty("images", out var images) || images.ValueKind != JsonValueKind.Object
            || !images.TryGetProperty("original", out var original) || original.ValueKind is not (JsonValueKind.Object or JsonValueKind.Null)
            || !project.TryGetProperty("annotations", out var notes) || notes.ValueKind != JsonValueKind.Array)
            throw new InvalidDataException("项目数据无效，未保存文件。");
        if (project.TryGetProperty("presentation", out var deck) && deck.ValueKind != JsonValueKind.Null)
        {
            if (deck.ValueKind != JsonValueKind.Object || !deck.TryGetProperty("pages", out var pages)
                || pages.ValueKind != JsonValueKind.Array || pages.GetArrayLength() is < 1 or > 400
                || !deck.TryGetProperty("activePage", out var active) || !active.TryGetInt32(out var pageNumber)
                || pageNumber < 1 || pageNumber > pages.GetArrayLength()
                || !Guid.TryParseExact(deck.GetProperty("assetId").GetString(), "N", out _))
                throw new InvalidDataException("PPT 项目页面数据无效，未保存文件。");
            var identifiers = new HashSet<int>();
            var number = 0;
            foreach (var page in pages.EnumerateArray())
            {
                if (page.GetProperty("number").GetInt32() != ++number || !page.GetProperty("slideId").TryGetInt32(out var slideId)
                    || slideId < 1 || !identifiers.Add(slideId)
                    || page.GetProperty("images").GetProperty("original").ValueKind != JsonValueKind.Object
                    || page.GetProperty("annotations").ValueKind != JsonValueKind.Array)
                    throw new InvalidDataException("PPT 项目页面标识或预览无效，未保存文件。");
            }
        }
        if (project.TryGetProperty("completedAt", out var completed) && completed.ValueKind != JsonValueKind.Null
            && (completed.ValueKind != JsonValueKind.String
                || !DateTimeOffset.TryParse(completed.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _)))
            throw new InvalidDataException("项目完成时间无效，未保存文件。");
    }

    internal static void ValidateCompleted(string projectJson)
    {
        Validate(projectJson);
        using var document = JsonDocument.Parse(projectJson);
        if (!document.RootElement.TryGetProperty("completedAt", out var completed) || completed.ValueKind != JsonValueKind.String
            || document.RootElement.GetProperty("images").GetProperty("original").ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("完成项目数据无效，未保存文件。");
    }

    internal static async Task SaveAsync(string filename, string projectJson, CancellationToken cancellationToken)
    {
        Validate(projectJson);
        var temporary = filename + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(temporary, projectJson, new UTF8Encoding(false), cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            File.Move(temporary, filename, overwrite: true);
        }
        finally
        {
            try { if (File.Exists(temporary)) File.Delete(temporary); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            { Trace.WriteLine("Incomplete project save could not be removed: " + error.Message); }
        }
    }
}
