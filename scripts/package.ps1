param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (!$OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'output/releases' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
[xml]$project = Get-Content -LiteralPath (Join-Path $projectRoot '源码/desktop/Quangai.csproj') -Raw
$version = [string]$project.Project.PropertyGroup.Version
$stage = Join-Path $OutputDirectory ('stage-' + [guid]::NewGuid().ToString('N'))
$appDirectory = Join-Path $stage '圈改'
New-Item -ItemType Directory -Path $appDirectory -Force | Out-Null

& dotnet publish (Join-Path $projectRoot '源码/desktop/Quangai.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $appDirectory
if ($LASTEXITCODE -ne 0) { throw "Windows publish failed with exit code $LASTEXITCODE" }
foreach ($name in 'licenses', '使用说明.md', '开源说明.md', '创建桌面快捷方式.ps1') {
    Copy-Item -LiteralPath (Join-Path $projectRoot "发布/圈改/$name") -Destination $appDirectory -Recurse
}

if (Test-Path -LiteralPath (Join-Path $appDirectory 'web/wallpapers')) { throw 'Personal wallpaper directory must not be distributed.' }
$archive = Join-Path $OutputDirectory "quangai-$version-win-x64.zip"
if (Test-Path -LiteralPath $archive) { throw "Release archive already exists: $archive" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $archive, [IO.Compression.CompressionLevel]::Optimal, $false)
$zipHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$exeHash = (Get-FileHash -LiteralPath (Join-Path $appDirectory '圈改.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
$sums = "$zipHash  $([IO.Path]::GetFileName($archive))`n$exeHash  圈改/圈改.exe`n"
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'SHA256SUMS.txt'), $sums, [Text.UTF8Encoding]::new($false))
Write-Output "Package: $archive"
Write-Output "Executable: $(Join-Path $appDirectory '圈改.exe')"
