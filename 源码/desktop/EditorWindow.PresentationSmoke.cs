using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Quangai;

internal sealed partial class EditorWindow
{
    private async Task RunPresentationSmokeTestAsync(CoreWebView2 core)
    {
        var fixture = Path.Combine(_smokeDirectory!, "presentation-fixture.pptx");
        if (!File.Exists(fixture)) return;
        await core.ExecuteScriptAsync("document.getElementById('new-project').click()");
        await WaitForScriptAsync(core, "document.body.getAttribute('aria-busy') !== 'true' && document.getElementById('note-count').textContent === '0'");
        _smokeChosenFile = fixture;
        await core.ExecuteScriptAsync("document.getElementById('import-image').click()");
        await WaitForScriptAsync(core, "document.querySelectorAll('#presentation-pages button').length === 4 && document.body.getAttribute('aria-busy') !== 'true'");
        var imported = await ReadSmokeDraftAsync(core);
        var deck = imported.GetProperty("presentation");
        if (deck.GetProperty("pages").GetArrayLength() != 4 || deck.GetProperty("sha256").GetString() != Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(fixture))))
            throw new InvalidDataException("PPT 原生选择窗口未准确导入源文件。");
        foreach (var number in new[] { 2, 4 })
        {
            await core.ExecuteScriptAsync($"document.querySelector('#presentation-pages [data-page=\"{number}\"]').click();document.querySelector('[data-tool=change]').click();document.getElementById('add-center-note').click()");
            await WaitForScriptAsync(core, "document.getElementById('note-count').textContent === '1'");
            await core.ExecuteScriptAsync($"document.getElementById('note-comment').value='只修改第 {number} 页';document.getElementById('note-comment').dispatchEvent(new Event('input',{{bubbles:true}}))");
        }
        await core.ExecuteScriptAsync("document.getElementById('export').click();document.getElementById('download-package').click()");
        await WaitForScriptAsync(core, "document.getElementById('agent-folder').value.includes('导出') && document.body.getAttribute('aria-busy') !== 'true'");
        var annotated = await ReadSmokeDraftAsync(core);
        var folder = annotated.GetProperty("presentation").GetProperty("exportFolder").GetString()!;
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(folder, "annotations.json")));
        var targetPages = manifest.RootElement.GetProperty("targetPages").EnumerateArray().Select(page => page.GetProperty("pageNumber").GetInt32()).ToArray();
        if (!targetPages.SequenceEqual(new[] { 2, 4 }) || !File.Exists(folder + ".zip"))
            throw new InvalidDataException("PPT 导出没有只定位指定页。");
        var revised = Path.Combine(_smokeDirectory!, "presentation-revised.pptx");
        if (File.Exists(revised))
        {
            _smokeChosenFile = revised;
            await core.ExecuteScriptAsync("document.getElementById('export-dialog').close();document.querySelector('[data-mode=review]').click();document.getElementById('import-revised').click()");
            await WaitForScriptAsync(core, "document.body.getAttribute('aria-busy') !== 'true' && document.querySelector('#canvas-image').naturalWidth > 0 && document.getElementById('use-revised').disabled === false");
            var paired = await ReadSmokeDraftAsync(core);
            if (paired.GetProperty("presentation").GetProperty("pages").EnumerateArray().Any(page => page.GetProperty("images").GetProperty("revised").ValueKind != JsonValueKind.Object))
                throw new InvalidDataException("修改后的 PPT 未配对全部页面。");
            await core.ExecuteScriptAsync("document.getElementById('use-revised').click()");
            var promoted = await ReadSmokeDraftAsync(core);
            if (promoted.GetProperty("presentation").GetProperty("assetId").GetString() != paired.GetProperty("presentation").GetProperty("revisedAssetId").GetString()
                || promoted.GetProperty("presentation").GetProperty("pages").EnumerateArray().Any(page => page.GetProperty("images").GetProperty("revised").ValueKind != JsonValueKind.Null))
                throw new InvalidDataException("修改稿提升没有同步完整 PPT 和所有页。");
        }
        await core.ExecuteScriptAsync("document.getElementById('complete-project').click()");
        await WaitForScriptAsync(core, "document.body.getAttribute('aria-busy') !== 'true'");
        var completed = await ReadSmokeDraftAsync(core);
        if (completed.GetProperty("completedAt").ValueKind != JsonValueKind.String) throw new InvalidDataException("完成时间没有保留。");
        core.Reload();
        await WaitForScriptAsync(core, "document.documentElement.dataset.appReady === 'true' && document.querySelectorAll('#presentation-pages button').length === 4");
        var restored = await ReadSmokeDraftAsync(core);
        if (restored.GetProperty("storageId").GetString() != completed.GetProperty("storageId").GetString()
            || restored.GetProperty("presentation").GetProperty("pages")[1].GetProperty("annotations").GetArrayLength() != 1
            || restored.GetProperty("presentation").GetProperty("pages")[3].GetProperty("annotations").GetArrayLength() != 1)
            throw new InvalidDataException("PPT 项目重新打开时丢失页面意见。");
        await using (var preview = File.Create(Path.Combine(_smokeDirectory!, "presentation-preview.png")))
            await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, preview);
        await File.WriteAllTextAsync(Path.Combine(_smokeDirectory!, "presentation-smoke.json"), JsonSerializer.Serialize(new
        { passed = true, nativeFilePicker = true, pages = 4, targetPages, slideIds = deck.GetProperty("pages").EnumerateArray().Select(page => page.GetProperty("slideId").GetInt32()).ToArray(),
            zipExport = true, independentAnnotations = true, revisedPairing = File.Exists(revised), completePresentationPromotion = File.Exists(revised), completionPersisted = true, reloadPreservedAllPages = true }));
    }
}
