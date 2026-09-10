// ZcodeWidget — frameless always-on-top shell for the zcode-monitor token-speed
// widget page (../public/widget.html, served by the node server at /widget).
// Same host pattern as ELaserFocus OperatorHost: WinForms + WebView2.
//
// Window rules: borderless, topmost, no taskbar entry, Win11 rounded corners +
// a 1px DWM border so the card stays visible on light and dark desktops.
// The page drives the shell via window.chrome.webview.postMessage:
//   {type:'drag'}            — drag anywhere
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

    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HTCAPTION = 0x2;
    private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private const int DWMWCP_ROUND = 2;

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

    private readonly WebView2 _web = new();
    private readonly ContextMenuStrip _menu = new();
    private readonly ToolStripMenuItem _topMostItem = new("置顶") { Checked = true };
    private readonly string _settingsPath = Path.Combine(AppContext.BaseDirectory, "widget-settings.json");

    public WidgetForm()
    {
        Program.Log("form ctor start");
        FormBorderStyle = FormBorderStyle.None;
        TopMost = true;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.Dpi;
        Size = WidgetSize;
        LoadSavedBounds();
        Program.Log($"bounds set: {Location} {Size}");

        _web.Dock = DockStyle.Fill;
        // transparent so the page's own pill (full-radius + hairline border)
        // defines the visible shape; the window is just a hit-test box
        _web.DefaultBackgroundColor = Color.Transparent;
        Controls.Add(_web);

        _topMostItem.Click += (s, e) => { TopMost = _topMostItem.Checked; };
        _menu.Items.Add(_topMostItem);
        _menu.Items.Add("打开完整面板", null, (s, e) => OpenUrl(DashboardUrl));
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add("退出", null, (s, e) => Close());
        ContextMenuStrip = _menu;

        Shown += async (s, e) => await InitWebAsync();
        FormClosing += (s, e) => { Program.Log("closing"); SaveBounds(); };
        // self-report heartbeat: settles "where is the window / is it visible" disputes
        var beats = 0;
        var heartbeat = new System.Windows.Forms.Timer { Interval = 2000 };
        heartbeat.Tick += (s, e) =>
        {
            if (beats++ < 8)
                Program.Log($"heartbeat loc={Location} size={Size} visible={Visible} exstyle=0x{GetWindowLong(Handle, -20):X}");
        };
        heartbeat.Start();
        HandleCreated += (s, e) => Program.Log($"handle created: 0x{Handle:X} exstyle=0x{GetWindowLong(Handle, -20):X}");
        HandleDestroyed += (s, e) => Program.Log("handle destroyed");
        Program.Log("form ctor end");
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

            // WebView2 init churns the native window styles — the constructor's
            // TopMost is gone from the actual exstyle by now (verified: exstyle
            // lacks WS_EX_TOPMOST while the Form property still says true).
            // Re-assert HWND_TOPMOST directly, bypassing the property cache.
            const int SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;
            bool sp = SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
            Program.Log($"topmost re-assert ok={sp} exstyle=0x{GetWindowLong(Handle, -20):X}");
        }
        catch (Exception ex)
        {
            Program.Log("InitWebAsync FAILED: " + ex);
            throw;
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        using var doc = JsonDocument.Parse(e.WebMessageAsJson);
        var root = doc.RootElement;
        switch (root.GetProperty("type").GetString())
        {
            case "drag":
                ReleaseCapture();
                SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
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

    private void LoadSavedBounds()
    {
        try
        {
            if (!File.Exists(_settingsPath)) { PlaceDefault(); return; }
            using var doc = JsonDocument.Parse(File.ReadAllText(_settingsPath));
            var b = doc.RootElement;
            var pt = new Point(b.GetProperty("x").GetInt32(), b.GetProperty("y").GetInt32());
            // clamp onto a visible monitor (display layout may have changed since last run)
            var screen = Screen.FromPoint(pt).WorkingArea;
            Location = new Point(Math.Clamp(pt.X, screen.Left, screen.Right - Width), Math.Clamp(pt.Y, screen.Top, screen.Bottom - Height));
        }
        catch { PlaceDefault(); }
    }

    private void PlaceDefault() =>
        Location = new Point(Screen.PrimaryScreen!.WorkingArea.Right - Width - 24,
                             Screen.PrimaryScreen.WorkingArea.Top + 24);

    private void SaveBounds()
    {
        try { File.WriteAllText(_settingsPath, JsonSerializer.Serialize(new { x = Location.X, y = Location.Y })); }
        catch { /* position persistence is best-effort */ }
    }
}
