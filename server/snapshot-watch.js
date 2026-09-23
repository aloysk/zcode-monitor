'use strict';
// server/snapshot-watch.js — 快照绊线（tripwire）引擎。
//
// 背景（本机只读实证 2026-09-23，README「隐私提示」）：ZCode 曾在后台把整个
// 工作区（含 .git 历史）加密打包写入 ~/.zcode/v2/checkpoints/<hash>/pending/
// *.tar.gz.enc 并上传云端；该机制自 2026-09-18 13:32 起零活动（推断服务端
// 开关，可能随更新恢复）。本引擎盯住该目录：机制复活、新快照落盘的那一刻
// 面板即告警——平时安静显示「静默」，这正是它的全部价值（保险，不是功能）。
//
// 语义要点：
//   - 绊线 = 基线对比，不是存在性：boot 后首次**可读**扫描即基线；此后任何
//     「新增工作区 / state.json 变化 / pending 工件增减」判为活动并**闩锁**
//     （latched——上传成功后 ZCode 清理目录、扫描回落为空也保持告警，直到
//     面板重启）。boot 时目录里已有的遗留内容不告警，如实展示为「遗留静止」。
//   - 目录不可读（readdir 被拒：EACCES/EPERM——如以**拒绝读取**式 ACL 锁定；
//     注意 README 的 icacls 程序只拒写入/创建、不拒读取，锁定后绊线照常扫描、
//     卡片保持静默/遗留静止）单列「unreadable」态，绝不折叠成「静默」——不可
//     读伪装成无内容会让绊线失明还显绿。同一原则同样适用于**子目录级**读失败
//     （某工作区的 state.json/pending 读被拒）：置 partial 并跳过该拍差异判定，
//     绝不把读失败折叠成「签名变化」假报活动。可读→不可读的转移也**不参与
//     差异判定**（否则手动锁目录那一刻全部工作区被判 removed，假报「机制
//     复活」）。零点建立在不可读扫描上时（boot 时已锁），首次可读扫描重锚
//     零点——解锁后既有内容不算新增。截断/部分不可读的扫描不参与判定、
//     也不作为零点，仅展示。
//   - 快路径 fs.watch（Windows/macOS 递归）+ 慢路径轮询（默认 30s）双保险：
//     watch 事件只触发去抖后的提前重扫，**不单独判活动**（写事件不构成
//     快照证据，扫描差异才是）；watch 不可用/出错时降级为纯轮询并在
//     state 里如实标注（watchMode/watchError），每拍轮询顺带尝试重挂。
//     两个 watcher 都挂 'error' 监听——FSWatcher 异步失败若无监听即未捕获
//     异常，会把整个面板进程带走（log-tail.js 同款教训）。
//   - 目录缺失也算覆盖面：递归 watch 挂不上时改盯父目录（~/.zcode/v2，
//     非递归、全平台可用），checkpoints 目录被创建本身就是事件。
//   - 红线遵从：对 ~/.zcode/ 只用 readdir/readFile/stat——零写入；扫描全
//     异步（事件循环不阻塞），且处处封顶（工作区数 / 单区工件数 / 单次
//     扫描总 stat 预算 / state.json 读取字节），异常路径按错误码分级降级，
//     绝不抛出。
//   - 目录名白名单 validHashName：只认 ZCode 生成的哈希形态（路径穿越/
//     隐藏名/空格一律忽略），state.json 里的 workspacePath 是不可信文本，
//     前端渲染必须过 escapeHtml（源码契约测试锁住）。
//
// 参考：Masterchiefm/zcode-speed-panel v0.4.6 的 snapshot_guard.rs（MIT）——
// state.json 容错解析（损坏跳过、failureCount 缺失按 0）与哈希名白名单形态。

const path = require('path');

// 扫描封顶（性能红线：常态目录为空，readdir 零成本；异常大的目录也不得
// 让一次扫描变长任务——被监视方单方面可制的扫描代价必须有界）
const MAX_WORKSPACES = 256;          // 每次扫描最多处理的工作区目录数
const MAX_ENC_PER_WS = 2000;         // 每工作区最多 stat 的 pending 工件数
const MAX_STATS_PER_SCAN = 50 * 1000; // 单次扫描总 stat 预算（防 256×2000 全额物化）
const STATE_JSON_MAX_BYTES = 65536;  // state.json 超过此尺寸不读（防异常大文件）
const API_WS_LIST_CAP = 50;          // state() 返回的明细细目上限（按最近活动倒序）

const DEFAULT_POLL_MS = 30 * 1000;   // 慢路径轮询
const WATCH_RESCAN_DELAY_MS = 3000;  // watch 事件 → 重扫去抖（事件风暴只扫一次）
const WATCH_REARM_DELAY_MS = 5 * 1000; // watch 出错 → 重挂冷却

/// state.json → 关心的字段（纯函数，可测）。损坏 JSON / 非对象 → null（调用
/// 方照常计工作区数，只是不贡献字段）；failureCount 缺失按 0（上游同款容错）。
/// workspacePath 是不可信文本：截断后透传，展示侧消毒。
function parseStateSummary(text) {
  let v;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const lcs = (v.lastCompressedSize && typeof v.lastCompressedSize === 'object')
    ? v.lastCompressedSize : {};
  return {
    path: typeof v.workspacePath === 'string' ? v.workspacePath.slice(0, 260) : null,
    failureCount: Number.isFinite(v.failureCount) ? v.failureCount : 0,
    recordedAtMs: Number.isFinite(lcs.recordedAt) ? lcs.recordedAt : null,
  };
}

/// checkpoints 下的工作区子目录名白名单（纯函数，可测）：哈希形态（字母
/// 数字 - _，≤128）。路径穿越（../、斜杠、绝对路径、隐藏名）一律不放行。
function validHashName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(name);
}

/// 一次目录扫描。fsapi 注入（测试可替换）。错误分级三层：
/// ① 顶层 readdir：ENOENT/ENOTDIR → exists:false（真缺失）；EACCES/EPERM 等
///   → exists:true + unreadable:true（整目录读不了）；
/// ② 子目录级（state.json / pending / 单工件）：ENOENT 属预期（文件本就不
///   存在 / 并发改名），静默跳过；**其余读失败（EACCES/EPERM/EBUSY 等）置
///   partial:true**——把读失败折叠成「签名为零」会让下一拍 diff 判 modified，
///   假报机制复活（或反向吞掉真实活动），调用方对 partial 扫描不参与差异
///   判定（与 truncated 同语义：部分数据仅供展示）；
/// ③ 封顶截断（工作区数 / 单区工件数 / stat 预算）→ truncated:true。
/// _sig 是供基线对比的签名（state.json mtime/size + 工件数/字节），API 输出
/// 前剥离。
async function scanDir(fsapi, dir) {
  const out = { exists: false, unreadable: false, partial: false, truncated: false, readError: null,
                workspaces: [], totals: { workspaces: 0, artifacts: 0, bytes: 0 }, lastWriteMs: 0 };
  let entries;
  try { entries = await fsapi.readdir(dir, { withFileTypes: true }); }
  catch (e) {
    const code = e && e.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return out;
    out.exists = true; out.unreadable = true; out.readError = code || String(e);
    return out;
  }
  out.exists = true;

  const hashDirs = entries.filter((e) => e.isDirectory() && validHashName(e.name));
  if (hashDirs.length > MAX_WORKSPACES) out.truncated = true; // 截断须如实标注
  const dirs = hashDirs.slice(0, MAX_WORKSPACES);

  let budget = MAX_STATS_PER_SCAN;
  for (const d of dirs) {
    if (budget <= 0) { out.truncated = true; break; }
    const wsRoot = path.join(dir, d.name);
    let wsReadError = null;
    // state.json（可缺失/损坏/超大——一律容忍；缺失=ENOENT 属预期，其余读
    // 失败上浮为 partial）
    let pathName = null, failureCount = null, recordedAtMs = null;
    let stMtimeMs = 0, stSize = 0;
    try {
      const sp = path.join(wsRoot, 'state.json');
      const sf = await fsapi.stat(sp);
      budget--;
      stMtimeMs = sf.mtimeMs; stSize = sf.size;
      if (sf.size <= STATE_JSON_MAX_BYTES) {
        const parsed = parseStateSummary(await fsapi.readFile(sp, 'utf8'));
        if (parsed) ({ path: pathName, failureCount, recordedAtMs } = parsed);
      }
    } catch (e) {
      if (!e || e.code !== 'ENOENT') wsReadError = (e && e.code) || String(e);
    }

    // pending/*.enc 工件（大小 + 最新 mtime）；预算内做不了的部分如实截断
    let encCount = 0, encBytes = 0, encLastMs = 0;
    try {
      const pendingRoot = path.join(wsRoot, 'pending');
      const pendEntries = await fsapi.readdir(pendingRoot, { withFileTypes: true });
      const pends = pendEntries.filter((e) => e.isFile() && e.name.endsWith('.enc'));
      if (pends.length > MAX_ENC_PER_WS) out.truncated = true;
      for (const f of pends.slice(0, MAX_ENC_PER_WS)) {
        if (budget <= 0) { out.truncated = true; break; }
        try {
          const md = await fsapi.stat(path.join(pendingRoot, f.name));
          budget--;
          encCount++; encBytes += md.size;
          if (md.mtimeMs > encLastMs) encLastMs = md.mtimeMs;
        } catch (e) {
          // 单工件消失 = 并发清理/改名的良性跳过；读被拒等其他失败上浮
          if (!e || e.code !== 'ENOENT') wsReadError = wsReadError || ((e && e.code) || String(e));
        }
      }
    } catch (e) {
      // 无 pending 目录（ENOENT）属预期；读被拒等其他失败上浮为 partial
      if (!e || e.code !== 'ENOENT') wsReadError = wsReadError || ((e && e.code) || String(e));
    }

    if (wsReadError) {
      out.partial = true;
      if (!out.readError) out.readError = wsReadError;
    }

    const lastWriteMs = Math.max(stMtimeMs, encLastMs, 0);
    out.workspaces.push({
      hash: d.name, path: pathName, failureCount, recordedAtMs,
      encCount, encBytes, lastWriteMs,
      _sig: { m: stMtimeMs, s: stSize, c: encCount, b: encBytes },
    });
    out.totals.workspaces++;
    out.totals.artifacts += encCount;
    out.totals.bytes += encBytes;
    if (lastWriteMs > out.lastWriteMs) out.lastWriteMs = lastWriteMs;
  }
  return out;
}

/// 扫描 → 基线指纹（纯函数，可测）：per-hash 签名表 + 总量。totals 不参与
/// changed 判定（ws 签名数学上已决定 totals，逐签名相同而总量不同不可能
/// 出现），只为 diffScans 的 bytesDelta 展示取数——注释与实现曾不一致，已
/// 按实现改写并有测试钉住当前语义。
/// ws 用 null 原型对象作键容器：普通对象下字面名为 `__proto__` 的目录
/// （validHashName 放行该形态）会改写原型而非建自有键，该目录对绊线隐形。
function fingerprintOf(scan) {
  const ws = Object.create(null);
  for (const w of scan.workspaces) ws[w.hash] = w._sig;
  return { ws, totals: { ...scan.totals } };
}

/// 基线 vs 当前（纯函数，可测）：任何 新增/移除/签名变化 → changed（布尔）。
/// 明细数组叫 modified（不与布尔键同名——重复键会让简写数组静默覆盖布尔，
/// assert.equal 的宽松相等还会把 [] == false 骗绿）。删除同样算活动（上传
/// 成功后 ZCode 清理 pending 也是该目录在动）。
/// 签名相等性用 JSON.stringify 逐键比较：两侧签名恒出自 scanDir 单一构造
/// 点、键序固定（m,s,c,b），此前提成立时与深比较等价。
function diffScans(base, cur) {
  const added = [], removed = [], modified = [];
  for (const h of Object.keys(cur.ws)) {
    if (!(h in base.ws)) added.push(h);
    else if (JSON.stringify(base.ws[h]) !== JSON.stringify(cur.ws[h])) modified.push(h);
  }
  for (const h of Object.keys(base.ws)) if (!(h in cur.ws)) removed.push(h);
  const bytesDelta = cur.totals.bytes - base.totals.bytes;
  return { changed: added.length > 0 || removed.length > 0 || modified.length > 0,
           added, removed, modified, bytesDelta };
}

/// 四态判定（纯函数，可测）：active 闩锁优先于一切；不可读单列一态（读取
/// 被拒后属预期，绝不折叠进 clear——不可读伪装成静默 = 绊线失明还显绿）；
/// 无内容 clear；有内容且未闩锁 static。
/// 五值 union 的权威定义：classify 只产四值；第五值 'pending'（尚无任何
/// 扫描）由 state() 在 current===null 时合成——「无扫描」不是扫描的属性，
/// 不进本函数。truncated/partial 只影响 rescan 的差异判定豁免，不影响
/// 分类展示（截断/部分不可读的扫描照常按其可见内容分类）。
function classify({ exists, unreadable, totals, latched }) {
  if (latched) return 'active';
  if (unreadable) return 'unreadable';
  if (!exists || !totals || totals.workspaces === 0) return 'clear';
  return 'static';
}

/// 绊线引擎。依赖注入：fsapi（默认 fs.promises）、watch（默认 fs.watch）、
/// now（时钟）、pollMs（测试注入小周期换确定性）。
function createSnapshotWatcher({ dir, fsapi, watch, now = () => Date.now(), pollMs = DEFAULT_POLL_MS } = {}) {
  const FS = fsapi || require('fs').promises;
  const fsWatch = watch || require('fs').watch;

  let baseline = null;        // 首次可读扫描的指纹（绊线零点）
  let baselineUnreadable = false; // 零点建立在不可读扫描上（boot 时目录已锁）→ 首次可读扫描重锚
  let current = null;         // 最近一次扫描（初始 null → state 里 pending 标记）
  let latched = false;        // 活动闩锁
  let firstActivityAt = null; // 首次判定活动的时刻
  let activityDetail = null;  // diffScans 的差异明细
  let lastWatchEventAt = null;
  let watchMode = 'pending';  // 'watch' | 'parent' | 'poll' | 'pending'
  let watchError = null;
  let scanError = null;
  let scannedAt = null;
  let stopped = false;
  let scanning = false;
  let rescanTimer = null;
  let rearmTimer = null;
  let dirWatcher = null;
  let parentWatcher = null;

  // ── watch 装配 ─────────────────────────────────────────────
  // 主路：对 checkpoints 递归 watch（win/mac 原生），**另挂**父目录非递归
  // watch（两级同时常驻——父目录级既兜底 checkpoints 目录本身的创建/更名，
  // 也覆盖平台不支持递归的场景）。两级都挂不上 → 纯轮询。**两个 watcher
  // 都必须挂 'error' 监听**：FSWatcher 的异步失败（EPERM/EMFILE 等）以
  // error 事件送达，EventEmitter 无监听的 error 即未捕获异常——会把整个
  // 面板进程带走（log-tail.js:338 同款教训）。错误路径：记录 → 关闭两级 →
  // 降级 poll → 冷却后重挂（不在回调里同步重入 armWatch）。同步 throw 由
  // armWatch 的 try/catch 走同一条降级路。失败/恢复在 console 留痕（按
  // 消息去重防 rearm 周期刷屏）——state 字段是易失的，降级原因须可事后
  // 归因（livegen.js 同款惯例）。
  function watchErrorSink(e) {
    if (stopped) return;
    const msg = (e && (e.message || e.code)) ? (e.message || e.code) : String(e);
    logWatchIssue('watch 失败,降级为轮询', msg);
    watchError = msg;
    watchMode = 'poll';
    closeWatchers();
    scheduleRearm();
  }

  let lastWatchIssueLog = null;
  function logWatchIssue(prefix, msg) {
    if (msg !== lastWatchIssueLog) {
      lastWatchIssueLog = msg;
      console.warn(`[snapshot] ${prefix}: ${msg}`);
    }
  }

  function makeParentWatcher() {
    const pw = fsWatch(path.dirname(dir), {}, onParentEvent);
    if (typeof pw.on === 'function') pw.on('error', watchErrorSink);
    return pw;
  }

  function armWatch() {
    if (stopped) return;
    closeWatchers();
    try {
      const dw = fsWatch(dir, { recursive: true }, onWatchEvent);
      if (typeof dw.on === 'function') dw.on('error', watchErrorSink);
      dirWatcher = dw;
      parentWatcher = makeParentWatcher();
      watchMode = 'watch';
      if (watchError) {
        console.log(`[snapshot] watch 恢复（此前降级: ${watchError}）`);
        lastWatchIssueLog = null; // 恢复后同一错误再现可再次留痕
      }
      watchError = null;
      return;
    } catch (e) {
      // 部分成功也要整批关闭再降级（泄漏的活 watcher 会持续触发重扫且永远
      // 脱管——closeWatchers 关闭已提交的两个引用后置空，重挂从头再来）
      closeWatchers();
      const msg = (e && e.message) ? e.message : String(e);
      logWatchIssue('递归 watch 建立失败,降级父目录监视', msg);
      watchError = msg;
    }
    try {
      parentWatcher = makeParentWatcher();
      watchMode = 'parent';
    } catch (e2) {
      parentWatcher = null;
      watchMode = 'poll';
      const msg2 = (e2 && e2.message) || watchError;
      logWatchIssue('父目录 watch 亦失败,降级纯轮询', msg2);
      watchError = msg2;
    }
  }

  function closeWatchers() {
    for (const w of [dirWatcher, parentWatcher]) { try { w && w.close(); } catch { /* 已关 */ } }
    dirWatcher = null; parentWatcher = null;
  }

  function onWatchEvent() {
    lastWatchEventAt = now();
    scheduleRescan();
  }
  function onParentEvent(_evt, filename) {
    // 只关心 checkpoints 条目本身的出现/更名（它不存在时被创建 = 事件）
    const base = path.basename(dir);
    if (!filename || path.basename(String(filename)) === base) {
      lastWatchEventAt = now();
      scheduleRescan();
      // 目录（重）出现 → 主路递归 watch 可以再试
      scheduleRearm();
    }
  }

  function scheduleRescan() {
    if (stopped || rescanTimer) return;
    rescanTimer = setTimeout(() => { rescanTimer = null; rescan(); }, WATCH_RESCAN_DELAY_MS);
    if (typeof rescanTimer.unref === 'function') rescanTimer.unref();
  }
  function scheduleRearm() {
    if (stopped || rearmTimer) return;
    rearmTimer = setTimeout(() => { rearmTimer = null; armWatch(); }, WATCH_REARM_DELAY_MS);
    if (typeof rearmTimer.unref === 'function') rearmTimer.unref();
  }

  // ── 扫描与绊线判定 ─────────────────────────────────────────
  // 零点只建立在**完整可读**的扫描上：不可读/截断/部分不可读（partial）的
  // 扫描既不锚零点也不参与差异判定——可读→不可读的转移若走 diff 会把全部
  // 工作区判成 removed（用户手动锁目录的那一刻假报「机制复活」），子目录
  // 级读失败若被折叠成签名为零同样假报 modified；转移与部分失败本身由
  // classify 的 unreadable 态 / state 的 partial 标记如实呈现。零点建立在
  // 不可读扫描上时（boot 时目录已锁），首次完整可读扫描重锚零点：锁定前
  // 就存在的内容不算「新增」。
  // 卡死自愈：scanDir 的 fs 调用若永不 settle（网络重定向/杀软挂钩的死锁
  // 有先例），scanning 永真会让绊线整体冻结——超 pollMs×3 仍 in-flight
  // 则强制复位让后续拍次能重入，并在 scanError 留痕。
  let scanStartedAt = null;
  let lastScanErrorLog = null;

  async function rescan() {
    if (stopped) return;
    if (scanning) {
      if (scanStartedAt != null && now() - scanStartedAt > pollMs * 3) {
        const msg = '扫描疑似卡死（in-flight 超时），已复位重入';
        if (msg !== lastScanErrorLog) { lastScanErrorLog = msg; console.error(`[snapshot] ${msg}`); }
        scanError = msg;
        scanning = false; // 让本次调用继续执行（重入）
      } else {
        return;
      }
    }
    scanning = true;
    scanStartedAt = now();
    try {
      const scan = await scanDir(FS, dir);
      scanError = null;
      lastScanErrorLog = null;
      if (!baseline && !scan.truncated && !scan.partial) {
        baseline = fingerprintOf(scan);
        baselineUnreadable = scan.unreadable;
      } else if (!latched && !scan.unreadable && !scan.truncated && !scan.partial) {
        if (baselineUnreadable) {
          baseline = fingerprintOf(scan);
          baselineUnreadable = false;
        } else {
          const d = diffScans(baseline, fingerprintOf(scan));
          if (d.changed) {
            latched = true;
            firstActivityAt = now();
            activityDetail = d;
            // 本模块存在的全部意义在这一刻——进程级留痕（state 是易失的，
            // 标签页关着/面板重启后这是唯一归因线索）
            console.warn(`[snapshot] 检测到快照活动并闩锁: added=${d.added.length} modified=${d.modified.length} removed=${d.removed.length} bytesDelta=${d.bytesDelta}`);
          }
        }
      }
      current = scan;
      scannedAt = now();
      // watch 还没挂上或已降级而目录实际存在可读 → 每拍顺带尝试重挂
      if (watchMode !== 'watch' && watchMode !== 'pending' && scan.exists && !scan.unreadable) scheduleRearm();
    } catch (e) {
      // scanDir 自身不抛；这里只防未预料的实现错误——绊线宁可不误报
      const msg = e && e.message ? e.message : String(e);
      if (msg !== lastScanErrorLog) { lastScanErrorLog = msg; console.error('[snapshot] 扫描异常(已记录到 state,不影响进程):', msg); }
      scanError = msg;
    } finally {
      scanning = false;
      scanStartedAt = null;
    }
  }

  // boot 基线（异步，不阻塞启动）+ 慢路径轮询 + watch 装配
  rescan();
  armWatch();
  const timer = setInterval(rescan, pollMs);
  if (typeof timer.unref === 'function') timer.unref();

  function state() {
    const totals = current ? current.totals : { workspaces: 0, artifacts: 0, bytes: 0 };
    const status = current
      ? classify({ exists: current.exists, unreadable: current.unreadable, totals: current.totals, latched })
      : 'pending';
    const list = current
      ? [...current.workspaces]
          .sort((a, b) => b.lastWriteMs - a.lastWriteMs)
          .slice(0, API_WS_LIST_CAP)
          .map(({ _sig, ...w }) => w)   // 剥离内部签名
      : [];
    return {
      dir,
      exists: current ? current.exists : false,
      unreadable: current ? current.unreadable : false,
      partial: current ? current.partial : false,
      readError: current ? current.readError : null,
      truncated: current ? current.truncated : false,
      scanStuck: scanning && scanStartedAt != null && (now() - scanStartedAt) > pollMs * 3,
      status,                     // 'pending' | 'clear' | 'static' | 'unreadable' | 'active'（五值 union 见 classify 头注）
      baseline: baseline ? baseline.totals : null,
      current: { ...totals, lastWriteMs: current ? current.lastWriteMs : null },
      firstActivityAt,
      activityDetail,
      lastWatchEventAt,
      watchMode,                  // 'watch' | 'parent' | 'poll' | 'pending'
      watchError,
      scanError,
      scannedAt,
      workspaces: list,
    };
  }

  return {
    state,
    rescan,
    stop() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(rescanTimer);
      clearTimeout(rearmTimer);
      closeWatchers();
    },
  };
}

/// /api/snapshot 的可挂载路由（health-route 同款工厂形态，依赖注入供测试）。
function makeSnapshotRoute({ watcher }) {
  return function snapshotRoute(_req, res) {
    res.json(watcher.state());
  };
}

module.exports = {
  createSnapshotWatcher,
  makeSnapshotRoute,
  parseStateSummary,
  validHashName,
  scanDir,
  fingerprintOf,
  diffScans,
  classify,
  // 常量导出供测试对齐（不参与契约）
  LIMITS: { MAX_WORKSPACES, MAX_ENC_PER_WS, MAX_STATS_PER_SCAN, STATE_JSON_MAX_BYTES, API_WS_LIST_CAP },
};
