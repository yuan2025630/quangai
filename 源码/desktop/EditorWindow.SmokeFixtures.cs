using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Quangai;

internal sealed partial class EditorWindow
{
    private async Task LoadSmokeWallpaperAsync(CoreWebView2 core)
    {
        ArgumentNullException.ThrowIfNull(_smokeDirectory);
        var filename = Path.Combine(_smokeDirectory, "wallpaper.webm");
        await using (var source = typeof(EditorWindow).Assembly.GetManifestResourceStream("Quangai.SmokeWallpaper.webm")
            ?? throw new FileNotFoundException("视频回归素材缺失。"))
        await using (var destination = File.Create(filename))
            await source.CopyToAsync(destination);
        _smokeChosenFile = filename;
        await core.ExecuteScriptAsync("document.getElementById('wallpaper-button').click();document.getElementById('choose-wallpaper').click()");
        await WaitForScriptAsync(core, "document.body.dataset.wallpaper === 'custom' && document.body.getAttribute('aria-busy') !== 'true'");
    }

    // The production UI no longer has a demo button. Import a test-owned project
    // through the same native picker and project validation used by the user.
    private async Task LoadSmokeProjectAsync(CoreWebView2 core)
    {
        ArgumentNullException.ThrowIfNull(_smokeDirectory);
        string ImageData(Color background, Color foreground)
        {
            using var bitmap = new Bitmap(1200, 800);
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.Clear(background);
                using var brush = new SolidBrush(foreground);
                graphics.FillRectangle(brush, 120, 140, 420, 280);
            }
            using var stream = new MemoryStream();
            bitmap.Save(stream, System.Drawing.Imaging.ImageFormat.Png);
            return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
        }
        object Image(string name, string src) => new { name, src, width = 1200, height = 800 };
        object Note(string id, int number, string kind, string source, string? targetId = null) => new {
            id, number, kind, source, rect = new { x = .1, y = .15 + number * .1, width = .2, height = .08 },
            arrow = (object?)null, comment = "桌面回归检查要求 " + number, status = "pending", targetId
        };
        var original = ImageData(Color.WhiteSmoke, Color.DarkGreen);
        var revised = ImageData(Color.WhiteSmoke, Color.SeaGreen);
        var project = new {
            schemaVersion = 1, title = "桌面验收项目", generalNote = "保持原图尺寸与参考关系。",
            images = new {
                original = Image("original.png", original),
                reference = Image("reference.png", original),
                revised = Image("revised.png", revised)
            },
            annotations = new[] {
                Note("demo-title", 1, "change", "original"),
                Note("demo-preserve", 2, "preserve", "original"),
                Note("demo-reference", 3, "reference", "reference", "demo-title"),
                Note("demo-footer", 4, "change", "original")
            },
            agentSessionId = (string?)null
        };
        var filename = Path.Combine(_smokeDirectory, "regression-fixture.quangai.json");
        await File.WriteAllTextAsync(filename, JsonSerializer.Serialize(project));
        _smokeChosenFile = filename;
        await OpenLegacyProjectPickerAsync(core);
    }

    private static async Task OpenLegacyProjectPickerAsync(CoreWebView2 core)
    {
        await core.ExecuteScriptAsync("document.getElementById('open-project').click()");
        await WaitForScriptAsync(core, "document.getElementById('project-library-dialog').open === true");
        await core.ExecuteScriptAsync("document.getElementById('library-import-project').click()");
    }
}
