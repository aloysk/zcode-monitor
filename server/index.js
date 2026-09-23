'use strict';
// server/index.js — entry point. Serves the static frontend + JSON API,
// then opens the browser automatically.
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const express = require('express');

const dbq = require('./db');
const { createGenWatcher } = require('./livegen');
const runtime = require('./zcode-runtime');
const { loopbackHostGate, securityHeaders, petsStaticOptions, makeErrorTranslator } = require('./http-hardening');
const { makeCheckpointRoute } = require('./checkpoint-route');
const { makeHealthRoute } = require('./health-route');
const overview = require('./routes/overview');
const sessions = require('./routes/sessions');
const trace = require('./routes/trace');
const live = require('./routes/live');
const transcript = require('./routes/transcript');
const raw = require('./routes/raw');
const agents = require('./routes/agents');
const petImport = require('./pet-import');

const PORT = +process.env.PORT || 7331;
const HOST = process.env.HOST || '127.0.0.1';
const OPEN = process.env.OPEN_BROWSER !== '0';

// pet pack registry for the pet page: every public/pets/<id>/ holding
// pet.json + spritesheet.webp is a selectable pack — drop a folder in and it
// joins the cycle. Discovery lives in server/pet-import.js (shared with the
// import CLI/endpoint); the two original packs stay first so the cycle feels
// stable as packs are added.
const PETS_ROOT = path.join(__dirname, '..', 'public', 'pets');
// staging root for candidate packs: imports may only source from inside this
// directory — the endpoint rejects any source that resolves outside of it.
const PETS_STAGING_ROOT = path.join(__dirname, '..', 'tools', 'pets-staging');

const app = express();
app.use(express.json());

// 全站安全响应头（CSP / nosniff，构成见 server/http-hardening.js）。
app.use(securityHeaders);

// /api 全局回环 Host 闸（防 DNS rebinding）：面板无鉴权，读 API 面大（整库
// 转录），rebinding 下唯一可靠的判别就是 Host 头形态。本机 UI/壳都从
// 127.0.0.1（或 localhost）加载，不受影响。
app.use('/api', loopbackHostGate);

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
// Polls whether ZCode is running (ASYNC probe — see zcode-runtime.probeZCodeRunning:
// tasklist/ps takes seconds, so the probe must never run synchronously on the
// event loop, must never overlap itself, and is throttled well above its own
// latency). When it transitions running→stopped, we run a one-shot
// wal_checkpoint(TRUNCATE) so all subsequent read-only connections see the
// complete history (the WAL's freshest rows get folded into the main db).
// We NEVER write to the db otherwise — checkpoint only reorganizes existing
// WAL frames, and we only do it when ZCode isn't holding the writer lock.
// 探测误报的第二道保险：-wal 近期有写入（walIdleMs < 窗口）= 真实 writer 在场
// （进程探测只认桌面端镜像名，覆盖不了 node 跑的 CLI 形态），否决「已退出」并
// 回置运行中——绝不与真实 writer 抢锁。
const runtimeState = {
  running: true,                       // optimistic until the first probe SEEDS it
                                         // (首探测只播种不判转移，见 makeRuntimeProbeHandler)
  lastCheckpoint: null,                // { at, folded, walBefore, walAfter }
  watchError: null,
};

const PROBE_MIN_INTERVAL_MS = 30 * 1000; // 探测节流 ≥ 单次子进程延迟（tasklist 实测 4-7s）
const WAL_ACTIVE_WINDOW_MS = 60 * 1000;  // -wal 静默不足此时长即视为 writer 在场
let lastProbeAt = 0;

// 探测回调（转移判断 + 自动 checkpoint）抽在 server/zcode-runtime.js 的
// makeRuntimeProbeHandler——首探测只播种 running 不判转移（boot 前 ZCode 就已
// 退出不是「刚退出」，启动即 checkpoint 是 b66842f 异步化引入的回归），依赖全
// 参数化供测试直接 stub。
const handleProbeResult = runtime.makeRuntimeProbeHandler({
  dbPath: dbq.DB_PATH,
  runtimeState,
  activeWindowMs: WAL_ACTIVE_WINDOW_MS,
  invalidateDb: () => dbq.invalidateDb(),
});

function pollZCodeRuntime() {
  if (Date.now() - lastProbeAt < PROBE_MIN_INTERVAL_MS) return; // 结果沿用上次
  lastProbeAt = Date.now();
  runtime.probeZCodeRunning(handleProbeResult);
}


// initial probe (async, doesn't block boot). The first probe SEEDS
// runtimeState.running only — no transition check, so a ZCode that was already
// down before boot does NOT trigger a startup checkpoint (that's fine; the
// WAL is folded on the next real running→stopped transition instead).
pollZCodeRuntime();
setInterval(pollZCodeRuntime, 5000);

// Manual checkpoint endpoint (for a "preserve now" button). Refuses to run
// while ZCode is running to avoid contending with its writer (unless ?force=1).
// 闸逻辑在 server/checkpoint-route.js（三分支：409 wal_active / 409 zcode_running /
// 503 checkpoint_busy / 200 放行），依赖注入便于测试挂载。
app.get('/api/checkpoint', makeCheckpointRoute({
  dbPath: dbq.DB_PATH,
  runtime,
  runtimeState,
  activeWindowMs: WAL_ACTIVE_WINDOW_MS,
  onSuccess: () => dbq.invalidateDb(),
}));

// /api/health（R5 起抽为 server/health-route.js 工厂，行为不变；探测活连接
// 而非 boot 快照、dbq.db 抛错时 invalidateDb 自愈等语义见该文件头注）。
app.get('/api/health', makeHealthRoute({
  dbq, runtime, runtimeState,
  dbPath: dbq.DB_PATH, logDir: dbq.LOG_DIR,
}));

app.use('/api/overview', overview);
app.use('/api/sessions', sessions);
app.use('/api/trace', trace);
app.use('/api/live', live);
app.use('/api/transcript', transcript);
app.use('/api/raw', raw);
app.use('/api/agents', agents);

// /pets 静态服务收紧（须挂在与下面通用的 express.static 之前，注册顺序即命中
// 顺序；构成见 server/http-hardening.js petsStaticOptions）：非图片一律
// octet-stream + attachment，可执行面即使混进 public/pets 也不能以面板同源执行。
app.use('/pets', express.static(PETS_ROOT, petsStaticOptions()));

// static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// companion mode (spawned by the widget shell with ZCODE_WIDGET_CHILD=1):
// if the shell is force-killed the server can be orphaned; with no requests
// for 5 minutes it exits by itself. The widget page seeds every 15s, so a
// live widget keeps it alive; plain `npm start` never enters this mode.
// NOTE: /api/widget/recent below is the keep-alive — keep it mounted AFTER
// this tracker (Express runs in registration order; routes claimed earlier,
// e.g. /api/live/events in the API router, do not refresh lastSeen).
if (process.env.ZCODE_WIDGET_CHILD === '1') {
  let lastSeen = Date.now();
  app.use((req, res, next) => { lastSeen = Date.now(); next(); });
  setInterval(() => {
    if (Date.now() - lastSeen > 5 * 60 * 1000) {
      console.log('companion: no requests for 5min — exiting');
      process.exit(0);
    }
  }, 30 * 1000).unref();
}

// ── generation-state engine (livegen) ─────────────────────────
// One watcher for the whole process; drives the token-speed pill's breathing
// animation while official tps is frozen between request completions.
const genWatcher = createGenWatcher(dbq);

app.get('/api/gen/state', (_req, res) => res.json(genWatcher.state()));

// today's official token total + request count for the pill's hover tooltip
// (kept below the companion tracker so it refreshes lastSeen as a keep-alive)
app.get('/api/widget/today', (_req, res) => res.json(dbq.todayUsage()));

// SSE stream of generation start/end edges. NOTE: this long-lived connection
// passes the companion tracker above only ONCE at connect and then never
// heartbeats it — that's fine, the widget page's 15s /api/widget/recent seed
// keeps companion mode alive on its own.
app.get('/api/gen/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  // Send the CURRENT state immediately: edges only fire on transitions, so a
  // page that connects MID-generation would otherwise wait until the next
  // edge (possibly the generation's end, minutes away) with the animation
  // stuck off. The snapshot closes that gap.
  const cur = genWatcher.state();
  res.write(`event: gen\ndata: ${JSON.stringify({ phase: cur.generating ? 'start' : 'end', sessions: cur.sessions, inflight: cur.inflight })}\n\n`);

  const heartbeat = setInterval(() => res.write(': hb\n\n'), 25000);
  const off = genWatcher.onEvent(ev => {
    res.write(`event: gen\ndata: ${JSON.stringify(ev)}\n\n`);
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    off();
  });
});

// Stop the watcher on shutdown signals (its timer is already unref'd and
// never blocks exit; this makes the teardown explicit and immediate).
process.on('SIGINT', () => { genWatcher.stop(); process.exit(0); });
process.on('SIGTERM', () => { genWatcher.stop(); process.exit(0); });

// token-speed floating widget page (loaded by the frameless WebView2 shell)
app.get('/widget', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'widget.html')));
// desktop pet card page — WITHOUT this the SPA fallback serves the dashboard
app.get('/pet', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'pet.html')));
// exact rolling-window seed for the widget page (no LIMIT cap — see db.js completedSince)
app.get('/api/widget/recent', (_req, res) => res.json(dbq.completedSince(Date.now() - 5 * 60 * 1000)));

// pet pack registry for the pet page (PETS_ROOT 见文件头部定义)：/api/pets 与
// staging/导入端点共用 server/pet-import.js 的发现与校验管线。
app.get('/api/pets', (_req, res) => {
  try { res.json(petImport.listPetPacks(PETS_ROOT)); }
  catch { res.json([]); }
});

// staging 包清单：pets-preview 页“从暂存导入”入口的数据源（staging 不存在时返回 []）
app.get('/api/pets/staging', (_req, res) => {
  res.json(petImport.listStagingPacks(PETS_STAGING_ROOT));
});

// 导入端点：缺 X-Zcode-Monitor-Import 首部一律 403（跨源简单 POST 无法携带自定义首部）。
// body: { source: <staging 内的包目录名>, id?, sourceUrl?, author?, license?, force?,
//         ackUnknownLicense? }（许可证缺失/unknown 需 ackUnknownLicense:true 显式确认）
app.post('/api/pets/import',
  petImport.importEndpointMiddleware({ petsRoot: PETS_ROOT, stagingRoot: PETS_STAGING_ROOT }));

// Translate SQLite lock/contention errors into 503 retryable responses so the
// frontend can back off and retry instead of showing a hard error card.
// 注册位置（R4 修-low）：必须在所有会碰 DB 的 /api 路由之后、SPA fallback 之前
//——Express 按注册顺序选错误处理器，先注册的翻译层罩不住后注册路由
//（/api/widget/today、/api/widget/recent 曾因此 500 而非契约 503）。工厂本体在
// server/http-hardening.js（依赖注入便于测试挂载，checkpoint-route.js 先例）。
app.use(makeErrorTranslator({ invalidateDb: () => dbq.invalidateDb() }));

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
