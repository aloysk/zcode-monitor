// window diagnostic — prints per-window style/visibility/cloak/frame info
// for a target process. Usage: wdiag.exe <pid>
using System.Runtime.InteropServices;
using System.Text;

if (args.Length < 1 || !int.TryParse(args[0], out int pid))
{
    Console.WriteLine("usage: wdiag <pid>");
    return;
}

_ = Win32.SetProcessDpiAwarenessContext(new IntPtr(-4)); // PerMonitorV2

Win32.EnumWindows((h, l) =>
{
    _ = Win32.GetWindowThreadProcessId(h, out uint wpid);
    if ((int)wpid != pid) return true;

    var sb = new StringBuilder(256);
    _ = Win32.GetWindowText(h, sb, 256);
    Win32.GetWindowRect(h, out var r);
    Win32.DwmGetWindowAttribute(h, 9, out var f, 16);   // EXTENDED_FRAME_BOUNDS
    Win32.DwmGetWindowAttributeInt(h, 14, out int cloaked, 4); // DWMWA_CLOAKED
    int style = Win32.GetWindowLong(h, -16);
    int ex = Win32.GetWindowLong(h, -20);
    Console.WriteLine($"hwnd=0x{h.ToInt64():X} title='{sb}'");
    Console.WriteLine($"  visible={Win32.IsWindowVisible(h)} cloaked={cloaked} minimized={(style & 0x20000000) != 0}");
    Console.WriteLine($"  winrect=({r.Left},{r.Top})-({r.Right},{r.Bottom}) {r.Right - r.Left}x{r.Bottom - r.Top}");
    Console.WriteLine($"  frame=({f.Left},{f.Top})-({f.Right},{f.Bottom})");
    Console.WriteLine($"  style=0x{style:X8} exstyle=0x{ex:X8} topmost={(ex & 8) != 0} layered={(ex & 0x80000) != 0} toolwin={(ex & 0x80) != 0} nopaint={(style & 0x8000000) != 0}");

    // capture this window's own rendering via PrintWindow (works while occluded)
    if (Win32.IsWindowVisible(h) && r.Right > r.Left && r.Bottom > r.Top)
    {
        using var bmp = new System.Drawing.Bitmap(r.Right - r.Left, r.Bottom - r.Top);
        using var g = System.Drawing.Graphics.FromImage(bmp);
        IntPtr hdc = g.GetHdc();
        _ = Win32.PrintWindow(h, hdc, 2); // PW_RENDERFULLCONTENT — WebView2 content
        g.ReleaseHdc(hdc);
        string outPath = System.IO.Path.Combine(AppContext.BaseDirectory, $"wdiag-0x{h.ToInt64():X}.png");
        bmp.Save(outPath);
        Console.WriteLine($"  printwindow saved: {outPath}");
    }
    return true;
}, IntPtr.Zero);

Console.WriteLine("screen=" + System.Windows.Forms.Screen.PrimaryScreen!.Bounds);

internal static class Win32
{
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int c);
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] public static extern int DwmGetWindowAttributeInt(IntPtr h, int a, out int v, int c);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, int flags);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
