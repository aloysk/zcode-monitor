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

// KPI cards. `sinceMs` = window start (epoch ms). Counts/tokens/latency over
// model_usage + tool_usage within the window.
function overviewKpis(sinceMs) {
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

  const sessions = db().prepare(`
    SELECT COUNT(DISTINCT session_id) AS active_sessions
    FROM model_usage
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
      output: m.out_tok || 0,
      reasoning: m.reason_tok || 0,
      reasoning_ratio: reasonRatio,
      cache_read: m.cache_read || 0,
      cache_write: m.cache_write || 0,
    },
    active_sessions: sessions.active_sessions || 0,
  };
}

// Time-series: requests + tokens bucketed by hour, for the last `hours` hours.
function timeseries(hours = 24) {
  const since = startOfDayMs() - (24 - new Date().getHours()) * 3600_000 - (hours - 24) * 3600_000;
  // Simpler: just compute since = now - hours*3600_000
  const sinceMs = Date.now() - hours * 3600_000;
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
// Mirrors the token-speed-monitor project's metric, computed from the
// same model_usage table. We aggregate raw sums and do the division in
// JS to avoid floating-point drift inside SQLite, and to keep the
// weighted average (= Σtokens / Σseconds) instead of mean(per-request tps).
//
// Caliber decisions (see design.md D1–D3):
//   - numerator: output_tokens + reasoning_tokens (reasoning counts as
//     generated throughput, same caliber as token-speed-monitor).
//   - denominator: duration_ms total (incl. TTFT). Per-request TTFT is
//     only available at turn_usage granularity, not per model call.
//   - weighted average = Σtokens / Σseconds (token-weighted), NOT
//     mean(tok/s) — long requests dominate, reflecting real throughput.

function overviewSpeed(sinceMs) {
  const m = db().prepare(`
    SELECT SUM(output_tokens + COALESCE(reasoning_tokens, 0)) AS total_tokens,
           SUM(duration_ms)                                    AS total_ms,
           COUNT(*)                                            AS request_count,
           SUM(CASE WHEN query_source='main_turn' THEN 1 END) AS main_count,
           SUM(CASE WHEN query_source='subagent'  THEN 1 END) AS subagent_count
    FROM model_usage
    WHERE status = 'completed'
      AND duration_ms > 0
      AND started_at >= @since
  `).get({ since: sinceMs });

  const totalTokens = m.total_tokens || 0;
  const totalSeconds = m.total_ms ? m.total_ms / 1000 : 0;
  return {
    weighted_tps: totalSeconds > 0 ? +(totalTokens / totalSeconds).toFixed(1) : null,
    total_tokens: totalTokens,
    total_seconds: +totalSeconds.toFixed(1),
    request_count: m.request_count || 0,
    main_count: m.main_count || 0,
    subagent_count: m.subagent_count || 0,
  };
}

// Per-request speed detail for the recent-speed table + scatter/line chart.
// id is exposed so the widget can dedup its SSE stream against seed re-fetches.
// Returns newest first. tps is null when duration_ms <= 0 (not shown).
function recentSpeed(sinceMs, limit = 50) {
  const rows = db().prepare(`
    SELECT id,
           started_at,
           model_id,
           output_tokens,
           COALESCE(reasoning_tokens, 0) AS reasoning_tokens,
           duration_ms,
           query_source
    FROM model_usage
    WHERE status = 'completed'
      AND duration_ms > 0
      AND started_at >= @since
    ORDER BY started_at DESC
    LIMIT @limit
  `).all({ since: sinceMs, limit });
  return rows.map(r => {
    const tps = r.duration_ms > 0
      ? +((r.output_tokens + r.reasoning_tokens) / (r.duration_ms / 1000)).toFixed(1)
      : null;
    return {
      id: r.id,
      time: ts(r.started_at),
      model: r.model_id,
      output: r.output_tokens || 0,
      reasoning: r.reasoning_tokens || 0,
      duration_ms: r.duration_ms,
      tps,
      query_source: r.query_source,
    };
  });
}

// Exact rolling-window population for the floating widget: completed requests
// whose COMPLETION time (started_at + duration_ms) falls inside the window.
// No LIMIT cap — recentSpeed's 50-row cap under-seeds busy windows (65+
// completions per 5 min observed under parallel subagents), which skews the
// widget's weighted aggregate. Payload stays tiny (window-sized).
function completedSince(sinceMs) {
  return db().prepare(`
    SELECT id,
           started_at,
           duration_ms,
           output_tokens,
           COALESCE(reasoning_tokens, 0) AS reasoning_tokens
    FROM model_usage
    WHERE status = 'completed'
      AND duration_ms > 0
      AND started_at + duration_ms >= @since
    ORDER BY started_at ASC
  `).all({ since: sinceMs }).map(r => ({
    id: r.id,
    time: ts(r.started_at),
    output: r.output_tokens || 0,
    reasoning: r.reasoning_tokens || 0,
    duration_ms: r.duration_ms,
  }));
}

// Newest started_at per table — SSE watermark init. recentModelRows orders
// ASC, so an "ORDER BY ... LIMIT 1" init picks the OLDEST row and replays the
// whole table on every server boot; MAX() must be explicit.
function latestModelStartedAt() {
  return db().prepare('SELECT MAX(started_at) AS m FROM model_usage').get().m || 0;
}

function latestToolStartedAt() {
  return db().prepare('SELECT MAX(started_at) AS m FROM tool_usage').get().m || 0;
}

// ───────────────────────── Sessions ─────────────────────────

function sessionList({ limit = 100, offset = 0, q = '', taskType = '', status = '' } = {}) {
  const where = [];
  const params = { limit, offset };
  if (q) { where.push('(title LIKE @q OR id LIKE @q)'); params.q = `%${q}%`; }
  if (taskType) { where.push('task_type = @taskType'); params.taskType = taskType; }
  // status filter applied on latest activity's existence
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db().prepare(`
    SELECT s.id, s.title, s.task_type, s.directory,
           s.parent_id,
           s.time_created, s.time_updated,
           (SELECT COUNT(*) FROM model_usage m WHERE m.session_id = s.id) AS model_calls,
           (SELECT COUNT(*) FROM tool_usage  t WHERE t.session_id = s.id) AS tool_calls,
           (SELECT SUM(m.computed_total_tokens) FROM model_usage m WHERE m.session_id = s.id) AS total_tokens
    FROM session s
    ${whereSql}
    ORDER BY s.time_updated DESC
    LIMIT @limit OFFSET @offset
  `).all(params);
}

function sessionGet(id) {
  return db().prepare(`SELECT * FROM session WHERE id = ?`).get(id) || null;
}

// Turn timeline for a session: one row per turn with aggregated metrics.
function sessionTurns(id) {
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
function slowTools({ sinceMs = null, limit = 50 } = {}) {
  const where = sinceMs ? 'WHERE started_at >= @since' : '';
  return db().prepare(`
    SELECT id, session_id, turn_id, tool_call_id, tool_name, status,
           started_at, duration_ms, exit_code,
           substr(COALESCE(error_message,''),1,160) AS err
    FROM tool_usage ${where}
    ORDER BY duration_ms DESC LIMIT @limit
  `).all({ since: sinceMs, limit }).map(r => ({ ...r, started_at: ts(r.started_at) }));
}

// ───────────────────────── Live tail ─────────────────────────

// For SSE: rows newer than the given id (primary key ordering via started_at+rowid).
function recentModelRows(afterStartedAt, limit = 50) {
  return db().prepare(`
    SELECT id, session_id, turn_id, trace_id, status, started_at, duration_ms,
           query_source, model_id, variant, mode, agent,
           input_tokens, output_tokens, reasoning_tokens, tool_call_count,
           error_type
    FROM model_usage
    WHERE started_at > ?
    ORDER BY started_at ASC
    LIMIT ?
  `).all(afterStartedAt, limit).map(r => ({ ...r, started_at: ts(r.started_at) }));
}

function recentToolRows(afterStartedAt, limit = 50) {
  return db().prepare(`
    SELECT id, session_id, turn_id, trace_id, tool_call_id, tool_name, status,
           started_at, duration_ms, exit_code, error_type
    FROM tool_usage
    WHERE started_at > ?
    ORDER BY started_at ASC
    LIMIT ?
  `).all(afterStartedAt, limit).map(r => ({ ...r, started_at: ts(r.started_at) }));
}

// ───────────────────────── Agents tree ─────────────────────────
// Build a forest of sessions rooted at interactive/main sessions, with their
// subagent children (parent_id chain) underneath.
function agentsForest({ projectId = null } = {}) {
  const where = projectId ? 'WHERE project_id = ?' : '';
  const bind = projectId ? [projectId] : [];
  const sessions = db().prepare(
    `SELECT id, title, task_type, parent_id, directory,
            time_created, time_updated,
            (SELECT SUM(computed_total_tokens) FROM model_usage m WHERE m.session_id = s.id) AS tokens,
            (SELECT COUNT(*) FROM model_usage m WHERE m.session_id = s.id) AS model_calls,
            (SELECT COUNT(*) FROM tool_usage  t WHERE t.session_id = s.id) AS tool_calls
     FROM session s ${where}`).all(...bind);
  // build map + forest
  const byId = new Map();
  for (const s of sessions) {
    byId.set(s.id, { ...s, children: [], time_created: ts(s.time_created), time_updated: ts(s.time_updated) });
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

module.exports = {
  DB_PATH, LOG_DIR, ROLLOUT_DIR,
  db, warmDb, invalidateDb,
  ts, j, startOfDayMs,
  overviewKpis, timeseries, breakdownByModel, breakdownByTool,
  overviewSpeed, recentSpeed, completedSince,
  sessionList, sessionGet, sessionTurns, sessionConversation,
  sessionActivity, sessionChildren, sessionReasoning,
  errorsList, errorSummary, slowTools,
  recentModelRows, recentToolRows, latestModelStartedAt, latestToolStartedAt,
  agentsForest,
};
