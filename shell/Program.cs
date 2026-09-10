// ZcodeWidget — frameless always-on-top shell for the zcode-monitor token-speed
// widget page (../public/widget.html, served by the node server at /widget).
// Same host pattern as ELaserFocus OperatorHost: WinForms + WebView2.
//
// Docking: the pill anchors to the ZCode main window, floating just above the
// composer card's rounded top edge (position measured via UI Automation on the
// maximized window: card left ≈ +1085px, card top ≈ 250px above window bottom).
// A WinEvent hook (EVENT_OBJECT_LOCATIONCHANGE) follows moves/resizes live; a
// slow timer re-acquires the ZCode window if it restarts. Dragging the pill
// while docked adjusts a persistent (dx, dy) fine-tune offset instead of
// breaking the anchor. The context menu can toggle docking off entirely.
//
// Window rules: borderless, topmost, no taskbar entry, transparent WebView2 so
// the page paints its own pill shape. WebView2 init recreates the native
// window and drops property-based styles — WS_EX_TOPMOST|WS_EX_TOOLWINDOW are
// baked into CreateParams and re-asserted via SetWindowPos after init.
// The page drives the shell via window.chrome.webview.postMessage:
//   {type:'drag'}            — drag (docked: adjusts offset; free: absolute)
//   {type:'menu', x, y}      — context menu at screen coords
//   {type:'open-dashboard'}  — open the full dashboard

using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ZcodeWidget;

internal static class Program
{
    private static readonly string LogPath = Path.Combine(AppContext.BaseDirectory, "widget-run.log");

    internal static void Log(string msg)
    {
        try { File.AppendAllText(LogPath, $"{DateTime.Now:HH:mm:ss.fff} {msg}\n"); }
        catch { /* logging is best-effort */ }
    }

    [STAThread]
    private static void Main()
    {
        Log("boot");
        ApplicationConfiguration.Initialize();
        Application.ThreadException += (s, e) => Log("ThreadException: " + e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            Log("UnhandledException: " + e.ExceptionObject + " terminating=" + e.IsTerminating);
        Application.Run(new WidgetForm());
        Log("message loop exited");
    }
}

internal sealed class WidgetForm : Form
{
    private const string WidgetUrl = "http://127.0.0.1:7331/widget";
    private const string DashboardUrl = "http://127.0.0.1:7331/";
    private static readonly Size WidgetSize = new(200, 36);

    // dock anchor, measured against the ZCode main window (physical px):
    // composer card left edge + card-top gap above window bottom, pill height included
    private const int DockLeft = 1085;
    private const int DockBottomUp = 292;

    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HTCAPTION = 0x2;
    private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private const int DWMWCP_ROUND = 2;
    private const int EVENT_OBJECT_LOCATIONCHANGE = 0x800B;
    private const int WINEVENT_OUTOFCONTEXT = 0;

    private delegate void WinEventProc(IntPtr hook, uint evt, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int cb);

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, int flags);

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    private static extern IntPtr SetWinEventHook(int evtMin, int evtMax, IntPtr mod, WinEventProc proc, uint pid, uint tid, int flags);

    [DllImport("user32.dll")]
    private static extern bool UnhookWinEvent(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr h, out RECT r);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr h);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    private readonly WebView2 _web = new();
    private readonly ContextMenuStrip _menu = new();
    private readonly ToolStripMenuItem _topMostItem = new("置顶") { Checked = true };
    private readonly ToolStripMenuItem _dockItem = new("吸附 ZCode 窗口") { Checked = true };
    private readonly string _settingsPath = Path.Combine(AppContext.BaseDirectory, "widget-settings.json");
    private readonly System.Windows.Forms.Timer _watch = new() { Interval = 500 };

    private IntPtr _zcodeHwnd;
    private uint _zcodePid;
    private IntPtr _winHook;
    private WinEventProc? _winProc; // rooted so the hook delegate survives GC
    private bool _docked = true;
    private int _dx, _dy; // drag fine-tune offsets applied on top of the dock anchor

    public WidgetForm()
    {
        Program.Log("form ctor start");
        FormBorderStyle = FormBorderStyle.None;
        TopMost = true;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.Dpi;
        Size = WidgetSize;
        LoadSettings();
        Program.Log($"bounds set: {Location} {Size} docked={_docked} d={_dx},{_dy}");

        _web.Dock = DockStyle.Fill;
        // transparent so the page's own pill (full-radius + hairline border)
        // defines the visible shape; the window is just a hit-test box
        _web.DefaultBackgroundColor = Color.Transparent;
        Controls.Add(_web);

        _topMostItem.Click += (s, e) => { TopMost = _topMostItem.Checked; };
        _dockItem.Click += (s, e) => { _docked = _dockItem.Checked; if (_docked) ApplyDock(); };
        _menu.Items.Add(_topMostItem);
        _menu.Items.Add(_dockItem);
        _menu.Items.Add("打开完整面板", null, (s, e) => OpenUrl(DashboardUrl));
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add("退出", null, (s, e) => Close());
        ContextMenuStrip = _menu;

        Shown += async (s, e) => await InitWebAsync();
        FormClosing += (s, e) => { Program.Log("closing"); SaveSettings(); if (_winHook != IntPtr.Zero) UnhookWinEvent(_winHook); };

        // re-acquire/re-dock safety net (hook misses restarts and some transitions)
        _watch.Tick += (s, e) =>
        {
            if (_zcodeHwnd == IntPtr.Zero || !GetWindowRect(_zcodeHwnd, out _)) AcquireZcodeWindow();
            ApplyDock();
        };
        _watch.Start();
        AcquireZcodeWindow();
        Program.Log($"zcode window: hwnd=0x{_zcodeHwnd:X} pid={_zcodePid}");
    }

    // WebView2 init recreates the form's native window (multiple IME ghost
    // windows observed = several handle recreations), and each recreation
    // drops TopMost/ShowInTaskbar from the actual window styles even though
    // the WinForms properties still report true. Bake both bits into
    // CreateParams so every recreation carries them.
    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= 0x8 | 0x80; // WS_EX_TOPMOST | WS_EX_TOOLWINDOW
            return cp;
        }
    }

    private async Task InitWebAsync()
    {
        try
        {
            Program.Log("InitWebAsync start");
            int round = DWMWCP_ROUND;
            DwmSetWindowAttribute(Handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref round, sizeof(int));
            Program.Log("dwm attrs set");

            await _web.EnsureCoreWebView2Async();
            Program.Log("core webview2 ready");
            _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            _web.CoreWebView2.WebMessageReceived += OnWebMessage;
            _web.CoreWebView2.Navigate(WidgetUrl);
            Program.Log("navigated: " + WidgetUrl);

            // WebView2 init churns the native window styles — re-assert the
            // topmost band directly, bypassing the property cache.
            const int SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;
            bool sp = SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
            Program.Log($"topmost re-assert ok={sp} exstyle=0x{GetWindowLong(Handle, -20):X}");
            ApplyDock();
        }
        catch (Exception ex)
        {
            Program.Log("InitWebAsync FAILED: " + ex);
            throw;
        }
    }

    // ── ZCode window docking ─────────────────────────────────────────

    private void AcquireZcodeWindow()
    {
        foreach (var p in System.Diagnostics.Process.GetProcessesByName("ZCode"))
        {
            try
            {
                if (p.MainWindowHandle != IntPtr.Zero)
                {
                    _zcodeHwnd = p.MainWindowHandle;
                    _zcodePid = (uint)p.Id;
                    HookZcodeWindow();
                    return;
                }
            }
            catch { /* process may exit between enumerate and read */ }
        }
    }

    private void HookZcodeWindow()
    {
        if (_winHook != IntPtr.Zero) UnhookWinEvent(_winHook);
        _winProc = (hook, evt, hwnd, idObject, idChild, thread, time) =>
        {
            // idObject OBJID_WINDOW == 0; ignore sub-object moves (scrollbars etc.)
            if (hwnd == _zcodeHwnd && idObject == 0) ApplyDock();
        };
        _winHook = SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE,
                                   IntPtr.Zero, _winProc, _zcodePid, 0, WINEVENT_OUTOFCONTEXT);
        Program.Log($"winevent hook: 0x{_winHook:X}");
    }

    private (int X, int Y)? DockAnchor()
    {
        if (_zcodeHwnd == IntPtr.Zero || !GetWindowRect(_zcodeHwnd, out var r) || IsIconic(_zcodeHwnd))
            return null;
        return (r.Left + DockLeft, r.Bottom - DockBottomUp);
    }

    private void ApplyDock()
    {
        if (!_docked) return;
        if (DockAnchor() is not { } a) return;
        var target = new Point(a.X + _dx, a.Y + _dy);
        if (Location != target) Location = target;
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        using var doc = JsonDocument.Parse(e.WebMessageAsJson);
        var root = doc.RootElement;
        switch (root.GetProperty("type").GetString())
        {
            case "drag":
                var anchorBefore = DockAnchor();
                ReleaseCapture();
                SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
                // SendMessage returns when the user releases the move loop:
                // whatever they did becomes the new fine-tune offset
                if (_docked && anchorBefore is { } a)
                {
                    _dx = Location.X - a.X;
                    _dy = Location.Y - a.Y;
                }
                SaveSettings();
                break;
            case "menu":
                var x = root.GetProperty("x").GetInt32();
                var y = root.GetProperty("y").GetInt32();
                _menu.Show(x, y);
                break;
            case "open-dashboard":
                OpenUrl(DashboardUrl);
                break;
        }
    }

    private static void OpenUrl(string url) =>
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });

    // ── settings (best-effort json beside the exe) ───────────────────

    private void LoadSettings()
    {
        try
        {
            if (File.Exists(_settingsPath))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(_settingsPath));
                var b = doc.RootElement;
                Location = new Point(b.GetProperty("x").GetInt32(), b.GetProperty("y").GetInt32());
                if (b.TryGetProperty("docked", out var d)) _docked = d.GetBoolean();
                if (b.TryGetProperty("dx", out var dx)) _dx = dx.GetInt32();
                if (b.TryGetProperty("dy", out var dy)) _dy = dy.GetInt32();
                return;
            }
        }
        catch { /* fall through to default placement */ }
        PlaceDefault();
    }

    private void PlaceDefault()
    {
        var wa = Screen.PrimaryScreen!.WorkingArea;
        Location = new Point(wa.Right - Width - 24, wa.Bottom - 300);
    }

    private void SaveSettings()
    {
        try
        {
            File.WriteAllText(_settingsPath, JsonSerializer.Serialize(
                new { x = Location.X, y = Location.Y, docked = _docked, dx = _dx, dy = _dy }));
        }
        catch { /* position persistence is best-effort */ }
    }
}
