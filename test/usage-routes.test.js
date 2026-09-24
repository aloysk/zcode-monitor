'use strict';
// test/usage-routes.test.js — /api/usage 族三端点的 HTTP 层测试（ecosystem-
// round2-batch1 T3：C1-1~C1-4、C1-9、C5-1/C5-2 的 API 面 + 可注入钉 + C1-5
// 路由侧源码契约）。
// 形态：express listen(0) + http.get（sessions-routes.test.js 同款）；env 指向
// os.tmpdir() fixture 后再 require 路由（路由级联 require db，db.js 模块级缓存
// 连接——env 先行是既有约定）。
// 数据布局（usage-queries.test.js 同款时间轴约定）：单 fixture 全程共享，
// node:test 顺序执行，各测试按「先断言后插行」推进——每阶段断言只看当时已在
// 库的行，24h 窗内的跨阶段行按构造值累计（w1/tl 等基线行的值均已计入期望值，
// 逐处标注）。窗口边界行：3d 行入 7d/30d 档、31d 行不入 30d 档（C1-1 钉）。
// ⚠ 禁止单筛本文件用例（node --test --test-name-pattern / IDE 单用例重跑）及
// 删除/改名早段用例：阶段 1 是空库断言（须最先跑），其后各阶段在同库上累计
// 插行、晚段期望值计入早段基线行（如阶段 4 totals 计入阶段 2 的 w1）——单筛
// 晚段会因基线行缺失而失红。整文件顺序跑是唯一受支持形态（I-测-1 评审钉：
// test.before 前插基线与阶段 1 空库断言互斥，故以头注警告为约）。
// 构造行与 usage-queries.test.js 共享 test/helpers/usage-baselines.js 单点定义
//（I-测-7）；HTTP 层期望值因跨阶段累计语义独有、互补不重叠（数值钉因累计
// 口径相异而各自持有——queries 是窗口隔离，本文件是 24h 窗累计）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { createFixtureDb, buildSession, buildModelUsage, buildToolUsage, buildTurnUsage } =
  require('./helpers/fixture-db');
const { wsemRows, nailRows, tnailRows, attrRows } = require('./helpers/usage-baselines');

const fx = createFixtureDb(); // 不 seed：空库起步（C1-9 的「新库首次部署」形态）
process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = fx.logDir;
process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;

const { makeUsageRouter } = require('../server/routes/usage');
const usageRouter = makeUsageRouter(); // 缺省 retentionDays=30（生产 index.js 同款）

const now = Date.now();
const MIN = 60e3; // DAY 不再本文件使用（构造行经 helpers/usage-baselines.js 注入）
const H = (m) => now - m * MIN; // now − m 分钟

test.after(() => {
  try { require('../server/db').db().close(); } catch { /* already closed */ }
  try { require('../server/db').invalidateDb(); } catch { /* ignore */ }
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
// 每用例独立挂载（路由无状态，实例复用），用后即收——sessions-routes 先例。
async function withUsageServer(fn, router = usageRouter) {
  const a = express();
  a.use('/api/usage', router);
  const server = await listen(a);
  try { await fn(server.address().port); } finally { server.close(); }
}
const isIso = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s));

// ── 阶段 1：空库（C1-9 + C5-1 空窗条款——新库是 /api/usage/* 首次部署形态）──
test('C1-9 空库: turns/tools 200、totals 全零/数组空、meta 完整不抛错；attribution 空窗空数组+meta', async () => {
  await withUsageServer(async (port) => {
    const t = await getJson(port, '/api/usage/turns?window=24h');
    assert.equal(t.status, 200);
    assert.deepEqual(t.body.totals, {
      turns: 0, completed: 0, errors: 0, cancelled: 0,
      model_requests: 0, retries: 0, tool_errors: 0,
      avg_ttft_ms: null, context_exceeded: 0,
    });
    assert.deepEqual(t.body.by_error_type, []);
    assert.equal(t.body.by_error_type_truncated, false);
    assert.deepEqual(t.body.timeline, []);
    assert.equal(t.body.window, '24h');
    assert.ok(isIso(t.body.since), 'since 须为 ISO 时间');
    assert.equal(t.body.meta.retention_days, 30);

    const g = await getJson(port, '/api/usage/tools?window=24h');
    assert.equal(g.status, 200);
    assert.deepEqual(g.body.groups, []);
    assert.equal(g.body.window, '24h');
    assert.ok(isIso(g.body.since));
    assert.equal(g.body.meta.retention_days, 30);

    // C5-1 空窗条款：session 层空数组 + meta；turn 层不存在的会话同款空态
    const a = await getJson(port, '/api/usage/attribution?window=24h');
    assert.equal(a.status, 200);
    assert.deepEqual(a.body.rows, []);
    assert.equal(a.body.level, 'session');
    assert.equal(a.body.meta.retention_days, 30);
    assert.equal(a.body.meta.truncated, false);
    assert.ok(isIso(a.body.since));
    const at = await getJson(port, '/api/usage/attribution?window=24h&level=turn&session_id=no-such');
    assert.equal(at.status, 200);
    assert.deepEqual(at.body.rows, []);
    assert.equal(at.body.meta.truncated, false);
    assert.equal(at.body.level, 'turn');
  });
});

// ── 阶段 2：C1-1 窗口语义（wsem 三组行：65min / 3d / 31d）──
test('C1-1 表驱动: 三端点 × {24h,7d,30d,999d}——999d 回退回显 24h；30d 含 3d 行不含 31d 边界行', async () => {
  const wsem = wsemRows(H, now);
  buildTurnUsage(fx.conn, wsem.turns);
  buildToolUsage(fx.conn, wsem.tools);
  buildModelUsage(fx.conn, wsem.models);

  await withUsageServer(async (port) => {
    // [请求 window, 期望回显, 期望窗内行数]：999d 未知值回退 24h（回显+行为一致）；
    // 30d=完整保留窗——含 3d 行、不含 31d 边界行。
    const cases = [['24h', '24h', 1], ['7d', '7d', 2], ['30d', '30d', 2], ['999d', '24h', 1]];
    for (const [w, echo, n] of cases) {
      const t = await getJson(port, `/api/usage/turns?window=${w}`);
      assert.equal(t.status, 200, `turns?window=${w}`);
      assert.equal(t.body.window, echo, `turns?window=${w} 回显`);
      assert.equal(t.body.totals.turns, n, `turns?window=${w} 计数`);
      assert.equal(t.body.timeline.length, n, `turns?window=${w} 时间线`);

      const g = await getJson(port, `/api/usage/tools?window=${w}`);
      assert.equal(g.status, 200, `tools?window=${w}`);
      assert.equal(g.body.window, echo, `tools?window=${w} 回显`);
      assert.equal(g.body.groups.length, 1, '唯一工具名 Bash');
      assert.equal(g.body.groups[0].calls, n, `tools?window=${w} calls`);

      const a = await getJson(port, `/api/usage/attribution?window=${w}`);
      assert.equal(a.status, 200, `attribution?window=${w}`);
      assert.equal(a.body.window, echo, `attribution?window=${w} 回显`);
      assert.equal(a.body.rows.length, n, `attribution?window=${w} 行数`);

      // 宽窗（30d 档）rowid 尾界候选钳制的 meta.scope 如实申报（slow_tools_scope
      // 先例）；窄窗无此键。turns 不钳（无 scope）。
      if (w === '30d') {
        assert.match(g.body.meta.scope, /^recent_30d_capped_\d+_rows$/, 'tools 宽窗 scope 申报');
        assert.match(a.body.meta.scope, /^recent_30d_capped_\d+_rows$/, 'attribution 宽窗 scope 申报');
      } else {
        assert.equal('scope' in g.body.meta, false, `tools?window=${w} 不应有 scope`);
        assert.equal('scope' in a.body.meta, false, `attribution?window=${w} 不应有 scope`);
      }
      const t2 = await getJson(port, `/api/usage/turns?window=${w}`);
      assert.equal('scope' in t2.body.meta, false, 'turns 恒无 scope（不钳制）');
    }
  });
});

// ── 阶段 3：C5-1/C5-2 归因两级数值钉 + 400 锚钉（sA/sB 行 8min；wsA 为阶段 2
// 基线行，累计值计入期望）──
test('C5-1 两级数值: session 层聚合/降序/分解/标题 + turn 层逐项按 token 降序 + 400 缺 session_id', async () => {
  const attr = attrRows(H);
  buildSession(fx.conn, attr.sessions);
  buildModelUsage(fx.conn, attr.models);

  await withUsageServer(async (port) => {
    // session 层：按 tokens 降序（sB 300 > sA 175 > wsA 10——wsA 是阶段 2 的 65min
    // 基线行，无 session 表行 → title=null）；by_query_source 为 token 口径分解。
    const a = await getJson(port, '/api/usage/attribution?window=24h');
    assert.equal(a.status, 200);
    assert.equal(a.body.level, 'session');
    assert.deepEqual(a.body.rows, [
      { session_id: 'sB', title: '会话B', tokens: 300, duration_ms_sum: 500, calls: 1,
        by_query_source: { main_turn: 300 } },
      { session_id: 'sA', title: '会话A', tokens: 175, duration_ms_sum: 3100, calls: 3,
        by_query_source: { main_turn: 100, subagent: 50, workflow_child: 25 } },
      { session_id: 'wsA', title: null, tokens: 10, duration_ms_sum: 1000, calls: 1,
        by_query_source: { main_turn: 10 } },
    ]);
    assert.equal(a.body.meta.truncated, false);
    // 口径标注义务三端点同款（与 C1-2/C1-3 对称）
    assert.equal(a.body.meta.retention_days, 30);
    assert.ok(isIso(a.body.since), 'attribution since 须为 ISO 时间');

    // turn 层：会话内逐 turn 分解，按 token 降序，同深度逐项断言
    const t = await getJson(port, '/api/usage/attribution?window=24h&level=turn&session_id=sA');
    assert.equal(t.status, 200);
    assert.equal(t.body.level, 'turn');
    assert.deepEqual(t.body.rows, [
      { turn_id: 'ta', tokens: 125, duration_ms_sum: 1100, model_calls: 2, tool_calls: 3 },
      { turn_id: 'tb', tokens: 50, duration_ms_sum: 2000, model_calls: 1, tool_calls: 0 },
    ]);
    assert.equal(t.body.meta.truncated, false);
    assert.equal(t.body.meta.retention_days, 30);
    assert.ok(isIso(t.body.since));

    // 400：level=turn 缺 session_id（计划拍板：下钻必须有锚）
    const bad = await getJson(port, '/api/usage/attribution?window=24h&level=turn');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'bad_request');
  });
});

test('C5-2 截断钳界: ?limit=1 → top1 + meta.truncated 如实；?limit=-1 钳 1（两级同验）', async () => {
  await withUsageServer(async (port) => {
    const one = await getJson(port, '/api/usage/attribution?window=24h&limit=1');
    assert.equal(one.status, 200);
    assert.equal(one.body.rows.length, 1);
    assert.equal(one.body.rows[0].session_id, 'sB', '仅 top1（tokens 降序首行）');
    assert.equal(one.body.meta.truncated, true, '截断如实标注，不静默');

    const neg = await getJson(port, '/api/usage/attribution?window=24h&limit=-1');
    assert.equal(neg.status, 200);
    assert.equal(neg.body.rows.length, 1, 'limit=-1 钳 1（负 LIMIT 整表物化事故形态回归守护）');
    assert.equal(neg.body.meta.truncated, true);

    // turn 层同款：sA 两 turn → top1=ta + truncated
    const t1 = await getJson(port, '/api/usage/attribution?window=24h&level=turn&session_id=sA&limit=1');
    assert.deepEqual(t1.body.rows.map(r => r.turn_id), ['ta']);
    assert.equal(t1.body.meta.truncated, true);
  });
});

// ── 阶段 4：C1-2/C1-3 数值钉（nail 三行 45-50min、工具两行 15min；24h 窗内
// 累计含阶段 2 基线行 w1/wt1——其构造值计入期望）──
test('C1-2 turns 数值钉: totals 逐项/by_error_type 与构造值相等；meta.retention_days===30、since ISO', async () => {
  buildTurnUsage(fx.conn, nailRows(H));
  await withUsageServer(async (port) => {
    const j = await getJson(port, '/api/usage/turns?window=24h');
    assert.equal(j.status, 200);
    // 24h 窗 = 阶段2 w1（completed、mrc=1、ttft=500——I-测-9 补回字段后计入 AVG）
    // + nail 三行
    assert.deepEqual(j.body.totals, {
      turns: 4, completed: 2, errors: 1, cancelled: 1,
      model_requests: 7, retries: 2, tool_errors: 1,
      avg_ttft_ms: 1625, // (500+1000+3000+2000)/4（w1 ttft=500 计入平均）
      context_exceeded: 1,
    });
    assert.deepEqual(j.body.by_error_type, [
      { type: '(none)', count: 3 }, // w1+tn2+tn3（无 error_type）
      { type: 'api_error', count: 1 },
    ]);
    assert.equal(j.body.by_error_type_truncated, false);
    assert.equal(j.body.meta.retention_days, 30);
    assert.ok(isIso(j.body.since), 'since 须为 ISO 时间');
  });
});

test('C1-3 tools 数值钉: 分组逐项与构造值相等（含三分布对象）；meta 与 turns 对称断言', async () => {
  buildToolUsage(fx.conn, tnailRows(H));
  await withUsageServer(async (port) => {
    const j = await getJson(port, '/api/usage/tools?window=24h');
    assert.equal(j.status, 200);
    // Bash 组 = 阶段2 wt1（65min，completed 100ms/ro1/d0/none/100B）+ bg1；
    // calls 2 > Read 1 → 降序确定。
    assert.deepEqual(j.body.groups, [
      { tool_name: 'Bash', calls: 2, errors: 0, success_rate: 1,
        avg_ms: 500, max_ms: 900, output_bytes: 220,
        read_only: { ro: 1, rw: 1 },
        destructive: { 1: 1, 0: 1 },
        approval_status: { none: 2 } },
      { tool_name: 'Read', calls: 1, errors: 1, success_rate: 0,
        avg_ms: null, // 仅 completed 口径：组内无完成行 → 全 NULL AVG 语义
        max_ms: 50,   // 全行口径：错误行时长仍进 max
        output_bytes: 0,
        read_only: { ro: 1, rw: 0 },
        destructive: { 1: 0, 0: 1 },
        approval_status: { denied: 1 } },
    ]);
    // 对称断言（口径标注义务覆盖本族全部端点）
    assert.equal(j.body.meta.retention_days, 30);
    assert.ok(isIso(j.body.since), 'since 须为 ISO 时间');
    assert.equal(j.body.window, '24h');
  });
});

// ── 阶段 5：C1-4 时间线钳界（tl 三行 20-30min + 601 行 38min 批量——批量行
// 比 tl 行旧，limit=2 仍取 tl 最新两行；24h 窗内共 608 行 > 500 上限，钳界可判）──
test('C1-4 时间线钳界: limit=2 恰 2 行新→旧、行形状字段齐；limit=-1 钳 1；limit=99999 钳 500', async () => {
  buildTurnUsage(fx.conn, [
    { turn_id: 'tl1', session_id: 'tlm', status: 'completed', started_at: H(30),
      duration_ms: 1000, model_request_count: 1 },
    { turn_id: 'tl2', session_id: 'tlm', status: 'completed', started_at: H(25),
      duration_ms: 1000, model_request_count: 1 },
    { turn_id: 'tl3', session_id: 'tlm', status: 'completed', started_at: H(20),
      duration_ms: 1000, model_request_count: 1 },
  ]);
  const bulk = [];
  for (let i = 1; i <= 601; i++) {
    bulk.push({ turn_id: `c${String(i).padStart(3, '0')}`, session_id: 'capbulk',
      status: 'completed', started_at: H(38), duration_ms: 10, model_request_count: 1 });
  }
  buildTurnUsage(fx.conn, bulk);

  await withUsageServer(async (port) => {
    const two = await getJson(port, '/api/usage/turns?window=24h&limit=2');
    assert.equal(two.status, 200);
    assert.equal(two.body.timeline.length, 2, '恰 2 行');
    assert.deepEqual(two.body.timeline.map(r => r.turn_id), ['tl3', 'tl2'], '新→旧（批量行更旧不入前 2）');
    const r0 = two.body.timeline[0];
    for (const k of ['turn_id', 'session_id', 'started_at', 'duration_ms',
      'time_to_first_token_ms', 'status', 'model_retry_count', 'tool_error_count',
      'error_type', 'context_exceeded', 'computed_total_tokens']) {
      assert.ok(k in r0, `时间线行缺列 ${k}`);
    }
    assert.ok(isIso(r0.started_at), 'started_at 须为 ISO');

    const neg = await getJson(port, '/api/usage/turns?window=24h&limit=-1');
    assert.equal(neg.status, 200);
    assert.equal(neg.body.timeline.length, 1, 'limit=-1 钳 1');
    assert.equal(neg.body.timeline[0].turn_id, 'tl3', '钳 1 后取最新');

    const big = await getJson(port, '/api/usage/turns?window=24h&limit=99999');
    assert.equal(big.status, 200);
    assert.equal(big.body.timeline.length, 500, 'limit=99999 钳上限 500（窗内 608 行，无钳即 608）');
  });
});

// ── 阶段 6：可注入钉（工厂形态——retentionDays 常量注入可测）──
test('可注入钉: makeUsageRouter({retentionDays:7}) → meta.retention_days === 7', async () => {
  await withUsageServer(async (port) => {
    const j = await getJson(port, '/api/usage/turns?window=24h');
    assert.equal(j.status, 200);
    assert.equal(j.body.meta.retention_days, 7);
  }, makeUsageRouter({ retentionDays: 7 }));
});

// ── 阶段 7：C1-5 路由侧源码契约（frontend-contract.test.js 读文件形态）──
test('C1-5 路由侧契约: resolveWindow 全文件恰一处定义；index.js 含 app.use(\'/api/usage\' 装配', () => {
  const readServer = (p) => fs.readFileSync(path.join(__dirname, '..', 'server', p), 'utf8');
  const routeSrc = readServer(path.join('routes', 'usage.js'));
  assert.equal((routeSrc.match(/function resolveWindow/g) || []).length, 1,
    '窗口解析具名函数仅一处定义（共享 helper 源码契约钉）');
  const indexSrc = readServer('index.js');
  assert.ok(indexSrc.includes("app.use('/api/usage'"),
    "index.js 须含 app.use('/api/usage' 装配");
});
