'use strict';
// routes/trace.js — error aggregation + trace/span waterfall reconstruction
const express = require('express');
const dbq = require('../db');
const log = require('../log-tail');

const router = express.Router();

// GET /api/trace/errors?window=24h&kind=both&limit=200
router.get('/errors', (req, res) => {
  const window = req.query.window || '24h';
  let sinceMs = null;
  if (window === 'today') sinceMs = dbq.startOfDayMs();
  else if (window === '24h') sinceMs = Date.now() - 24 * 3600_000;
  else if (window === '7d') sinceMs = Date.now() - 7 * 86400_000;
  // 'all' → null
  res.json({
    window,
    summary: dbq.errorSummary(sinceMs),
    items: dbq.errorsList({
      sinceMs, kind: req.query.kind || 'both',
      limit: Math.min(+req.query.limit || 200, 1000),
    }),
  });
});

// GET /api/trace/slow-tools?window=24h&limit=50
router.get('/slow-tools', (req, res) => {
  const window = req.query.window || '24h';
  let sinceMs = null;
  if (window === 'today') sinceMs = dbq.startOfDayMs();
  else if (window === '24h') sinceMs = Date.now() - 24 * 3600_000;
  else if (window === '7d') sinceMs = Date.now() - 7 * 86400_000;
  res.json({ items: dbq.slowTools({
    sinceMs, limit: Math.min(+req.query.limit || 50, 500),
  }) });
});

// GET /api/trace/logs/tail?lines=200
router.get('/logs/tail', async (req, res) => {
  const lines = Math.min(+req.query.lines || 200, 2000);
  const events = await log.tailLog({ lines });
  res.json({ events });
});

// GET /api/trace/trace/:traceId — reconstruct span forest from logs
router.get('/trace/:traceId', async (req, res) => {
  const { traceId } = req.params;
  const events = await log.eventsForTrace(traceId);
  const forest = log.buildSpanForest(events);
  res.json({ traceId, events, forest });
});

module.exports = router;
