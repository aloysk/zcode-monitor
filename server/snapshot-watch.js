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
//   - 目录不可读（EACCES/EPERM，如用户按 README 以 icacls 锁定）单列
//     「unreadable」态，绝不折叠成「静默」——不可读伪装成无内容会让绊线
//     失明还显绿；可读→不可读的转移也**不参与差异判定**（否则手动锁目录那
//     一刻全部工作区被判 removed，假报「机制复活」）。零点建立在不可读
//     扫描上时（boot 时已锁），首次可读扫描重锚零点——解锁后既有内容不算
//     新增。截断的扫描（预算耗尽）同样不参与判定，仅展示。
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

/// 一次目录扫描。fsapi 注入（测试可替换）；readdir 失败按错误码分级：
/// ENOENT/ENOTDIR → exists:false（真缺失）；EACCES/EPERM 等 → exists:true +
/// unreadable:true（目录在但读不了——ACL 锁定后属预期态，绝不折叠成
/// 「无内容」：把不可读伪装成静默会让绊线在用户最需要它的时刻失明还显绿）。
/// 预算耗尽 → truncated:true（部分数据仅供展示，调用方不得用于差异判定）。
/// _sig 是供基线对比的签名（state.json mtime/size + 工件数/字节），API 输出
/// 前剥离。
async function scanDir(fsapi, dir) {
  const out = { exists: false, unreadable: false, truncated: false, readError: null,
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

  const dirs = entries
    .filter((e) => e.isDirectory() && validHashName(e.name))
    .slice(0, MAX_WORKSPACES);

  let budget = MAX_STATS_PER_SCAN;
  for (const d of dirs) {
    if (budget <= 0) { out.truncated = true; break; }
    const wsRoot = path.join(dir, d.name);
    // state.json（可缺失/损坏/超大——一律容忍）
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
    } catch { /* state.json 缺失或不可读：字段留空，目录照常计入 */ }

    // pending/*.enc 工件（大小 + 最新 mtime）；预算内做不了的部分如实截断
    let encCount = 0, encBytes = 0, encLastMs = 0;
    try {
      const pendingRoot = path.join(wsRoot, 'pending');
      const pends = (await fsapi.readdir(pendingRoot, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.enc'))
        .slice(0, MAX_ENC_PER_WS);
      for (const f of pends) {
        if (budget <= 0) { out.truncated = true; break; }
        try {
          const md = await fsapi.stat(path.join(pendingRoot, f.name));
          budget--;
          encCount++; encBytes += md.size;
          if (md.mtimeMs > encLastMs) encLastMs = md.mtimeMs;
        } catch { /* 单个工件 stat 失败跳过，不影响其余 */ }
      }
    } catch { /* 无 pending 目录：0 工件 */ }

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
function fingerprintOf(scan) {
  const ws = {};
  for (const w of scan.workspaces) ws[w.hash] = w._sig;
  return { ws, totals: { ...scan.totals } };
}

/// 基线 vs 当前（纯函数，可测）：任何 新增/移除/签名变化 → changed（布尔）。
/// 明细数组叫 modified（不与布尔键同名——重复键会让简写数组静默覆盖布尔，
/// assert.equal 的宽松相等还会把 [] == false 骗绿）。删除同样算活动（上传
/// 成功后 ZCode 清理 pending 也是该目录在动）。
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

/// 四态判定（纯函数，可测）：active 闩锁优先于一切；不可读单列一态（ACL
/// 锁定后属预期，绝不折叠进 clear——不可读伪装成静默 = 绊线失明还显绿）；
/// 无内容 clear；有内容且未闩锁 static。
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
  // 主路：对 checkpoints 递归 watch（win/mac 原生）；失败或目录缺失 → 盯
  // 父目录非递归（全平台可用，catch 到 checkpoints 目录被创建）。两级都挂
  // 不上 → 纯轮询。**两个 watcher 都必须挂 'error' 监听**：FSWatcher 的
  // 异步失败（EPERM/EMFILE 等）以 error 事件送达，EventEmitter 无监听的
  // error 即未捕获异常——会把整个面板进程带走（log-tail.js:338 同款教训）。
  // 错误路径：记录 → 关闭两级 → 降级 poll → 冷却后重挂（不在回调里同步
  // 重入 armWatch）。同步 throw 由 armWatch 的 try/catch 走同一条降级路。
  function watchErrorSink(e) {
    if (stopped) return;
    watchError = (e && (e.message || e.code)) ? (e.message || e.code) : String(e);
    watchMode = 'poll';
    closeWatchers();
    scheduleRearm();
  }

  function armWatch() {
    if (stopped) return;
    closeWatchers();
    try {
      const dw = fsWatch(dir, { recursive: true }, onWatchEvent);
      if (typeof dw.on === 'function') dw.on('error', watchErrorSink);
      dirWatcher = dw;
      const pw = fsWatch(path.dirname(dir), {}, onParentEvent);
      if (typeof pw.on === 'function') pw.on('error', watchErrorSink);
      parentWatcher = pw;
      watchMode = 'watch';
      watchError = null;
      return;
    } catch (e) {
      // 部分成功也要整批关闭再降级（泄漏的活 watcher 会持续触发重扫且永远
      // 脱管——closeWatchers 关闭已提交的两个引用后置空，重挂从头再来）
      closeWatchers();
      watchError = (e && e.message) ? e.message : String(e);
    }
    try {
      // 目录缺失（或平台不支持递归）时的兜底：父目录非递归 watch
      const pw = fsWatch(path.dirname(dir), {}, onParentEvent);
      if (typeof pw.on === 'function') pw.on('error', watchErrorSink);
      parentWatcher = pw;
      watchMode = 'parent';
    } catch (e2) {
      parentWatcher = null;
      watchMode = 'poll';
      watchError = (e2 && e2.message) || watchError;
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
  // 不可读/截断的扫描不参与差异判定：可读→不可读的转移若走 diff 会把全部
  // 工作区判成 removed（用户手动锁目录的那一刻假报「机制复活」，方向完全
  // 错误）——转移本身由 classify 的 unreadable 态如实呈现。反过来，零点
  // 建立在不可读扫描上（boot 时目录已锁）时，首次可读扫描**重锚零点**：
  // 锁定前就存在的内容不算「新增」。
  async function rescan() {
    if (stopped || scanning) return;
    scanning = true;
    try {
      const scan = await scanDir(FS, dir);
      scanError = null;
      if (!baseline) {
        baseline = fingerprintOf(scan);
        baselineUnreadable = scan.unreadable;
      } else if (!latched) {
        if (!scan.unreadable && !scan.truncated) {
          if (baselineUnreadable) {
            baseline = fingerprintOf(scan);
            baselineUnreadable = false;
          } else {
            const d = diffScans(baseline, fingerprintOf(scan));
            if (d.changed) {
              latched = true;
              firstActivityAt = now();
              activityDetail = d;
            }
          }
        }
      }
      current = scan;
      scannedAt = now();
      // watch 还没挂上或已降级而目录实际存在 → 每拍顺带尝试重挂
      if (watchMode !== 'watch' && watchMode !== 'pending' && scan.exists && !scan.unreadable) scheduleRearm();
    } catch (e) {
      // scanDir 自身不抛；这里只防未预料的实现错误——绊线宁可不误报
      scanError = e && e.message ? e.message : String(e);
    } finally {
      scanning = false;
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
      readError: current ? current.readError : null,
      truncated: current ? current.truncated : false,
      status,                    // 'pending' | 'clear' | 'static' | 'unreadable' | 'active'
      baseline: baseline ? baseline.totals : null,
      current: { ...totals, lastWriteMs: current ? current.lastWriteMs : null },
      firstActivityAt,
      activityDetail,
      lastWatchEventAt,
      watchMode,                 // 'watch' | 'parent' | 'poll' | 'pending'
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
