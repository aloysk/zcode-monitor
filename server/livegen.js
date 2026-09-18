'use strict';
// server/livegen.js — generation-state engine for the widget stack.
//
// The token-speed pill shows exact official tps, but that number only updates
// when a request COMPLETES — during a long generation the pill looks frozen.
// This module supplies the missing boolean signal, "is ZCode generating right
// now", polled from the `message` table, and emits start/end edge events that
// drive the pill's breathing animation.
//
// v1 is deliberately boolean-only: probes showed the DB has no live text
// stream while a request is in flight (message.data is metadata, ~650 bytes,
// no content), so tps estimation is out of scope. The poll/event shape is
// kept estimator-friendly (per-session counts + a single reused statement) so
// one can be layered in later without changing consumers.
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
const EventEmitter = require('events');

const POLL_MS = 1000;
const CREATED_WINDOW_MS = 5 * 60 * 1000;
const UPDATED_WINDOW_MS = 90 * 1000;
const ERROR_LOG_INTERVAL_MS = 30 * 1000;

// One statement, reused every tick. db.js may drop and reopen the underlying
// connection on damage (invalidateDb), which would orphan a cached statement —
// so we key the cache on the raw handle's identity and re-prepare only when
// the facade swapped it. Steady state keeps a single prepared statement.
const SQL = `
  SELECT COUNT(*)                   AS inflight,
         COUNT(DISTINCT session_id) AS sessions
  FROM message
  WHERE json_extract(data, '$.role') = 'assistant'
    AND json_extract(data, '$.time.completed') IS NULL
    AND time_created > ?
    AND time_updated > ?
`;

function createGenWatcher(dbq, { pollMs = POLL_MS } = {}) {
  const emitter = new EventEmitter();

  let generating = false; // edge-detector memory: last observed boolean
  let sessions = 0;       // distinct sessions currently in flight
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
    const nowGenerating = (row.inflight || 0) > 0;

    // Edge detection: emit ONLY on boolean transitions, not every tick. A
    // second session joining an ongoing generation is not an edge; its count
    // still shows up via state() for snapshot consumers.
    if (nowGenerating && !generating) {
      emitter.emit('gen', { phase: 'start', sessions, at: Date.now() });
    } else if (!nowGenerating && generating) {
      // count just dropped to 0, so the end event carries only the timestamp
      emitter.emit('gen', { phase: 'end', at: Date.now() });
    }
    generating = nowGenerating;
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
    state() { return { generating, sessions }; },
    stop() { stopped = true; clearInterval(timer); },
  };
}

module.exports = { createGenWatcher };
