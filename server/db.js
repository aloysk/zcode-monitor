'use strict';
// db.js — read-only connection to the ZCode SQLite database.
// The DB is owned and actively written by the running ZCode app (WAL mode).
// We are a concurrent reader and MUST be robust to:
//   - transient lock contention (SQLITE_BUSY) while ZCode writes/checkpoints
//   - WAL file growth / -shm refresh
//   - rare connection damage requiring reopen
// Strategy: open with retries, raise busy_timeout, participate in WAL sharing,
// and wrap every query with automatic retry + connection self-healing.

const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.ZCODE_DB
  || path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');

const LOG_DIR = process.env.ZCODE_LOG_DIR
  || path.join(os.homedir(), '.zcode', 'cli', 'log');

const ROLLOUT_DIR = process.env.ZCODE_ROLLOUT_DIR
  || path.join(os.homedir(), '.zcode', 'cli', 'rollout');

// Synchronous micro-wait for retry backoff (better-sqlite3 is sync, so we can't
// await). SharedArrayBuffer + Atomics.wait blocks the current statement only.
function spinMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const t = Date.now() + ms; while (Date.now() < t) {} } // fallback
}

// Is this error a transient lock contention we should retry on?
function isBusyErr(e) {
  const code = e && (e.code || e.errno);
  // SQLITE_BUSY = 5, SQLITE_BUSY_SNAPSHOT, SQLITE_LOCKED = 6, SQLITE_READONLY = 8
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED'
      || code === 'SQLITE_BUSY_SNAPSHOT' || code === 'SQLITE_READONLY'
      || /database is locked|database table is locked|unable to open database/i.test(e && e.message);
}

// Is this an error that means our connection is broken and must be rebuilt?
function isConnBroken(e) {
  const code = e && (e.code || e.errno);
  return code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB'
      || code === 'SQLITE_IOERR' || /bad database|file is not a database|disk i\/o/i.test(e && e.message);
}

// Open with retries: ZCode holding a write lock at the exact moment we open
// can make the readonly connection throw. Back off and try again.
// (better-sqlite3 is synchronous; we spin briefly between attempts.)
function openDbRetrying() {
  const attempts = 5;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const db = new Database(DB_PATH, { readonly: true, timeout: 5000 });
      // Be a polite concurrent reader. A long busy_timeout lets SQLite wait
      // for the writer instead of throwing SQLITE_BUSY immediately.
      db.pragma('busy_timeout = 5000');
      // readonly connections read WAL fine; setting the mode is a no-op here
      // but normalizes behavior if the DB ever switches modes.
      try { db.pragma('journal_mode = WAL'); } catch {}
      return db;
    } catch (e) {
      lastErr = e;
      if (!fs.existsSync(DB_PATH)) throw e; // genuinely missing — don't loop
      // busy/open in progress: brief spin (50ms→150ms→400ms→1000ms)
      spinMs(50 * Math.pow(3, i));
    }
  }
  throw lastErr;
}

let _raw = null;     // the underlying better-sqlite3 Database
let _proxy = null;   // a facade whose prepare() returns retrying statements

// Drop the cached connection so the next call reopens it.
function invalidateDb() { _raw = null; _proxy = null; }

// A prepared-statement wrapper that retries .all()/.get() on transient locks
// and self-heals the connection on damage. Existing call sites use
// db().prepare(sql).all(...) / .get(...) — this keeps that shape intact.
function makeRetryingStatement(rawStmt) {
  const exec = (method, params) => {
    const maxAttempts = 4;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return rawStmt[method](...params);
      } catch (e) {
        if (isConnBroken(e)) { invalidateDb(); if (i < maxAttempts - 1) continue; }
        if (isBusyErr(e) && i < maxAttempts - 1) {
          spinMs(30 * Math.pow(2, i)); // 30, 60, 120ms
          continue;
        }
        throw e;
      }
    }
  };
  return {
    all: (...p) => exec('all', p),
    get:  (...p) => exec('get', p),
    // pass through anything else (e.g. .iterate, .pluck) with the same retry
    rawStmt,
  };
}

// Connection facade: prepare() returns a retrying statement; pragma() is passed
// through directly (harmless if it throws — openDbRetrying already set them).
function makeProxy(raw) {
  return {
    prepare(sql) { return makeRetryingStatement(raw.prepare(sql)); },
    pragma(...a) { try { return raw.pragma(...a); } catch { return null; } },
    close() { try { raw.close(); } catch {} },
    _raw: raw,
  };
}

function db() {
  if (!_raw) {
    _raw = openDbRetrying();
    _proxy = makeProxy(_raw);
  }
  return _proxy;
}

// Warm the connection at startup so the first user request doesn't pay the
// (possibly retrying) open cost, and so we know up front whether the DB is OK.
function warmDb() {
  try { db().prepare('SELECT 1').get(); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// ───────────────────────── helpers ─────────────────────────

// ms-timestamp (epoch ms) → human string in local tz
function ts(ms) {
  if (!ms) return null;
  try { return new Date(Number(ms)).toISOString(); } catch { return null; }
}

// safe JSON parse for columns that store JSON text
function j(obj, fallback = null) {
  if (obj == null) return fallback;
  if (typeof obj !== 'string') return obj;
  try { return JSON.parse(obj); } catch { return fallback; }
}

// ms since epoch → ms-since-midnight bucket helpers
function startOfDayMs(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

// ───────────────────────── Overview ─────────────────────────
// Token 口径（详见 docs/usage-accounting.md，官方出处核实于 zai-org/ZCode
// commit 872ad96 "feat: open source"）：
//   - schema source: zai-org/ZCode apps/zcode-cli/packages/adapters/src/storage/
//     session-store/migrations.ts（migration 0010_usage_observability，下称 MIG）
//   - 写入/聚合口径 source: zai-org/ZCode apps/zcode-cli/packages/adapters/src/
//     storage/session-store/repositories/usage.ts（下称 USAGE）
//   - 事实写入 source: zai-org/ZCode apps/zcode-cli/packages/core/src/runtime/
//     methods/usage-observability.ts（下称 OBS）
// 关键语义：input_tokens 已含 cache_read（AI SDK v6，USAGE inputSideTokensFromStoredUsage
// 注释），cache_creation/cache_read 只是 breakdown；computed_total_tokens 是官方
// 预计算权威值（USAGE recordModelUsage），官方聚合 queryAppUsage 的总量即
// SUM(computed_total_tokens)——本文件所有 total 口径照此，不再自造公式。

// KPI cards. `sinceMs` = window start (epoch ms). Counts/tokens/latency over
// model_usage + tool_usage within the window.
function overviewKpis(sinceMs) {
  // schema source: zai-org/ZCode MIG 0010_usage_observability + USAGE queryAppUsage(totals)
  // 全量行聚合（官方口径：子代理行属于子会话、无重复计入，不做 parent 维度排除）。
  const m = db().prepare(`
    SELECT COUNT(*)                                    AS model_calls,
           SUM(CASE WHEN status='completed' THEN 1 END) AS completed,
           SUM(CASE WHEN status='error' THEN 1 END)     AS errors,
           SUM(CASE WHEN status='cancelled' THEN 1 END) AS cancelled,
           SUM(input_tokens)     AS in_tok,
           SUM(output_tokens)     AS out_tok,
           SUM(reasoning_tokens)  AS reason_tok,
           SUM(cache_read_input_tokens)  AS cache_read,
           SUM(cache_creation_input_tokens) AS cache_write,
           SUM(computed_total_tokens) AS total_tok,
           AVG(CASE WHEN duration_ms IS NOT NULL AND status='completed' THEN duration_ms END) AS avg_ms
    FROM model_usage
    WHERE started_at >= @since
  `).get({ since: sinceMs });

  const t = db().prepare(`
    SELECT COUNT(*)                                  AS tool_calls,
           SUM(CASE WHEN status='error' THEN 1 END)  AS tool_errors,
           AVG(CASE WHEN status='completed' THEN duration_ms END) AS avg_tool_ms
    FROM tool_usage
    WHERE started_at >= @since
  `).get({ since: sinceMs });

  // INDEXED BY 强制走 started_at 索引：缺省计划会全索引扫 session_turn_idx 求
  // DISTINCT（真实库实测 1.9s/次，事件循环饿死风险）；强制后 SEARCH started_at
  // 范围 + 小集合去重，结果一致（510=510）、50ms（docs/usage-accounting.md §红线实测）。
  // 该索引名来自官方 migration 0010：缺它的库（旧版 ZCode、外部 ZCODE_DB）会抛
  // "no such index"，错误中间件不匹配 SQLITE_ERROR → Overview 整页 500。故先查
  // sqlite_master，缺失时回退不加 INDEXED BY 的原查询；结果按连接
  // 记忆（连接被 invalidateDb 换掉后自然重查）。
  // 回退路径量级（2026-09-23 真实库只读计时）：单次 1.4-1.8s 全索引扫、同步阻塞
  // 事件循环（INDEXED BY 路径 0.6ms、结果一致 49=49）。「慢但可用」是既定取舍：
  // 本服务自身的库恒有官方索引，该路径只服务旧版/外部 ZCODE_DB，不为罕见形态
  // 引入缓存/限频复杂度。
  const conn = db();
  if (conn._hasStartedModelIdx === undefined) {
    conn._hasStartedModelIdx = !!conn.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='index' AND name='model_usage_started_model_idx'`
    ).get();
  }
  const sessions = conn.prepare(`
    SELECT COUNT(DISTINCT session_id) AS active_sessions
    FROM model_usage ${conn._hasStartedModelIdx ? 'INDEXED BY model_usage_started_model_idx' : ''}
    WHERE started_at >= @since
  `).get({ since: sinceMs });

  // reasoning ratio (only meaningful when there's output)
  const reasonRatio = (m.reason_tok && m.out_tok)
    ? +(m.reason_tok / (m.reason_tok + m.out_tok)).toFixed(3) : null;

  return {
    since: ts(sinceMs),
    window_ms: Date.now() - sinceMs,
    model: {
      calls: m.model_calls || 0,
      completed: m.completed || 0,
      errors: m.errors || 0,
      cancelled: m.cancelled || 0,
      avg_duration_ms: m.avg_ms ? Math.round(m.avg_ms) : null,
    },
    tools: {
      calls: t.tool_calls || 0,
      errors: t.tool_errors || 0,
      avg_duration_ms: t.avg_tool_ms ? Math.round(t.avg_tool_ms) : null,
    },
    tokens: {
      input: m.in_tok || 0,
      // 展示拆分：input 列原样含 cache_read（官方语义），拆出去重展示。
      input_ex_cache: Math.max(0, (m.in_tok || 0) - (m.cache_read || 0)),
      output: m.out_tok || 0,
      reasoning: m.reason_tok || 0,
      reasoning_ratio: reasonRatio,
      cache_read: m.cache_read || 0,
      cache_write: m.cache_write || 0,
      // 官方预计算权威总量 = SUM(computed_total_tokens)（USAGE queryAppUsage 同口径；
      // 本地实测 381,548/381,548 行 == input+output，见 docs/usage-accounting.md）。
      total: m.total_tok || 0,
    },
    active_sessions: sessions.active_sessions || 0,
  };
}

// Time-series: requests + tokens bucketed by hour, for the last `hours` hours.
function timeseries(hours = 24) {
  const since = startOfDayMs() - (24 - new Date().getHours()) * 3600_000 - (hours - 24) * 3600_000;
  // Simpler: just compute since = now - hours*3600_000
  const sinceMs = Date.now() - hours * 3600_000;
  // schema source: zai-org/ZCode MIG 0010_usage_observability（input 列含 cache_read）
  const rows = db().prepare(`
    SELECT (started_at / 3600000) * 3600000 AS bucket,
           COUNT(*) AS calls,
           SUM(input_tokens)  AS in_tok,
           SUM(output_tokens) AS out_tok,
           SUM(reasoning_tokens) AS reason_tok,
           SUM(CASE WHEN status='error' THEN 1 END) AS errors
    FROM model_usage
    WHERE started_at >= @since
    GROUP BY bucket
    ORDER BY bucket ASC
  `).all({ since: sinceMs });
  return rows.map(r => ({
    bucket: ts(r.bucket),
    calls: r.calls,
    input: r.in_tok || 0,
    output: r.out_tok || 0,
    reasoning: r.reason_tok || 0,
    errors: r.errors || 0,
  }));
}

// Breakdown by model + query_source — shows where compute goes.
function breakdownByModel(sinceMs) {
  // schema source: zai-org/ZCode MIG 0010_usage_observability +
  // USAGE queryAppUsage(models)（官方同款按 model_id 分组，全量行）
  return db().prepare(`
    SELECT provider_id, model_id, variant, query_source,
           COUNT(*) AS calls,
           SUM(input_tokens)  AS in_tok,
           SUM(output_tokens) AS out_tok,
           SUM(reasoning_tokens) AS reason_tok,
           AVG(CASE WHEN status='completed' THEN duration_ms END) AS avg_ms
    FROM model_usage
    WHERE started_at >= @since
    GROUP BY provider_id, model_id, variant, query_source
    ORDER BY calls DESC
  `).all({ since: sinceMs });
}

function breakdownByTool(sinceMs) {
  // schema source: zai-org/ZCode MIG 0010_usage_observability +
  // USAGE queryAppUsage(tools)（官方同款按 tool_name 分组）
  return db().prepare(`
    SELECT tool_name,
           COUNT(*) AS calls,
           SUM(CASE WHEN status='error' THEN 1 END) AS errors,
           AVG(CASE WHEN status='completed' THEN duration_ms END) AS avg_ms,
           MAX(duration_ms) AS max_ms,
           SUM(output_bytes) AS out_bytes
    FROM tool_usage
    WHERE started_at >= @since
    GROUP BY tool_name
    ORDER BY calls DESC
  `).all({ since: sinceMs });
}

// ───────────────────────── Token speed ─────────────────────────
// Token generation speed (tokens/sec) for completed model requests.
// Computed from the model_usage table; we aggregate raw sums and do the
// division in JS to avoid floating-point drift inside SQLite, and to keep
// the weighted average (= Σtokens / Σseconds) instead of mean(per-request
// tps).
//
// Caliber decisions (revised 2026-09-24 — the generation-time split):
//   - numerator: output_tokens + reasoning_tokens (reasoning counts as
//     generated throughput; matches claude-speed METRIC "reasoning is part
//     of generation". In this db reasoning_tokens is always 0 so far —
//     provider raw_usage_json carries no reasoning field at all).
//   - denominator: GENERATION time = duration_ms − time_to_first_token_ms,
//     NOT the full duration. GLM-5.3's thinking phase averages 8.7s TTFT
//     = 39% of total duration (2026-09-24 measurement over 4756 rows),
//     so the old incl-TTFT caliber read ~40% low vs. felt output speed.
//     Community cross-check: JuDaXia/claude-speed METRIC v1.2 models
//     duration ≈ TTFT + out/TPS and headlines the TTFT-stripped TPS
//     (it must even Theil-Sen-fit it from record timestamps); the
//     token-speed-monitor project this module originally mirrored includes
//     TTFT only because its rollout-JSONL source has no TTFT field — a
//     data limitation, not a caliber preference. model_usage has had
//     time_to_first_token_ms per row all along (~77% coverage; NULL rows
//     fall back to full duration), so the earlier note "per-request TTFT
//     is only available at turn_usage granularity" was wrong.
//   - per-row generation time is floored at 1ms (SQLite scalar MAX) so a
//     dirty row with ttft ≥ duration can never zero/negate the sum.
//   - weighted average = Σtokens / Σgeneration-seconds (token-weighted),
//     NOT mean(tok/s) — long requests dominate, reflecting real throughput.

function overviewSpeed(sinceMs) {
  // schema source: zai-org/ZCode MIG 0010_usage_observability。速度分子
  // （output+reasoning）是速度专用口径（本地估算合成），与 computed_total_tokens
  // 的总量口径不同——徽章与 docs/usage-accounting.md §徽章映射一致。
  // 分母生成时长（duration−ttft，NULL 回退全时长，1ms 下限）见区头注。
  const m = db().prepare(`
    SELECT SUM(output_tokens + COALESCE(reasoning_tokens, 0)) AS total_tokens,
           SUM(duration_ms)                                    AS total_ms,
           SUM(MAX(duration_ms - COALESCE(time_to_first_token_ms, 0), 1)) AS gen_ms,
           SUM(time_to_first_token_ms)                          AS ttft_ms,
           SUM(CASE WHEN time_to_first_token_ms IS NOT NULL THEN 1 END) AS ttft_count,
           COUNT(*)                                            AS request_count,
           SUM(CASE WHEN query_source='main_turn'      THEN 1 END) AS main_count,
           SUM(CASE WHEN query_source='subagent'       THEN 1 END) AS subagent_count,
           SUM(CASE WHEN query_source='workflow_child' THEN 1 END) AS workflow_child_count
    FROM model_usage
    WHERE status = 'completed'
      AND duration_ms > 0
      AND started_at >= @since
  `).get({ since: sinceMs });

  const totalTokens = m.total_tokens || 0;
  const totalSeconds = m.total_ms ? m.total_ms / 1000 : 0;
  const genSeconds = m.gen_ms ? m.gen_ms / 1000 : 0;
  return {
    weighted_tps: genSeconds > 0 ? +(totalTokens / genSeconds).toFixed(1) : null,
    total_tokens: totalTokens,
    total_seconds: +totalSeconds.toFixed(1),
    // 生成秒数（速度分母）与平均首等：KPI 副行展示口径用（0 请求时均首等为 null）
    gen_seconds: +genSeconds.toFixed(1),
    avg_ttft_ms: m.ttft_count ? Math.round(m.ttft_ms / m.ttft_count) : null,
    request_count: m.request_count || 0,
    main_count: m.main_count || 0,
    subagent_count: m.subagent_count || 0,
    // 动态工作流（dwf）派生的 actor 走第三个来源 workflow_child（会话行为
    // task_type='workflow_child'、同样挂在 parent 会话下，运行册在 dwf_run/
    // dwf_actor 表）。与 subagent 分列返回：UI「子agent」语义 = 两者之和，
    // 拆开可区分 Task 子代理与工作流 actor。三计数之和 < request_count——
    // 残差是 compact/session_title 及未来未知来源（口径见 How 页）。
    workflow_child_count: m.workflow_child_count || 0,
  };
}

// Per-request speed detail for the recent-speed table + scatter/line chart.
// id is exposed so the widget can dedup its SSE stream against seed re-fetches.
// Returns newest first. tps is null when duration_ms <= 0 (not shown).
// gen_ms = generation time (duration−ttft, NULL→full duration, 1ms floor)
// — the tps denominator; ttft_ms is exposed for the table's TTFT column.
function recentSpeed(sinceMs, limit = 50) {
  // schema source: zai-org/ZCode MIG 0010_usage_observability（tps 分子同速度口径）
  const rows = db().prepare(`
    SELECT id,
           started_at,
           model_id,
           output_tokens,
           COALESCE(reasoning_tokens, 0) AS reasoning_tokens,
           duration_ms,
           time_to_first_token_ms,
           query_source
    FROM model_usage
    WHERE status = 'completed'
      AND duration_ms > 0
      AND started_at >= @since
    ORDER BY started_at DESC
    LIMIT @limit
  `).all({ since: sinceMs, limit });
  return rows.map(r => {
    const genMs = Math.max(r.duration_ms - (r.time_to_first_token_ms || 0), 1);
    const tps = r.duration_ms > 0
      ? +((r.output_tokens + r.reasoning_tokens) / (genMs / 1000)).toFixed(1)
      : null;
    return {
      id: r.id,
      time: ts(r.started_at),
      model: r.model_id,
      output: r.output_tokens || 0,
      reasoning: r.reasoning_tokens || 0,
      duration_ms: r.duration_ms,
      ttft_ms: r.time_to_first_token_ms,
      gen_ms: genMs,
      tps,
      query_source: r.query_source,
    };
  });
}

// Exact rolling-window population for the floating widget: completed requests
// whose COMPLETION time (started_at + duration_ms) falls inside the window.
// No LIMIT cap — recentSpeed's 50-row cap under-seeds busy windows (65+
// completions per 5 min observed under parallel subagents), which skews the
// widget's weighted aggregate. Payload stays tiny (window-sized). Rows carry
// gen_ms (generation time, the speed denominator — see Token speed header)
// alongside duration_ms (completion-time bookkeeping).
function completedSince(sinceMs) {
  // started_at + duration_ms can't use the started_at index (expression),
  // and a bare expression scan cost ~430ms on the 14.6GB db — the pet page
  // polls this every 5s, so that alone starved the event loop. Pre-filter
  // on the INDEXED started_at first: a request still inside the window must
  // have started no earlier than the window start minus its duration; the
  // 2h pad covers any real request (anything longer only lands in the
  // rolling average it belongs to anyway). The exact completion filter
  // still runs on the small candidate set, so results are identical.
  // schema source: zai-org/ZCode MIG 0010_usage_observability
  return db().prepare(`
    SELECT id,
           started_at,
           duration_ms,
           time_to_first_token_ms,
           output_tokens,
           COALESCE(reasoning_tokens, 0) AS reasoning_tokens
    FROM model_usage
    WHERE status = 'completed'
      AND duration_ms > 0
      AND started_at >= @since - 7200000
      AND started_at + duration_ms >= @since
    ORDER BY started_at ASC
  `).all({ since: sinceMs }).map(r => ({
    id: r.id,
    time: ts(r.started_at),
    output: r.output_tokens || 0,
    reasoning: r.reasoning_tokens || 0,
    duration_ms: r.duration_ms,
    // 生成时长（widget 滚动均速/sparkline 的分母）；完成时刻判定仍用
    // duration_ms（上两行），勿混。ttft NULL → 全时长；脏行 1ms 下限。
    gen_ms: Math.max(r.duration_ms - (r.time_to_first_token_ms || 0), 1),
  }));
}

// Today's usage totals for the widget's daily budget readout. Same day-window
// convention as the dashboard's ?window=today (startOfDayMs = LOCAL midnight),
// and same token caliber as overviewSpeed: output + reasoning count as
// generated tokens; reasoning_tokens is nullable so COALESCE to 0.
function todayUsage() {
  // schema source: zai-org/ZCode MIG 0010_usage_observability（速度口径见 overviewSpeed；
  // input/cache_read 两 SUM 与 cache_hit_rate 是 C2 widget 缓存命中副行的数据面扩展）
  const r = db().prepare(`
    SELECT SUM(output_tokens + COALESCE(reasoning_tokens, 0)) AS tokens,
           COUNT(*)                                            AS requests,
           SUM(input_tokens)                   AS in_tok,
           SUM(cache_read_input_tokens)        AS cache_read
    FROM model_usage
    WHERE status = 'completed'
      AND started_at >= @since
  `).get({ since: startOfDayMs(Date.now()) });
  // cache_hit_rate = cache_read/input：分母 input_tokens 官方语义已含 cache_read
  //（Overview 区头注），照搬「input+cache_read」作分母会 ≈2 倍虚高；当日全零行日
  //（§2.0 勘误承认存在）input=0 → null（widget 副行显「—」），禁 NaN/Infinity。
  // 比率在响应侧算好，widget 纯渲染。
  const input = r.in_tok || 0;
  const cacheRead = r.cache_read || 0;
  return {
    tokens: r.tokens || 0,
    requests: r.requests || 0,
    input_tokens: input,
    cache_read_tokens: cacheRead,
    cache_hit_rate: input > 0 ? +((cacheRead / input)).toFixed(4) : null,
  };
}

// boot/connect 的 SSE 水位 init 亦是 MAX(rowid)（见 recentModelRowsAfterRowid
// 头注；旧 latestModelStartedAt/latestToolStartedAt 的 started_at 水位随本改造移除）。

// ───────────────────────── Sessions ─────────────────────────

function sessionList({ limit = 100, offset = 0, q = '', taskType = '', status = '' } = {}) {
  const where = [];
  const params = { limit, offset };
  if (q) { where.push('(title LIKE @q OR id LIKE @q)'); params.q = `%${q}%`; }
  if (taskType) { where.push('task_type = @taskType'); params.taskType = taskType; }
  // status filter applied on latest activity's existence
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // schema source: zai-org/ZCode MIG 0010_usage_observability + USAGE queryAppUsage
  // total_tokens = SUM(computed_total_tokens)（官方预计算权威值，保持原口径）。
  // 子代理 token 记在子会话名下（session.parent_id 关联），不与本会话行重复。
  //
  // 两段查询（R3 修-medium）：原单查询的 3 个相关聚合按「排序前的全行」逐行计算
  //（真实库 17,733 会话实测热态 949ms，冷态 4.3s——同步阻塞事件循环）；改为先取
  // 页内 ≤limit 行（排序只搬 8 个基础列，16-29ms），再对页内 id 做两条索引寻址的
  // GROUP BY 聚合（idx model_usage_session_turn/ tool_usage_session_tool 最左
  // session_id，合计 <15ms），口径与空值语义不变（COUNT 缺行=0、SUM 缺行=null）。
  const page = db().prepare(`
    SELECT s.id, s.title, s.task_type, s.directory,
           s.parent_id,
           s.time_created, s.time_updated
    FROM session s
    ${whereSql}
    ORDER BY s.time_updated DESC
    LIMIT @limit OFFSET @offset
  `).all(params);
  if (!page.length) return [];
  const ids = page.map(r => r.id);
  const ph = ids.map(() => '?').join(',');
  const modelAgg = new Map(db().prepare(`
    SELECT session_id, COUNT(*) AS c, SUM(computed_total_tokens) AS s
    FROM model_usage WHERE session_id IN (${ph}) GROUP BY session_id
  `).all(...ids).map(r => [r.session_id, r]));
  const toolAgg = new Map(db().prepare(`
    SELECT session_id, COUNT(*) AS c
    FROM tool_usage WHERE session_id IN (${ph}) GROUP BY session_id
  `).all(...ids).map(r => [r.session_id, r]));
  // 「最新 model 行」第三聚合（C2 mini 水位条数据面，两段先例同款页内 IN 寻址）：
  // SQLite bare-column+MAX 特性——GROUP BY session_id 且聚合含 MAX(rowid) 时，
  // 裸列（model_id/input_tokens）确定取自该组 MAX(rowid) 所在行（SQLite 文档
  // lang_select.html#bareagg 的特例）。取 rowid 最大行＝写入序最新行，**非
  // MAX(input_tokens)**——后者会选「历史最大输入」而非「最近一次请求」。
  // schema source: zai-org/ZCode MIG 0010_usage_observability
  const latestModel = new Map(db().prepare(`
    SELECT session_id, model_id, input_tokens, MAX(rowid) AS rid
    FROM model_usage WHERE session_id IN (${ph}) GROUP BY session_id
  `).all(...ids).map(r => [r.session_id, r]));
  return page.map(r => {
    const m = modelAgg.get(r.id);
    const t = toolAgg.get(r.id);
    const lm = latestModel.get(r.id);
    return { ...r, model_calls: m ? m.c : 0, tool_calls: t ? t.c : 0,
             total_tokens: m ? m.s : null,
             // 无 model 行会话三字段均为 null 且字段存在（C2-4 钉：字段存在值为
             // null，非缺字段）。context_tokens 由路由层经 models-meta resolve
             // 附带（窗口值唯一通路，本层不持模型表；此处先置 null 补全形状）。
             latest_model: {
               model_id: lm ? lm.model_id : null,
               input_tokens: lm ? lm.input_tokens : null,
               context_tokens: null,
             } };
  });
}

function sessionGet(id) {
  return db().prepare(`SELECT * FROM session WHERE id = ?`).get(id) || null;
}

// Turn timeline for a session: one row per turn with aggregated metrics.
function sessionTurns(id) {
  // schema source: zai-org/ZCode MIG 0010_usage_observability + OBS recordTurnUsageFact
  // turn_usage 不含标题生成等 side call（官方 title-generation-sidecar.ts 异步运行，
  // 只写 model_usage、query_source='session_title'；真实库 30/30 样本验证
  // turn_usage.computed_total_tokens == Σ(model_usage 排除 session_title 行)），
  // computed_total_tokens 为下界（出处见 docs/usage-accounting.md §side call 缺口）。
  return db().prepare(`
    SELECT turn_id, status, trace_id, user_message_id,
           started_at, first_token_at, completed_at,
           duration_ms, time_to_first_token_ms,
           model_request_count, model_retry_count,
           tool_call_count, tool_error_count,
           input_tokens, output_tokens, reasoning_tokens,
           cache_read_input_tokens, cache_creation_input_tokens,
           computed_total_tokens,
           context_exceeded, error_type, error_code
    FROM turn_usage
    WHERE session_id = ?
    ORDER BY started_at ASC
  `).all(id).map(t => ({ ...t,
    started_at: ts(t.started_at),
    first_token_at: ts(t.first_token_at),
    completed_at: ts(t.completed_at),
  }));
}

// Conversation replay: messages with their parts, ordered.
function sessionConversation(id, { maxMessages = 400 } = {}) {
  const messages = db().prepare(`
    SELECT id, session_id, time_created, sequence, data
    FROM message
    WHERE session_id = ?
    ORDER BY COALESCE(sequence, 0) ASC, time_created ASC
    LIMIT ?
  `).all(id, maxMessages);

  if (!messages.length) return [];

  const ids = messages.map(m => m.id);
  const placeholders = ids.map(() => '?').join(',');
  const parts = db().prepare(`
    SELECT id, message_id, sequence, time_created, data
    FROM part
    WHERE message_id IN (${placeholders})
    ORDER BY message_id ASC, COALESCE(sequence, 0) ASC, time_created ASC
  `).all(...ids);

  // group parts by message
  const byMsg = new Map();
  for (const p of parts) {
    if (!byMsg.has(p.message_id)) byMsg.set(p.message_id, []);
    byMsg.get(p.message_id).push({
      id: p.id,
      sequence: p.sequence,
      data: j(p.data, {}),
    });
  }

  return messages.map(m => {
    const data = j(m.data, {});
    return {
      id: m.id,
      sequence: m.sequence,
      time_created: ts(m.time_created),
      role: data.role,
      model: data.modelID || data.model?.modelID || null,
      provider: data.providerID || data.model?.providerID || null,
      variant: data.variant || null,
      mode: data.mode || null,
      agent: data.agent || null,
      tokens: data.tokens || null,
      turn_id: data.anchor?.turnId || null,
      // user messages carry context info useful to show
      env: data.contextSnapshot?.envInfo || null,
      parts: byMsg.get(m.id) || [],
    };
  });
}

// Recent activity (model + tool) within a session, merged by time.
function sessionActivity(id, limit = 200) {
  const models = db().prepare(`
    SELECT 'model' AS kind, id, turn_id, status, started_at, completed_at, duration_ms,
           query_source, model_id, provider_id, variant, mode, agent,
           input_tokens, output_tokens, reasoning_tokens,
           tool_call_count, error_type, error_message
    FROM model_usage
    WHERE session_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(id, limit);
  const tools = db().prepare(`
    SELECT 'tool' AS kind, id, turn_id, tool_call_id, tool_name, status,
           started_at, completed_at, duration_ms,
           side_effect_scope, read_only, approval_status,
           exit_code, output_bytes, stderr_bytes, error_type, error_message
    FROM tool_usage
    WHERE session_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(id, limit);
  return [...models, ...tools]
    .sort((a, b) => b.started_at - a.started_at)
    .slice(0, limit)
    .map(r => ({ ...r,
      started_at: ts(r.started_at),
      completed_at: ts(r.completed_at),
    }));
}

// Subagent tree: children sessions + the tool call that spawned them.
// We find children via session.parent_id, and link to the spawning tool call
// via agents/<parent>/agent_*/metadata.json (read on demand in route).
function sessionChildren(id) {
  // schema source: zai-org/ZCode MIG 0010_usage_observability + USAGE queryAppUsage
  // 同 sessionList：SUM(computed_total_tokens) 官方预计算口径（与主列表一致，勿改公式）。
  return db().prepare(`
    SELECT id, title, task_type, time_created, time_updated,
           (SELECT SUM(computed_total_tokens) FROM model_usage m WHERE m.session_id = c.id) AS total_tokens
    FROM session c
    WHERE c.parent_id = ?
    ORDER BY time_created ASC
  `).all(id);
}

// ───────────────────────── Reasoning-focused ─────────────────────────
// Pull reasoning text parts for a session (the model's chain-of-thought).
function sessionReasoning(id, limit = 50) {
  const rows = db().prepare(`
    SELECT p.id, p.message_id, p.time_created, p.data
    FROM part p
    JOIN message m ON m.id = p.message_id
    WHERE m.session_id = ? AND json_extract(p.data, '$.type') = 'reasoning'
    ORDER BY p.time_created ASC
    LIMIT ?
  `).all(id, limit);
  return rows.map(r => {
    const d = j(r.data, {});
    return {
      id: r.id,
      message_id: r.message_id,
      time: ts(r.time_created),
      text: d.text || '',
      time_start: d.time?.start ? ts(d.time.start) : null,
      time_end: d.time?.end ? ts(d.time.end) : null,
    };
  });
}

// ───────────────────────── Errors ─────────────────────────

function errorsList({ sinceMs = null, kind = 'both', limit = 200 } = {}) {
  const sinceClause = sinceMs ? 'AND started_at >= @since' : '';
  const params = { since: sinceMs, limit };
  const out = { model: [], tool: [] };
  if (kind === 'both' || kind === 'model') {
    // schema source: zai-org/ZCode MIG 0010_usage_observability
    out.model = db().prepare(`
      SELECT id, session_id, turn_id, trace_id, status, started_at,
             model_id, provider_id, query_source,
             input_tokens, output_tokens, duration_ms,
             error_type, error_code, error_message
      FROM model_usage
      WHERE status IN ('error','cancelled') ${sinceClause}
      ORDER BY started_at DESC LIMIT @limit
    `).all(params).map(r => ({ ...r, started_at: ts(r.started_at) }));
  }
  if (kind === 'both' || kind === 'tool') {
    out.tool = db().prepare(`
      SELECT id, session_id, turn_id, trace_id, tool_call_id, tool_name, status,
             started_at, duration_ms, exit_code, stderr_bytes,
             error_type, error_code, error_message
      FROM tool_usage
      WHERE status IN ('error','cancelled') ${sinceClause}
      ORDER BY started_at DESC LIMIT @limit
    `).all(params).map(r => ({ ...r, started_at: ts(r.started_at) }));
  }
  return out;
}

// SQLite needs single-quoted string literals. We build the WHERE once.
const STATUS_FAILED = `'error','cancelled'`;

// Error counts grouped by error_type and by tool_name.
function errorSummary(sinceMs) {
  // schema source: zai-org/ZCode MIG 0010_usage_observability
  const mWhere = sinceMs
    ? `WHERE started_at >= ${+sinceMs} AND status IN (${STATUS_FAILED})`
    : `WHERE status IN (${STATUS_FAILED})`;
  const tWhere = mWhere; // same shape for tool_usage
  const byModelErrorType = db().prepare(
    `SELECT COALESCE(error_type,'(none)') AS k, COUNT(*) AS n
     FROM model_usage ${mWhere} GROUP BY k ORDER BY n DESC`).all();
  const byToolName = db().prepare(
    `SELECT tool_name AS k, COUNT(*) AS n
     FROM tool_usage ${tWhere} GROUP BY k ORDER BY n DESC`).all();
  const byToolErrorType = db().prepare(
    `SELECT COALESCE(error_type,'(none)') AS k, COUNT(*) AS n
     FROM tool_usage ${tWhere} GROUP BY k ORDER BY n DESC`).all();
  return { byModelErrorType, byToolName, byToolErrorType };
}

// Slow tool calls Top N
// ── window=all（sinceMs=null）的候选集钳制（R5 修-med，阻断-2）──────────────
// 演进：最初的无 WHERE `ORDER BY duration_ms DESC` 是全表扫 + TEMP B-TREE 排序
//（真实库 tool_usage 52.3万行实测热态 235ms，EXPLAIN: SCAN）；c69a145 钳
// started_at ≥ now-30d，但真实库时间跨度恰好 30.0 天 → 窗口不裁任何行，全部
// 52.3万行照旧进排序（实测 254-315ms，与修前无实质差异）。根因是只钳了时间
// 维度、没钳候选集规模——时间跨度会随使用时长无限增长，规模必须有独立上界。
// 现行双保险（均命中性能红线允许的路径）：
//   1) 语义口径：started_at ≥ now-30d（「最慢工具」排查本就聚焦近期）；
//   2) 规模钳制：rowid 尾部限定最新 SLOW_TOOLS_CANDIDATE_CAP_ROWS 行——
//      `WHERE rowid > (SELECT MAX(rowid) FROM tool_usage) - @cap` 走隐式
//      rowid 的 INTEGER PRIMARY KEY 尾界寻址（EXPLAIN QUERY PLAN 实测
//      SEARCH ... USING INTEGER PRIMARY KEY (rowid>?);TEMP B-TREE 排序的输入
//      从全表降为 ≤cap 行）。append-only 表 rowid 随写入单调递增（不变量出处
//      见 recentToolRowsAfterRowid 头注），「最新 N 行」即「最近写入的 N 条」。
// 实际口径由调用方在响应 meta 如实注明（routes/trace.js 的
// slow_tools_scope:'recent_30d_capped_<cap>_rows'）。调用方显式给 sinceMs 的
// 窗口（today/24h/7d）不做规模钳制——那是用户点名的时间窗，真实库 7d ≈ 12万
// 行的排序在红线内，且隐藏截断会改语义。
// candidateCapRows 参数是测试缝：小 fixture 注入小 cap 验证裁剪生效，不改
// 运行时缺省值。
const SLOW_TOOLS_ALL_SCOPE_MS = 30 * 86400_000;
const SLOW_TOOLS_CANDIDATE_CAP_ROWS = 100_000;
function slowTools({ sinceMs = null, limit = 50,
                     candidateCapRows = SLOW_TOOLS_CANDIDATE_CAP_ROWS } = {}) {
  if (sinceMs != null) {
    return db().prepare(`
      SELECT id, session_id, turn_id, tool_call_id, tool_name, status,
             started_at, duration_ms, exit_code,
             substr(COALESCE(error_message,''),1,160) AS err
      FROM tool_usage
      WHERE started_at >= @since
      ORDER BY duration_ms DESC LIMIT @limit
    `).all({ since: sinceMs, limit }).map(r => ({ ...r, started_at: ts(r.started_at) }));
  }
  const since = Date.now() - SLOW_TOOLS_ALL_SCOPE_MS;
  return db().prepare(`
    SELECT id, session_id, turn_id, tool_call_id, tool_name, status,
           started_at, duration_ms, exit_code,
           substr(COALESCE(error_message,''),1,160) AS err
    FROM tool_usage
    WHERE rowid > (SELECT MAX(rowid) FROM tool_usage) - @cap
      AND started_at >= @since
    ORDER BY duration_ms DESC LIMIT @limit
  `).all({ since, limit, cap: candidateCapRows }).map(r => ({ ...r, started_at: ts(r.started_at) }));
}

// ───────────────────────── Live tail ─────────────────────────

// SSE 行流的 rowid 水位查询（R4 修-low，三视角交叉印证）：旧 recentModelRows/
// recentToolRows 用 started_at 单键水位，有 livegen.js:28-34 已定性并修复的同款
// 盲区——boot 取 MAX(started_at) 后，启动前开始、启动后才落库的行永不发射；
// 同毫秒批量新行超过 LIMIT 100 时截断点之后的同毫秒行被永久跳过。与
// recentToolRowsAfterRowid（livegen 工具失败扫描）共享同一不变量：rowid 水位 +
// ASC + LIMIT，>LIMIT 的余量下个 tick 续扫、晚落库的旧行 rowid 更大照常发射。
// rowid 不变量与性能路径见 recentToolRowsAfterRowid 头注（隐式 rowid 尾界寻址，
// 性能红线允许）。行携带 rid（隐式 rowid）供 per-connection 水位推进；started_at
// 仍 ISO 化（前端时间轴直接消费）。返回按 rowid ASC。
function recentModelRowsAfterRowid(afterRowid, limit = 50) {
  return db().prepare(`
    SELECT rowid AS rid, id, session_id, turn_id, trace_id, status, started_at, duration_ms,
           time_to_first_token_ms,
           query_source, model_id, variant, mode, agent,
           input_tokens, output_tokens, reasoning_tokens, tool_call_count,
           error_type
    FROM model_usage
    WHERE rowid > ?
    ORDER BY rowid ASC
    LIMIT ?
  `).all(afterRowid, limit)
    .map(r => ({ ...r, started_at: ts(r.started_at) }));
}

// boot/connect 水位取 MAX(rowid)：只流式发射本连接建立之后的行（无历史回放）。
function latestModelRowid() {
  return db().prepare('SELECT MAX(rowid) AS m FROM model_usage').get().m || 0;
}

// livegen 工具失败扫描 + live.js SSE 工具行流的共用 rowid 水位扫描（R4 起双消费
// 者）。started_at 单键水位有两个盲区——同毫秒批量新行超过 LIMIT 时截断点之后的
// 同毫秒行被 WHERE started_at > 水位永久跳过；boot 取 MAX(started_at) 后，启动
// 前开始、启动后才落库的行也永不发射。rowid 水位后两个盲区同时消失：>LIMIT 的
// 余量下一 tick 续扫，晚落库的旧行 rowid 更大照常发射。与 recentModelRowsAfterRowid
// 共享同一不变量。rowid 不变量（2026-09-23 只读实测真实库 sqlite_master）：
// tool_usage.id 是 `text primary key`——TEXT 主键**不是** rowid 别名，本水位的
// 是独立的隐式 rowid；append-only 表新行按 max(rowid)+1 分配，故隐式 rowid 随
// 写入单调递增。`WHERE rowid > ?` 命中隐式 rowid 的 O(log n) 尾界寻址（EXPLAIN
// QUERY PLAN 实测 SEARCH tool_usage USING INTEGER PRIMARY KEY (rowid>?)；性能
// 红线允许的两条路径之一），不碰 started_at 索引、绝不全表扫。勿以 TEXT 的 id
// 列替代 rowid 做水位/排序——TEXT 序是字典序、≠ 写入序，那才是真 bug。残余前提：
// append-only——若上游未来删除最大 rowid 行，复用分配会让新行 ≤ 水位被跳过
//（fixture 的同表 id 已对齐为 TEXT 主键，test/helpers/fixture-db.js）。
// 返回载荷：livegen 消费 rid/status/tool_name/session_id（其余列不读）；live.js
// SSE 行流消费完整列（含 ISO 化 started_at 供前端时间轴直接渲染）。
function recentToolRowsAfterRowid(afterRowid, limit = 50) {
  return db().prepare(`
    SELECT rowid AS rid, id, session_id, turn_id, trace_id, tool_call_id,
           tool_name, status, started_at, duration_ms, exit_code, error_type
    FROM tool_usage
    WHERE rowid > ?
    ORDER BY rowid ASC
    LIMIT ?
  `).all(afterRowid, limit)
    .map(r => ({ ...r, started_at: ts(r.started_at) }));
}

function latestToolRowid() {
  return db().prepare('SELECT MAX(rowid) AS m FROM tool_usage').get().m || 0;
}

// ───────────────────────── Agents tree ─────────────────────────
// Build a forest of sessions rooted at interactive/main sessions, with their
// subagent children (parent_id chain) underneath.
// 两段 + LIMIT（R3 修-medium）：原查询对全部会话行内联 3 个相关聚合（真实库
// 17,733 会话实测热态 985ms-1s、冷态 4.3s）；森林展示主体是「最近活跃的会话」，
// 改为取 time_updated 最新的 ≤AGENTS_FOREST_MAX_SESSIONS 行（22ms）+ 对这些 id
// 的索引寻址聚合（60ms）。LIMIT 取舍（有意为之）：被截掉的更旧父会话不进森林，
// 其仍在窗口内的子会话按既有孤儿语义升为根（byId 缺父即根）；total 如实返回
// 进入窗口的会话数。真实库当前 17.7k 会话 → 窗口 500 覆盖最近约 3 周活跃。
const AGENTS_FOREST_MAX_SESSIONS = 500;
function agentsForest({ projectId = null } = {}) {
  const where = projectId ? 'WHERE project_id = ?' : '';
  const bind = projectId ? [projectId] : [];
  // schema source: zai-org/ZCode MIG 0010_usage_observability + USAGE queryAppUsage
  // 同 sessionList：SUM(computed_total_tokens) 官方预计算口径；父/子节点各自持有
  // 自己会话的行，森林展示不叠加求和，无重复计入。
  const sessions = db().prepare(
    `SELECT id, title, task_type, parent_id, directory,
            time_created, time_updated
     FROM session s ${where}
     ORDER BY time_updated DESC
     LIMIT ?`).all(...bind, AGENTS_FOREST_MAX_SESSIONS);
  if (!sessions.length) return { roots: [], total: 0 };
  const ids = sessions.map(r => r.id);
  const ph = ids.map(() => '?').join(',');
  const modelAgg = new Map(db().prepare(
    `SELECT session_id, COUNT(*) AS c, SUM(computed_total_tokens) AS s
     FROM model_usage WHERE session_id IN (${ph}) GROUP BY session_id`
  ).all(...ids).map(r => [r.session_id, r]));
  const toolAgg = new Map(db().prepare(
    `SELECT session_id, COUNT(*) AS c
     FROM tool_usage WHERE session_id IN (${ph}) GROUP BY session_id`
  ).all(...ids).map(r => [r.session_id, r]));
  // build map + forest
  const byId = new Map();
  for (const s of sessions) {
    const m = modelAgg.get(s.id);
    const t = toolAgg.get(s.id);
    byId.set(s.id, { ...s, tokens: m ? m.s : null, model_calls: m ? m.c : 0,
                     tool_calls: t ? t.c : 0,
                     children: [], time_created: ts(s.time_created), time_updated: ts(s.time_updated) });
  }
  const roots = [];
  for (const s of byId.values()) {
    if (s.parent_id && byId.has(s.parent_id)) {
      byId.get(s.parent_id).children.push(s);
    } else {
      roots.push(s);
    }
  }
  // sort roots newest first, children oldest first (chronological spawn)
  roots.sort((a, b) => b.time_updated.localeCompare(a.time_updated));
  for (const n of byId.values()) n.children.sort((a, b) => a.time_created.localeCompare(b.time_created));
  return { roots, total: sessions.length };
}

// ───────────────────────── Usage attribution ─────────────────────────
// 窗口级用量归因查询族（ecosystem-round2-batch1：C1 回合/工具统计与 C5 token
// 归因的同基座，规格 docs/specs/ecosystem-round2-batch1.md §2.1/§2.3）。
// 口径钉：
//   - token 一律 SUM(computed_total_tokens)（官方预计算权威值，区头注见 Overview；
//     不自造公式）。by_query_source 同为 token 口径（火焰宽度语义：值 = 各
//     query_source 的 token 份额，五值域 subagent/main_turn/workflow_child/
//     compact/session_title）。
//   - turn 侧 avg_ttft_ms 是回合健康度的窗口视角（AVG(time_to_first_token_ms)，
//     全 NULL → null，SQLite AVG 语义不伪造 0）；与速度口径轮 model_usage 侧的
//     avg_ttft_ms（逐请求生成速度面）互补，不重复。
//   - tool 侧 avg_ms 仅聚合 completed 行（计划对规格 §2.1 AVG(duration_ms) 的
//     收紧细化：错误行时长不代表健康耗时）；max_ms 仍全行（极端值含错误行）。
//   - approval_status 只呈现值域分布（值→计数），不赋 pending 语义——该列实测
//     只记终态（7d 窗 160,827 行 'none' + 1 行 'denied'）。
// 性能契约（红线 2）：窗口查询全部 WHERE started_at >= @since 命中官方 started_at
// 索引（model_usage_started_model_idx / tool_usage_started_tool_idx /
// turn_usage_started_idx；GROUP BY 的 TEMP B-TREE 允许）；宽窗（≥8d，见下）改走
// rowid 尾界钳制（红线允许的另一条路径）；会话内/页内寻址走
// session 索引（sessionList db.js 两段模式先例）；行数上限经 LIMIT @probe=limit+1
// 探针（归因 session 层单趟化后为 JS 侧截断，同义）实现诚实截断——多 1 行/会话
// 即置 truncated 并丢弃，免额外 COUNT。真实库 EXPLAIN/计时与 30d 档规模取舍
// 照录 docs/acceptance/round2-batch1-explain-timing.md。

// 行数防御：路由层 clampLimit 是第一道（负 LIMIT = 无上限 → SQLite 整表同步
// 物化事故形态，见 http-hardening.js 头注）；db 层对直调（测试/未来调用方）
// 再兜底一次负值/NaN → 1，语义不变。
function attrLimit(limit) {
  return Math.max(1, Math.floor(+limit) || 1);
}

// 宽窗候选集钳制（slowTools 先例的移植；启用依据＝2026-09-25 真实库只读实测，
// 数字与取舍照录 docs/acceptance/round2-batch1-explain-timing.md）：
//   - 窗宽 ≥8d（本族 30d 档）的 tool/attribution 聚合，30d 全窗逐行回表聚合实测
//     热态 653-820ms（冷态至 4.5s）——超 500ms 触发线，启用 rowid 尾部候选集
//     上界：`rowid > MAX(rowid) - cap AND started_at >= @since`（隐式 rowid 尾界
//     寻址；NOT INDEXED 钉死计划——attr 页查询不钉时 planner 会为省 GROUP BY 的
//     TEMP B-TREE 改走 session 索引全扫，cap 形同虚设）。
//   - <8d 窗（本族值域 24h/7d）保持 started_at 索引精确路径（7d 实测 ≤204ms
//     在线内）；cap=200k 下 24h/7d 结果与不钳逐字节相等（实测钉）。副作用如实
//     申报是调用方义务（路由 meta 注明 scope，slow_tools_scope 先例）。
//   - 阈值是 8d 而非 7d（评审修复）：宽窄判定在此处对 Date.now() 二次求值，
//     而 sinceMs 由路由在更早时刻算出（T1≤T2 恒真）——阈值若取 7d，7d 请求的
//     窗宽（7d+求值延迟）恒过线、被静默尾界收窄且路由无 scope 申报（路由按
//     window 标签只对 30d 申报）。8d＝7d 档加 1 天余量，令 7d 恒走精确路径，
//     与 meta 申报机制同源；DB 层直调更宽的自定义窗（如 9d/10d）仍过线钳制。
//   - turn_usage 不钳：30d 全表仅 1.4 万行、实测 116ms 冷/12ms 热，远在线内；
//     增长触发线——30d 行数 >5 万或单查询 >300ms 时重评钳制（与 slowTools/
//     USAGE cap 的既有治理口径对齐，无谓复杂度不提前引入）。
const USAGE_CANDIDATE_CAP_ROWS = 200_000;
const USAGE_CAP_WINDOW_MS = 8 * 86400_000;

// C1 turn 健康度聚合 + error_type 分布 Top5（诚实截断）。
function usageTurnsSummary(sinceMs) {
  // schema source: zai-org/ZCode MIG 0010_usage_observability + OBS recordTurnUsageFact
  //（窗口聚合为本仓口径；官方 queryAppUsage 无 turn 维度的跨会话窗口聚合）
  const t = db().prepare(`
    SELECT COUNT(*)                                    AS turns,
           SUM(CASE WHEN status='completed' THEN 1 END) AS completed,
           SUM(CASE WHEN status='error' THEN 1 END)     AS errors,
           SUM(CASE WHEN status='cancelled' THEN 1 END) AS cancelled,
           SUM(model_request_count) AS model_requests,
           SUM(model_retry_count)   AS retries,
           SUM(tool_error_count)    AS tool_errors,
           AVG(time_to_first_token_ms) AS avg_ttft,
           SUM(CASE WHEN context_exceeded=1 THEN 1 END) AS context_exceeded
    FROM turn_usage
    WHERE started_at >= @since
  `).get({ since: sinceMs });

  // schema source: zai-org/ZCode MIG 0010_usage_observability
  // 分布含 '(none)'（无 error_type 的行——completed/cancelled 常态）；LIMIT 6
  // 探针：多出第 6 名即置 truncated 并丢弃，不静默裁剪。
  const dist = db().prepare(`
    SELECT COALESCE(error_type, '(none)') AS type, COUNT(*) AS n
    FROM turn_usage
    WHERE started_at >= @since
    GROUP BY COALESCE(error_type, '(none)')
    ORDER BY n DESC
    LIMIT 6
  `).all({ since: sinceMs });
  const truncated = dist.length > 5;
  if (truncated) dist.length = 5;

  return {
    totals: {
      turns: t.turns || 0,
      completed: t.completed || 0,
      errors: t.errors || 0,
      cancelled: t.cancelled || 0,
      model_requests: t.model_requests || 0,
      retries: t.retries || 0,
      tool_errors: t.tool_errors || 0,
      avg_ttft_ms: t.avg_ttft != null ? Math.round(t.avg_ttft) : null,
      context_exceeded: t.context_exceeded || 0,
    },
    by_error_type: dist.map(r => ({ type: r.type, count: r.n })),
    by_error_type_truncated: truncated,
  };
}

// C1 逐回合时间线（新→旧）。列集为规格 §2.1 需求 1 的字面清单；ORDER BY
// started_at DESC 走 started_at 索引逆序，limit 由路由层钳界后传入。
function usageTurnTimeline(sinceMs, limit = 100) {
  // schema source: zai-org/ZCode MIG 0010_usage_observability + OBS recordTurnUsageFact
  return db().prepare(`
    SELECT turn_id, session_id, started_at, duration_ms, time_to_first_token_ms,
           status, model_retry_count, tool_error_count, error_type,
           context_exceeded, computed_total_tokens
    FROM turn_usage
    WHERE started_at >= @since
    ORDER BY started_at DESC
    LIMIT @limit
  `).all({ since: sinceMs, limit: attrLimit(limit) })
    .map(r => ({ ...r, started_at: ts(r.started_at) }));
}

// C1 工具维度分档。tool_name 为有限枚举 → 全量分组、无 limit 参数、无整表
// 物化风险（窗口内 GROUP BY，TEMP B-TREE 允许）。read_only/destructive 固定
// 双键分布；NULL 行计入「未标记」侧（官方 OBS 写入侧恒置布尔，NULL 只可能
// 出现在外部 ZCODE_DB，按未标记归类不另造第三键）。approval_status 值域开放
// → 独立 GROUP BY 组装（SQL NULL 键归 'null'，与字符串值域可区分）。
function usageToolBreakdown(sinceMs, { candidateCapRows = USAGE_CANDIDATE_CAP_ROWS } = {}) {
  const wide = sinceMs <= Date.now() - USAGE_CAP_WINDOW_MS;
  const from = wide ? 'FROM tool_usage NOT INDEXED' : 'FROM tool_usage';
  const where = wide
    ? 'WHERE rowid > (SELECT MAX(rowid) FROM tool_usage) - @cap AND started_at >= @since'
    : 'WHERE started_at >= @since';
  const params = wide ? { since: sinceMs, cap: candidateCapRows } : { since: sinceMs };
  // schema source: zai-org/ZCode MIG 0010_usage_observability + USAGE queryAppUsage(tools)
  //（官方同款按 tool_name 分组；三分布列为 C1 增量）
  const rows = db().prepare(`
    SELECT tool_name,
           COUNT(*)                                  AS calls,
           SUM(CASE WHEN status='error' THEN 1 END)  AS errors,
           AVG(CASE WHEN status='completed' THEN duration_ms END) AS avg_ms,
           MAX(duration_ms)                          AS max_ms,
           SUM(output_bytes)                         AS out_bytes,
           SUM(CASE WHEN read_only=1   THEN 1 END)   AS ro,
           SUM(CASE WHEN destructive=1 THEN 1 END)   AS d1
    ${from}
    ${where}
    GROUP BY tool_name
    ORDER BY calls DESC
  `).all(params);
  // schema source: zai-org/ZCode MIG 0010_usage_observability
  const approvals = db().prepare(`
    SELECT tool_name, approval_status, COUNT(*) AS n
    ${from}
    ${where}
    GROUP BY tool_name, approval_status
  `).all(params);
  const apprByTool = new Map();
  for (const a of approvals) {
    if (!apprByTool.has(a.tool_name)) apprByTool.set(a.tool_name, {});
    apprByTool.get(a.tool_name)[String(a.approval_status)] = a.n;
  }
  return rows.map(r => {
    const calls = r.calls || 0;
    const ro = r.ro || 0;
    const d1 = r.d1 || 0;
    return {
      tool_name: r.tool_name,
      calls,
      errors: r.errors || 0,
      success_rate: +(1 - (r.errors || 0) / calls).toFixed(4),
      avg_ms: r.avg_ms != null ? Math.round(r.avg_ms) : null,
      max_ms: r.max_ms != null ? r.max_ms : null,
      output_bytes: r.out_bytes || 0,
      read_only: { ro, rw: calls - ro },
      destructive: { 1: d1, 0: calls - d1 },
      approval_status: apprByTool.get(r.tool_name) || {},
    };
  });
}

// C5 归因 session 层：单趟分组 + JS 归并（第二轮评审 I-SQL-4 的方案 (a)）。
// 演进史：两段式（页查询 GROUP BY session_id LIMIT+1 探截断 → 页内 id 的
// query_source 分解）在宽窗下双尾界扫描——真实库 30d 页 270-360ms + sources
// 200-246ms ≈ 541-605ms，持续超 500ms 触发线；改为同趟 GROUP BY
// session_id, query_source 一次扫描（真实库实测 30d 299.3ms 冷 / 7d 189.7ms 冷
// 回线内，探针 zcmon-i-sql-4-merge-probe.js 留 os.tmpdir()），JS 侧归并出每会话
// 总量/分解/排序截断（30d 5187 分组行 → 4978 会话，归并 3.2ms）。分解与总量
// 出自同一查询（I-码-3「可对账」的彻底消解——两段式曾出现行内 cap 窗值 vs
// 全窗分解的双口径）。会话行 ORDER BY tokens DESC 与截断移入 JS：分组行数
// 上界=候选集行数（最坏每行一组），万级分组行的归并+排序不构成长阻塞面。
function usageAttributionBySession(sinceMs, limit = 50, { candidateCapRows = USAGE_CANDIDATE_CAP_ROWS } = {}) {
  const lim = attrLimit(limit);
  // 窄窗（<8d，本族 24h/7d 档）：INDEXED BY 强制 started_at 索引（overviewKpis
  // 同款问题+同款解法，见其头注）——缺省计划会全索引扫 session 索引求
  // GROUP BY session_id 的序（fixture EXPLAIN 实测 SCAN model_usage USING INDEX
  // idx_model_usage_session，真实库 40 万行同形态即 2.4s 级事件循环阻塞）；
  // 复用 overviewKpis 的连接级 sqlite_master 探测记忆与「缺索引库回退不加
  // INDEXED BY」取舍。
  // 宽窗（≥8d，本族 30d 档）：NOT INDEXED + rowid 尾界 cap（见分节头注——不钉
  // NOT INDEXED 时 planner 同样改走 session 索引全扫，cap 失效）。
  const conn = db();
  const wide = sinceMs <= Date.now() - USAGE_CAP_WINDOW_MS;
  let idxGuard = '';
  if (!wide) {
    if (conn._hasStartedModelIdx === undefined) {
      conn._hasStartedModelIdx = !!conn.prepare(
        `SELECT 1 FROM sqlite_master WHERE type='index' AND name='model_usage_started_model_idx'`
      ).get();
    }
    idxGuard = conn._hasStartedModelIdx ? 'INDEXED BY model_usage_started_model_idx' : '';
  }
  // schema source: zai-org/ZCode MIG 0010_usage_observability + USAGE queryAppUsage
  //（token=SUM(computed_total_tokens) 官方预计算权威口径；query_source 列）
  const grp = conn.prepare(`
    SELECT session_id, query_source,
           SUM(computed_total_tokens) AS tokens,
           SUM(duration_ms)           AS duration_ms_sum,
           COUNT(*)                   AS calls
    FROM model_usage ${wide ? 'NOT INDEXED' : idxGuard}
    WHERE ${wide ? 'rowid > (SELECT MAX(rowid) FROM model_usage) - @cap AND ' : ''}started_at >= @since
    GROUP BY session_id, query_source
  `).all(wide ? { since: sinceMs, cap: candidateCapRows } : { since: sinceMs });
  // JS 归并：(session, source) 分组行 → 会话行（总量/耗时/调用数 + 分解字典；
  // SUM 全 NULL → null，归并侧按 0 折算防 NaN 累加）。
  const bySess = new Map();
  for (const g of grp) {
    let s = bySess.get(g.session_id);
    if (!s) {
      s = { session_id: g.session_id, tokens: 0, duration_ms_sum: 0, calls: 0, by_query_source: {} };
      bySess.set(g.session_id, s);
    }
    s.tokens += g.tokens || 0;
    s.duration_ms_sum += g.duration_ms_sum || 0;
    s.calls += g.calls || 0;
    s.by_query_source[g.query_source] = (s.by_query_source[g.query_source] || 0) + (g.tokens || 0);
  }
  // token 降序 + 诚实截断（会话数 > limit 即 truncated——与旧 SQL LIMIT+1 探针
  // 同义；排序移 JS 后并列 tokens 的次序由插入序稳定决定）。
  const all = [...bySess.values()].sort((a, b) => b.tokens - a.tokens);
  const truncated = all.length > lim;
  if (!all.length) return { rows: [], truncated };
  const page = truncated ? all.slice(0, lim) : all;

  // 标题补齐：session 表主键寻址；缺行会话（model 行先于 session 行落库的窗口
  // 形态）title=null 如实呈现。
  // schema source: zai-org/ZCode MIG 0010_usage_observability（session 表）
  const ids = page.map(r => r.session_id);
  const ph = ids.map(() => '?').join(',');
  const titles = new Map(db().prepare(
    `SELECT id, title FROM session WHERE id IN (${ph})`
  ).all(...ids).map(r => [r.id, r.title]));

  return {
    rows: page.map(r => ({
      session_id: r.session_id,
      title: titles.has(r.session_id) ? titles.get(r.session_id) : null,
      tokens: r.tokens,
      duration_ms_sum: r.duration_ms_sum,
      calls: r.calls,
      by_query_source: r.by_query_source,
    })),
    truncated,
  };
}

// C5 归因 turn 层：会话内逐 turn 分解（session 复合索引寻址，会话内天然小
// 集合，无窗口参数——与 session 层窗口语义解耦，规格 §2.3 level=turn 形态）。
// model_calls=COUNT(*)（model 行数）、tool_calls=SUM(tool_call_count)
//（model_usage 逐行携带）。含 session_title 等 side call 行（turn_id 归属该
// turn）——与 session 层总量可对账；turn_usage 直读反而是缺 side call 的下界
//（见 sessionTurns 头注）。
function usageAttributionByTurn(sessionId, limit = 50) {
  const lim = attrLimit(limit);
  // schema source: zai-org/ZCode MIG 0010_usage_observability + USAGE queryAppUsage
  const page = db().prepare(`
    SELECT turn_id,
           SUM(computed_total_tokens) AS tokens,
           SUM(duration_ms)           AS duration_ms_sum,
           COUNT(*)                   AS model_calls,
           SUM(tool_call_count)       AS tool_calls
    FROM model_usage
    WHERE session_id = ?
    GROUP BY turn_id
    ORDER BY tokens DESC
    LIMIT ?
  `).all(sessionId, lim + 1);
  const truncated = page.length > lim;
  if (truncated) page.length = lim;
  return { rows: page, truncated };
}

// ───────────────────────── Context gauge ─────────────────────────
// C2 上下水位查询族（ecosystem-round2-batch1 §2.2）：会话内 token 序列。
// 口径钉（§2.0 勘误的执行义务——db 层返回原始三列，不预判回退）：
//   - 水位分子 = 逐行 input_tokens（官方语义 input 已含 cache_read——Overview
//     区头注；照抄上游「input+cache_read+cache_creation 累计」会 ≈2 倍虚高）；
//     input_tokens=0 的行（error/cancelled 全零行）回退官方 fallback
//     cache_creation+cache_read（USAGE inputSideTokensFromNormalizedUsage）。
//     回退计算在 T7 组件纯函数做（live 行缺列形态也由那边判空），本层只返回
//     原始三列。
//   - query_source='compact' 行即 compaction 边界（30d 窗实测 341 行，§9-3）；
//     边界标记 compact_boundary 由路由层判定。
//   - 窗口值（context_tokens）不经本层——路由层经 server/models-meta.js resolve
//     附带（未知模型 null），前端不持有模型窗口表（窗口值唯一通路）。
// 性能（红线 2）：WHERE session_id = ? 走 session 索引（sessionTurns 同款；
// fixture 对应 idx_model_usage_session），会话内小集合 + 小排序，无整表物化
// 风险。真实库 EXPLAIN/计时照录 docs/acceptance/round2-batch1-explain-timing.md。
function contextGaugeRows(sessionId, limit = 100) {
  // 方向钉（本仓首次引入会话内序列 limit）：ORDER BY started_at DESC LIMIT ?
  // 取最新端 → JS 反转为 ASC 返回。ASC+LIMIT 直取会错取会话最旧端——长会话
  // 超 100 行常态（真实库 model_usage 40 万行），截错端则 live 水位种子停在
  // 远古、SSE 只推 connect 后新行、中间段永久缺失。limit 由路由层 clampLimit
  // 钳界后传入；此处 attrLimit 兜底直调（负/NaN → 1，Usage attribution 区的
  // 同款防线）。
  // schema source: zai-org/ZCode MIG 0010_usage_observability（model_usage 逐行）
  const rows = db().prepare(`
    SELECT started_at, turn_id, model_id, query_source,
           input_tokens, cache_read_input_tokens, cache_creation_input_tokens
    FROM model_usage
    WHERE session_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(sessionId, attrLimit(limit));
  return rows.reverse().map(r => ({ ...r, started_at: ts(r.started_at) }));
}

module.exports = {
  DB_PATH, LOG_DIR, ROLLOUT_DIR,
  db, warmDb, invalidateDb,
  makeRetryingStatement, isBusyErr, isConnBroken, // 测试缝（R4 修-low）：导出供直测，不改变运行时行为
  ts, j, startOfDayMs,
  overviewKpis, timeseries, breakdownByModel, breakdownByTool,
  overviewSpeed, recentSpeed, completedSince, todayUsage,
  sessionList, sessionGet, sessionTurns, sessionConversation,
  sessionActivity, sessionChildren, sessionReasoning,
  errorsList, errorSummary, slowTools, SLOW_TOOLS_CANDIDATE_CAP_ROWS,
  recentModelRowsAfterRowid, latestModelRowid,
  recentToolRowsAfterRowid, latestToolRowid,
  agentsForest,
  usageTurnsSummary, usageTurnTimeline, usageToolBreakdown,
  usageAttributionBySession, usageAttributionByTurn,
  USAGE_CANDIDATE_CAP_ROWS, // 规模钳制口径常量（路由 meta 注明 scope 用，slow_tools_scope 先例）
  contextGaugeRows,
};
