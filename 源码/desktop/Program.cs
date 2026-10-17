using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Quangai;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--render-presentation")
        {
            Environment.ExitCode = PresentationRenderer.RunJob(args[1]);
            return;
        }
        ApplicationConfiguration.Initialize();
        string? smokeDirectory = args.Length == 2 && args[0] == "--smoke-test" ? Path.GetFullPath(args[1]) : null;
        string? testDirectory = args.Length == 2 && args[0] == "--test-profile" ? Path.GetFullPath(args[1]) : null;
        using var instance = new Mutex(true, smokeDirectory is null && testDirectory is null ? "Local\\QuangaiDesktop" : "Local\\QuangaiSmoke-" + Guid.NewGuid().ToString("N"), out bool isFirstInstance);
        if (!isFirstInstance)
        {
            using var current = Process.GetCurrentProcess();
            foreach (var process in Process.GetProcessesByName(current.ProcessName))
            {
                using (process)
                {
                    if (process.Id == current.Id || process.MainWindowHandle == IntPtr.Zero) continue;
                    ShowWindow(process.MainWindowHandle, 9);
                    SetForegroundWindow(process.MainWindowHandle);
                    return;
                }
            }
            return;
        }
        using var window = new EditorWindow(smokeDirectory, testDirectory);
        Application.Run(window);
        instance.ReleaseMutex();
    }

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);
}
