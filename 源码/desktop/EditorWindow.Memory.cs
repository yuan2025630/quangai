using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;

namespace Quangai;

internal sealed partial class EditorWindow
{
    private readonly System.Windows.Forms.Timer _backgroundMemoryTimer = new() { Interval = 5000 };
    private bool _memoryManagementReady;
    private bool _windowActive;

    private void InitializeMemoryManagement()
    {
        _memoryManagementReady = true;
        _windowActive = ActiveForm == this;
        _backgroundMemoryTimer.Tick += (_, _) =>
        {
            _backgroundMemoryTimer.Stop();
            SetMemoryTarget(CoreWebView2MemoryUsageTargetLevel.Low);
        };
        Activated += (_, _) => { _windowActive = true; UpdateBackgroundMemory(); };
        Deactivate += (_, _) => { _windowActive = false; UpdateBackgroundMemory(); };
        FormClosed += (_, _) => _backgroundMemoryTimer.Dispose();
        UpdateBackgroundMemory();
    }

    private void UpdateBackgroundMemory()
    {
        if (!_memoryManagementReady || IsDisposed || Disposing) return;
        _backgroundMemoryTimer.Stop();
        if (WindowState == FormWindowState.Minimized)
            SetMemoryTarget(CoreWebView2MemoryUsageTargetLevel.Low);
        else if (_windowActive)
            SetMemoryTarget(CoreWebView2MemoryUsageTargetLevel.Normal);
        else
            _backgroundMemoryTimer.Start();
    }

    private void SetMemoryTarget(CoreWebView2MemoryUsageTargetLevel target)
    {
        if (_webView.CoreWebView2 is not { } core || IsDisposed || Disposing) return;
        try
        {
            // Keep collaboration messages and autosave running while WebView releases caches.
            if (core.MemoryUsageTargetLevel != target) core.MemoryUsageTargetLevel = target;
        }
        catch (Exception error) when (error is NotImplementedException or COMException or InvalidOperationException)
        {
            Trace.WriteLine("WebView memory target could not be changed: " + error.Message);
        }
    }
}
