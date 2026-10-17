using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Quangai;

internal sealed partial class EditorWindow
{
    protected override void WndProc(ref Message message)
    {
        const int calculateNonClientSize = 0x0083;
        const int nonClientHitTest = 0x0084;
        const int getMinMaxInfo = 0x0024;
        if (message.Msg == calculateNonClientSize)
        {
            // Let WebView fill the resize frame instead of leaving the native white strip.
            message.Result = IntPtr.Zero;
            return;
        }
        if (message.Msg == nonClientHitTest)
        {
            var position = message.LParam.ToInt64();
            var cursor = new Point(unchecked((short)position), unchecked((short)(position >> 16)));
            var resizeHit = WindowState == FormWindowState.Normal ? HitTestResizeFrame(cursor) : 0;
            message.Result = new IntPtr(resizeHit == 0 ? 1 : resizeHit);
            return;
        }
        base.WndProc(ref message);
        if (message.Msg != getMinMaxInfo) return;

        var monitor = MonitorFromWindow(Handle, 2);
        var monitorInfo = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfo(monitor, ref monitorInfo)) return;

        // Captionless windows must explicitly reserve the current monitor's taskbar area.
        var limits = Marshal.PtrToStructure<MinMaxInfo>(message.LParam);
        limits.MaxPosition = new Point(
            monitorInfo.Work.Left - monitorInfo.Monitor.Left,
            monitorInfo.Work.Top - monitorInfo.Monitor.Top);
        limits.MaxSize = new Point(
            monitorInfo.Work.Right - monitorInfo.Work.Left,
            monitorInfo.Work.Bottom - monitorInfo.Work.Top);
        Marshal.StructureToPtr(limits, message.LParam, false);
        message.Result = IntPtr.Zero;
    }

    private int HitTestResizeFrame(Point cursor)
    {
        if (!Bounds.Contains(cursor)) return 0;
        var dpi = (uint)DeviceDpi;
        var horizontalBorder = GetSystemMetricsForDpi(32, dpi) + GetSystemMetricsForDpi(92, dpi);
        var verticalBorder = GetSystemMetricsForDpi(33, dpi) + GetSystemMetricsForDpi(92, dpi);
        var left = cursor.X < Left + horizontalBorder;
        var right = cursor.X >= Right - horizontalBorder;
        var top = cursor.Y < Top + verticalBorder;
        var bottom = cursor.Y >= Bottom - verticalBorder;
        if (top) return left ? 13 : right ? 14 : 12;
        if (bottom) return left ? 16 : right ? 17 : 15;
        return left ? 10 : right ? 11 : 0;
    }

    // Keep the native resize frame and system menu while the project tabs own the caption.
    protected override CreateParams CreateParams
    {
        get
        {
            const int caption = 0x00C00000;
            var parameters = base.CreateParams;
            parameters.Style &= ~caption;
            return parameters;
        }
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        UpdateBackgroundMemory();
        PublishWindowState();
    }

    private void HandleWindowMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!args.Source.StartsWith(LocalOrigin + "/", StringComparison.OrdinalIgnoreCase)) return;
        try
        {
            using var message = JsonDocument.Parse(args.WebMessageAsJson);
            var data = message.RootElement;
            if (!data.TryGetProperty("type", out var type) || type.GetString() != "window-request") return;
            if (!data.TryGetProperty("command", out var command)) return;
            var action = command.GetString();
            var resizeHit = action == "resize" && data.TryGetProperty("edge", out var edge)
                && edge.TryGetInt32(out var hit) ? hit : 0;
            // Return from WebView's callback before closing triggers the async draft flush.
            BeginInvoke(new Action(() => ExecuteWindowCommand(action, resizeHit)));
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException)
        {
            Trace.WriteLine($"Window control request was invalid: {error.Message}");
        }
    }

    private void ExecuteWindowCommand(string? command, int resizeHit)
    {
        if (IsDisposed || Disposing) return;
        switch (command)
        {
            case "resize":
                if (WindowState != FormWindowState.Normal || resizeHit is < 10 or > 17) return;
                ReleaseCapture();
                SendMessage(Handle, 0x00A1, new IntPtr(resizeHit), IntPtr.Zero);
                return;
            case "drag":
                ReleaseCapture();
                SendMessage(Handle, 0x00A1, new IntPtr(2), IntPtr.Zero);
                break;
            case "minimize":
                WindowState = FormWindowState.Minimized;
                break;
            case "maximize":
                WindowState = WindowState == FormWindowState.Maximized
                    ? FormWindowState.Normal : FormWindowState.Maximized;
                break;
            case "close":
                Close();
                return;
            case "state":
                break;
            default:
                return;
        }
        PublishWindowState();
    }

    private void PublishWindowState()
    {
        if (_webView?.CoreWebView2 is not { } core || IsDisposed || Disposing) return;
        core.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "window-state",
            isMaximized = WindowState == FormWindowState.Maximized,
            isMinimized = WindowState == FormWindowState.Minimized
        }));
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", ExactSpelling = true)]
    private static extern int GetSystemMetricsForDpi(int index, uint dpi);

    [StructLayout(LayoutKind.Sequential)]
    private struct MinMaxInfo
    {
        internal Point Reserved;
        internal Point MaxSize;
        internal Point MaxPosition;
        internal Point MinTrackSize;
        internal Point MaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        internal int Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo
    {
        internal int Size;
        internal NativeRect Monitor;
        internal NativeRect Work;
        internal uint Flags;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);

    [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
}
