'use strict';
// routes/live.js — Server-Sent Events stream of newly observed model/tool rows.
// Polls the SQLite DB every second for rows newer than the last-seen
// started_at, and forwards them to connected clients.
// Each connection owns its watermark: a module-level shared one made
// concurrent clients split the stream (each poll consumed rows the other
// never saw), and initializing it must use MAX(started_at) — an
// ASC/LIMIT-1 lookup seeded the oldest row and replayed the entire table
// (~269k rows, ~1h at the 100-rows/1.5s poll cap) after every server boot.
const express = require('express');
const dbq = require('../db');
const log = require('../log-tail');

const router = express.Router();

// track last log size so we can tail forward
let lastLogSize = 0;
let currentLogFile = log.todayLogFile();

router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  // per-connection watermarks, starting at the newest observed row so only
  // traffic after THIS connect streams
  let lastModelStartedAt = dbq.latestModelStartedAt();
  let lastToolStartedAt = dbq.latestToolStartedAt();

  const heartbeat = setInterval(() => res.write(': hb\n\n'), 25000);

  // poll DB
  const poll = setInterval(() => {
    try {
      const models = dbq.recentModelRows(lastModelStartedAt, 100);
      const tools = dbq.recentToolRows(lastToolStartedAt, 100);
      for (const m of models) {
        const t = new Date(m.started_at).getTime();
        if (t > lastModelStartedAt) lastModelStartedAt = t;
        res.write(`event: model\ndata: ${JSON.stringify(m)}\n\n`);
      }
      for (const t of tools) {
        const tt = new Date(t.started_at).getTime();
        if (tt > lastToolStartedAt) lastToolStartedAt = tt;
        res.write(`event: tool\ndata: ${JSON.stringify(t)}\n\n`);
      }
    } catch (e) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
    }
  }, 1500);

  req.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(poll);
  });
});

module.exports = router;
