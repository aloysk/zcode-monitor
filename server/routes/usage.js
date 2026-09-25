'use strict';
// routes/usage.js — /api/usage 族三端点（ecosystem-round2-batch1 T3：
// C1 窗口级回合/工具统计 + C5 token 归因，规格 §2.1/§2.3）。
// 工厂形态（makeHealthRoute / makeErrorTranslator 先例）：retentionDays 经
// opts 注入可测（缺省 30=本机实测值；上游 USAGE_RETENTION_DAYS 是 ZCode 侧
// 可配置项，本仓不读其配置文件——响应 meta 只回显本仓常量）。
// 路由只消费 db.js「Usage attribution」分节的 T2 查询族，不在路由层重复聚合。
// 响应公共头（window/since/meta.retention_days）由 server/routes/usage-window.js
// 的共享 resolveWindow 唯一装配（batch2 T8 结构性提取、行为零变更：闭包内实现
// 与模块级 wideWindowScope 移出，本文件薄委托；/api/export 同源消费同一
// helper）——口径标注义务（窗口读数上限即 30 天保留窗）覆盖本族全部端点。
const express = require('express');
const dbq = require('../db');
const { clampLimit, firstParam } = require('../http-hardening');
const { resolveWindow: sharedResolveWindow, wideWindowScope } = require('./usage-window');

function makeUsageRouter({ retentionDays = 30 } = {}) {
  const router = express.Router();

  // 窗口解析薄委托（提取重构的真正不变量）：调用点与返回值形状零改动。保持
  // 具名函数形态是既有源码契约钉——usage-routes「窗口解析具名函数仅一处定义」
  // 对本文件的计数断言（箭头薄委托会使计数归零而红）。
  function resolveWindow(q) {
    return sharedResolveWindow(q, retentionDays);
  }

  // GET /turns?window=&limit= — C1 回合健康度窗口聚合 + 逐回合时间线。
  // timeline 行数钳界 100/500（sessions.js:48 同款二元组；helper 语义
  // http-hardening.js:83-91——负值钳 1、0/NaN 回落缺省、超上限钳 max）。
  router.get('/turns', (req, res) => {
    const { sinceMs, head } = resolveWindow(req.query);
    const s = dbq.usageTurnsSummary(sinceMs);
    res.json({
      ...head,
      // 截断标注收敛 meta.*（F-码-5）：族内统一取法（attribution 先例
      // meta.truncated，消费面两套取法分裂）；顶层 by_error_type_truncated 为
      // 保留一个过渡期的兼容字段（前端已改读 meta.truncated，旧字段待下轮清理）。
      meta: { ...head.meta, truncated: s.by_error_type_truncated },
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
  // 字符串参数经 firstParam 归一（?k=a&k=b 的数组形态不再 500，取首值）。
  router.get('/attribution', (req, res) => {
    const level = firstParam(req.query.level) === 'turn' ? 'turn' : 'session';
    const sessionId = firstParam(req.query.session_id);
    if (level === 'turn' && !sessionId) {
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
      ({ rows, truncated } = dbq.usageAttributionByTurn(sessionId, limit));
    } else {
      scope = wideWindowScope(window);
      ({ rows, truncated } = dbq.usageAttributionBySession(sinceMs, limit));
    }
    // turn 层不带 window/since（F-码-5）：下钻层是会话内全量分解、无窗口语义
    // ——响应头携带窗口字段对下钻层是误导（窗口选择器只治理会话层，见
    // attribution.js 口径钉）；meta.retention_days 仍适用（保留期是库级事实）。
    if (level === 'turn') {
      return res.json({ meta: { ...head.meta, truncated }, level, rows });
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
