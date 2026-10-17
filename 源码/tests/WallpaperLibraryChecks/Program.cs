using System.Text.Json;
using Quangai;

var root = Path.GetFullPath(args[0]);
Directory.CreateDirectory(root);
using var library = new WallpaperLibrary(Path.Combine(root, "profile"));
var count = 0;
void Check(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException("Failed: " + name);
    count++;
    Console.WriteLine("PASS " + name);
}
string Project(string name, string kind, string file)
{
    var directory = Path.Combine(root, name);
    Directory.CreateDirectory(directory);
    File.WriteAllText(Path.Combine(directory, "project.json"), JsonSerializer.Serialize(new {
        title = name, type = kind, file, preview = "missing.jpg"
    }));
    return directory;
}

var video = Project("video", "video", "中文 clip.mp4");
File.WriteAllText(Path.Combine(video, "中文 clip.mp4"), "fixture");
var entry = library.ReadProject(video)!;
Check(entry.Kind == "video" && entry.Video!.Contains("%20"), "video and URL encoding");
Check(library.ReadProject(video)!.Id == entry.Id, "stable identity");
Check(!JsonSerializer.Serialize(entry).Contains(video, StringComparison.Ordinal), "native path excluded from browser index");
var scene = Project("scene", "Scene", "scene.json");
File.WriteAllText(Path.Combine(scene, "scene.pkg"), "fixture");
Check(library.ReadProject(scene)?.Kind == "scene", "case insensitive packaged scene without loose scene.json");
var web = Project("web", "web", "index.html");
File.WriteAllText(Path.Combine(web, "index.html"), "fixture");
Check(library.ReadProject(web)?.Kind == "web", "web project");
var exe = Project("application", "application", "test.exe");
File.WriteAllText(Path.Combine(exe, "test.exe"), "fixture");
Check(library.ReadProject(exe) is null, "application excluded");
var bad = Project("bad-extension", "video", "test.exe");
File.WriteAllText(Path.Combine(bad, "test.exe"), "fixture");
Check(library.ReadProject(bad) is null, "executable cannot masquerade as video");
var missing = Project("missing", "video", "missing.mp4");
Check(library.ReadProject(missing) is null, "missing entry excluded");
File.WriteAllText(Path.Combine(root, "outside.mp4"), "fixture");
Check(WallpaperLibrary.SafeFile(video, "../outside.mp4") is null, "parent traversal denied");
Check(WallpaperLibrary.SafeFile(video, Path.Combine(root, "outside.mp4")) is null, "absolute path denied");
var sibling = Path.Combine(root, "video-extra");
Directory.CreateDirectory(sibling);
File.WriteAllText(Path.Combine(sibling, "test.mp4"), "fixture");
Check(WallpaperLibrary.SafeFile(video, "../video-extra/test.mp4") is null, "sibling prefix escape denied");
Directory.CreateDirectory(Path.Combine(video, "nested"));
File.WriteAllText(Path.Combine(video, "nested", "valid.mp4"), "fixture");
Check(WallpaperLibrary.SafeFile(video, "nested/valid.mp4") is not null, "normal nested resource allowed");
var escape = Project("escape", "video", "../outside.mp4");
Check(library.ReadProject(escape) is null, "project file cannot escape its folder");
var picture = Project("image", "image", "full.png");
using (var bitmap = new Bitmap(16, 16)) bitmap.Save(Path.Combine(picture, "full.png"), System.Drawing.Imaging.ImageFormat.Png);
Check(library.ReadProject(picture)?.Src.EndsWith("/full.png", StringComparison.Ordinal) == true, "image uses full resolution entry");
Console.WriteLine($"{count} checks passed");
