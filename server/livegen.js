'use strict';
// server/livegen.js — generation-state engine for the widget stack.
//
// The token-speed pill shows exact official tps, but that number only updates
// when a request COMPLETES — during a long generation the pill looks frozen.
// This module supplies the missing boolean signal, "is ZCode generating right
// now", polled from the `message` table, and emits start/end edge events that
// drive the pill's breathing animation.
//
// v1 was deliberately boolean-only; the poll/event shape kept per-session
// counts + a single reused statement so a lane counter could be layered in
// without changing consumers — that counter is live now: 'start'/'lanes'
// events and state() carry `sessions` (distinct in-flight sessions = the
// concurrent "lanes" the widget shows as ×N) and `inflight` (in-flight
// assistant-message rows, ≥ sessions).
//
// In-flight detection: an assistant message row is in-flight while
// json_extract(data,'$.time.completed') IS NULL; completion writes that field.
// A bare completed-NULL check over-reports because aborted/ignored requests
// leave STALE in-flight rows that linger for minutes (152s observed). Two
// hygiene windows cut those zombies (values verified against the live DB:
// without them the raw count showed 147 stale rows vs 1 real generation):
//   - time_created > now-5min: a real model request finishes well inside 5
//     minutes; an older never-completed assistant row is a zombie, not a turn.
//   - time_updated > now-90s: ZCode keeps touching time_updated while the row
//     is being driven; 90s of silence means nothing is writing it anymore.
//
// Tool-failure edges (T5): the same tick also watermark-scans the newest
// tool_usage rows (recentToolRows hits the tool_usage_started_tool_idx —
// real-DB EXPLAIN: SEARCH ... (started_at>?), no table scan) and emits
// phase:'tool_error' for rows with status='error'. Consumers: the gen SSE
// (/api/gen/events forwards any emitter event verbatim) drives the desktop
// pet's failed animation; state() carries lastToolError for pollers. Boot
// watermark = MAX(started_at), so historical errors are never replayed.
const EventEmitter = require('events');

const POLL_MS = 1000;
const CREATED_WINDOW_MS = 5 * 60 * 1000;
const UPDATED_WINDOW_MS = 90 * 1000;
const ERROR_LOG_INTERVAL_MS = 30 * 1000;

// One statement, reused every tick. db.js may drop and reopen the underlying
// connection on damage (invalidateDb), which would orphan a cached statement —
// so we key the cache on the raw handle's identity and re-prepare only when
// the facade swapped it. Steady state keeps a single prepared statement.
//
// The rowid tail bound is LOAD-BEARING: message has NO index on time_created
// (only session_id-led composites), so the time filters alone full-scan the
// 14.6GB / 635k-row table at ~2.4s per poll — at 1 Hz that permanently
// blocked node's event loop (observed: static sprite downloads stalling
// mid-stream, /api/gen/state answering in 2.8s, pack switches rendering
// blank). Rows are appended chronologically, and the hygiene windows above
// mean only the newest rows can possibly qualify, so scanning the last 8000
// rowids (MAX(rowid) is O(1)) yields identical counts in ~18ms.
const SQL = `
  SELECT COUNT(*)                   AS inflight,
         COUNT(DISTINCT session_id) AS sessions
  FROM message
  WHERE rowid > (SELECT MAX(rowid) FROM message) - 8000
    AND json_extract(data, '$.role') = 'assistant'
    AND json_extract(data, '$.time.completed') IS NULL
    AND time_created > ?
    AND time_updated > ?
`;

function createGenWatcher(dbq, { pollMs = POLL_MS } = {}) {
  const emitter = new EventEmitter();

  let generating = false; // edge-detector memory: last observed boolean
  let sessions = 0;       // distinct sessions currently in flight
  let inflight = 0;       // in-flight assistant rows (≥ sessions)
  let lastSessions = 0;   // last value emitted to consumers (lane-change memory)
  // tool-error watermark: newest tool_usage.started_at already inspected
  // (epoch ms, same unit as the ts()-mapped rows once Date.parse'd). MAX at
  // boot = no historical replay; on failure fall back to "now" so a broken
  // boot can never replay old errors (watermark 0 would rescan from ASC head).
  let lastErrStartedAt = (() => {
    try { return dbq.latestToolStartedAt(); } catch { return Date.now(); }
  })();
  let lastToolError = null; // { tool, at } — newest observed failure, for state()
  let stopped = false;
  let lastErrorLogAt = 0;

  // prepared-statement cache, invalidated when db.js swaps the connection
  let stmt = null;
  let stmtRaw = null;
  function statement() {
    const conn = dbq.db();
    if (!stmt || conn._raw !== stmtRaw) {
      stmt = conn.prepare(SQL);
      stmtRaw = conn._raw;
    }
    return stmt;
  }

  function tick() {
    if (stopped) return;
    let row;
    try {
      const now = Date.now();
      row = statement().get(now - CREATED_WINDOW_MS, now - UPDATED_WINDOW_MS);
    } catch (e) {
      // Transient failure (SQLITE_BUSY mid-write, connection damage): skip
      // this tick and keep the last known state. A missed poll must never
      // crash the server nor fabricate a false 'end' edge. Log rate-limited
      // so a persistently busy DB can't spam once per second.
      if (Date.now() - lastErrorLogAt >= ERROR_LOG_INTERVAL_MS) {
        lastErrorLogAt = Date.now();
        console.error(`[livegen] poll failed (tick skipped): ${e.message}`);
      }
      return;
    }

    sessions = row.sessions || 0;
    inflight = row.inflight || 0;
    const nowGenerating = inflight > 0;

    // Tool-failure edge scan: same started_at watermark + ASC LIMIT pattern as
    // routes/live.js. Strictly-increasing watermark means several failures in
    // the SAME millisecond collapse into one — a best-effort visual signal,
    // accepted truncation (comment kept per plan). The scan sits outside the
    // main query's try/catch, so it carries its own guard: a busy/damaged DB
    // must skip the tick, not crash the poll interval (watermark untouched →
    // the rows are simply retried next tick).
    try {
      for (const r of dbq.recentToolRows(lastErrStartedAt, 50)) {
        const t = Date.parse(r.started_at);
        if (!(t > lastErrStartedAt)) continue; // null/NaN started_at: skip, keep watermark
        if (r.status === 'error') {
          lastToolError = { tool: r.tool_name, at: Date.now() };
          emitter.emit('gen', { phase: 'tool_error', tool: r.tool_name,
            session: r.session_id, at: Date.now() });
        }
        lastErrStartedAt = t;
      }
    } catch (e) {
      if (Date.now() - lastErrorLogAt >= ERROR_LOG_INTERVAL_MS) {
        lastErrorLogAt = Date.now();
        console.error(`[livegen] tool-error scan failed (tick skipped): ${e.message}`);
      }
    }

    // Edge detection: boolean transitions stay pure edges (start/end). A
    // lane-count CHANGE while generating is its own 'lanes' event — the
    // widget's ×N badge must move the moment a session joins or leaves an
    // ongoing generation, not only at the next boolean edge.
    if (nowGenerating && !generating) {
      emitter.emit('gen', { phase: 'start', sessions, inflight, at: Date.now() });
    } else if (!nowGenerating && generating) {
      // count just dropped to 0, so the end event carries only the timestamp
      emitter.emit('gen', { phase: 'end', at: Date.now() });
    } else if (nowGenerating && sessions !== lastSessions) {
      emitter.emit('gen', { phase: 'lanes', sessions, inflight, at: Date.now() });
    }
    generating = nowGenerating;
    lastSessions = nowGenerating ? sessions : 0;
  }

  // Establish the baseline immediately so state() is correct right after boot
  // (index.js reads it to seed freshly connected SSE clients).
  tick();

  // unref'd: the poll must never keep the process alive by itself (the HTTP
  // server owns the lifetime); stop() clears it for explicit shutdown.
  const timer = setInterval(tick, pollMs);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    // Subscribe to start/end edge events; returns an unsubscribe function so
    // short-lived consumers (one SSE response) can detach on close.
    onEvent(cb) { emitter.on('gen', cb); return () => emitter.off('gen', cb); },
    state() { return { generating, sessions, inflight, lastToolError }; },
    stop() { stopped = true; clearInterval(timer); },
  };
}

module.exports = { createGenWatcher };
