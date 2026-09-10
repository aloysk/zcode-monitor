// window diagnostic — prints per-window style/visibility/cloak/frame info
// for a target process. Usage: wdiag.exe <pid>
using System.Runtime.InteropServices;
using System.Text;

if (args.Length >= 4 && args[0] == "--nudge")
{
    var h = new IntPtr(Convert.ToInt64(args[1], 16));
    Win32.GetWindowRect(h, out var nr);
    Win32.SetWindowPos(h, IntPtr.Zero, nr.Left + int.Parse(args[2]), nr.Top + int.Parse(args[3]),
                       0, 0, 0x0001 | 0x0002 | 0x0010); // NOSIZE|NOZORDER|NOACTIVATE
    Win32.GetWindowRect(h, out var ar);
    Console.WriteLine($"nudged to ({ar.Left},{ar.Top})-({ar.Right},{ar.Bottom})");
    return;
}

if (args.Length >= 2 && args[0] == "--hwnd")
{
    var h = new IntPtr(Convert.ToInt64(args[1], 16));
    Win32.DwmGetWindowAttribute(h, 9, out var fr, 16);
    Win32.DwmGetWindowAttributeInt(h, 14, out int cl, 4);
    Win32.GetWindowRect(h, out var wr);
    Console.WriteLine($"hwnd=0x{h.ToInt64():X} visible={Win32.IsWindowVisible(h)} iconic={Win32.IsIconic(h)} cloaked={cl}");
    var above = Win32.GetWindow(h, 3); // GW_HWNDPREV: window directly above in z-order
    var sb2 = new StringBuilder(256);
    _ = Win32.GetWindowText(above, sb2, 256);
    _ = Win32.GetWindowThreadProcessId(above, out uint apid);
    Console.WriteLine($"  above=0x{above.ToInt64():X} pid={apid} [{sb2}]");
    var below = Win32.GetWindow(h, 2); // GW_HWNDNEXT: window directly below in z-order
    var sb3 = new StringBuilder(256);
    _ = Win32.GetWindowText(below, sb3, 256);
    _ = Win32.GetWindowThreadProcessId(below, out uint bpid);
    Console.WriteLine($"  below=0x{below.ToInt64():X} pid={bpid} [{sb3}]");
    Console.WriteLine("  --- z chain down ---");
    var curd = h;
    for (int i = 0; i < 6 && curd != IntPtr.Zero; i++)
    {
        curd = Win32.GetWindow(curd, 2); // GW_HWNDNEXT
        if (curd == IntPtr.Zero) break;
        var td = new StringBuilder(256);
        _ = Win32.GetWindowText(curd, td, 256);
        _ = Win32.GetWindowThreadProcessId(curd, out uint p3);
        Win32.GetWindowRect(curd, out var rd);
        Console.WriteLine($"   dn{i}: 0x{curd.ToInt64():X} pid={p3} [{td}] rect=({rd.Left},{rd.Top}) {rd.Right - rd.Left}x{rd.Bottom - rd.Top}");
    }
Console.WriteLine("  --- z chain (walking up from this window) ---");
    var cur = h;
    for (int i = 0; i < 6 && cur != IntPtr.Zero; i++)
    {
        cur = Win32.GetWindow(cur, 3); // GW_HWNDPREV
        if (cur == IntPtr.Zero) break;
        var t = new StringBuilder(256);
        _ = Win32.GetWindowText(cur, t, 256);
        _ = Win32.GetWindowThreadProcessId(cur, out uint p2);
        Win32.GetWindowRect(cur, out var rr);
        Console.WriteLine($"   up{i}: 0x{cur.ToInt64():X} pid={p2} [{t}] rect=({rr.Left},{rr.Top}) {rr.Right - rr.Left}x{rr.Bottom - rr.Top}");
    }
    Console.WriteLine($"  winrect=({wr.Left},{wr.Top})-({wr.Right},{wr.Bottom}) {wr.Right - wr.Left}x{wr.Bottom - wr.Top}");
    Console.WriteLine($"  frame=({fr.Left},{fr.Top})-({fr.Right},{fr.Bottom}) {fr.Right - fr.Left}x{fr.Bottom - fr.Top}");
    return;
}

if (args.Length < 1 || !int.TryParse(args[0], out int pid))
{
    Console.WriteLine("usage: wdiag <pid> | wdiag --hwnd <hex>");
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
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, int flags);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, int flags);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
