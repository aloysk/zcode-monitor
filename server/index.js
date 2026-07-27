'use strict';
// server/index.js — entry point. Serves the static frontend + JSON API,
// then opens the browser automatically.
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const express = require('express');

const dbq = require('./db');
const runtime = require('./zcode-runtime');
const overview = require('./routes/overview');
const sessions = require('./routes/sessions');
const trace = require('./routes/trace');
const live = require('./routes/live');
const transcript = require('./routes/transcript');
const raw = require('./routes/raw');
const agents = require('./routes/agents');

const PORT = +process.env.PORT || 7331;
const HOST = process.env.HOST || '127.0.0.1';
const OPEN = process.env.OPEN_BROWSER !== '0';

const app = express();
app.use(express.json());

// tiny request logger
app.use((req, _res, next) => {
  if (!req.url.startsWith('/api/live')) {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  }
  next();
});

// sanity: warm the DB connection so the first request doesn't pay open cost,
// and detect up front whether the DB is readable. We DO NOT hard-fail boot on
// a busy DB — ZCode may be mid-write; the connection self-heals on demand.
let dbOk = true;
const warm = dbq.warmDb();
dbOk = warm.ok;
if (warm.ok) {
  console.log(`[db] opened read-only: ${dbq.DB_PATH}`);
} else {
  console.warn(`[db] not readable at startup (will retry on demand): ${warm.error}`);
  console.warn('      set ZCODE_DB=<path> to override');
}

// /api/health probes the live connection (not the startup snapshot) so a
// transient lock is reported as the current state, not a permanent failure.
// Also reports ZCode runtime status + WAL size so the UI can show whether
// a checkpoint is pending (i.e. recent data is at risk until ZCode exits cleanly).
// ── ZCode runtime watcher ────────────────────────────────────
// Polls whether ZCode is running. When it transitions running→stopped, we run
// a one-shot wal_checkpoint(TRUNCATE) so all subsequent read-only connections
// see the complete history (the WAL's freshest rows get folded into the main db).
// We NEVER write to the db otherwise — checkpoint only reorganizes existing
// WAL frames, and we only do it when ZCode isn't holding the writer lock.
const runtimeState = {
  running: true,                       // updated by the watcher
  lastCheckpoint: null,                // { at, folded, walBefore, walAfter }
  watchError: null,
};

function pollZCodeRuntime() {
  let running;
  try { running = runtime.isZCodeRunning(); runtimeState.watchError = null; }
  catch (e) { running = runtimeState.running; runtimeState.watchError = e.message; }

  const wasRunning = runtimeState.running;
  runtimeState.running = running;

  // Transition: running → stopped → fold the WAL so history stays readable.
  if (wasRunning && !running) {
    console.log('[runtime] ZCode exited — checkpointing WAL to preserve history…');
    const before = runtime.walStatus(dbq.DB_PATH);
    const result = runtime.checkpointNow(dbq.DB_PATH);
    if (result.ok) {
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
      runtimeState.lastCheckpoint = { at: new Date().toISOString(), ok: false, error: result.error };
      console.warn(`[runtime] checkpoint failed: ${result.error}`);
    }
    // Drop our read-only connection cache so the next read sees the folded db.
    dbq.invalidateDb();
  }
}

// initial poll (don't checkpoint at boot — ZCode may already be down and that's fine)
runtimeState.running = runtime.isZCodeRunning();
setInterval(pollZCodeRuntime, 5000);

// Manual checkpoint endpoint (for a "preserve now" button). Refuses to run
// while ZCode is running to avoid contending with its writer (unless ?force=1).
app.get('/api/checkpoint', (req, res) => {
  if (runtimeState.running && !req.query.force) {
    return res.status(409).json({
      ok: false,
      error: 'zcode_running',
      message: 'ZCode 正在运行，无法安全 checkpoint。请先关闭 ZCode，或加 ?force=1 强制（可能短暂抢锁）。',
    });
  }
  const before = runtime.walStatus(dbq.DB_PATH);
  const result = runtime.checkpointNow(dbq.DB_PATH);
  if (result.ok) {
    dbq.invalidateDb();
    runtimeState.lastCheckpoint = {
      at: new Date().toISOString(), ok: true,
      walBefore: before ? before.walBytes : null,
      walAfter: result.after ? result.after.walBytes : null,
    };
  }
  res.json(result);
});

app.get('/api/health', (_req, res) => {
  let ok = false, error = null;
  try {
    dbq.db().prepare('SELECT 1').get();
    ok = true;
  } catch (e) {
    error = e.message;
    // drop a damaged connection so the next request reopens cleanly
    dbq.invalidateDb();
  }
  const zcodeRunning = runtimeState.running;
  const wal = runtime.walStatus(dbq.DB_PATH);
  res.json({
    ok, error,
    db: dbq.DB_PATH, log_dir: dbq.LOG_DIR,
    zcode_running: zcodeRunning,
    wal_bytes: wal ? wal.walBytes : null,
    wal_pending_checkpoint: wal ? wal.walBytes > 0 : false,
    last_checkpoint: runtimeState.lastCheckpoint,
  });
});

app.use('/api/overview', overview);
app.use('/api/sessions', sessions);
app.use('/api/trace', trace);
app.use('/api/live', live);
app.use('/api/transcript', transcript);
app.use('/api/raw', raw);
app.use('/api/agents', agents);

// Translate SQLite lock/contention errors into 503 retryable responses so the
// frontend can back off and retry instead of showing a hard error card.
app.use((err, _req, res, next) => {
  const msg = (err && err.message) || String(err);
  const code = err && (err.code || err.errno);
  const isLock = code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED'
    || /database is locked|unable to open database|database table is locked/i.test(msg);
  if (isLock) {
    dbq.invalidateDb(); // force a fresh connection next time
    return res.status(503).json({
      error: 'database_busy',
      message: 'ZCode 正在写入数据库，请稍后重试。',
      retryable: true,
    });
  }
  // connection damage → 503 too, the next request will reopen
  const broken = code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB' || code === 'SQLITE_IOERR'
    || /bad database|file is not a database|disk i\/o/i.test(msg);
  if (broken) {
    dbq.invalidateDb();
    return res.status(503).json({
      error: 'database_unavailable',
      message: '数据库连接异常，正在自动重连。',
      retryable: true,
    });
  }
  next(err);
});

// static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback: any non-api route → index.html
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const server = http.createServer(app);
server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log(`\n  zcode-monitor → ${url}\n  (DB ${dbOk ? 'OK' : 'NOT FOUND'})  Ctrl-C to stop\n`);
  if (OPEN) {
    const cmd = process.platform === 'darwin' ? `open "${url}"`
              : process.platform === 'win32'  ? `start "" "${url}"`
              : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
