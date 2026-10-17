using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

namespace Quangai;

internal sealed record SlideImage(string Name, string Src, int Width, int Height);
internal sealed record RenderedSlide(int Number, int SlideId, string Title, SlideImage Image);
internal sealed record RenderedPresentation(string FileName, string AssetId, string Sha256, IReadOnlyList<RenderedSlide> Pages);

internal static class PresentationRenderer
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    internal static void CleanJob(string jobsRoot, string assetId)
    {
        try
        {
            if (!Guid.TryParseExact(assetId, "N", out _)) return;
            var parent = Path.GetFullPath(jobsRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var job = Path.GetFullPath(Path.Combine(parent, assetId));
            if (!job.StartsWith(parent, StringComparison.OrdinalIgnoreCase) || !Directory.Exists(job)) return;
            ProjectLibrary.RejectLink(job);
            if (Directory.EnumerateDirectories(job).Any()) return;
            var files = Directory.GetFiles(job);
            foreach (var file in files) ProjectLibrary.RejectLink(file);
            foreach (var file in files) File.Delete(file);
            Directory.Delete(job);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException)
        { Trace.WriteLine("PPT temporary preview retained: " + error.Message); }
    }

    internal static async Task<RenderedPresentation> ImportAsync(string source, string jobsRoot, Action<string> progress)
    {
        if (string.IsNullOrWhiteSpace(source)) throw new InvalidDataException("所选 PPT 没有本地文件路径，请通过“导入文件”重新选择。");
        var extension = Path.GetExtension(source).ToLowerInvariant();
        if (extension is not (".ppt" or ".pptx")) throw new InvalidDataException("请选择 .ppt 或 .pptx 文件。");
        if (new FileInfo(source).Length > 100_000_000) throw new InvalidDataException("PPT 超过 100 MB，请先缩小媒体素材。");
        var assetId = Guid.NewGuid().ToString("N");
        var job = Path.Combine(jobsRoot, assetId);
        Directory.CreateDirectory(job);
        var input = Path.Combine(job, "source" + extension);
        File.Copy(source, input);
        File.WriteAllText(Path.Combine(job, "request.json"), JsonSerializer.Serialize(new { fileName = Path.GetFileName(source), input = Path.GetFileName(input), assetId }, JsonOptions));
        var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add("--render-presentation");
        start.ArgumentList.Add(job);
        using var worker = Process.Start(start) ?? throw new IOException("无法启动 PPT 预览进程。");
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(3));
        var wait = worker.WaitForExitAsync(timeout.Token);
        var lastProgress = "";
        try
        {
            while (!wait.IsCompleted)
            {
                var status = Path.Combine(job, "progress.txt");
                if (File.Exists(status))
                {
                    var current = await File.ReadAllTextAsync(status, timeout.Token);
                    if (current != lastProgress) { lastProgress = current; progress(current); }
                }
                await Task.WhenAny(wait, Task.Delay(250, timeout.Token));
            }
            await wait;
        }
        catch (OperationCanceledException)
        {
            if (!worker.HasExited) worker.Kill();
            throw new TimeoutException("PPT 预览超过三分钟。请关闭该文件的密码或修复提示后重试。");
        }
        var error = Path.Combine(job, "error.txt");
        if (worker.ExitCode != 0)
            throw new InvalidDataException(File.Exists(error) ? File.ReadAllText(error) : "PPT 未能生成预览。");
        var result = JsonSerializer.Deserialize<RenderedPresentation>(await File.ReadAllTextAsync(Path.Combine(job, "result.json")), JsonOptions)
            ?? throw new InvalidDataException("PPT 预览结果为空。");
        return result;
    }

    internal static int RunJob(string directory)
    {
        dynamic? application = null, presentations = null, presentation = null, slides = null;
        int previousSecurity = 3, previousAlerts = 1;
        try
        {
            directory = Path.GetFullPath(directory);
            using var request = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "request.json")));
            var inputName = request.RootElement.GetProperty("input").GetString()!;
            if (inputName != Path.GetFileName(inputName)) throw new InvalidDataException("PPT 预览输入无效。");
            var source = Path.Combine(directory, inputName);
            var type = Type.GetTypeFromProgID("PowerPoint.Application")
                ?? throw new InvalidOperationException("PPT 预览需要安装 Microsoft PowerPoint 桌面版。");
            application = Activator.CreateInstance(type)!;
            previousSecurity = (int)application.AutomationSecurity;
            previousAlerts = (int)application.DisplayAlerts;
            application.DisplayAlerts = 1;
            presentations = application.Presentations;
            application.AutomationSecurity = 3;
            try { presentation = presentations.Open(source, -1, 0, 0); }
            finally { application.AutomationSecurity = previousSecurity; }
            slides = presentation.Slides;
            var count = (int)slides.Count;
            if (count < 1 || count > 400) throw new InvalidDataException("PPT 需包含 1–400 页。");
            dynamic setup = presentation.PageSetup;
            double width = setup.SlideWidth, height = setup.SlideHeight;
            Release(setup);
            var factor = 1600 / Math.Max(width, height);
            var imageWidth = Math.Max(1, (int)Math.Round(width * factor));
            var imageHeight = Math.Max(1, (int)Math.Round(height * factor));
            var pages = new List<RenderedSlide>();
            long totalBytes = 0;
            for (var number = 1; number <= count; number++)
            {
                dynamic slide = slides.Item(number);
                try
                {
                    var filename = $"page-{number:D3}.png";
                    var path = Path.Combine(directory, filename);
                    slide.Export(path, "PNG", imageWidth, imageHeight);
                    var bytes = File.ReadAllBytes(path);
                    totalBytes += bytes.Length;
                    if (totalBytes > 100_000_000) throw new InvalidDataException("PPT 预览超过 100 MB，请减少页数或图片素材。");
                    var title = ReadTitle(slide, number);
                    pages.Add(new RenderedSlide(number, (int)slide.SlideID, title,
                        new SlideImage(filename, "data:image/png;base64," + Convert.ToBase64String(bytes), imageWidth, imageHeight)));
                    File.WriteAllText(Path.Combine(directory, "progress.txt.tmp"), $"正在生成 PPT 预览：{number} / {count} 页");
                    File.Move(Path.Combine(directory, "progress.txt.tmp"), Path.Combine(directory, "progress.txt"), overwrite: true);
                }
                finally { Release(slide); }
            }
            var result = new RenderedPresentation(request.RootElement.GetProperty("fileName").GetString()!,
                request.RootElement.GetProperty("assetId").GetString()!,
                Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(source))), pages);
            File.WriteAllText(Path.Combine(directory, "result.json"), JsonSerializer.Serialize(result, JsonOptions));
            return 0;
        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(directory, "error.txt"), "PPT 预览失败：" + error.Message);
            return 1;
        }
        finally
        {
            try { if (presentation is not null) presentation.Close(); }
            catch (Exception error) { Trace.WriteLine("PPT preview close failed: " + error.Message); }
            Release(presentation);
            Release(slides);
            try
            {
                if (application is not null)
                {
                    application.DisplayAlerts = previousAlerts;
                    application.AutomationSecurity = previousSecurity;
                    if (presentations is not null && (int)presentations.Count == 0) application.Quit();
                }
            }
            catch (Exception error) { Trace.WriteLine("PPT automation cleanup failed: " + error.Message); }
            Release(presentations); Release(application);
        }
    }

    private static string ReadTitle(dynamic slide, int number)
    {
        dynamic? shapes = null, title = null, frame = null, range = null;
        try
        {
            shapes = slide.Shapes;
            if ((int)shapes.HasTitle != -1) return $"第 {number} 页";
            title = shapes.Title; frame = title.TextFrame; range = frame.TextRange;
            var text = ((string)range.Text).Replace('\r', ' ').Replace('\n', ' ').Trim();
            return string.IsNullOrEmpty(text) ? $"第 {number} 页" : text[..Math.Min(text.Length, 160)];
        }
        finally { Release(range); Release(frame); Release(title); Release(shapes); }
    }

    private static void Release(object? value)
    {
        try { if (value is not null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value); }
        catch (InvalidComObjectException error) { Trace.WriteLine(error.Message); }
    }
}
