using System.Text.Json;
using System.Diagnostics;
using Quangai;

if (args.Length == 3 && args[0] == "--import-legacy")
{
    var library = new ProjectLibrary(Path.Combine(args[1], ".test-settings.json"), args[1]);
    await library.ImportLegacyProjectsAsync(args[2]);
    Console.WriteLine(JsonSerializer.Serialize(library.List()));
    return;
}
var root = Path.GetFullPath(Path.Combine("output", "documents", "library-checks", Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(root);
var settings = Path.Combine(root, "settings.json");
var first = Path.Combine(root, "first");
var manager = new ProjectLibrary(settings, first);
var project = """{"schemaVersion":1,"title":"旧项目:示例","generalNote":"原文保留","images":{"original":null,"reference":null,"revised":null},"annotations":[]}""";
var entry = await manager.CreateAsync(project);
Check(File.Exists(entry.ProjectFile) && JsonDocument.Parse(manager.Read(entry.Id)).RootElement.GetProperty("storageId").GetString() == entry.Id, "create persists a managed identity");
await manager.SaveAsync(entry.Id, project.Replace("旧项目:示例", "改名后的项目"));
Check(Path.GetFileName(manager.Resolve(entry.Id)).StartsWith("改名后的项目"), "rename retains the identity");
await ExpectFailure(() => manager.SaveAsync(entry.Id, "{}"), "invalid save preserves the last valid project");
Check(JsonDocument.Parse(manager.Read(entry.Id)).RootElement.GetProperty("title").GetString() == "改名后的项目", "last valid content survives");
var exportFolder = Path.Combine(manager.Resolve(entry.Id), "导出", "20261013-本轮");
Directory.CreateDirectory(exportFolder);
await File.WriteAllTextAsync(Path.Combine(exportFolder, "instructions.md"), "only the requested slide");
await manager.SaveAsync(entry.Id, PresentationProject("改名后的项目", exportFolder));
Check(manager.ResolveExportFolder(entry.Id, exportFolder) == exportFolder, "the latest saved export resolves inside its project");
await manager.SaveAsync(entry.Id, PresentationProject("再次改名后的项目", exportFolder));
var renamedExport = Path.Combine(manager.Resolve(entry.Id), "导出", Path.GetFileName(exportFolder));
Check(!Directory.Exists(exportFolder) && manager.ResolveExportFolder(entry.Id, exportFolder) == renamedExport
    && File.ReadAllText(Path.Combine(renamedExport, "instructions.md")) == "only the requested slide", "rename resolves the original export path to its new location");
Check(manager.ResolveExportFolder(entry.Id, renamedExport) == renamedExport, "a resolved current export path can be opened again");
var otherExport = Path.Combine(manager.Resolve(entry.Id), "导出", "other-round");Directory.CreateDirectory(otherExport);
await ExpectFailure(() => Task.Run(() => manager.ResolveExportFolder(entry.Id, otherExport)), "another round cannot replace the latest recorded export");
await ExpectFailure(() => Task.Run(() => manager.ResolveExportFolder(entry.Id, Path.Combine(root, "unrelated", Path.GetFileName(exportFolder)))), "an unrelated folder with the same name is rejected");
await ExpectFailure(() => Task.Run(() => manager.ResolveExportFolder(entry.Id, renamedExport + Path.DirectorySeparatorChar + ".." + Path.DirectorySeparatorChar + Path.GetFileName(exportFolder))), "parent traversal is rejected before normalization");
await ExpectFailure(() => Task.Run(() => manager.ResolveExportFolder(entry.Id, renamedExport + Path.DirectorySeparatorChar + ".")), "current-directory traversal is rejected");
await ExpectFailure(() => Task.Run(() => manager.ResolveExportFolder(entry.Id, "")), "empty exports never fall back to the library root");
await ExpectFailure(() => Task.Run(() => manager.ResolveExportFolder(entry.Id, "..")), "relative exports are rejected");
await manager.SaveAsync(entry.Id, PresentationProject("再次改名后的项目", null));
await ExpectFailure(() => Task.Run(() => manager.ResolveExportFolder(entry.Id, renamedExport)), "a project with no recorded export cannot open old directories");
var missingExport = Path.Combine(manager.Resolve(entry.Id), "导出", "missing-round");
await manager.SaveAsync(entry.Id, PresentationProject("再次改名后的项目", missingExport));
await ExpectFailure(() => Task.Run(() => manager.ResolveExportFolder(entry.Id, missingExport)), "a missing latest export requires a new export");
await manager.SaveAsync(entry.Id, PresentationProject("再次改名后的项目", exportFolder));
var exportBackup = Path.Combine(manager.Resolve(entry.Id), "export-link-target");
Directory.Move(renamedExport, exportBackup);
try
{
    CreateJunction(renamedExport, exportBackup);
    await ExpectFailure(() => Task.Run(() => manager.ResolveExportFolder(entry.Id, exportFolder)), "an export reparse point is rejected");
}
finally
{
    if (Directory.Exists(renamedExport)) Directory.Delete(renamedExport);
    Directory.Move(exportBackup, renamedExport);
}
Check(File.ReadAllText(Path.Combine(renamedExport, "instructions.md")) == "only the requested slide", "rejecting an export link leaves its contents intact");
var legacy = Path.Combine(root, "legacy");Directory.CreateDirectory(legacy);
await File.WriteAllTextAsync(Path.Combine(legacy, "旧文件.quangai.json"), project);
await manager.ImportLegacyProjectsAsync(legacy);await manager.ImportLegacyProjectsAsync(legacy);
Check(manager.List().Count == 2 && File.ReadAllText(Path.Combine(legacy, "旧文件.quangai.json")) == project, "legacy import is idempotent and preserves the source");
var external = Path.Combine(root, "personal.pptx");await File.WriteAllTextAsync(external, "personal document");
var assetId = Guid.NewGuid().ToString("N");manager.StoreSource(entry.Id, assetId, external);
Check(File.ReadAllText(manager.Source(entry.Id, assetId)) == "personal document", "source is copied inside the project");
await ExpectFailure(() => Task.Run(() => manager.Resolve("../escape")), "unmanaged paths are rejected");
var trashed = manager.Trash(manager.List().Single(item => item.Id != entry.Id).Id);
Check(Directory.Exists(trashed) && manager.List().Count == 1, "delete moves the whole project into recovery");
await ExpectFailure(() => Task.Run(() => manager.ChangeRoot(Path.Combine(first, "nested"))), "nested roots cannot cause recursive copies");
var second = Path.Combine(root, "second");manager.ChangeRoot(second);
Check(manager.Root == second && manager.List().Single().Id == entry.Id && File.ReadAllText(manager.Source(entry.Id, assetId)) == "personal document", "migration keeps source assets and project identity");
var migratedExport = Path.Combine(manager.Resolve(entry.Id), "导出", Path.GetFileName(exportFolder));
Check(manager.ResolveExportFolder(entry.Id, exportFolder) == migratedExport
    && manager.ResolveExportFolder(entry.Id, migratedExport) == migratedExport
    && File.ReadAllText(Path.Combine(migratedExport, "instructions.md")) == "only the requested slide", "migration resolves old and current export paths to the moved contents");
Check(Directory.GetDirectories(Path.Combine(second, ".项目回收站")).Length == 1 && File.Exists(Path.Combine(second, ".legacy-imports.json")), "migration includes recycle bin and legacy import records");
var restored = new ProjectLibrary(settings, first);Check(restored.Root == second, "new location survives restart");
Check(restored.ResolveExportFolder(entry.Id, exportFolder) == migratedExport, "migrated export resolution survives restart");
await restored.ImportLegacyProjectsAsync(legacy);Check(restored.List().Count == 1, "deleted legacy project is not resurrected");
var active = restored.List().Single();restored.Trash(active.Id);
Check(File.ReadAllText(external) == "personal document", "delete leaves the personal original untouched");
Console.WriteLine("Project library checks passed.");
static void Check(bool result, string name) { if (!result) throw new Exception(name); Console.WriteLine("PASS " + name); }
static string PresentationProject(string title, string? folder)
{
    var image = new { name = "page.png", src = "data:image/png;base64,AA==", width = 1, height = 1 };
    var images = new { original = image, reference = (object?)null, revised = (object?)null };
    return JsonSerializer.Serialize(new { schemaVersion = 1, title, generalNote = "原文保留", images, annotations = Array.Empty<object>(),
        presentation = new { assetId = Guid.NewGuid().ToString("N"), activePage = 1, exportFolder = folder,
            pages = new[] { new { number = 1, slideId = 256, images, annotations = Array.Empty<object>() } } } });
}
static void CreateJunction(string path, string target)
{
    var process = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
    process.ArgumentList.Add("-NoProfile");process.ArgumentList.Add("-NonInteractive");process.ArgumentList.Add("-EncodedCommand");
    var command = "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path '" + path.Replace("'", "''") + "' -Target '" + target.Replace("'", "''") + "' | Out-Null";
    process.ArgumentList.Add(Convert.ToBase64String(System.Text.Encoding.Unicode.GetBytes(command)));
    using var creation = Process.Start(process) ?? throw new IOException("Could not start the junction fixture.");
    var output = creation.StandardOutput.ReadToEnd();var error = creation.StandardError.ReadToEnd();creation.WaitForExit();
    if (creation.ExitCode != 0) throw new IOException("Could not create the junction fixture: " + error + output);
}
static async Task ExpectFailure(Func<Task> action, string name)
{
    try { await action(); } catch (Exception error) when (error is IOException or InvalidDataException) { Console.WriteLine("PASS " + name); return; }
    throw new Exception("Expected rejection: " + name);
}
