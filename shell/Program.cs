// ZcodeWidget — frameless shell for the zcode-monitor token-speed widget.
// ONE window, TWO forms (a single WebView2 navigated between two pages):
//   pill (default)  /widget  280×56  number + sparkline, docks to ZCode
//   pet             /pet     320×380 sprite cat, free position
// The right-click menu carries everything: form toggle (桌宠形态), next pet
// pack (下一只宠物 — also double-click the cat), docking, global topmost,
// dashboard, exit. Served by the repo's node server on 127.0.0.1:7331.
// Same host pattern as ELaserFocus OperatorHost: WinForms + WebView2.
//
// Docking (pill form only): the pill anchors to the ZCode main window,
// floating just above the composer card's rounded top edge (position measured
// via UI Automation on the maximized window: card left ≈ +1085px, card top ≈
// 250px above window bottom). A WinEvent hook (EVENT_OBJECT_LOCATIONCHANGE)
// follows moves/resizes live; a slow timer re-acquires the ZCode window if it
// restarts. Dragging the pill while docked adjusts a persistent (dx, dy)
// fine-tune offset instead of breaking the anchor. The pet form ignores
// docking entirely and keeps its own saved position.
//
// Lifecycle: bound to ZCode, not to login. ZCode's SessionStart hook
// (~/.zcode/cli/config.json hooks.events) launches this exe whenever ZCode
// starts a session; the single-instance mutex makes repeat fires no-ops. When
// no ZCode process exists for a grace period the shell exits (and kills the
// node server it owns) — the widget's lifetime mirrors ZCode's. Until a ZCode
// main window exists the window stays hidden (SetVisibleCore suppresses the
// first show; the watch timer reveals it). If the node server isn't up, the
// shell spawns it as a hidden child so the whole stack comes up with the
// widget.
//
// Window rules: borderless, no taskbar entry, transparent WebView2 so
// each page paints its own shape (the window region clips the radius —
// pill r=20, pet card r=36). WebView2 init recreates the native window and
// drops property-based styles — WS_EX_TOOLWINDOW is baked into CreateParams
// and re-asserted via SetWindowPos after init. Both forms z-bind above the
// ZCode window (covered together with ZCode) unless global topmost is on.
// The page drives the shell via window.chrome.webview.postMessage:
//   {type:'drag'}            — drag (docked pill: adjusts offset; else absolute)
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

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetStdHandle(int nStdHandle, IntPtr hHandle);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateFileW(string name, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr hObject);

    [STAThread]
    private static void Main()
    {
        // pin PMv2 before anything else: process-launch DPI-context inheritance
        // races otherwise, and rect reads flip between physical/virtualized
        // (observed: same window reporting 3200×1904 and 1600×952)
        _ = SetProcessDpiAwarenessContext(new IntPtr(-4));
        DetachInheritedStdio();
        Log("boot");
        using var singleton = new Mutex(true, "ZcodeWidget_SingleInstance", out bool first);
        if (!first)
        {
            Log("another instance is already running — exiting");
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.ThreadException += (s, e) => Log("ThreadException: " + e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            Log("UnhandledException: " + e.ExceptionObject + " terminating=" + e.IsTerminating);
        Application.Run(new WidgetForm());
        Log("message loop exited");
    }

    // Shared WebView2 environment. The extra browser flags are load-bearing:
    // Chromium marks never-activated tool windows (frameless, WS_EX_TOOLWINDOW)
    // as occluded and then stops requestAnimationFrame and throttles timers —
    // the pet froze solid and the pill went stale until these flags went in.
    private static CoreWebView2Environment? _webEnv;
    internal static async Task<CoreWebView2Environment> WebEnvAsync()
    {
        if (_webEnv is not { } env)
        {
            var opts = new CoreWebView2EnvironmentOptions
            {
                AdditionalBrowserArguments =
                    "--disable-backgrounding-occluded-windows --disable-renderer-backgrounding",
            };
            _webEnv = env = await CoreWebView2Environment.CreateAsync(null, null, opts);
        }
        return env;
    }

    // When spawned by a hook runner (SessionStart → Start-Process), our std
    // handles can be the runner's capture pipes: holding them makes the hook
    // wait for EOF until its timeout, then the runner kills the whole tree
    // (observed: every SessionStart today died this way). Swap each inherited
    // handle to NUL and close the original — the runner sees EOF immediately,
    // and WebView2 children spawned later inherit NUL, not pipes.
    private static void DetachInheritedStdio()
    {
        try
        {
            const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000;
            foreach (int slot in new[] { -10, -11, -12 }) // STD_INPUT/OUTPUT/ERROR
            {
                IntPtr old = GetStdHandle(slot);
                if (old == IntPtr.Zero || old == new IntPtr(-1)) continue;
                IntPtr nul = CreateFileW("NUL", GENERIC_READ | GENERIC_WRITE,
                    3 /* FILE_SHARE_READ|WRITE */, IntPtr.Zero, 3 /* OPEN_EXISTING */,
                    0x80 /* FILE_ATTRIBUTE_NORMAL */, IntPtr.Zero);
                if (nul == new IntPtr(-1)) continue;
                _ = SetStdHandle(slot, nul);
                _ = CloseHandle(old);
            }
            Log("stdio detached from launcher pipes");
        }
        catch { /* best-effort: worst case the launcher times out as before */ }
    }
}

internal sealed class WidgetForm : Form
{
    private const string WidgetUrl = "http://127.0.0.1:7331/widget";
    private const string PetUrl = "http://127.0.0.1:7331/pet";
    private const string DashboardUrl = "http://127.0.0.1:7331/";
    // 280 physical = 140 CSS px at 200% DPI: number + unit + reserved
    // 44px sparkline zone, no collisions (vision-review measured the fit)
    private static readonly Size WidgetSize = new(280, 56);
    // 160×190 CSS px at 200% DPI; cat canvas ~80% height + bubble headroom
    private static readonly Size PetSize = new(320, 380);

    // dock anchor, calibrated against the ZCode window's visible frame bounds
    // (DWM EXTENDED_FRAME_BOUNDS = 3200×1904 when maximized): the pill sits in
    // the free margin RIGHT of the composer card (card right ≈2820 → pill left
    // 2836 = 194+Width inside the right edge), vertically centered on the
    // bottom toolbar row (row y1787-1844 → pill top 1787 = 117 above bottom)
    private const int DockFromRight = 194;
    private const int DockBottomUp = 117;

    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HTCAPTION = 0x2;
    // pill corner radius (physical px) — matches the ZCode composer card's ≈17px
    private const int PillRadius = 20;
    // pet card corner radius (physical px) — matches the card face in pet.html
    private const int PetRadius = 36;
    private const int EVENT_OBJECT_LOCATIONCHANGE = 0x800B;
    private const int WINEVENT_OUTOFCONTEXT = 0;

    private delegate void WinEventProc(IntPtr hook, uint evt, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int cb);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT r, int cb);

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

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr h);

    // job object ties the spawned node server's lifetime to ours — it dies even
    // when THIS process is force-killed (FormClosing never runs on TerminateProcess)
    [DllImport("kernel32.dll")]
    private static extern IntPtr CreateJobObject(IntPtr attrs, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int size);

    [DllImport("kernel32.dll")]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; // SIZE_T
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;                                      // ULONG_PTR
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount,
                     ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateRoundRectRgn(int x1, int y1, int x2, int y2, int w, int h);

    // rounded window region for the current form (pill or pet card);
    // w/h params are ellipse DIAMETERS, so a true radius r needs r*2
    private static IntPtr MakeRoundRgn(int width, int height, int radius) =>
        CreateRoundRectRgn(0, 0, width + 1, height + 1, radius * 2, radius * 2);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr h, int cmd); // 3 = GW_HWNDPREV

    [DllImport("user32.dll")]
    private static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool redraw);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    private readonly WebView2 _web = new();
    private readonly ContextMenuStrip _menu = new();
    // CheckOnClick is load-bearing: without it a click never flips Checked,
    // so toggle handlers keep reading the stale value (the old 桌宠模式 item
    // looked dead for exactly this reason)
    private readonly ToolStripMenuItem _topMostItem = new("始终置顶(全局)") { CheckOnClick = true, Checked = false };
    private readonly ToolStripMenuItem _dockItem = new("吸附 ZCode 窗口") { CheckOnClick = true, Checked = true };
    private readonly ToolStripMenuItem _petItem = new("桌宠形态") { CheckOnClick = true };
    private readonly ToolStripMenuItem _nextPetItem = new("下一只宠物");
    private readonly string _settingsPath = Path.Combine(AppContext.BaseDirectory, "widget-settings.json");
    private readonly System.Windows.Forms.Timer _watch = new() { Interval = 500 };
    // localhost probe client — MUST bypass any system proxy: with a proxy
    // configured, routing 127.0.0.1 through it made every health probe hang
    // for the full 2s timeout (observed 60s of cold-start delay) while
    // WebView2 (Chromium auto-bypasses localhost) connected instantly
    private static readonly System.Net.Http.HttpClient Http = new(
        new System.Net.Http.HttpClientHandler { UseProxy = false })
    { Timeout = TimeSpan.FromSeconds(2) };

    private IntPtr _zcodeHwnd;
    private uint _zcodePid;
    private IntPtr _winHook;
    private WinEventProc? _winProc; // rooted so the hook delegate survives GC
    private bool _docked = true;
    private int _dx, _dy; // drag fine-tune offsets applied on top of the dock anchor
    private bool _shownOnce;
    private int _zcodeGoneTicks; // consecutive 500ms ticks with no ZCode process
    private System.Diagnostics.Process? _serverProc;
    private bool _ownsServer;
    private IntPtr _serverJob; // KILL_ON_JOB_CLOSE: child node dies with us, always
    private string _mode = "pill"; // "pill" | "pet" — which form the window wears
    private Point? _pillLoc;       // last free pill position (docking overrides it)
    private Point? _petLoc;        // last pet-form position
    private bool _webReady;        // CoreWebView2 initialized (Navigate/ExecuteScript safe)
    private bool _cycleOnNav;      // run cyclePack() once the /pet document lands

    public WidgetForm()
    {
        Program.Log("form ctor start");
        FormBorderStyle = FormBorderStyle.None;
        TopMost = true;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None; // sizes stay in physical px (200% desktop: WebView2 renders CSS at 2x)
        LoadSettings();
        Size = _mode == "pet" ? PetSize : WidgetSize;
        if (_mode == "pet") { _petLoc ??= DefaultPetLocation(); Location = _petLoc.Value; }
        else if (_pillLoc is { } p) Location = p;
        // reflect the restored form in the menu before any click can race it
        _petItem.Checked = _mode == "pet";
        _dockItem.Enabled = _mode != "pet"; // docking is a pill-form concept
        Program.Log($"bounds set: {Location} {Size} mode={_mode} docked={_docked} d={_dx},{_dy}");

        _web.Dock = DockStyle.Fill;
        // transparent so the page paints its own shape (pill / pet card);
        // the window is just a hit-test box clipped by its region
        _web.DefaultBackgroundColor = Color.Transparent;
        Controls.Add(_web);

        _topMostItem.Click += (s, e) =>
        {
            TopMost = _topMostItem.Checked;
            if (!_topMostItem.Checked) BindZOrder();
        };
        _dockItem.Click += (s, e) => { _docked = _dockItem.Checked; if (_docked) ApplyDock(); };
        _petItem.Click += (s, e) => ApplyMode(_petItem.Checked ? "pet" : "pill");
        _nextPetItem.Click += (s, e) => NextPetAsync();
        _menu.Items.Add(_petItem);
        _menu.Items.Add(_nextPetItem);
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(_dockItem);
        _menu.Items.Add(_topMostItem);
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add("打开完整面板", null, (s, e) => OpenUrl(DashboardUrl));
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add("退出", null, (s, e) => Close());
        ContextMenuStrip = _menu;

        Shown += async (s, e) =>
        {
            // slow path (autostart at login): bring the node server up BEFORE
            // navigating, or WebView2 would paint its own error page
            if (!await ServerUpAsync()) await EnsureServerAsync();
            await InitWebAsync();
        };
        FormClosing += (s, e) =>
        {
            Program.Log("closing");
            SaveSettings();
            if (_winHook != IntPtr.Zero) UnhookWinEvent(_winHook);
            if (_ownsServer && _serverProc is { HasExited: false })
            {
                try { _serverProc.Kill(); Program.Log("server: killed owned node"); }
                catch { /* already dying */ }
            }
        };

        // re-acquire/re-dock safety net (hook misses restarts and some transitions)
        _watch.Tick += (s, e) =>
        {
            if (_zcodeHwnd == IntPtr.Zero || !IsWindow(_zcodeHwnd))
            {
                AcquireZcodeWindow();
                if (_zcodeHwnd == IntPtr.Zero)
                {
                    // lifecycle mirrors ZCode: after a grace period with no
                    // ZCode process at all, exit (kills the owned node server);
                    // brief gaps (app restart, window recreation) are bridged
                    if (System.Diagnostics.Process.GetProcessesByName("ZCode").Length == 0)
                    {
                        if (++_zcodeGoneTicks >= 30)
                        {
                            Program.Log("zcode process gone 15s — exiting");
                            Close();
                            return;
                        }
                    }
                    else _zcodeGoneTicks = 0;
                    // no window yet (or CLI-only sessions) → hidden, not gone
                    if (Visible) { Hide(); Program.Log("hidden: no zcode window"); }
                    return;
                }
                _zcodeGoneTicks = 0;
                Program.Log($"zcode window (re)acquired: 0x{_zcodeHwnd:X} pid={_zcodePid}");
            }
            // pet form z-binds too (covered with ZCode, never floats over
            // unrelated apps); pill form only while docked — a freed pill
            // floats in its own band until global topmost is toggled on
            if (_docked || _mode == "pet") BindZOrder();
            // bound to ZCode's visibility too: no widget floating over the
            // desktop or other apps while ZCode is away or minimized
            bool zcodeUp = !IsIconic(_zcodeHwnd);
            if (!zcodeUp) { if (Visible) Hide(); }
            else if (!Visible) Show();
            ApplyDock();
        };
        _watch.Start();
        AcquireZcodeWindow();
        Program.Log($"zcode window: hwnd=0x{_zcodeHwnd:X} pid={_zcodePid}");

        // the window region IS the visible shape (pill or pet card, radius
        // per form). WebView2 transparency doesn't work on plain WinForms
        // windows, so the page paints full-bleed and the shell clips.
        // HandleCreated fires again on every WebView2-driven handle recreation.
        HandleCreated += (s, e) =>
        {
            int r = _mode == "pet" ? PetRadius : PillRadius;
            _ = SetWindowRgn(Handle, MakeRoundRgn(Width, Height, r), true);
            Program.Log($"region applied r={r} {Width}x{Height}");
        };
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
            cp.ExStyle |= 0x80; // WS_EX_TOOLWINDOW (no WS_EX_TOPMOST: z-order is bound to ZCode)
            return cp;
        }
    }

    // Autostart lands before ZCode opens: suppress the very first show while
    // no ZCode window exists. The watch timer's Show() (when ZCode appears)
    // passes through normally — Shown and WebView2 init ride on that reveal.
    protected override void SetVisibleCore(bool value)
    {
        if (!_shownOnce && value && _zcodeHwnd == IntPtr.Zero)
        {
            _shownOnce = true;
            Program.Log("first show suppressed (no zcode window yet)");
            value = false;
        }
        else if (value) _shownOnce = true;
        base.SetVisibleCore(value);
    }

    // ── node server companion ────────────────────────────────────────

    private static async Task<bool> ServerUpAsync()
    {
        try
        {
            // /api/gen/state is pure in-memory (no DB): probing the overview
            // route instead froze the bring-up — its first cold query on the
            // 13GB sqlite blocks node's event loop ~60s (better-sqlite3 is
            // synchronous), so every probe connected but timed out waiting
            using var r = await Http.GetAsync("http://127.0.0.1:7331/api/gen/state");
            return r.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    // The widget page is served by the repo's node server. At login it usually
    // isn't running: probe a few times, then spawn it hidden as our child so
    // the whole stack comes up with the pill. The owned server dies with our
    // clean exit (menu 退出); hiding with ZCode gone keeps both alive.
    private async Task EnsureServerAsync()
    {
        for (int i = 0; i < 3; i++)
        {
            if (await ServerUpAsync()) { Program.Log("server: already up"); return; }
            await Task.Delay(600);
        }
        var repo = FindRepoRoot();
        var node = FindNodeExe();
        if (repo == null || node == null)
        {
            Program.Log($"server: cannot spawn (repo={repo ?? "null"} node={node ?? "null"}) — start node manually");
            return;
        }
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = node,
                Arguments = "server/index.js",
                WorkingDirectory = repo,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.EnvironmentVariables["OPEN_BROWSER"] = "0";
            psi.EnvironmentVariables["ZCODE_WIDGET_CHILD"] = "1"; // companion mode: idle self-exit
            _serverProc = System.Diagnostics.Process.Start(psi);
            _ownsServer = true;
            _serverJob = CreateJobObject(IntPtr.Zero, null);
            var jobInfo = default(JOBOBJECT_EXTENDED_LIMIT_INFORMATION);
            jobInfo.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            bool okInfo = SetInformationJobObject(_serverJob, 9 /*ExtendedLimitInformation*/,
                ref jobInfo, System.Runtime.InteropServices.Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>());
            bool okAssign = _serverProc is not null && AssignProcessToJobObject(_serverJob, _serverProc.Handle);
            // log the raw results: a silent false here leaves an orphan server on
            // force-kill (observed once), and the idle self-exit is the backstop
            if (!okInfo)
                Program.Log($"job SetInformationJobObject FAILED err={System.Runtime.InteropServices.Marshal.GetLastWin32Error()} size={System.Runtime.InteropServices.Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()}");
            Program.Log($"server: spawned node pid={_serverProc?.Id} job: create=0x{_serverJob:X} setInfo={okInfo} assign={okAssign}");
        }
        catch (Exception ex)
        {
            Program.Log("server spawn failed: " + ex.Message);
            return;
        }
        for (int i = 0; i < 24; i++)
        {
            if (await ServerUpAsync()) { Program.Log("server: up after spawn"); return; }
            await Task.Delay(500);
        }
        Program.Log("server: not up after 12s (page seed retries every 60s)");
    }

    private static string? FindRepoRoot()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d != null; d = d.Parent!)
            if (File.Exists(Path.Combine(d.FullName, "server", "index.js"))) return d.FullName;
        return null;
    }

    private static string? FindNodeExe()
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in path.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            try { var c = Path.Combine(dir, "node.exe"); if (File.Exists(c)) return c; }
            catch { /* unreadable PATH entry */ }
        }
        var fallback = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        return File.Exists(fallback) ? fallback : null;
    }

    // ── login autostart was rejected: the pill is bound to ZCode's own
    //    lifecycle via its SessionStart hook instead (see header comment) ──

    private async Task InitWebAsync()
    {
        try
        {
            Program.Log("InitWebAsync start");

            await _web.EnsureCoreWebView2Async(await Program.WebEnvAsync());
            Program.Log("core webview2 ready");
            _webReady = true;
            _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            _web.CoreWebView2.WebMessageReceived += OnWebMessage;
            // a pill→pet form swap can carry a queued pack cycle: ExecuteScript
            // targets the CURRENT document, so firing it right after Navigate
            // would hit the outgoing page's script context — wait for the new
            // document instead
            _web.CoreWebView2.NavigationCompleted += (s, e) =>
            {
                if (!_cycleOnNav) return;
                _cycleOnNav = false;
                _ = _web.CoreWebView2.ExecuteScriptAsync("typeof cyclePack==='function'&&cyclePack()");
            };
            string url = _mode == "pet" ? PetUrl : WidgetUrl;
            _web.CoreWebView2.Navigate(url);
            Program.Log("navigated: " + url);

            // WebView2 init churns the native window styles; re-bind z-order
            // after init (the watch timer keeps re-asserting every 500ms)
            BindZOrder();
            Program.Log($"z-order bound exstyle=0x{GetWindowLong(Handle, -20):X}");
            ApplyDock();
        }
        catch (Exception ex)
        {
            Program.Log("InitWebAsync FAILED: " + ex);
            throw;
        }
    }

    // ── form machinery: one window, two faces ───────────────────────

    // Swap the window between the pill and the pet card: size, clip region,
    // position policy (dock anchor vs free spot) and the hosted page. All
    // shared machinery (z-binding, ZCode visibility, lifecycle, server)
    // is untouched — this is purely the shell's shape.
    private void ApplyMode(string mode)
    {
        if (_mode == mode) return;
        _mode = mode;
        bool pet = mode == "pet";
        _petItem.Checked = pet;
        _dockItem.Enabled = !pet;
        Size = pet ? PetSize : WidgetSize;
        if (IsHandleCreated)
            _ = SetWindowRgn(Handle, MakeRoundRgn(Width, Height, pet ? PetRadius : PillRadius), true);
        if (pet)
        {
            _petLoc ??= DefaultPetLocation();
            Location = _petLoc.Value;
        }
        else if (_docked)
        {
            ApplyDock(); // anchor recomputed with the pill's width
        }
        else if (_pillLoc is { } p)
        {
            Location = p;
        }
        if (_webReady) _web.CoreWebView2.Navigate(pet ? PetUrl : WidgetUrl);
        BindZOrder();
        SaveSettings();
        Program.Log($"form → {mode} at {Location} {Size}");
    }

    // menu 下一只宠物: cycle the sprite pack on the pet page. If the window
    // is currently the pill, swap forms first and let NavigationCompleted
    // deliver the cycle to the freshly loaded /pet document.
    private async void NextPetAsync()
    {
        if (!_webReady) return;
        if (_mode != "pet")
        {
            _cycleOnNav = true;
            ApplyMode("pet");
            return;
        }
        try { await _web.CoreWebView2.ExecuteScriptAsync("typeof cyclePack==='function'&&cyclePack()"); }
        catch (Exception ex) { Program.Log("cyclePack failed: " + ex.Message); }
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
        if (_zcodeHwnd == IntPtr.Zero || IsIconic(_zcodeHwnd)) return null;
        // EXTENDED_FRAME_BOUNDS = the visible window rect. GetWindowRect of a
        // maximized window includes an invisible frame that appears and
        // disappears across states (observed 3200 vs 3261 wide), which would
        // make the anchor drift; DWM bounds stay pinned to what's on screen.
        if (DwmGetWindowAttribute(_zcodeHwnd, 9, out var r, 16) != 0
            && !GetWindowRect(_zcodeHwnd, out r))
            return null;
        return (r.Right - DockFromRight - Width, r.Bottom - DockBottomUp);
    }

    private int _dockLogs;

    // Keep the pill one z-level ABOVE the ZCode window (not the topmost
    // band): any app that covers ZCode covers the pill too, and activating
    // ZCode raises the pill with it — the pill behaves like part of ZCode.
    // SetWindowPos places the window BELOW hWndInsertAfter, so to sit above
    // ZCode we insert below whatever currently sits above ZCode (HWND_TOP
    // when ZCode tops its band). Passing ZCode itself put the pill under it
    // — the bug that hid the pill entirely.
    private void BindZOrder()
    {
        if (_zcodeHwnd == IntPtr.Zero || _topMostItem.Checked) return;
        var aboveZcode = GetWindow(_zcodeHwnd, 3); // GW_HWNDPREV, may be IntPtr.Zero → HWND_TOP
        const int SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;
        _ = SetWindowPos(Handle, aboveZcode, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    }

    private void ApplyDock()
    {
        if (!_docked || _mode != "pill") return; // docking is a pill-form concept
        bool ok = DwmGetWindowAttribute(_zcodeHwnd, 9, out var fr, 16) == 0;
        GetWindowRect(_zcodeHwnd, out var wr);
        if (_dockLogs < 6)
        {
            _dockLogs++;
            Program.Log($"dockcalc#{_dockLogs} hwnd=0x{_zcodeHwnd:X} dwmOk={ok} frame=({fr.Left},{fr.Top})-({fr.Right},{fr.Bottom}) winrect=({wr.Left},{wr.Top})-({wr.Right},{wr.Bottom}) loc={Location}");
        }
        if (DockAnchor() is not { } a) return;
        var target = new Point(a.X + _dx, a.Y + _dy);
        // never jump to a target outside a visible screen (guards against
        // virtualized/garbage rects); stay put and wait for the next tick
        if (!Screen.FromPoint(target).WorkingArea.Contains(target)) return;
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
                // record what they did — pet keeps its position, docked pill
                // keeps a fine-tune offset vs the anchor, free pill its position
                if (_mode == "pet")
                {
                    _petLoc = Location;
                }
                else if (_docked && anchorBefore is { } a)
                {
                    _dx = Location.X - a.X;
                    _dy = Location.Y - a.Y;
                }
                else
                {
                    _pillLoc = Location;
                }
                BindZOrder();
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

    internal static void OpenUrl(string url) =>
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
                _pillLoc = new Point(b.GetProperty("x").GetInt32(), b.GetProperty("y").GetInt32());
                if (b.TryGetProperty("docked", out var d)) _docked = d.GetBoolean();
                if (b.TryGetProperty("dx", out var dx)) _dx = dx.GetInt32();
                if (b.TryGetProperty("dy", out var dy)) _dy = dy.GetInt32();
                // migrate the two-window era: petVisible meant a separate pet
                // card was open — carry that into the single-window form state
                if (b.TryGetProperty("mode", out var m)) _mode = m.GetString() == "pet" ? "pet" : "pill";
                else if (b.TryGetProperty("petVisible", out var pv) && pv.GetBoolean()) _mode = "pet";
                if (b.TryGetProperty("petX", out var px) && b.TryGetProperty("petY", out var py))
                    _petLoc = new Point(px.GetInt32(), py.GetInt32());
                return;
            }
        }
        catch { /* fall through to default placement */ }
        PlaceDefault();
    }

    // default pet rest spot: right edge, vertically MIDDLE of the work area —
    // the bottom-right corner belongs to the docked pill and would z-fight
    // with it every watch tick
    private static Point DefaultPetLocation()
    {
        var wa = Screen.PrimaryScreen!.WorkingArea;
        return new Point(wa.Right - PetSize.Width - 28, (wa.Top + wa.Bottom) / 2 - PetSize.Height / 2);
    }

    private void PlaceDefault()
    {
        var wa = Screen.PrimaryScreen!.WorkingArea;
        _pillLoc = new Point(wa.Right - WidgetSize.Width - 24, wa.Bottom - 300);
    }

    private void SaveSettings()
    {
        try
        {
            Point pill = _mode == "pill" ? Location : _pillLoc ?? Location;
            Point pet = _mode == "pet" ? Location : _petLoc ?? DefaultPetLocation();
            File.WriteAllText(_settingsPath, JsonSerializer.Serialize(
                new { x = pill.X, y = pill.Y, docked = _docked, dx = _dx, dy = _dy,
                      mode = _mode, petX = pet.X, petY = pet.Y }));
        }
        catch { /* position persistence is best-effort */ }
    }
}

