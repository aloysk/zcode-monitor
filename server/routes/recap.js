'use strict';
// routes/recap.js — GET /api/recap?period=week|month|year（C7 周/月叙事回顾的
// 数据面，ecosystem-round2-batch2 §2.3 需求 2/3）。
// 装配函数 buildRecapPayload 是模块级导出——T8 /api/export 的 recap 数据集同源
// 消费本函数（文件本身 T8 不触碰）；makeRecapRouter 为薄壳：query 解析 →
// buildRecapPayload → res.json。
// period 白名单 week|month|year：缺省 week、未知值回退 week 且回显 'week'
// （resolveWindow 先例——人读消费面回退不 400，与 C12 机器面从严有意不同）。
// period_start：week=now−7d、month=本月 1 日（本地）、year=本年 1 月 1 日（本地）
// （now/tzOffsetMinutes 注入可测，测试与宿主机时区/时刻无关）。
// 规模治理（R-22 同治）：week 档 started_at 精确窗；month/year（db 层宽窗 ≥8d
// 判定，USAGE_CAP_WINDOW_MS）rowid 尾部候选集钳制 + NOT INDEXED，meta.scope
// 如实申报（wideWindowScope 同款形态）。
// meta.token_coverage_from＝max(period_start, now−retentionDays, cap 覆盖起点)
// （三元 max 唯一诚实公式——cap 生效时月初日桶先被 cap 截断而非 30d prune，
// 「自 30 天前可读」的宣称会被 cap 先证伪；cap 未生效时该元取 now−30d 语义值）。
// year 档语义：token 类字段 null（30d prune 外无数据源，不伪造 0——C9-5 未知
// 值原则；日桶 tokens 与 top_focus 均属 token 类）；活动时长＝session 区间并集
// 上界（含挂机时间，activity.caliber 披露）；环比仅 week 档（§2.0 拍板 6——
// month/year 前一周期数据不可保证完整）。
// 日桶生成边界（路由/视图共同契约，数据侧在路由生成）：日桶序列自
// token_coverage_from 对齐的本地自然日起生成——coverage 之前的 period 内日期
// 不产出桶行（数据不可读≠零活动，不伪造 0 桶）；coverage 之内无活动的日期产出
// 真 0 桶（「已知零」与「未知不伪造」的区分）。
const express = require('express');
const dbq = require('../db');
const { firstParam } = require('../http-hardening');

const DAY_MS = 86400_000;
const BUCKETS_PER_DAY = 288; // 86400_000 / 300_000

// 环比百分数：基线为 0/无数据 → null（不伪造 ±Infinity）。
function deltaPct(cur, prev) {
  return prev > 0 ? +(((cur - prev) / prev) * 100).toFixed(1) : null;
}

function buildRecapPayload({
  period, now = Date.now(), tzOffsetMinutes = null,
  retentionDays = 30, capRows = dbq.USAGE_CANDIDATE_CAP_ROWS,
} = {}) {
  if (tzOffsetMinutes == null) {
    // 服务器本地偏移（东八区=480；getTimezoneOffset 西正东负，取负号）
    tzOffsetMinutes = -new Date(now).getTimezoneOffset();
  }
  const tzMs = tzOffsetMinutes * 60_000;
  const p = period === 'month' || period === 'year' ? period : 'week';

  // period_start（本地日界）：week=滚动 7d；month/year 取本地墙钟（now+tzMs 归一
  // 后经 UTC 取分量再减 tz）的月/年首日 0 点——与宿主机时区无关。
  const wall = new Date(now + tzMs);
  const periodStart = p === 'week'  ? now - 7 * DAY_MS
                    : p === 'month' ? Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), 1) - tzMs
                    :                 Date.UTC(wall.getUTCFullYear(), 0, 1) - tzMs;

  // 覆盖起点（三元 max）：cap 项只在宽窗形态参与——窄窗无 rowid 钳制，候选集
  // 不受 cap 约束（与 db 层 recapModelWindow 的宽窄判定同规则同阈值）。
  const pruneSince = now - retentionDays * DAY_MS;
  const wide = periodStart <= now - dbq.USAGE_CAP_WINDOW_MS;
  let coverageFrom = Math.max(periodStart, pruneSince);
  let scope = null;
  if (wide) {
    scope = `recent_30d_capped_${capRows}_rows`;
    const capStart = dbq.recapCapCoverageStart({ capRows });
    if (capStart != null && capStart > coverageFrom) coverageFrom = capStart;
  }

  // 主窗查询（日桶 + 活动桶；开窗到现在）。
  const daily = dbq.recapDailyUsage(periodStart, { tzMs, capRows });
  const buckets = dbq.recapActivityBuckets(periodStart, { tzMs, capRows });

  // 日序列装配：自 coverage 对齐本地自然日起至今天；activity 桶按 288/日折叠
  // 成逐日 active_minutes/parallel_max。dayKey 已含 tz 归一——Date(dayKey*DAY)
  // 按 UTC 取日期串即本地墙钟日，不受宿主机时区影响。
  const dailyByDay = new Map(daily.map(r => [r.day, r]));
  const dayAct = new Map();
  for (const b of buckets) {
    const d = Math.floor(b.bucket / BUCKETS_PER_DAY);
    let a = dayAct.get(d);
    if (!a) { a = { minutes: 0, parallelMax: 0 }; dayAct.set(d, a); }
    a.minutes += 1;
    a.parallelMax = Math.max(a.parallelMax, b.sessions);
  }
  const firstDay = Math.floor((coverageFrom + tzMs) / DAY_MS);
  const lastDay = Math.floor((now + tzMs) / DAY_MS);
  const days = [];
  for (let d = firstDay; d <= lastDay; d++) {
    const dr = dailyByDay.get(d);
    const a = dayAct.get(d);
    days.push({
      date: new Date(d * DAY_MS).toISOString().slice(0, 10),
      tokens: p === 'year' ? null : (dr ? dr.tokens : 0),
      calls: dr ? dr.calls : 0,
      sessions: dr ? dr.sessions : 0,
      errors: dr ? dr.errors : 0,
      active_minutes: a ? a.minutes : 0,
      parallel_max: a ? a.parallelMax : 0,
    });
  }

  // 活动维度（§2.0 拍板 5 双档）：week/month＝事件级（5min 桶跨会话去重）；
  // year＝会话区间并集上界（session 表跨窗可用，含挂机时间，caliber 披露）。
  let activity;
  if (p === 'year') {
    let activeMs = 0;
    for (const [s, e] of dbq.recapSessionSpans()) {
      const lo = Math.max(s, periodStart), hi = Math.min(e, now);
      if (hi > lo) activeMs += hi - lo;
    }
    activity = {
      caliber: 'session_span_union',
      active_minutes: Math.round(activeMs / 60_000),
      parallel_max: null,
      parallel_avg: null,
    };
  } else {
    const parallelMax = buckets.reduce((m, b) => Math.max(m, b.sessions), 0);
    const parallelAvg = buckets.length
      ? buckets.reduce((s, b) => s + b.sessions, 0) / buckets.length : 0;
    activity = {
      caliber: 'event_5min_buckets',
      active_minutes: buckets.length,
      parallel_max: parallelMax,
      parallel_avg: +parallelAvg.toFixed(1),
    };
  }

  // Top focus（year 档 null——directory 级 token 归因在 30d prune 外不可读，
  // 排序键本身是 token，伪值即伪序）。
  const top_focus = p === 'year'
    ? null : dbq.recapTopFocus(periodStart, { tzMs, capRows });

  // 环比（仅 week 档，token+活动两维）。前一窗 [ps−7d, ps) 同为窄窗精确路径
  //（7d < 8d 宽窄阈值），untilMs 切片不与 cap 路径交叠。
  let comparison = null;
  if (p === 'week') {
    const prevStart = periodStart - 7 * DAY_MS;
    const prevDaily = dbq.recapDailyUsage(prevStart, { tzMs, untilMs: periodStart, capRows });
    const prevBuckets = dbq.recapActivityBuckets(prevStart, { tzMs, untilMs: periodStart, capRows });
    const curTokens = daily.reduce((s, r) => s + (r.tokens || 0), 0);
    const prevTokens = prevDaily.reduce((s, r) => s + (r.tokens || 0), 0);
    comparison = {
      window_days: 7,
      tokens: {
        current: curTokens, previous: prevTokens,
        delta_pct: deltaPct(curTokens, prevTokens),
      },
      active_minutes: {
        current: buckets.length, previous: prevBuckets.length,
        delta_pct: deltaPct(buckets.length, prevBuckets.length),
      },
    };
  }

  return {
    period: p,
    period_start: new Date(periodStart).toISOString(),
    generated_at: new Date(now).toISOString(),
    meta: {
      retention_days: retentionDays,
      tz_offset_minutes: tzOffsetMinutes,
      token_coverage_from: new Date(coverageFrom).toISOString(),
      ...(scope != null && { scope }),
    },
    days,
    activity,
    top_focus,
    ...(comparison != null && { comparison }),
  };
}

function makeRecapRouter(opts = {}) {
  const router = express.Router();

  // GET /?period=week|month|year — 薄壳：解析 query → 装配 → json。
  // firstParam 归一数组形态（?period=a&period=b 取首值，与其余字符串参数同语义）。
  router.get('/', (req, res) => {
    res.json(buildRecapPayload({ period: firstParam(req.query.period), ...opts }));
  });

  return router;
}

module.exports = { makeRecapRouter, buildRecapPayload };
