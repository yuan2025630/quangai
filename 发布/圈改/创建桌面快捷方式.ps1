$ErrorActionPreference = 'Stop'
$applicationPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '圈改.exe')).Path
$iconPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'quangai.ico')).Path
$desktopDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$shortcutPath = Join-Path $desktopDirectory '圈改.lnk'
# Explicit Unicode interop preserves Chinese paths on this machine.
if (-not ('QuangaiShortcut' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
internal class ShellLink { }

[ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int length, IntPtr findData, uint flags);
    void GetIDList(out IntPtr list);
    void SetIDList(IntPtr list);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int length);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int length);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int length);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetHotkey(out short value);
    void SetHotkey(short value);
    void GetShowCmd(out int value);
    void SetShowCmd(int value);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int length, out int index);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string value, int index);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string value, uint reserved);
    void Resolve(IntPtr window, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string value);
}

public static class QuangaiShortcut {
    public static void Create(string filename, string application, string directory, string icon) {
        object instance = new ShellLink();
        try {
            var link = (IShellLinkW)instance;
            var file = (IPersistFile)instance;
            var value = new StringBuilder(1024);
            if (File.Exists(filename)) {
                file.Load(filename, 0);
                link.GetPath(value, value.Capacity, IntPtr.Zero, 0);
                if (!string.Equals(value.ToString(), application, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("桌面已有指向其他位置的同名快捷方式，未覆盖：" + filename);
            }
            link.SetPath(application);
            link.SetWorkingDirectory(directory);
            link.SetIconLocation(icon, 0);
            link.SetDescription("圈改 · 把修改意见画出来");
            link.SetShowCmd(1);
            file.Save(filename, true);
            file.Load(filename, 0);
            value.Clear();
            link.GetPath(value, value.Capacity, IntPtr.Zero, 0);
            if (value.ToString() != application) throw new IOException("快捷方式目标校验失败。");
            value.Clear();
            link.GetWorkingDirectory(value, value.Capacity);
            if (value.ToString() != directory) throw new IOException("快捷方式工作目录校验失败。");
            value.Clear();
            int index;
            link.GetIconLocation(value, value.Capacity, out index);
            if (value.ToString() != icon || index != 0) throw new IOException("快捷方式图标校验失败。");
        }
        finally { Marshal.FinalReleaseComObject(instance); }
    }
}
'@
}
[QuangaiShortcut]::Create($shortcutPath, $applicationPath, $PSScriptRoot, $iconPath)
[PSCustomObject]@{
    Shortcut = $shortcutPath
    Application = $applicationPath
    WorkingDirectory = $PSScriptRoot
    Icon = "$iconPath,0"
    Verified = $true
} | ConvertTo-Json
