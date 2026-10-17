using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Quangai;

internal static class TitleBarAppearance
{
    private enum WindowAttribute : uint
    {
        BorderColor = 34,
        CaptionColor = 35,
        TextColor = 36
    }

    internal static void Apply(IntPtr window)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000) || SystemInformation.HighContrast) return;
        SetColor(window, WindowAttribute.CaptionColor, Color.FromArgb(244, 237, 228));
        SetColor(window, WindowAttribute.TextColor, Color.FromArgb(23, 61, 49));
        // DWMWA_COLOR_NONE removes the extra DWM outline around the custom frame.
        SetValue(window, WindowAttribute.BorderColor, unchecked((int)0xFFFFFFFE));
    }

    private static void SetColor(IntPtr window, WindowAttribute attribute, Color color)
    {
        SetValue(window, attribute, ColorTranslator.ToWin32(color));
    }

    private static void SetValue(IntPtr window, WindowAttribute attribute, int value)
    {
        var result = DwmSetWindowAttribute(window, attribute, ref value, sizeof(int));
        if (result < 0) Trace.WriteLine($"Title bar color {attribute} was not applied: 0x{result:X8}");
    }

    [DllImport("dwmapi.dll", ExactSpelling = true)]
    private static extern int DwmSetWindowAttribute(IntPtr window, WindowAttribute attribute, ref int value, int size);
}
