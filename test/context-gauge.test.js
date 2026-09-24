'use strict';
// test/context-gauge.test.js — C2 服务端面（T6）：
//   C2-2：GET /api/sessions/:id/context-gauge —— 行序 ASC、行形状八字段逐项核对、
//         compact 边界标记、context_tokens 通路（已知 id 非 null / 未知 id null）、
//         limit 钳界（?limit=-1 钳 1、?limit=99999 钳 500、缺省 100）、
//         截断方向（?limit=3 于 5 行 → 恰最新 3 行且仍 ASC）；
//   C2-4：GET /api/sessions —— 每会话 latest_model 三字段（「更晚但 input 更小」
//         行守护 rowid-max 语义；无 model 行会话三字段 null 且存在）；
//   C2-6：dbq.todayUsage() 增列（input/cache_read SUM + cache_hit_rate 响应侧算好）
//         与 /api/widget/today 直通——端点是 index.js:214 `res.json(dbq.todayUsage())`
//         直通，本文件用同款最小 express 直通挂载断言 HTTP 面（规格 C2-6 判定物是
//         HTTP 响应；不必拉起完整 index.js），db 层断言为充分补充。
// 全部 fixture 在 os.tmpdir()（ZCODE_DB 等 env 注入，require 前设置），绝不触碰
// 真实库；水位/列表行全部落在「昨日」——todayUsage 只聚合当日（startOfDayMs
// 本地零点起），昨日行不污染 C2-6 的当日 SUM 断言（用例间隔离钉）。
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const { createFixtureDb, buildSession, buildModelUsage } = require('./helpers/fixture-db');
const modelsMeta = require('../server/models-meta');

// fixture 的 model_id 必须与 models-meta 表键一致（任务卡 fixture 注意）。
// KNOWN_A＝表首键（任意档）；KNOWN_200K＝200K 档已知 id（与 KNOWN_A 构成不同
// 窗口的两会话，C2-4 分别断言两档 context_tokens）。
const KNOWN_A = Object.keys(modelsMeta.table)[0];
const KNOWN_200K = 'GLM-5.1';
assert.ok(modelsMeta.resolve(KNOWN_A) != null, '前置：表首键须可 resolve');
assert.ok(modelsMeta.resolve(KNOWN_200K)?.context_tokens === 200000,
  '前置：GLM-5.1 须为 200K 档（models-meta 表混档，显式选档）');
const CTX_A = modelsMeta.resolve(KNOWN_A).context_tokens;
const UNKNOWN = 'nonexistent-model-x';

const Y = Date.now() - 86400_000; // 昨日基线（今日行只在 C2-6 段插入）

const fx = createFixtureDb();
buildSession(fx.conn, [
  { id: 's1', title: '水位序列', task_type: 'interactive', directory: 'F:/demo',
    parent_id: null, project_id: 'p1', time_created: Y - 500e3, time_updated: Y - 100e3 },
  { id: 'sA', title: 'rowid 守护甲', task_type: 'interactive', directory: 'F:/demo',
    parent_id: null, project_id: 'p1', time_created: Y - 70e3, time_updated: Y - 40e3 },
  { id: 'sB', title: 'rowid 守护乙', task_type: 'interactive', directory: 'F:/demo',
    parent_id: null, project_id: 'p1', time_created: Y - 40e3, time_updated: Y - 30e3 },
  { id: 'sC', title: '无 model 行', task_type: 'interactive', directory: 'F:/demo',
    parent_id: null, project_id: 'p1', time_created: Y - 30e3, time_updated: Y - 20e3 },
  { id: 'sBig', title: '钳界载荷', task_type: 'interactive', directory: 'F:/demo',
    parent_id: null, project_id: 'p1', time_created: Y - 10e3, time_updated: Y - 5e3 },
]);
buildModelUsage(fx.conn, [
  // s1：input 递增 3 行 + 1 行 query_source='compact' + 1 行 input=0/
  // cache_creation=100/cache_read=50 的 error 行（未知模型——context_tokens null 路径）
  { id: 'g1', session_id: 's1', turn_id: 't1', trace_id: 'tr1', status: 'completed',
    started_at: Y - 500e3, completed_at: Y - 499e3, duration_ms: 1000,
    query_source: 'main_turn', model_id: KNOWN_A, provider_id: 'zai',
    input_tokens: 100, output_tokens: 10, reasoning_tokens: null,
    cache_read_input_tokens: 40, cache_creation_input_tokens: 5,
    tool_call_count: 0, computed_total_tokens: 110 },
  { id: 'g2', session_id: 's1', turn_id: 't2', trace_id: 'tr1', status: 'completed',
    started_at: Y - 400e3, completed_at: Y - 399e3, duration_ms: 1000,
    query_source: 'main_turn', model_id: KNOWN_A, provider_id: 'zai',
    input_tokens: 200, output_tokens: 10, reasoning_tokens: null,
    cache_read_input_tokens: 80, cache_creation_input_tokens: 8,
    tool_call_count: 0, computed_total_tokens: 210 },
  { id: 'g3', session_id: 's1', turn_id: 't3', trace_id: 'tr2', status: 'completed',
    started_at: Y - 300e3, completed_at: Y - 299e3, duration_ms: 1000,
    query_source: 'main_turn', model_id: KNOWN_A, provider_id: 'zai',
    input_tokens: 300, output_tokens: 10, reasoning_tokens: null,
    cache_read_input_tokens: 120, cache_creation_input_tokens: 10,
    tool_call_count: 0, computed_total_tokens: 310 },
  { id: 'g4', session_id: 's1', turn_id: 't4', trace_id: 'tr2', status: 'completed',
    started_at: Y - 200e3, completed_at: Y - 199e3, duration_ms: 4000,
    query_source: 'compact', model_id: KNOWN_A, provider_id: 'zai',
    input_tokens: 5000, output_tokens: 900, reasoning_tokens: null,
    cache_read_input_tokens: 4000, cache_creation_input_tokens: 100,
    tool_call_count: 0, computed_total_tokens: 5900 },
  { id: 'g5', session_id: 's1', turn_id: 't5', trace_id: 'tr3', status: 'error',
    started_at: Y - 100e3, completed_at: Y - 99e3, duration_ms: 500,
    query_source: 'main_turn', model_id: UNKNOWN, provider_id: 'zai',
    input_tokens: 0, output_tokens: 0, reasoning_tokens: null,
    cache_read_input_tokens: 50, cache_creation_input_tokens: 100,
    tool_call_count: 0, computed_total_tokens: 0,
    error_type: 'api_error', error_code: '500', error_message: 'boom' },
  // sA：a1（更早、rowid 小、input 999）→ a2（更晚、rowid 大、input 120）——
  // 「更晚但 input 更小」守护 rowid-max 语义（误用 MAX(input) 会得 999）
  { id: 'a1', session_id: 'sA', turn_id: 'ta1', trace_id: 'tra', status: 'completed',
    started_at: Y - 60e3, completed_at: Y - 59e3, duration_ms: 1000,
    query_source: 'main_turn', model_id: KNOWN_200K, provider_id: 'zai',
    input_tokens: 999, output_tokens: 10, reasoning_tokens: null,
    cache_read_input_tokens: 100, cache_creation_input_tokens: 10,
    tool_call_count: 0, computed_total_tokens: 1009 },
  { id: 'a2', session_id: 'sA', turn_id: 'ta2', trace_id: 'tra', status: 'completed',
    started_at: Y - 50e3, completed_at: Y - 49e3, duration_ms: 1000,
    query_source: 'main_turn', model_id: KNOWN_200K, provider_id: 'zai',
    input_tokens: 120, output_tokens: 10, reasoning_tokens: null,
    cache_read_input_tokens: 60, cache_creation_input_tokens: 6,
    tool_call_count: 0, computed_total_tokens: 130 },
  // sB：不同 model_id（KNOWN_A 档）的最新行
  { id: 'b1', session_id: 'sB', turn_id: 'tb1', trace_id: 'trb', status: 'completed',
    started_at: Y - 35e3, completed_at: Y - 34e3, duration_ms: 1000,
    query_source: 'main_turn', model_id: KNOWN_A, provider_id: 'zai',
    input_tokens: 777, output_tokens: 10, reasoning_tokens: null,
    cache_read_input_tokens: 300, cache_creation_input_tokens: 30,
    tool_call_count: 0, computed_total_tokens: 787 },
  // sBig：600 行（截断方向/钳界/缺省 limit 载荷；started_at 严格递增）
  ...Array.from({ length: 600 }, (_, i) => ({
    id: 'big' + i, session_id: 'sBig', turn_id: 'tbig' + i, trace_id: 'trbig',
    status: 'completed', started_at: Y + i, completed_at: Y + i + 500,
    duration_ms: 500, query_source: 'main_turn', model_id: KNOWN_A,
    provider_id: 'zai', input_tokens: 1000 + i, output_tokens: 1,
    reasoning_tokens: null, cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0, tool_call_count: 0,
    computed_total_tokens: 1001 + i,
  })),
]);

process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = fx.logDir;
process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;
const dbq = require('../server/db');
const sessionsRouter = require('../server/routes/sessions');

test.after(() => {
  try { dbq.db().close(); } catch { /* already closed */ }
  dbq.invalidateDb();
  fx.cleanup();
});

function listen(app) {
  const server = app.listen(0, '127.0.0.1');
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

function sessionsApp() {
  const app = express();
  app.use('/api/sessions', sessionsRouter);
  return app;
}

// index.js:214 同款直通挂载（res.json(dbq.todayUsage())，零加工）
function widgetTodayApp() {
  const app = express();
  app.get('/api/widget/today', (_req, res) => res.json(dbq.todayUsage()));
  return app;
}

test('C2-2: s1 序列默认 5 行、行序 ASC、行形状八字段逐项核对、compact 边界、context_tokens 通路', async () => {
  const server = await listen(sessionsApp());
  try {
    const port = server.address().port;
    const r = await get(port, '/api/sessions/s1/context-gauge');
    assert.equal(r.status, 200);
    const rows = JSON.parse(r.body).rows;
    assert.equal(rows.length, 5, '5 行序列默认全量返回');
    // 行序 ASC：started_at 严格递增（ISO 字符串比较即可——同时区同格式字典序=时序）
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].started_at < rows[i].started_at, `行 ${i - 1}→${i} 须 ASC`);
    }
    // 行形状：规格 C2-2 字面八字段（API 响应缺列被本用例直接抓到）+ 边界标记字段
    const FIELDS = ['started_at', 'turn_id', 'model_id', 'query_source', 'input_tokens',
      'cache_read_input_tokens', 'cache_creation_input_tokens', 'context_tokens'];
    for (const row of rows) {
      for (const k of FIELDS) assert.ok(k in row, `行缺字段 ${k}`);
      assert.ok('compact_boundary' in row, '行缺 compact_boundary');
    }
    // started_at ISO 形态
    assert.match(rows[0].started_at, /^\d{4}-\d{2}-\d{2}T/, 'started_at 须为 ISO');
    // 逐项与构造值核对
    assert.deepStrictEqual(rows.map(x => x.turn_id), ['t1', 't2', 't3', 't4', 't5']);
    assert.deepStrictEqual(rows.map(x => x.input_tokens), [100, 200, 300, 5000, 0]);
    assert.deepStrictEqual(rows.map(x => x.cache_read_input_tokens), [40, 80, 120, 4000, 50]);
    assert.deepStrictEqual(rows.map(x => x.cache_creation_input_tokens), [5, 8, 10, 100, 100]);
    assert.deepStrictEqual(rows.map(x => x.query_source),
      ['main_turn', 'main_turn', 'main_turn', 'compact', 'main_turn']);
    // compact 行带边界标记（恰在 g4）
    assert.deepStrictEqual(rows.map(x => x.compact_boundary), [false, false, false, true, false]);
    // context_tokens 通路：已知 id → models-meta 窗口；未知 id（g5）→ null
    for (const row of rows.slice(0, 4)) assert.equal(row.context_tokens, CTX_A);
    assert.equal(rows[4].context_tokens, null, '未知模型 context_tokens 须为 null');
    assert.equal(rows[4].model_id, UNKNOWN);
    // 回退分子的原始三列透传（input=0 行的 cache_creation=100/cache_read=50——
    // §2.0 勘误回退计算在 T7 组件做，db/路由层不预判）
    assert.equal(rows[4].input_tokens, 0);
  } finally { server.close(); }
});

test('C2-2: 截断方向——?limit=3 于 5 行 → 恰最新 3 行且行序仍 ASC（取最新端钉）', async () => {
  const server = await listen(sessionsApp());
  try {
    const r = await get(server.address().port, '/api/sessions/s1/context-gauge?limit=3');
    assert.equal(r.status, 200);
    const rows = JSON.parse(r.body).rows;
    assert.equal(rows.length, 3);
    // 首行恰为截断窗外最旧行 t3——ASC+LIMIT 直取最旧端（t1 起）的实现在此红
    assert.deepStrictEqual(rows.map(x => x.turn_id), ['t3', 't4', 't5']);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].started_at < rows[i].started_at, '截断后行序仍须 ASC');
    }
  } finally { server.close(); }
});

test('C2-2: limit 钳界——?limit=-1 钳 1（负 LIMIT 整表物化事故形态守护）', async () => {
  const server = await listen(sessionsApp());
  try {
    const r = await get(server.address().port, '/api/sessions/s1/context-gauge?limit=-1');
    assert.equal(r.status, 200);
    const rows = JSON.parse(r.body).rows;
    assert.equal(rows.length, 1, '负值须钳 1');
    assert.equal(rows[0].turn_id, 't5', '钳 1 后恰为最新一行');
  } finally { server.close(); }
});

test('C2-2: limit 钳界——缺省 100、?limit=99999 钳 500（600 行载荷实证两端）', async () => {
  const server = await listen(sessionsApp());
  try {
    const port = server.address().port;
    const def = await get(port, '/api/sessions/sBig/context-gauge');
    const defRows = JSON.parse(def.body).rows;
    assert.equal(defRows.length, 100, '缺省 limit=100');
    // 缺省取最新端：i=500..599，ASC（input=1000+i）
    assert.equal(defRows[0].input_tokens, 1500);
    assert.equal(defRows[defRows.length - 1].input_tokens, 1599);

    const big = await get(port, '/api/sessions/sBig/context-gauge?limit=99999');
    const bigRows = JSON.parse(big.body).rows;
    assert.equal(bigRows.length, 500, '?limit=99999 须钳 500');
    assert.equal(bigRows[0].input_tokens, 1100, '钳 500 取最新端：首行 i=100');
    assert.equal(bigRows[bigRows.length - 1].input_tokens, 1599);
    for (let i = 1; i < bigRows.length; i++) {
      assert.ok(bigRows[i - 1].started_at <= bigRows[i].started_at, '钳后行序仍 ASC');
    }
  } finally { server.close(); }
});

test('C2-4: GET /api/sessions 每会话 latest_model 三字段（rowid-max 守护 + 空会话三 null 且存在）', async () => {
  const server = await listen(sessionsApp());
  try {
    const r = await get(server.address().port, '/api/sessions');
    assert.equal(r.status, 200);
    const sessions = JSON.parse(r.body).sessions;
    const by = Object.fromEntries(sessions.map(s => [s.id, s]));
    // sA：a1（input 999，rowid 小）先插、a2（input 120，rowid 大/更晚）后插——
    // rowid-max 语义取 a2；误用 MAX(input_tokens) 会得 999。
    assert.deepStrictEqual(by.sA.latest_model,
      { model_id: KNOWN_200K, input_tokens: 120, context_tokens: 200000 });
    // sB：不同 model_id（KNOWN_A 档）→ 各自窗口
    assert.deepStrictEqual(by.sB.latest_model,
      { model_id: KNOWN_A, input_tokens: 777, context_tokens: CTX_A });
    // sC：无任何 model 行——三字段均为 null 且存在（deepStrictEqual 钉键集，
    // 缺字段即红）
    assert.deepStrictEqual(by.sC.latest_model,
      { model_id: null, input_tokens: null, context_tokens: null });
  } finally { server.close(); }
});

test('C2-6: 当日行 input 1000/cache_read 400 → todayUsage 与 /api/widget/today 直通均含三字段', async () => {
  // 当日 completed 行（今日基线＝此刻，startOfDayMs 本地零点窗内）
  buildModelUsage(fx.conn, [{
    id: 'today1', session_id: 's1', turn_id: 'ttoday', trace_id: 'trtoday',
    status: 'completed', started_at: Date.now() - 1000, completed_at: Date.now() - 500,
    duration_ms: 500, query_source: 'main_turn', model_id: KNOWN_A, provider_id: 'zai',
    input_tokens: 1000, output_tokens: 100, reasoning_tokens: null,
    cache_read_input_tokens: 400, cache_creation_input_tokens: 50,
    tool_call_count: 0, computed_total_tokens: 1100,
  }]);
  // db 层断言（文件内注释：端点是 index.js:214 res.json(dbq.todayUsage()) 直通，
  // db 层即响应体——HTTP 例为同款最小挂载的补充钉）
  const out = dbq.todayUsage();
  assert.equal(out.input_tokens, 1000);
  assert.equal(out.cache_read_tokens, 400);
  assert.equal(out.cache_hit_rate, 0.4);
  // 既有速度口径字段并存、命名不混淆（tokens=output+reasoning=100）
  assert.equal(out.tokens, 100);
  assert.equal(out.requests, 1);

  const server = await listen(widgetTodayApp());
  try {
    const r = await get(server.address().port, '/api/widget/today');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.equal(j.input_tokens, 1000);
    assert.equal(j.cache_read_tokens, 400);
    assert.equal(j.cache_hit_rate, 0.4);
  } finally { server.close(); }
});

test('C2-6: 当日全 input=0（全零行日）→ cache_hit_rate === null（零分母，禁 NaN/Infinity）', async () => {
  // 清场后只留全零行（C2-2/C2-4 断言已完成，模型行清空不影响本例）
  fx.conn.prepare('DELETE FROM model_usage').run();
  buildModelUsage(fx.conn, [{
    id: 'zero1', session_id: 's1', turn_id: 'tzero', trace_id: 'trzero',
    status: 'completed', started_at: Date.now() - 1000, completed_at: Date.now() - 500,
    duration_ms: 500, query_source: 'main_turn', model_id: KNOWN_A, provider_id: 'zai',
    input_tokens: 0, output_tokens: 7, reasoning_tokens: null,
    cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    tool_call_count: 0, computed_total_tokens: 7,
  }]);
  const out = dbq.todayUsage();
  assert.equal(out.input_tokens, 0);
  assert.equal(out.cache_read_tokens, 0);
  assert.strictEqual(out.cache_hit_rate, null, '零分母须为 null，不得 NaN/Infinity');

  const server = await listen(widgetTodayApp());
  try {
    const r = await get(server.address().port, '/api/widget/today');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.equal(j.input_tokens, 0);
    assert.strictEqual(j.cache_hit_rate, null, 'HTTP 面零分母同为 null');
  } finally { server.close(); }
});
