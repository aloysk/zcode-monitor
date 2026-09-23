'use strict';
// zcode-runtime.js — detect whether ZCode is running and keep the DB readable
// after ZCode exits.
//
// Why this exists (the real root cause of "can't see history after ZCode closes"):
//   ZCode uses SQLite in WAL mode. While ZCode is running, every connection
//   (even read-only) reads the freshest data because the live process maintains
//   the WAL shared-memory index (-shm). When ZCode exits abnormally, the WAL
//   may contain un-checkpointed data that a fresh read-only connection CANNOT
//   recover — we observed it reading weeks-old data in that case.
//
// Fix:
//   1. Probe whether ZCode is running (process + lock check, cross-platform).
//   2. While ZCode runs → read-only direct connection (current behavior).
//   3. When we detect ZCode has just exited → open ONE writable connection and
//      run wal_checkpoint(TRUNCATE) to fold the WAL into the main db. After
//      that, all read-only connections see complete history. We never write
//      to the db ourselves — checkpoint only reorganizes existing WAL frames.
//
// The writable connection is only opened transiently for the checkpoint, and
// only when ZCode is NOT running (so we never contend with its writer).

const { execFile } = require('child_process');
const fs = require('fs');
const Database = require('better-sqlite3');

// Detect ZCode running via process list. ASYNC and callback-based: the probe
// shells out to tasklist/ps, which takes seconds on win32 (2026-09-23 实测
// tasklist /FI 单次 4.2-7.4s——枚举全部进程的成本，/FI 不减少枚举量）。调用方
// 是常驻轮询（server/index.js），同步 execFileSync 曾把事件循环按单次 5-7s
// 冻结、5s 间隔背靠背近乎持续阻塞（评审实测 /api/health median 5.0s）——
// 热路径上严禁同步子进程调用；本函数只允许异步使用。
// Probes never overlap: while one is in flight the next request reuses it.
let probeInFlight = false;
function probeZCodeRunning(cb) {
  if (probeInFlight) return; // 在途不重叠：上一次的结果即将写回
  probeInFlight = true;
  const finish = (v) => { probeInFlight = false; cb(v); };
  const onOut = (err, stdout) => {
    if (err) {
      // probe failed (non-unix, tasklist missing?) — fall back to optimistic:
      // assume running so we stay in safe read-only mode rather than risk a
      // contended checkpoint.
      return finish(true);
    }
    const lines = String(stdout).split('\n');
    if (process.platform === 'win32') {
      // tasklist /NH：命中行首即镜像名；按桌面端镜像名匹配。
      return finish(lines.some(l => /(^|\s)ZCode\.exe\s/i.test(l)));
    }
    // `ps -axo comm` gives the executable path; matching is robust to args.
    // Match the ZCode app on macOS, the .exe on Windows, and the linux binary.
    return finish(lines.some(line => {
      const l = line.trim();
      return /\/ZCode\.app\//.test(l)
          || /(^|\/)zcode-cli$/.test(l)
          || /(^|\/)zcode-host-local/.test(l)
          || /(^|\/)ZCode(\.exe)?$/.test(l);
    }));
  };
  if (process.platform === 'win32') {
    // Git Bash 的 ps 是 MSYS 迷你实现，不支持 -o（实测 `ps: unknown option -- x`
    // 失败退出）。win32 用 tasklist 按镜像名精确匹配桌面端进程。
    execFile('tasklist', ['/FI', 'IMAGENAME eq ZCode.exe', '/NH'],
      { encoding: 'utf8', maxBuffer: 1 << 20 }, onOut);
  } else {
    execFile('ps', ['-axo', 'comm'],
      { encoding: 'utf8', maxBuffer: 1 << 20 }, onOut);
  }
}

// Returns { walBytes, shmBytes, mainBytes } for the db, or null if missing.
function walStatus(dbPath) {
  try {
    const main = fs.statSync(dbPath).size;
    const wal = fs.existsSync(dbPath + '-wal') ? fs.statSync(dbPath + '-wal').size : 0;
    const shm = fs.existsSync(dbPath + '-shm') ? fs.statSync(dbPath + '-shm').size : 0;
    return { mainBytes: main, walBytes: wal, shmBytes: shm };
  } catch { return null; }
}

// -wal 文件的写入静默时长（ms）：writer 活跃性判据。ZCode 运行中会持续触碰
// -wal；进程探测（tasklist 只认桌面端镜像名，覆盖不了 node 跑的 CLI 形态）误报
// 「已退出」时，-wal 近期有写入即是真实 writer 在场的反证——自动 checkpoint 前
// 以此否决误报，避免用可写连接与真实 writer 抢锁。-wal 不存在或不可 stat（已
// checkpoint 过 / 从未写入）→ 返回 null（无反证，允许 checkpoint）。
function walIdleMs(dbPath) {
  try { return Date.now() - fs.statSync(dbPath + '-wal').mtimeMs; }
  catch { return null; }
}

// Fold the WAL into the main db so read-only connections can see all history.
// ONLY call this when ZCode is NOT running (verified by caller).
// busy_timeout 用短等待（800ms）：这是同步 better-sqlite3 调用，长 busy_timeout
// 会把事件循环按 timeout 时长冻结（曾为 10s）。调用方已有 walIdleMs 即时否决
// （writer 静默 ≥60s 才会走到这里），正常路径抢不到锁的窗口极小；真抢不到就让
// busy=1 如实上抛，由调用方决定重试——绝不为罕见竞争冻结事件循环。
// 残余（R3 登记 residuals R-11）：busy_timeout 只约束锁等待、不约束折叠 WAL 的
// 磁盘 I/O——巨大 -wal 时本调用仍可秒级阻塞（罕见：异常退出 + 大 WAL）。
// Returns { ok, before, after, checkpointed }.
function checkpointNow(dbPath) {
  const before = walStatus(dbPath);
  let db;
  try {
    // Writable connection: opening it lets SQLite recover the WAL journal,
    // then TRUNCATE checkpoint folds it into the main db and zeroes the -wal.
    db = new Database(dbPath, { timeout: 800 });
    db.pragma('busy_timeout = 800');
    // TRUNCATE = checkpoint as much as possible, then truncate -wal to 0.
    // better-sqlite3 对这类 pragma 返回**行对象数组**，wal_checkpoint 恰一行
    // { busy, log, checkpointed }（2026-09-23 实测：读者持锁时
    // [{ busy:1, log:5, checkpointed:5 }]）。R3 修正：曾误按裸值数组
    // [busy, log, checkpointed] 解读——result[0] 取到的是行对象（truthy 而非
    // busy 数值）、result[2] 恒 undefined，导致 busy===1 永不成立：busy 竞争被
    // 误报为成功，checkpoint-route 的 503 checkpoint_busy 分支与 index.js 的
    // checkpointRetryPending 重试整体死代码（评审探针实锤）。测试守护：
    // test/zcode-runtime.test.js 在真实 WAL 库上不 mock 复核两种形态。
    const result = db.pragma('wal_checkpoint(TRUNCATE)');
    const row = Array.isArray(result) ? result[0] : null;
    const after = walStatus(dbPath);
    return {
      ok: true,
      before,
      after,
      busy: row ? row.busy : null,
      checkpointed: row ? row.checkpointed : null,
    };
  } catch (e) {
    return { ok: false, error: e.message, before };
  } finally {
    try { if (db) db.close(); } catch {}
  }
}

// ── 探测回调：running→stopped 转移 + 自动 checkpoint ──────────────────────
// 自 server/index.js 抽出为可注入工厂（依赖全参数化，供测试直接 stub 覆盖转移
// 语义；index.js 只保留节流与定时器）。
//
// 首探测播种语义（R4 修-medium，git 考古 b66842f 回归）：runtimeState.running
// 乐观初始化为 true，boot 即发出首个异步探测。若首次探测回调直接进入转移判断，
// 「服务启动前 ZCode 就已退出（-wal 静默 ≥ 窗口）」会命中 wasRunning&&!running
// → 启动即同步 checkpoint——违背 7dd5cbc 原实现「用同步探测结果播种 running、
// boot 不 checkpoint」的语义。故首次回调只播种 runtimeState.running 并跳过转移
// 判断；此后（第二次回调起）running→stopped 转移才触发 checkpoint。
// checkpointRetryPending 与转移判断同住此处：上次自动 checkpoint 因 busy 未完成
// 时，下个探测周期（仍判定未运行）重试一次。
function makeRuntimeProbeHandler({ dbPath, runtimeState, activeWindowMs, invalidateDb, runtime = null } = {}) {
  const rt = runtime || { walIdleMs, walStatus, checkpointNow };
  let firstProbeDone = false;
  let checkpointRetryPending = false;
  return function handleProbeResult(probedRunning) {
    let running = probedRunning;
    if (running === false) {
      const idle = rt.walIdleMs(dbPath);
      if (idle != null && idle < activeWindowMs) running = true; // 误报否决
    }
    runtimeState.watchError = null;

    if (!firstProbeDone) {
      firstProbeDone = true;
      runtimeState.running = running; // 只播种，不判转移（见函数头注）
      return;
    }

    // Transition: running → stopped → fold the WAL so history stays readable.
    // Also retry once per probe cycle after a busy attempt: the one-shot
    // transition would otherwise give up forever on a transient lock.
    const wasRunning = runtimeState.running;
    runtimeState.running = running;
    const shouldCheckpoint = (wasRunning && !running)
      || (checkpointRetryPending && !running);
    if (!shouldCheckpoint) return;
    console.log('[runtime] ZCode exited — checkpointing WAL to preserve history…');
    const before = rt.walStatus(dbPath);
    const result = rt.checkpointNow(dbPath);
    checkpointRetryPending = !!(result.ok && result.busy === 1); // busy=1：锁被占，下个周期再试一次
    if (result.ok && !checkpointRetryPending) {
      const after = result.after;
      runtimeState.lastCheckpoint = {
        at: new Date().toISOString(),
        ok: true,
        walBefore: before ? before.walBytes : null,
        walAfter: after ? after.walBytes : null,
        folded: before && after ? (before.walBytes - after.walBytes) : null,
      };
      console.log(`[runtime] checkpoint done: WAL ${before ? before.walBytes : '?'} → ${after ? after.walBytes : '?'} bytes`);
    } else {
      runtimeState.lastCheckpoint = { at: new Date().toISOString(), ok: false,
        error: checkpointRetryPending ? 'checkpoint_busy' : result.error, retryable: true };
      console.warn(`[runtime] checkpoint ${checkpointRetryPending ? 'busy（下个探测周期重试一次）' : 'failed'}: ${result.error || 'lock busy'}`);
    }
    // Drop our read-only connection cache so the next read sees the folded db.
    if (typeof invalidateDb === 'function') invalidateDb();
  };
}

module.exports = { probeZCodeRunning, walStatus, walIdleMs, checkpointNow,
                   makeRuntimeProbeHandler };
