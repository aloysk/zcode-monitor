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
    const result = db.pragma('wal_checkpoint(TRUNCATE)');
    // result is [busy, log_frames, checkpointed_frames]
    const after = walStatus(dbPath);
    return {
      ok: true,
      before,
      after,
      busy: Array.isArray(result) ? result[0] : null,
      checkpointed: Array.isArray(result) ? result[2] : null,
    };
  } catch (e) {
    return { ok: false, error: e.message, before };
  } finally {
    try { if (db) db.close(); } catch {}
  }
}

module.exports = { probeZCodeRunning, walStatus, walIdleMs, checkpointNow };
