'use strict';
// test/recap.test.js — C7 recap 查询族 + 口径 + 路由 + EQP（ecosystem-round2-
// batch2 T6：C7-1~C7-5、C7-7 的 fixture 面；真实库 EXPLAIN/计时照录验收记录
// docs/acceptance/round2-batch2-explain-timing.md）。
// 形态：express listen(0) + http.get（usage-routes.test.js 同款）；env 指向
// os.tmpdir() fixture 后再 require（db.js 模块级缓存连接——env 先行是既有约定）。
// 时间注入：now/tz 一律常量注入（tz 固定 UTC+8＝480），测试与宿主机时区/时刻
// 无关（R2 跨本地午夜用例先例）；db 层宽窄判定消费同注入 nowMs（路由层同源
// 传递——评审第 1 轮时钟统一），8d 阈值邻域不再依赖「窗口边界天级远」的旧声明。
// 数据布局（usage 族同款时间轴约定）：单 fixture 全程共享、node:test 顺序执行，
// 各阶段「先断言后插行」——晚段期望值计入早段基线行（逐处标注）。
// ⚠ 禁止单筛本文件用例：阶段 0 是空库断言（须最先跑），其后各阶段在同库上
// 累计插行，早段构造是晚段窗口语义的一部分——单筛晚段会因基线行缺失而失红。
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const { createFixtureDb, buildSession, buildModelUsage } =
  require('./helpers/fixture-db');

const fx = createFixtureDb(); // 不 seed：空库起步（阶段 0 的空库形态）
process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = fx.logDir;
process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;
const dbq = require('../server/db');
const { makeRecapRouter, buildRecapPayload } = require('../server/routes/recap');

const now = Date.now();
const DAY = 86400e3, MIN = 60e3;
const TZ = 480;              // 注入固定 tz：UTC+8（getTimezoneOffset 西正东负的逆）
const TZ_MS = TZ * 60e3;
const dayKeyOf = (t) => Math.floor((t + TZ_MS) / DAY);
const wallDate = (t) => new Date(dayKeyOf(t) * DAY).toISOString().slice(0, 10);
const modelRow = (o) => ({ status: 'completed', query_source: 'main_turn', ...o });
const isIso = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s));

test.after(() => {
  try { dbq.db().close(); } catch { /* already closed */ }
  dbq.invalidateDb();
  fx.cleanup();
});

function listen(a) {
  const server = a.listen(0, '127.0.0.1');
  return new Promise(resolve => server.on('listening', () => resolve(server)));
}
function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p },
      res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
  });
}
async function getJson(port, p) {
  const r = await get(port, p);
  return { status: r.status, body: JSON.parse(r.body) };
}
// 每用例独立挂载（路由无状态），用后即收——usage-routes 先例。
async function withRecapServer(opts, fn) {
  const a = express();
  a.use('/api/recap', makeRecapRouter(opts));
  const server = await listen(a);
  try { await fn(server.address().port); } finally { server.close(); }
}
// 与路由同公式的期望值装配（C7-3 period_start 的独立复算锚）
const wallNow = new Date(now + TZ_MS);
const expWeekStart = now - 7 * DAY;
const expMonthStart = Date.UTC(wallNow.getUTCFullYear(), wallNow.getUTCMonth(), 1) - TZ_MS;
const expYearStart = Date.UTC(wallNow.getUTCFullYear(), 0, 1) - TZ_MS;
// year 档宽窗判定（1 月 1-8 日运行时 yearStart 距 now 不足 8d → db 层走窄窗，
// scope 申报随之缺席——断言按同规则条件化，任何日期运行都成立）
const wideYear = expYearStart <= now - dbq.USAGE_CAP_WINDOW_MS;

// ── 阶段 0：空库（C7-5 空窗条款 + 空库稳健）──
test('C7-5 空库: week 空 top_focus/全零日桶/环比基线空 → delta null；year token 类 null + span 活动为零', () => {
  const w = buildRecapPayload({ period: 'week', now, tzOffsetMinutes: TZ });
  assert.equal(w.period, 'week');
  assert.deepEqual(w.top_focus, []);
  assert.equal(w.days.length, 8, 'week 日桶序列＝coverage(=period_start)对齐日起 8 天');
  for (const d of w.days) {
    assert.deepEqual(d, { date: d.date, tokens: 0, calls: 0, sessions: 0,
      errors: 0, active_minutes: 0, parallel_max: 0 }, `空库日桶真 0：${d.date}`);
  }
  assert.deepEqual(w.activity, { caliber: 'event_5min_buckets',
    active_minutes: 0, parallel_max: 0, parallel_avg: 0 });
  assert.deepEqual(w.comparison, {
    window_days: 7,
    // 前窗 [ps−7d, ps) 起点距今 ≥14d > 8d 阈值 → 恒宽窗 cap 路径，previous_
    // scope 恒申报（评审第 1 轮 major：前窗受 cap 钳制须披露，不得静默）
    previous_scope: `recent_30d_capped_${dbq.USAGE_CANDIDATE_CAP_ROWS}_rows`,
    tokens: { current: 0, previous: 0, delta_pct: null },
    active_minutes: { current: 0, previous: 0, delta_pct: null },
  }, '空基线 → delta_pct null（不伪造 ±Infinity）');
  assert.equal(w.meta.retention_days, 30);
  assert.equal(w.meta.tz_offset_minutes, TZ);
  assert.equal(w.meta.token_coverage_from, new Date(expWeekStart).toISOString());
  assert.ok(!('scope' in w.meta), '窄窗无 cap，无 scope 申报');

  const y = buildRecapPayload({ period: 'year', now, tzOffsetMinutes: TZ });
  assert.equal(y.top_focus, null, 'year 档 top_focus=null（token 类不伪造）');
  assert.ok(!('comparison' in y), '环比仅 week 档（字段不存在钉）');
  assert.deepEqual(y.activity, { caliber: 'session_span_union',
    active_minutes: 0, parallel_max: null, parallel_avg: null });
  for (const d of y.days) assert.equal(d.tokens, null, 'year 档日桶 tokens=null');
});

// ── 阶段 1：C7-1 跨本地日界分桶（注入 tz UTC+8）──
test('C7-1 跨日界钉: 23:50/次日 00:10 分属不同日桶、桶键与注入 tz 一致；tz=0 时同桶（tz 真实参与）', () => {
  const midnight = dayKeyOf(now) * DAY - TZ_MS;        // 今日本地 0 点（注入 tz 口径）
  const tA = midnight - DAY + (23 * 60 + 50) * MIN;    // 昨日 23:50（本地墙钟）
  const tB = midnight + 10 * MIN;                      // 今日 00:10（本地墙钟）
  buildModelUsage(fx.conn, [
    modelRow({ id: 'db1', session_id: 'dbS', started_at: tA, computed_total_tokens: 111 }),
    modelRow({ id: 'db2', session_id: 'dbS', started_at: tB, computed_total_tokens: 222 }),
  ]);
  const keyA = dayKeyOf(tA), keyB = dayKeyOf(tB);
  assert.notEqual(keyA, keyB, '注入 tz 下两行跨本地午夜 → 不同日桶');
  assert.deepEqual(dbq.recapDailyUsage(midnight - DAY, { tzMs: TZ_MS }), [
    { day: keyA, calls: 1, sessions: 1, tokens: 111, errors: 0 },
    { day: keyB, calls: 1, sessions: 1, tokens: 222, errors: 0 },
  ]);
  // 负对照：tz=0 时两行同属一个日桶（分桶边界随注入 tz 移动，非宿主机时区）
  const rows0 = dbq.recapDailyUsage(midnight - DAY, { tzMs: 0 });
  assert.equal(rows0.length, 1);
  assert.equal(rows0[0].calls, 2);
  assert.equal(rows0[0].tokens, 333);
});

// ── 阶段 2：C7-2 activeMinutes 跨会话去重（5min 桶构造，窗内只含本组行）──
test('C7-2 去重钉: 同桶两会话只计一次（3 行 3 会话 → 2 桶）、桶键相邻、桶内并行数与构造一致', () => {
  const base = Math.floor((now + TZ_MS) / 300000) * 300000 - TZ_MS; // 5min 桶边界对齐
  buildModelUsage(fx.conn, [
    modelRow({ id: 'pb1', session_id: 'pA', started_at: base + MIN, computed_total_tokens: 5 }),
    modelRow({ id: 'pb2', session_id: 'pB', started_at: base + 2 * MIN, computed_total_tokens: 7 }),
    modelRow({ id: 'pc1', session_id: 'pC', started_at: base + 6 * MIN, computed_total_tokens: 9 }),
  ]);
  const buckets = dbq.recapActivityBuckets(now - 10 * MIN, { tzMs: TZ_MS });
  assert.equal(buckets.length, 2, '同桶跨会话去重：activeMinutes＝2');
  assert.equal(buckets[0].bucket + 1, buckets[1].bucket, '相邻桶');
  assert.deepEqual(buckets.map(b => b.sessions), [2, 1], '桶内并行会话数：[pA,pB]=2、[pC]=1');
});

// ── 阶段 3：C7-3/C7-4 HTTP week（含阶段 1/2 基线行的累计期望值）──
test('C7-3/C7-4 HTTP week: 回显/period_start/meta 三元 max（窄窗=period_start）/日桶累计值/空基线环比', async () => {
  await withRecapServer({ now, tzOffsetMinutes: TZ }, async (port) => {
    const r = await getJson(port, '/api/recap');
    assert.equal(r.status, 200);
    assert.equal(r.body.period, 'week', '缺省=week');
    assert.equal(r.body.period_start, new Date(expWeekStart).toISOString());
    assert.ok(isIso(r.body.generated_at));
    assert.equal(r.body.meta.retention_days, 30);
    assert.equal(r.body.meta.tz_offset_minutes, TZ);
    // 窄窗无 cap：token_coverage_from=max(period_start, now−30d)=period_start
    assert.equal(r.body.meta.token_coverage_from, new Date(expWeekStart).toISOString());
    assert.ok(!('scope' in r.body.meta), 'week 走 started_at 精确窗，无 scope');
    // 日桶（计入阶段 1/2 基线行）：今日=db2+pb1/pb2/pc1、昨日=db1
    assert.equal(r.body.days.length, 8);
    const byDate = Object.fromEntries(r.body.days.map(d => [d.date, d]));
    assert.deepEqual(byDate[wallDate(now)], { date: wallDate(now), tokens: 243,
      calls: 4, sessions: 4, errors: 0, active_minutes: 3, parallel_max: 2 });
    assert.deepEqual(byDate[wallDate(now - DAY)], { date: wallDate(now - DAY), tokens: 111,
      calls: 1, sessions: 1, errors: 0, active_minutes: 1, parallel_max: 1 });
    assert.deepEqual(byDate[wallDate(now - 6 * DAY)], { date: wallDate(now - 6 * DAY),
      tokens: 0, calls: 0, sessions: 0, errors: 0, active_minutes: 0, parallel_max: 0 },
      'coverage 内无活动日＝真 0 桶（tokens=0/calls=0）');
    // 活动面（4 桶：昨日 23:50、今日 00:10、pb 桶、pc 桶）与「N× parallel」
    assert.deepEqual(r.body.activity, { caliber: 'event_5min_buckets',
      active_minutes: 4, parallel_max: 2, parallel_avg: 1.3 });
    // 环比：前一窗空 → previous 0、delta null（诚实基线）
    assert.deepEqual(r.body.comparison.tokens, { current: 354, previous: 0, delta_pct: null });
    assert.deepEqual(r.body.comparison.active_minutes, { current: 4, previous: 0, delta_pct: null });
    // top_focus：基线行会话无 session 表行 → directory=null 单组如实呈现
    //（calls=5：阶段 1 两行 + 阶段 2 三行）
    assert.deepEqual(r.body.top_focus, [
      { directory: null, tokens: 354, calls: 5, sessions: 4, active_minutes: 4 },
    ]);
  });
});

// ── 阶段 4：C7-3 HTTP period 三档与回退 ──
test('C7-3 HTTP period: month/year period_start=本地月/年首日；未知值回退 week 且回显', async () => {
  await withRecapServer({ now, tzOffsetMinutes: TZ }, async (port) => {
    const m = await getJson(port, '/api/recap?period=month');
    assert.equal(m.body.period, 'month');
    assert.equal(m.body.period_start, new Date(expMonthStart).toISOString(),
      '本月 1 日（注入 tz 的本地日界）');
    // month 档数据面非 null 钉（评审第 1 轮 minor：此前 null 断言全在 year 档，
    // month 误 null 化——复制 year 分支——测试不红）：tokens 为数（宽窗 cap 与
    // 否都产出数值）、top_focus 为数组、comparison 字段缺席（环比仅 week）。
    assert.ok(m.body.days.length >= 1, 'month 档有日桶序列');
    assert.ok(m.body.days.every(d => typeof d.tokens === 'number'),
      'month 档日桶 tokens 非 null（token 类字段仅 year 档 null）');
    assert.ok(Array.isArray(m.body.top_focus), 'month 档 top_focus 为数组非 null');
    assert.ok(m.body.top_focus.length >= 1, 'month 档 top_focus 有归并组（种子行在窗）');
    assert.ok(!('comparison' in m.body), '环比仅 week 档');
    const y = await getJson(port, '/api/recap?period=year');
    assert.equal(y.body.period, 'year');
    assert.equal(y.body.period_start, new Date(expYearStart).toISOString(),
      '本年 1 月 1 日（注入 tz 的本地日界）');
    const f = await getJson(port, '/api/recap?period=year!');
    assert.equal(f.body.period, 'week', '未知值回退 week');
    assert.equal(f.body.period_start, new Date(expWeekStart).toISOString());
    // 数组形态 query 取首值（firstParam 归一，batch1 R2 同语义）
    const arr = await getJson(port, '/api/recap?period=month&period=year');
    assert.equal(arr.body.period, 'month');
  });
});

// ── 阶段 5：会话区间并集（year 档活动上界的数据面；本阶段前 session 表为空）──
test('区间并集: 重叠合并/脏行（逆序+NULL）防御，合并区间与构造一致', () => {
  buildSession(fx.conn, [
    { id: 'sp1', title: '区间一', task_type: 'interactive', directory: 'F:/demo',
      time_created: now - 20 * DAY, time_updated: now - 19 * DAY },
    { id: 'sp2', title: '区间二', task_type: 'interactive', directory: 'F:/demo',
      time_created: now - Math.round(19.5 * DAY), time_updated: now - Math.round(18.5 * DAY) },
    { id: 'sp3', title: '区间三', task_type: 'interactive', directory: 'F:/demo',
      time_created: now - 2 * 3600e3, time_updated: now - 3600e3 },
    // 脏行：time_created>time_updated（归一 [min,max] 后落在 sp3 内，并集不变）
    { id: 'sp4', title: '逆序脏行', task_type: 'interactive', directory: 'F:/demo',
      time_created: now - 90 * MIN, time_updated: now - 2 * 3600e3 },
    // 脏行：time_updated NULL → 跳过
    { id: 'sp5', title: 'NULL 脏行', task_type: 'interactive', directory: 'F:/demo',
      time_created: now - 5 * 3600e3, time_updated: null },
  ]);
  assert.deepEqual(dbq.recapSessionSpans(), [
    [now - 20 * DAY, now - Math.round(18.5 * DAY)],   // sp1+sp2 重叠合并（1.5d）
    [now - 2 * 3600e3, now - 3600e3],                // sp3（sp4 脏行归一后被吸收）
  ]);
});

// ── 阶段 6：C7-5 top_focus 行级桶聚合 + JS 归并（含跨会话同桶对照）──
test('C7-5 归并钉: by-directory tokens/calls/sessions/activeMinutes 逐项相等；空窗空数组；Top N 在归并后', () => {
  const base = Math.floor((now - 3 * DAY + TZ_MS) / 300000) * 300000 - TZ_MS;
  // 零长度 span（time_created==time_updated）：会话存在但不影响区间并集口径
  buildSession(fx.conn, [
    { id: 'tfA1', title: 'A1', task_type: 'interactive', directory: 'F:/projA',
      time_created: base, time_updated: base },
    { id: 'tfA2', title: 'A2', task_type: 'interactive', directory: 'F:/projA',
      time_created: base, time_updated: base },
    { id: 'tfB1', title: 'B1', task_type: 'interactive', directory: 'F:/projB',
      time_created: base, time_updated: base },
    { id: 'tfB2', title: 'B2', task_type: 'interactive', directory: 'F:/projB',
      time_created: base, time_updated: base },
  ]);
  buildModelUsage(fx.conn, [
    // projA：X1/X2 同一 5min 桶（跨会话同桶对照）；projB：Y1 同桶、Y2 相邻桶
    modelRow({ id: 'tf1', session_id: 'tfA1', started_at: base, computed_total_tokens: 100 }),
    modelRow({ id: 'tf2', session_id: 'tfA2', started_at: base + MIN, computed_total_tokens: 200 }),
    modelRow({ id: 'tf3', session_id: 'tfB1', started_at: base + 2 * MIN, computed_total_tokens: 50 }),
    modelRow({ id: 'tf4', session_id: 'tfB2', started_at: base + 6 * MIN, computed_total_tokens: 500 }),
  ]);
  // 窗口 [now−4d, ∞) 计入阶段 1/2 基线行（会话无 session 表行 → null 组）：
  // tokens 降序 [projB 550, null 354, projA 300]
  assert.deepEqual(dbq.recapTopFocus(now - 4 * DAY, { tzMs: TZ_MS }), [
    { directory: 'F:/projB', tokens: 550, calls: 2, sessions: 2, active_minutes: 2 },
    { directory: null, tokens: 354, calls: 5, sessions: 4, active_minutes: 4 },
    // projA 两会话同一桶：跨会话去重后 active_minutes=1（同桶两会话只计一次）
    { directory: 'F:/projA', tokens: 300, calls: 2, sessions: 2, active_minutes: 1 },
  ]);
  // Top N 截断在 directory 级归并完成后：limit=1 保留完整聚合计数
  assert.deepEqual(dbq.recapTopFocus(now - 4 * DAY, { tzMs: TZ_MS, limit: 1 }), [
    { directory: 'F:/projB', tokens: 550, calls: 2, sessions: 2, active_minutes: 2 },
  ]);
  // 分块寻址对拍（评审第 1 轮 minor：ids 无上界超 SQLite 32766 变量限即 500，
  // 按 RECAP_IN_CHUNK=500 分块）：inChunk=2 时 8 会话分 4 段寻址，结果与
  // 单段逐位一致（分块只改寻址形态、不改语义）
  const chunked = dbq.recapTopFocus(now - 4 * DAY, { tzMs: TZ_MS, inChunk: 2 });
  assert.deepEqual(chunked, dbq.recapTopFocus(now - 4 * DAY, { tzMs: TZ_MS }),
    'IN 分块寻址与单段结果逐位一致');
  // 空窗（未来窗）→ 空数组不抛错（C7-5 空窗条款）
  assert.deepEqual(dbq.recapTopFocus(now + DAY, { tzMs: TZ_MS }), []);
  assert.deepEqual(dbq.recapDailyUsage(now + DAY, { tzMs: TZ_MS }), []);
  assert.deepEqual(dbq.recapActivityBuckets(now + DAY, { tzMs: TZ_MS }), []);
});

// ── 阶段 7：环比前一窗种子（此后前一窗恰一行 1000 tokens/1 桶）──
test('环比种子: 前一窗 [ps−7d, ps) 单行 1000 tokens', () => {
  const t = now - 10 * DAY;
  buildSession(fx.conn, [
    { id: 'cmpPrev', title: '上周基线', task_type: 'interactive', directory: 'F:/demo',
      time_created: t, time_updated: t },
  ]);
  buildModelUsage(fx.conn, [
    modelRow({ id: 'cmp1', session_id: 'cmpPrev', started_at: t, computed_total_tokens: 1000 }),
  ]);
});

// ── 阶段 8：HTTP week 全量（环比两维 + 累计日桶 + top_focus 三组）──
test('C7-4 HTTP week 环比: token/活动两维 delta 与构造一致；top_focus 含 null-directory 组排序', async () => {
  await withRecapServer({ now, tzOffsetMinutes: TZ }, async (port) => {
    const r = await getJson(port, '/api/recap?period=week');
    assert.equal(r.status, 200);
    // 当前窗 1204（111+222+21+850）vs 前一窗 1000 → +20.4%
    assert.deepEqual(r.body.comparison.tokens, { current: 1204, previous: 1000, delta_pct: 20.4 });
    // 活动桶 6（阶段 1 两桶 + 阶段 2 两桶 + tf 两桶）vs 1 → +500%
    assert.deepEqual(r.body.comparison.active_minutes, { current: 6, previous: 1, delta_pct: 500 });
    // 前窗恒宽窗（起点距今 ≥14d > 8d 阈值）→ previous_scope 披露在案
    assert.equal(r.body.comparison.previous_scope,
      `recent_30d_capped_${dbq.USAGE_CANDIDATE_CAP_ROWS}_rows`,
      '环比前窗 cap 形态披露（不静默）');
    assert.deepEqual(r.body.activity, { caliber: 'event_5min_buckets',
      active_minutes: 6, parallel_max: 3, parallel_avg: 1.5 });
    const byDate = Object.fromEntries(r.body.days.map(d => [d.date, d]));
    assert.deepEqual(byDate[wallDate(now - 3 * DAY)], { date: wallDate(now - 3 * DAY),
      tokens: 850, calls: 4, sessions: 4, errors: 0, active_minutes: 2, parallel_max: 3 });
    // top_focus：tokens 降序 [projB 550, null 354, projA 300]
    assert.deepEqual(r.body.top_focus.map(t => [t.directory, t.tokens]),
      [['F:/projB', 550], [null, 354], ['F:/projA', 300]]);
  });
});

// ── 阶段 9：cap 种子（rNew 插入次序最后＝最大 rowid；capOld 为全库最早行）──
test('cap 种子: now−10d−1h / now−5d / now−2d 三行（rNew 最后插入）', () => {
  buildModelUsage(fx.conn, [
    modelRow({ id: 'capOld', session_id: 'capY1', started_at: now - 10 * DAY - 3600e3,
      computed_total_tokens: 10 }),
    modelRow({ id: 'capMid', session_id: 'capY2', started_at: now - 5 * DAY,
      computed_total_tokens: 20 }),
    modelRow({ id: 'rNew', session_id: 'capY3', started_at: now - 2 * DAY,
      computed_total_tokens: 30 }),
  ]);
});

// ── 阶段 10：C7-4 year + cap 极小值（覆盖起点右移钉）──
test('C7-4 cap 钉: capRows=1 → token_coverage_from 右移至最新行；coverage 前无桶行；year token 类 null', async () => {
  await withRecapServer({ now, tzOffsetMinutes: TZ, capRows: 1 }, async (port) => {
    const r = await getJson(port, '/api/recap?period=year');
    assert.equal(r.status, 200);
    assert.equal(r.body.period, 'year');
    assert.equal(r.body.meta.retention_days, 30);
    // 三元 max：cap 覆盖起点（最新行 started_at）> now−30d > 年首日 → 右移生效
    assert.equal(r.body.meta.token_coverage_from, new Date(now - 2 * DAY).toISOString(),
      'cap 极小值使覆盖起点右移，不停在 30d 线');
    assert.equal(r.body.meta.scope, 'recent_30d_capped_1_rows', 'cap 生效时 meta.scope 申报');
    // 日桶序列＝[coverage 对齐日 … 今天]，coverage 前的 period 内日期（now−5d 有行）
    // 不产出桶行（数据不可读≠零活动）
    assert.deepEqual(r.body.days.map(d => d.date),
      [wallDate(now - 2 * DAY), wallDate(now - DAY), wallDate(now)]);
    const [d0, d1] = r.body.days;
    assert.deepEqual(d0, { date: wallDate(now - 2 * DAY), tokens: null, calls: 1,
      sessions: 1, errors: 0, active_minutes: 1, parallel_max: 1 });
    assert.deepEqual(d1, { date: wallDate(now - DAY), tokens: null, calls: 0,
      sessions: 0, errors: 0, active_minutes: 0, parallel_max: 0 },
      'coverage 内无活动日＝真 0 桶（year 档 tokens=null、calls=0）');
    // year 档语义：token 类 null、top_focus null、环比字段不存在、span 上界口径
    assert.equal(r.body.top_focus, null);
    assert.ok(!('comparison' in r.body));
    assert.equal(r.body.activity.caliber, 'session_span_union');
    // span 并集裁剪 [年首日, now]：9 月运行时＝1.5d+1h=2220min（1 月初运行时左侧
    // 被年首日裁剪，期望值按同裁剪式复算——任何日期成立）
    const expectedSpanMin = Math.round(
      (Math.max(0, Math.min(now - Math.round(18.5 * DAY), now) - Math.max(now - 20 * DAY, expYearStart))
        + Math.max(0, (now - 3600e3) - Math.max(now - 2 * 3600e3, expYearStart))) / 60e3);
    assert.equal(r.body.activity.active_minutes, expectedSpanMin);
    assert.equal(r.body.activity.parallel_max, null);
  });
});

// ── 阶段 11：C7-4 year 默认 cap（覆盖起点=候选集最早行=全库最早种子行）──
test('C7-4 year 默认 cap: scope 申报 200k；token_coverage_from=候选集最早行（三元 max 逐项参与）', async () => {
  await withRecapServer({ now, tzOffsetMinutes: TZ }, async (port) => {
    const r = await getJson(port, '/api/recap?period=year');
    assert.equal(r.status, 200);
    if (wideYear) {
      assert.equal(r.body.meta.scope,
        `recent_30d_capped_${dbq.USAGE_CANDIDATE_CAP_ROWS}_rows`);
      // 200k cap 在小 fixture 上覆盖全部行 → cap 起点=MIN(started_at)=capOld 行
      assert.equal(r.body.meta.token_coverage_from,
        new Date(now - 10 * DAY - 3600e3).toISOString());
      assert.equal(r.body.days[0].date, wallDate(now - 10 * DAY - 3600e3));
      assert.equal(r.body.days.length,
        dayKeyOf(now) - dayKeyOf(now - 10 * DAY - 3600e3) + 1);
    } else {
      // 1 月 1-8 日形态：yearStart 距 now 不足 8d → 窄窗精确路径（同 db 层规则）
      assert.ok(!('scope' in r.body.meta));
    }
    assert.ok(r.body.days.every(d => d.tokens === null), 'year 档 token 类字段 null');
    assert.equal(r.body.top_focus, null);
  });
});

// ── 阶段 12b：deltaPct 负增长分支（前窗加大基线行 → cur<prev 的直接用例）──
// 评审第 1 轮 note：此前 delta_pct 断言仅 prev=0（null）与正增长两分支，
// 负增长（cur<prev）无直接用例。期望值计入阶段 9 cap 种子（current 1204+
// capMid20+rNew30=1254；previous 1000+cmp22000+capOld10=3010）。
test('C7-4 deltaPct 负增长: cur<prev → 负百分数（−58.3），非 null 非 ±Infinity', async () => {
  buildModelUsage(fx.conn, [
    modelRow({ id: 'cmp2', session_id: 'cmpPrev', started_at: now - 10 * DAY,
      computed_total_tokens: 2000 }),
  ]);
  await withRecapServer({ now, tzOffsetMinutes: TZ }, async (port) => {
    const r = await getJson(port, '/api/recap?period=week');
    assert.deepEqual(r.body.comparison.tokens,
      { current: 1254, previous: 3010, delta_pct: -58.3 });
    // 活动桶：current 6+capMid/rNew 两桶=8；previous cmp1/cmp2 同桶 1+capOld=2
    assert.deepEqual(r.body.comparison.active_minutes,
      { current: 8, previous: 2, delta_pct: 300 });
  });
});

// ── 阶段 12：EQP 机检（fixture 计划形态守护；真实库照录见验收记录 C7-7）──
test('EQP 形态: 窄窗 SEARCH started_at 索引/宽窗 NOT INDEXED+rowid 尾界/覆盖起点 COVERING；无基表 SCAN', () => {
  const captureSql = (thunk) => {
    const proxy = dbq.db();
    const orig = proxy.prepare;
    const seen = [];
    proxy.prepare = (sql) => { seen.push(sql); return orig.call(proxy, sql); };
    try { thunk(); } finally { proxy.prepare = orig; }
    return seen;
  };
  const narrowSince = now - 2 * 3600e3; // 窄窗（<8d）：只含当日近 2h 行
  const wideSince = now - 10 * DAY;     // 宽窗（≥8d）：cap 形态
  const narrow = [
    ...captureSql(() => dbq.recapDailyUsage(narrowSince, { tzMs: TZ_MS })),
    ...captureSql(() => dbq.recapActivityBuckets(narrowSince, { tzMs: TZ_MS })),
    ...captureSql(() => dbq.recapTopFocus(narrowSince, { tzMs: TZ_MS })),
  ];
  const wide = [
    ...captureSql(() => dbq.recapDailyUsage(wideSince, { tzMs: TZ_MS, capRows: 5 })),
    ...captureSql(() => dbq.recapActivityBuckets(wideSince, { tzMs: TZ_MS, capRows: 5 })),
    ...captureSql(() => dbq.recapTopFocus(wideSince, { tzMs: TZ_MS, capRows: 5 })),
  ];
  const other = [
    ...captureSql(() => dbq.recapSessionSpans()),
    ...captureSql(() => dbq.recapCapCoverageStart()),
    ...captureSql(() => dbq.recapCapCoverageStart({ capRows: 3 })),
  ];
  assert.equal(narrow.length, 4, '窄窗计数钉：日桶 1 + 活动桶 1 + top-focus 2（分组 + directory 寻址）');
  assert.equal(wide.length, 4, '宽窗计数钉：同上三路');
  assert.equal(other.length, 3, 'span 1 + 覆盖起点 2');
  // 宽窗形态钉：三路聚合 SQL 必须 NOT INDEXED + rowid 尾界（directory 寻址无此形态）
  assert.equal(wide.filter(s => /NOT INDEXED/.test(s)).length, 3,
    '宽窗必须钉 NOT INDEXED（日桶/活动桶/top-focus 分组）');
  assert.equal(wide.filter(s => /rowid > \(SELECT MAX\(rowid\) FROM model_usage\) - @cap/.test(s)).length, 3,
    '宽窗必须带 rowid 尾部候选集钳制');
  // 窄窗形态钉：top-focus 分组查询 INDEXED BY 强制；日桶/活动桶分桶表达式安全形态
  //（不强制——恒走 started_at SEARCH + TEMP B-TREE）
  const tfGroupNarrow = narrow.find(s => /GROUP BY session_id, bucket/.test(s));
  assert.ok(tfGroupNarrow, 'top-focus 分组 SQL 在捕获集内');
  assert.ok(/INDEXED BY model_usage_started_model_idx/.test(tfGroupNarrow),
    '窄窗 top-focus 分组必须 INDEXED BY 强制（GROUP BY session_id 翻转防护）');
  for (const s of [narrow[0], narrow[1]]) {
    assert.ok(!/INDEXED BY|NOT INDEXED/.test(s), '日桶/活动桶窄窗不强制（安全形态）');
  }
  // 显式排除集（batch1 先例）：recapSessionSpans 的 session 基表 SCAN 受 A2-3
  // 出路条款管辖——按「无 WHERE 的 FROM session 尾锚」滤出（directory 寻址查询
  // 带 WHERE id IN，仍受检）；其余每条 SQL 一律过基表 SCAN 判据。
  const all = [...narrow, ...wide, ...other];
  const checked = all.filter(s => !/FROM session\s*$/.test(s));
  assert.equal(checked.length, all.length - 1, '排除钉：恰 span 拉取 1 条被滤出');
  const explain = (sql) => {
    const named = [...sql.matchAll(/@(\w+)/g)].map(m => m[1]);
    const vals = { since: narrowSince, tz: TZ_MS, cap: 5, until: now };
    const stmt = fx.conn.prepare('EXPLAIN QUERY PLAN ' + sql);
    const rows = named.length
      ? stmt.all(Object.fromEntries(named.map(n => [n, vals[n] ?? 0])))
      : stmt.all(...Array.from({ length: (sql.match(/\?/g) || []).length }, () => 'tfA1'));
    return rows.map(r => r.detail).join(' | ');
  };
  const scanRe = /\bSCAN\s+(model_usage|session|message|tool_usage|turn_usage)\b/i;
  for (const sql of checked) {
    const plan = explain(sql);
    assert.ok(plan.length > 0);
    assert.ok(!scanRe.test(plan), `出现基表 SCAN：${plan}（SQL：${sql.slice(0, 80)}…）`);
  }
  // 计划形态逐路钉（fixture 与真实库同 DDL 索引集，C7-7 照录真库对照）
  assert.ok(explain(narrow[0]).includes('SEARCH model_usage USING INDEX model_usage_started_model_idx')
    && explain(narrow[0]).includes('USE TEMP B-TREE FOR GROUP BY'),
    '窄窗日桶：started_at SEARCH + TEMP B-TREE');
  assert.ok(explain(narrow[1]).includes('SEARCH model_usage USING INDEX model_usage_started_model_idx'),
    '窄窗活动桶：started_at SEARCH');
  assert.ok(explain(tfGroupNarrow).includes('SEARCH model_usage USING INDEX model_usage_started_model_idx'),
    '窄窗 top-focus 分组：强制索引 SEARCH');
  for (const s of wide.filter(s => /NOT INDEXED/.test(s))) {
    assert.ok(explain(s).includes('SEARCH model_usage USING INTEGER PRIMARY KEY (rowid>?)'),
      '宽窗三路：rowid 尾界寻址');
  }
  for (const s of other.filter(s => /MIN\(started_at\)/.test(s))) {
    assert.ok(explain(s).includes('SEARCH model_usage USING COVERING INDEX model_usage_started_model_idx'),
      'cap 覆盖起点：MIN+rowid 尾界的覆盖索引形态（OFFSET 反例=SCAN）');
  }
});
