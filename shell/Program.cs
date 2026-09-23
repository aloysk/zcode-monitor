// ZcodeWidget — frameless shell for the zcode-monitor token-speed widget.
// ONE window, THREE forms (a single WebView2, two pages):
//   pill (default)  /widget  280×56   number + sparkline, docks to ZCode
//   mini pet        /pet     160×200  mini sprite + speed bubble, docks to ZCode
//   normal pet      /pet     320×380  sprite card + speed bubble, free position
// Switching forms: right-click menu (radio items 胶囊/迷你宠物/正常桌宠) or
// scrolling the wheel anywhere on the widget (pill → mini → pet → pill).
// The menu also carries: next pet pack (下一只宠物 — or double-click the
// pet), docking, global topmost, dashboard, exit. Served by the repo's node
// server on 127.0.0.1:7331. Same host pattern as ELaserFocus OperatorHost:
// WinForms + WebView2.
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
    // mini pet companion: 80×100 CSS at 200% DPI — mini sprite + bubble
    private static readonly Size MiniSize = new(160, 200);
    // normal pet card: 160×190 CSS; cat canvas ~80% height + bubble headroom
    private static readonly Size PetSize = new(320, 380);

    // dock anchor, calibrated against the ZCode window's visible frame bounds
    // (DWM EXTENDED_FRAME_BOUNDS = 3200×1904 when maximized): the pill sits in
    // the free margin RIGHT of the composer card (card right ≈2820 → pill left
    // 2836 = 194+Width inside the right edge), vertically centered on the
    // bottom toolbar row (row y1787-1844 → pill top 1787 = 117 above bottom)
    private const int DockFromRight = 194;
    private const int DockBottomUp = 117;
    // mini pet dock: vertically centered on the old pill spot (its 200px height
    // spans the same optical band the 56px pill occupied)
    private const int DockBottomUpMini = 245;

    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HTCAPTION = 0x2;
    // pill corner radius (physical px) — matches the ZCode composer card's ≈17px
    private const int PillRadius = 20;
    // pet card corner radius (physical px) — matches the card face in pet.html
    private const int PetRadius = 36;
    // mini pet card radius — pill-lineage radius on a pet-sized card
    private const int MiniRadius = 20;
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
    // form selection: three mutually-exclusive radio items (CheckOnClick);
    // the click handler clears the other two so the menu reads as one choice
    private readonly ToolStripMenuItem _topMostItem = new("始终置顶(全局)") { CheckOnClick = true, Checked = false };
    private readonly ToolStripMenuItem _dockItem = new("吸附 ZCode 窗口") { CheckOnClick = true, Checked = true };
    private readonly ToolStripMenuItem _pillFormItem = new("胶囊") { CheckOnClick = true };
    private readonly ToolStripMenuItem _miniFormItem = new("迷你宠物") { CheckOnClick = true };
    private readonly ToolStripMenuItem _petFormItem = new("正常桌宠") { CheckOnClick = true };
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

    // restart POST rides a LONGER budget than the 2s probe client: the server is
    // single-threaded with synchronous sqlite — a cold query queued ahead of the
    // POST can hold it seconds past 2s, and aborting then leaves the shell
    // assuming failure while the server still commits the restart (stale page,
    // no reload). The replacement is slow to boot, not the response.
    private static readonly System.Net.Http.HttpClient HttpLong = new(
        new System.Net.Http.HttpClientHandler { UseProxy = false })
    { Timeout = TimeSpan.FromSeconds(15) };

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
    private string _mode = "pill"; // "pill" | "mini" | "pet" — the form the window wears
    private Point? _pillLoc;       // last free pill position (docking overrides it)
    private Point? _miniLoc;       // last free mini-pet position (docking overrides it)
    private Point? _petLoc;        // last normal-pet position
    private string? _navUrl;       // page currently loaded (skip no-op navigations)
    private bool _webReady;        // CoreWebView2 initialized (Navigate/ExecuteScript safe)
    private bool _cycleOnNav;      // run cyclePack() once a NEW /pet document lands
    private bool _restartBusy;     // one restart at a time: a second click in the
                                   // handoff gap would take the was-down branch and
                                   // double-spawn a racing node (EADDRINUSE loser dies silently)
    private bool _ensureBusy;      // same latch for EnsureServerAsync: Shown's startup
                                   // bring-up can race a menu restart into a double spawn
    private int _navRetries;       // failed-Navigation re-attempts (error page has no
                                   // page script → no menu, no seed — it must not be terminal)

    public WidgetForm()
    {
        Program.Log("form ctor start");
        FormBorderStyle = FormBorderStyle.None;
        TopMost = true;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None; // sizes stay in physical px (200% desktop: WebView2 renders CSS at 2x)
        LoadSettings();
        Size = _mode switch { "mini" => MiniSize, "pet" => PetSize, _ => WidgetSize };
        if (_mode == "pet") { _petLoc ??= DefaultPetLocation(); Location = _petLoc.Value; }
        else if (_mode == "mini") { _miniLoc ??= DefaultPetLocation(); Location = _miniLoc.Value; }
        else if (_pillLoc is { } p) Location = p;
        SyncFormMenu();
        _dockItem.Enabled = _mode != "pet"; // docking is a companion-form concept (pill + mini)
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
        // radio semantics: each click selects one form and clears the others;
        // CheckOnClick already flipped the clicked item before Click runs
        _pillFormItem.Click += (s, e) => ApplyMode("pill");
        _miniFormItem.Click += (s, e) => ApplyMode("mini");
        _petFormItem.Click += (s, e) => ApplyMode("pet");
        _nextPetItem.Click += (s, e) => NextPetAsync();
        _menu.Items.Add(_pillFormItem);
        _menu.Items.Add(_miniFormItem);
        _menu.Items.Add(_petFormItem);
        _menu.Items.Add(_nextPetItem);
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(_dockItem);
        _menu.Items.Add(_topMostItem);
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add("打开完整面板", null, (s, e) => OpenUrl(DashboardUrl));
        var restartItem = new ToolStripMenuItem("重启面板")
            { ToolTipText = "重启 127.0.0.1:7331 面板服务（更新代码后用；失败时可再点一次）" };
        restartItem.Click += (s, e) => _ = RestartServerAsync();
        _menu.Items.Add(restartItem);
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
            // pet forms (mini + normal) z-bind too (covered with ZCode, never
            // floats over unrelated apps); pill only while docked — a freed
            // pill floats in its own band until global topmost is toggled on
            if (_docked || _mode != "pill") BindZOrder();
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

        // the window region IS the visible shape (pill / mini pet / pet card,
        // radius per form). WebView2 transparency doesn't work on plain
        // WinForms windows, so the page paints full-bleed and the shell clips.
        // HandleCreated fires again on every WebView2-driven handle recreation.
        HandleCreated += (s, e) =>
        {
            int r = _mode switch { "pet" => PetRadius, "mini" => MiniRadius, _ => PillRadius };
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

    // tri-state probe for the restart flow: "refused" (nothing listening) and
    // "blocked" (listening but the single-threaded loop is stuck in a cold
    // query) both read as false to ServerUpAsync — but restart must NOT treat
    // blocked as down: the ensure fallback would spawn a doomed racer against a
    // port the blocked server still holds (round-2 concurrency finding 1).
    private enum ServerProbe { Up, Refused, Blocked }
    private static async Task<ServerProbe> ProbeServerAsync()
    {
        try
        {
            using var r = await Http.GetAsync("http://127.0.0.1:7331/api/gen/state");
            return r.IsSuccessStatusCode ? ServerProbe.Up : ServerProbe.Refused;
        }
        catch (System.Threading.Tasks.TaskCanceledException) { return ServerProbe.Blocked; } // 2s timeout: TCP up, loop busy
        catch { return ServerProbe.Refused; } // refused/reset: nothing there
    }

    // The widget page is served by the repo's node server. At login it usually
    // isn't running: probe a few times, then spawn it hidden as our child so
    // the whole stack comes up with the pill. The owned server dies with our
    // clean exit (menu 退出); hiding with ZCode gone keeps both alive.
    private async Task EnsureServerAsync()
    {
        // serialized: Shown's startup bring-up and a same-instant menu restart would
        // both pass the probe phase and both spawn node — the EADDRINUSE loser dies
        // silently and overwrites _serverProc/_serverJob with the dead child
        if (_ensureBusy) { Program.Log("server: ensure already in progress — skipping"); return; }
        _ensureBusy = true;
        try { await EnsureServerCoreAsync(); }
        catch (Exception ex) { Program.Log("server: ensure unexpected: " + ex.Message); }
        finally { _ensureBusy = false; }
    }

    private async Task EnsureServerCoreAsync()
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

    // ── menu action: restart the panel server ────────────────────────
    // The server owns the port handoff itself — POST /api/restart (custom
    // header gate, see server/restart-route.js) spawns its own replacement
    // and exits, so ONE call path covers both ownership states: the companion
    // server we spawned (ZCODE_WIDGET_CHILD, job-bound) and one we merely
    // adopted because it was already listening. Only when nothing answers do
    // we fall back to the plain bring-up path. The page is reloaded at the
    // end so freshly merged frontend code actually runs — SSE self-heal alone
    // would keep the OLD document alive against the new server.
    private async Task RestartServerAsync()
    {
        if (_restartBusy) { Program.Log("restart: already in progress — ignoring"); return; }
        _restartBusy = true;
        try { await RestartServerCoreAsync(); }
        catch (Exception ex) { Program.Log("restart: unexpected: " + ex.Message); }
        finally { _restartBusy = false; }
    }

    private async Task RestartServerCoreAsync()
    {
        Program.Log("menu: restart panel");
        var probe = await ProbeServerAsync();
        if (probe == ServerProbe.Blocked)
        {
            // alive but unresponsive (cold query holding the single-threaded
            // loop): a restart POST would hang too, and the down-branch would
            // spawn a doomed racer against a port the blocked server holds —
            // bail and say why (round-2 concurrency finding 1)
            Program.Log("restart: server alive but unresponsive (blocked event loop) — not restarting now, retry later");
            return;
        }
        var wasUp = probe == ServerProbe.Up;
        if (wasUp)
        {
            try
            {
                using var req = new System.Net.Http.HttpRequestMessage(
                    System.Net.Http.HttpMethod.Post, "http://127.0.0.1:7331/api/restart");
                req.Headers.TryAddWithoutValidation("X-Zcode-Monitor-Restart", "1");
                // HttpLong (15s): a cold sqlite query can hold the single-threaded
                // server seconds past the 2s probe budget — aborting then would
                // assume failure while the server still commits the restart
                using var resp = await HttpLong.SendAsync(req);
                Program.Log($"restart: endpoint -> {(int)resp.StatusCode}");
                // HttpClient doesn't throw on 4xx/5xx: a refused restart (403 gate /
                // 500 spawn_failed — old server stays up) must stop here, not burn
                // 4s in the wait-down loop against a server that never goes down
                // and then "recover" into a pointless page reload
                if (!resp.IsSuccessStatusCode) return;
            }
            catch (Exception ex)
            {
                Program.Log("restart: endpoint failed: " + ex.Message);
                return;
            }
            // let the OLD process actually exit first: it stays reachable for
            // ~250ms after the response, and an immediate "wait for up" would
            // probe the old listener, "recover" instantly and reload the page
            // against PRE-restart assets — the exact stale-code state this
            // menu item exists to clear
            bool oldWentDown = false;
            for (int i = 0; i < 16; i++)
            {
                if (!await ServerUpAsync()) { oldWentDown = true; break; }
                await Task.Delay(250);
            }
            // exhaustion is not fatal (the up-loop may catch the replacement), but
            // it means the reload below may hit the OLD server — say so in the log,
            // naming both plausible causes (blocked loop, or the replacement died
            // early — the latter's evidence is in the server's restart-child.log)
            if (!oldWentDown) Program.Log("restart: old listener still up after 4s (blocked event loop? or child died early — see logs/restart-child.log) — proceeding");
        }
        else
        {
            await EnsureServerAsync(); // nothing up (e.g. companion idle self-exit)
            // EnsureServerAsync gives up silently on several paths (repo/node not
            // found, spawn failure, 12s no-up) — report the OUTCOME, not the intent
            bool ensured = await ServerUpAsync();
            Program.Log("restart: server was down — ensure result: " + (ensured ? "up" : "still down (see server: lines above)"));
        }
        // replacement binds after its boot delay + node start; /api/gen/state
        // is in-memory so each probe is cheap
        for (int i = 0; i < 40; i++)
        {
            if (await ServerUpAsync()) break;
            await Task.Delay(500);
        }
        if (!await ServerUpAsync()) { Program.Log("restart: server did not come back"); return; }
        if (_webReady)
        {
            var url = _navUrl ?? UrlOf(_mode);
            _web.CoreWebView2.Navigate(url);
            Program.Log("restart: reloaded " + url);
        }
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
            _web.CoreWebView2.NavigationCompleted += async (s, e) =>
            {
                // async void: any escapee exception rethrows on the UI thread —
                // a local catch keeps it a log line, matching NextPetAsync's shape
                try
                {
                // a failed navigation (server briefly down mid-handoff) lands
                // WebView2's error page — it runs no page script, so drag/menu/
                // seed all die and nothing ever retries. Re-probe and re-Navigate
                // a bounded number of times; success resets the budget.
                if (!e.IsSuccess)
                {
                    if (_navUrl != null && _navRetries < 3)
                    {
                        _navRetries++;
                        Program.Log($"nav failed (http={e.HttpStatusCode}) — retry {_navRetries}/3 after probe");
                        for (int i = 0; i < 20; i++)
                        {
                            if (await ServerUpAsync()) break;
                            await Task.Delay(500);
                        }
                        if (await ServerUpAsync()) _web.CoreWebView2.Navigate(_navUrl);
                        else Program.Log("nav retry: server still down, giving up this attempt");
                    }
                    else if (_navUrl != null) Program.Log("nav failed and retry budget exhausted");
                    return;
                }
                _navRetries = 0;
                if (!_cycleOnNav) return;
                _cycleOnNav = false;
                _ = _web.CoreWebView2.ExecuteScriptAsync("typeof cyclePack==='function'&&cyclePack()");
                }
                catch (Exception ex) { Program.Log("nav handler: " + ex.Message); }
            };
            string url = _mode == "pill" ? WidgetUrl : PetUrl;
            _navUrl = url;
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

    // ── form machinery: one window, three faces ──────────────────────

    private static Size SizeOf(string mode) =>
        mode switch { "mini" => MiniSize, "pet" => PetSize, _ => WidgetSize };
    private static int RadiusOf(string mode) =>
        mode switch { "pet" => PetRadius, "mini" => MiniRadius, _ => PillRadius };
    private static string UrlOf(string mode) =>
        mode == "pill" ? WidgetUrl : PetUrl;

    private void SyncFormMenu()
    {
        _pillFormItem.Checked = _mode == "pill";
        _miniFormItem.Checked = _mode == "mini";
        _petFormItem.Checked = _mode == "pet";
    }

    // Swap the window between the three forms: size, clip region, position
    // policy (dock anchor vs free spot) and — only across the pill↔pet page
    // boundary — the hosted page. Shared machinery (z-binding, ZCode
    // visibility, lifecycle, server) is untouched; this is the shell's shape.
    private void ApplyMode(string mode)
    {
        if (_mode == mode) return;
        _mode = mode;
        SyncFormMenu();
        _dockItem.Enabled = mode != "pet";
        Size = SizeOf(mode);
        if (IsHandleCreated)
            _ = SetWindowRgn(Handle, MakeRoundRgn(Width, Height, RadiusOf(mode)), true);
        switch (mode)
        {
            case "pet":
                Location = _petLoc ??= DefaultPetLocation();
                break;
            case "mini":
                if (_docked) ApplyDock();
                else Location = _miniLoc ??= DefaultPetLocation();
                break;
            default: // pill
                if (_docked) ApplyDock(); // anchor recomputed with the pill's width
                else if (_pillLoc is { } p) Location = p;
                break;
        }
        // same-URL swaps (mini↔pet share the page) must NOT navigate: a reload
        // would reset the sprite/pack state mid-display
        string url = UrlOf(mode);
        if (_webReady && url != _navUrl)
        {
            _navUrl = url;
            _web.CoreWebView2.Navigate(url);
        }
        BindZOrder();
        SaveSettings();
        Program.Log($"form → {mode} at {Location} {Size}");
    }

    // wheel on the widget cycles pill → mini → pet → pill (reverse when
    // scrolling down); the pages forward their wheel events as messages
    private void CycleForm(bool up)
    {
        string next = (_mode, up) switch
        {
            ("pill", true) => "mini",
            ("mini", true) => "pet",
            ("pet", true) => "pill",
            ("pill", false) => "pet",
            ("pet", false) => "mini",
            _ => "pill",
        };
        ApplyMode(next);
    }

    // menu 下一只宠物: cycle the sprite pack on the pet page. From a pet form
    // it runs directly; from the pill it swaps to the normal pet first and
    // lets NavigationCompleted deliver the cycle to the freshly loaded /pet
    // document (ExecuteScript targets the CURRENT document, so firing it
    // right after Navigate would hit the outgoing page's script context).
    private async void NextPetAsync()
    {
        if (!_webReady) return;
        if (_mode == "pill")
        {
            _cycleOnNav = true;
            ApplyMode("pet");
            return;
        }
        try
        {
            // returns diagnostics so a dead cycle is visible in widget-run.log
            var r = await _web.CoreWebView2.ExecuteScriptAsync(
                "(function(){var r={t:typeof cyclePack,p:typeof pack!=='undefined'?pack.id:null};" +
                "try{if(r.t==='function'){cyclePack();r.ok=true;r.p2=pack.id}}catch(e){r.err=String(e)}" +
                "return JSON.stringify(r)})()");
            Program.Log("next-pet: " + r);
        }
        catch (Exception ex) { Program.Log("next-pet FAILED: " + ex.Message); }
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
        int bottomUp = _mode == "mini" ? DockBottomUpMini : DockBottomUp;
        return (r.Right - DockFromRight - Width, r.Bottom - bottomUp);
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
        if (!_docked || _mode == "pet") return; // docking is a companion-form concept (pill + mini)
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
                // record what they did — pets keep their positions, a docked
                // companion keeps a fine-tune offset vs the anchor, a freed
                // companion keeps its position
                if (_mode == "pet")
                {
                    _petLoc = Location;
                }
                else if (_mode == "mini" && !_docked)
                {
                    _miniLoc = Location;
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
            case "form-cycle":
                CycleForm(root.GetProperty("up").GetBoolean());
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
                if (b.TryGetProperty("mode", out var m))
                {
                    var s = m.GetString();
                    _mode = s is "pet" or "mini" ? s! : "pill";
                }
                else if (b.TryGetProperty("petVisible", out var pv) && pv.GetBoolean()) _mode = "pet";
                if (b.TryGetProperty("petX", out var px) && b.TryGetProperty("petY", out var py))
                    _petLoc = new Point(px.GetInt32(), py.GetInt32());
                if (b.TryGetProperty("miniX", out var mx) && b.TryGetProperty("miniY", out var my))
                    _miniLoc = new Point(mx.GetInt32(), my.GetInt32());
                return;
            }
        }
        catch { /* fall through to default placement */ }
        PlaceDefault();
    }

    // default pet rest spot: right edge, vertically MIDDLE of the work area —
    // the bottom-right corner belongs to the docked companions and would
    // z-fight with them every watch tick
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
            Point mini = _mode == "mini" ? Location : _miniLoc ?? DefaultPetLocation();
            Point pet = _mode == "pet" ? Location : _petLoc ?? DefaultPetLocation();
            File.WriteAllText(_settingsPath, JsonSerializer.Serialize(
                new { x = pill.X, y = pill.Y, docked = _docked, dx = _dx, dy = _dy,
                      mode = _mode,
                      miniX = mini.X, miniY = mini.Y, petX = pet.X, petY = pet.Y }));
        }
        catch { /* position persistence is best-effort */ }
    }
}

