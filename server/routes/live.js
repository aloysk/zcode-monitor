'use strict';
// routes/live.js — Server-Sent Events stream of newly observed model/tool rows.
// Polls the SQLite DB every second for rows newer than the last-seen
// started_at, and forwards them to connected clients.
const express = require('express');
const dbq = require('../db');
const log = require('../log-tail');

const router = express.Router();

let lastModelStartedAt = Date.now();
let lastToolStartedAt = Date.now();

// refresh the watermark so we only stream rows created after server start
(function init() {
  try {
    const m = dbq.recentModelRows(0, 1)[0];
    const t = dbq.recentToolRows(0, 1)[0];
    if (m && m.started_at) lastModelStartedAt = new Date(m.started_at).getTime();
    if (t && t.started_at) lastToolStartedAt = new Date(t.started_at).getTime();
  } catch {}
})();

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
