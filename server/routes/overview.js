'use strict';
// routes/overview.js
const express = require('express');
const dbq = require('../db');
const { firstParam } = require('../http-hardening');

const router = express.Router();

// GET /api/overview?window=24h|7d|today
// window 经 firstParam 归一（第 3 轮安全席 SEC-R3-001，main 既有同族收口）：
// 数组形态此前把原始数组回显进响应 window 字段（形状类型漂移），bracket/
// 对象形态落 '' 回缺省档。
router.get('/', (req, res) => {
  const window = firstParam(req.query.window) || '24h';
  let sinceMs;
  if (window === 'today') {
    sinceMs = dbq.startOfDayMs();
  } else if (window === '7d') {
    sinceMs = Date.now() - 7 * 86400_000;
  } else { // 24h
    sinceMs = Date.now() - 24 * 3600_000;
  }
  const kpis = dbq.overviewKpis(sinceMs);
  const series = dbq.timeseries(window === '7d' ? 24 * 7 : 24);
  res.json({
    window,
    since: kpis.since,
    kpis,
    series,
    by_model: dbq.breakdownByModel(sinceMs),
    by_tool: dbq.breakdownByTool(sinceMs),
    speed: dbq.overviewSpeed(sinceMs),
    recent_speed: dbq.recentSpeed(sinceMs, 50),
  });
});

module.exports = router;
