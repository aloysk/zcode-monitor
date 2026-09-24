'use strict';
// routes/usage.js — /api/usage 族三端点（ecosystem-round2-batch1 T3：
// C1 窗口级回合/工具统计 + C5 token 归因，规格 §2.1/§2.3）。
// 工厂形态（makeHealthRoute / makeErrorTranslator 先例）：retentionDays 经
// opts 注入可测（缺省 30=本机实测值；上游 USAGE_RETENTION_DAYS 是 ZCode 侧
// 可配置项，本仓不读其配置文件——响应 meta 只回显本仓常量）。
// 路由只消费 db.js「Usage attribution」分节的 T2 查询族，不在路由层重复聚合。
// 响应公共头（window/since/meta.retention_days）由下方 resolveWindow 唯一
// 装配——口径标注义务（窗口读数上限即 30 天保留窗）覆盖本族全部端点。
const express = require('express');
const dbq = require('../db');
const { clampLimit } = require('../http-hardening');

// 宽窗（30d 档）候选钳制副作用的 meta 申报（slow_tools_scope 先例）：db 层对
// >7d 窗的 tool/attribution session 层查询启用 rowid 尾部候选集上界
// （USAGE_CANDIDATE_CAP_ROWS；启用依据与实测数字见 db.js 分节头注及
// docs/acceptance/round2-batch1-explain-timing.md）——读数上限=最新 cap 行，
// 如实注明不静默。值域内 24h/7d 走 started_at 索引精确窗口，无此副作用；
// turn_usage 与 attribution turn 层不启用钳制（会话内天然小集合）。
function wideWindowScope(window) {
  return window === '30d'
    ? { scope: `recent_30d_capped_${dbq.USAGE_CANDIDATE_CAP_ROWS}_rows` }
    : {};
}

function makeUsageRouter({ retentionDays = 30 } = {}) {
  const router = express.Router();

  // ── 共享 helper：窗口解析 + 响应公共头（本族三端点统一消费的唯一装配点）──
  // 值域 24h|7d|30d，默认 24h、未知值回退 24h且回显 '24h'。
  // 与 server/routes/overview.js:8-18 的路由内联窗口解析是两套值域（本族含
  // 30d=完整保留窗、不含 today）——overview 既有内联不动，不越界改既有路由。
  // sinceMs 供端点喂给 T2 查询；head 即响应公共头（since 为 ISO 时间）。
  function resolveWindow(q) {
    const w = q && q.window;
    const known = w === '7d' || w === '30d';
    const window = known ? w : '24h';
    const sinceMs = w === '7d' ? Date.now() - 7 * 86400_000
                  : w === '30d' ? Date.now() - 30 * 86400_000
                  : Date.now() - 24 * 3600_000; // 默认/未知（含 today 等外族值）→ 24h
    return {
      sinceMs, window,
      head: { window, since: new Date(sinceMs).toISOString(), meta: { retention_days: retentionDays } },
    };
  }

  // GET /turns?window=&limit= — C1 回合健康度窗口聚合 + 逐回合时间线。
  // timeline 行数钳界 100/500（sessions.js:48 同款二元组；helper 语义
  // http-hardening.js:83-91——负值钳 1、0/NaN 回落缺省、超上限钳 max）。
  router.get('/turns', (req, res) => {
    const { sinceMs, head } = resolveWindow(req.query);
    const s = dbq.usageTurnsSummary(sinceMs);
    res.json({
      ...head,
      totals: s.totals,
      by_error_type: s.by_error_type,
      by_error_type_truncated: s.by_error_type_truncated,
      timeline: dbq.usageTurnTimeline(sinceMs, clampLimit(req.query.limit, 100, 500)),
    });
  });

  // GET /tools?window= — C1 工具维度分档。tool_name 为有限枚举 → 全量基数，
  // 无 limit 参数、无整表物化风险（T2 查询头注）。
  router.get('/tools', (req, res) => {
    const { sinceMs, window, head } = resolveWindow(req.query);
    res.json({
      ...head,
      meta: { ...head.meta, ...wideWindowScope(window) },
      groups: dbq.usageToolBreakdown(sinceMs),
    });
  });

  // GET /attribution?window=&level=&limit=&session_id= — C5 token 归因两级。
  // level=session（默认；未知值同回退）或 level=turn；turn 层缺 session_id →
  // 400（计划拍板：下钻必须有锚）。空窗口 → 空数组 + meta，不抛错。
  // 行数两级同档：50/200。截断经 meta.truncated 如实标注（诚实原则）。
  router.get('/attribution', (req, res) => {
    const level = req.query.level === 'turn' ? 'turn' : 'session';
    if (level === 'turn' && !req.query.session_id) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'level=turn 需要 session_id（下钻必须有锚）。',
      });
    }
    const { sinceMs, window, head } = resolveWindow(req.query);
    const limit = clampLimit(req.query.limit, 50, 200);
    // turn 层是会话内查询（无窗口语义、无钳制）；session 层宽窗才有 scope 申报。
    let rows, truncated, scope = {};
    if (level === 'turn') {
      ({ rows, truncated } = dbq.usageAttributionByTurn(req.query.session_id, limit));
    } else {
      scope = wideWindowScope(window);
      ({ rows, truncated } = dbq.usageAttributionBySession(sinceMs, limit));
    }
    res.json({
      ...head,
      meta: { ...head.meta, ...scope, truncated },
      level, rows,
    });
  });

  return router;
}

module.exports = { makeUsageRouter };
