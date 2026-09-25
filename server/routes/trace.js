'use strict';
// routes/trace.js — error aggregation + trace/span waterfall reconstruction
const express = require('express');
const dbq = require('../db');
const log = require('../log-tail');
const { clampLimit, firstParam } = require('../http-hardening');

const router = express.Router();

// GET /api/trace/errors?window=24h&kind=both&limit=200
// window/kind 经 firstParam 归一（四席全量审查第 2 轮）：数组形态此前静默
// 落 'all' 全窗聚合（errors 端最重路径）或空结果——不是 500 但行为失真。
router.get('/errors', (req, res) => {
  const window = firstParam(req.query.window) || '24h';
  let sinceMs = null;
  if (window === 'today') sinceMs = dbq.startOfDayMs();
  else if (window === '24h') sinceMs = Date.now() - 24 * 3600_000;
  else if (window === '7d') sinceMs = Date.now() - 7 * 86400_000;
  // 'all' → null
  res.json({
    window,
    summary: dbq.errorSummary(sinceMs),
    items: dbq.errorsList({
      sinceMs, kind: firstParam(req.query.kind) || 'both',
      limit: clampLimit(req.query.limit, 200, 1000),
    }),
  });
});

// GET /api/trace/slow-tools?window=24h&limit=50
router.get('/slow-tools', (req, res) => {
  const window = firstParam(req.query.window) || '24h';
  let sinceMs = null;
  let meta;
  if (window === 'today') sinceMs = dbq.startOfDayMs();
  else if (window === '24h') sinceMs = Date.now() - 24 * 3600_000;
  else if (window === '7d') sinceMs = Date.now() - 7 * 86400_000;
  else {
    // 'all'：无界 ORDER BY duration_ms DESC 是全表扫 + TEMP B-TREE 排序（性能
    // 红线，真实库 tool_usage 52.3万行实测热态 235ms）。R5 起不再只在路由层钳
    // 30d 时间窗——真实库时间跨度恰好 30.0d 时窗口不裁任何行（实测 254-315ms
    // 无实质改善）。改为传 null 给 dbq.slowTools，由其在查询层做「时间窗语义
    // 口径 + rowid 尾部候选集规模钳制」双保险（见 db.js slowTools 头注），meta
    // 如实注明实际口径。
    sinceMs = null;
    meta = { slow_tools_scope: `recent_30d_capped_${dbq.SLOW_TOOLS_CANDIDATE_CAP_ROWS}_rows` };
  }
  const out = { items: dbq.slowTools({
    sinceMs, limit: clampLimit(req.query.limit, 50, 500),
  }) };
  if (meta) out.meta = meta;
  res.json(out);
});

// GET /api/trace/logs/tail?lines=200
// lines 双侧钳界（第 3 轮安全席观察项收口，clampLimit 家族语义）：旧形态
// Math.min(+lines || 200, 2000) 无下界——?lines=-5 产出负数行静默空 events；
// 数组/对象形态经 clampLimit 的 Number 化天然回落缺省。
router.get('/logs/tail', async (req, res) => {
  const lines = clampLimit(req.query.lines, 200, 2000);
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
