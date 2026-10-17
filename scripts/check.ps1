$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    foreach ($file in Get-ChildItem -LiteralPath '发布/圈改/web/assets' -File -Recurse | Where-Object Extension -in '.js', '.mjs') {
        Invoke-Checked node @('--check', $file.FullName)
    }
    foreach ($file in Get-ChildItem -LiteralPath '源码/tests' -Filter '*checks.mjs' -File) {
        Invoke-Checked node @($file.FullName)
    }
    Invoke-Checked dotnet @('run', '--project', '源码/tests/ProjectLibraryChecks/ProjectLibraryChecks.csproj', '-c', 'Release')
    $wallpaperFixtures = Join-Path $projectRoot ('output/checks/wallpapers/' + [guid]::NewGuid().ToString('N'))
    Invoke-Checked dotnet @('run', '--project', '源码/tests/WallpaperLibraryChecks/WallpaperLibraryChecks.csproj', '-c', 'Release', '--', $wallpaperFixtures)
    Invoke-Checked dotnet @('build', '源码/desktop/Quangai.csproj', '-c', 'Release', '--nologo')
    Write-Output 'JavaScript, model, workflow, storage, wallpaper and Windows build checks passed.'
}
finally { Pop-Location }
