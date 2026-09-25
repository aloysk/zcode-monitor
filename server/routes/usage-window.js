'use strict';
// routes/usage-window.js — usage 族窗口解析与宽窗 scope 申报的共享 helper
// （ecosystem-round2-batch2 T8：C12 §2.4 需求 2 显式授权的结构性提取、行为
// 零变更——原 makeUsageRouter 闭包内 resolveWindow 与 usage.js 模块级私有
// wideWindowScope 移入本模块，签名/返回值形状零改动；retentionDays 从闭包
// 捕获改经参数注入（双参函数形态，评审第 1 轮两席钉）。usage.js 薄委托消费、
// routes/export.js 同源消费——usage 值域（24h|7d|30d）的窗口解析全仓唯一
// 落点在本模块，防第二套聚合/窗口解析（C12 同源钉）。
const dbq = require('../db');
const { firstParam } = require('../http-hardening');

// 宽窗（30d 档）候选钳制副作用的 meta 申报（slow_tools_scope 先例）：db 层对
// 窗宽 ≥8d（本族值域即 30d 档）的 tool/attribution session 层查询启用 rowid
// 尾部候选集上界（USAGE_CANDIDATE_CAP_ROWS；启用依据与实测数字见 db.js 分节
// 头注及 docs/acceptance/round2-batch1-explain-timing.md）——读数上限=最新 cap
// 行，如实注明不静默。值域内 24h/7d 走 started_at 索引精确窗口，无此副作用；
// turn_usage 与 attribution turn 层不启用钳制（会话内天然小集合）。
function wideWindowScope(window) {
  return window === '30d'
    ? { scope: `recent_30d_capped_${dbq.USAGE_CANDIDATE_CAP_ROWS}_rows` }
    : {};
}

// ── usage 族共享 helper：窗口解析 + 响应公共头（三端点与 /api/export 统一
// 消费的唯一装配点）──
// 值域 24h|7d|30d，默认 24h、未知值回退 24h且回显 '24h'。
// 与 server/routes/overview.js:13-22 的路由内联窗口解析是两套值域（本族含
// 30d=完整保留窗、不含 today）——overview 既有内联不动，不越界改既有路由。
// sinceMs 供调用方喂给查询族；head 即响应公共头（since 为 ISO 时间）。
// retentionDays 经参数注入（usage.js 侧由工厂 opts 传入，提取前为闭包捕获）。
function resolveWindow(q, retentionDays = 30) {
  const w = firstParam(q && q.window); // 数组形态取首值（与其余字符串参数同语义）
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

module.exports = { resolveWindow, wideWindowScope };
