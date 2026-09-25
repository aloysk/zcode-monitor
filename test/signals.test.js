'use strict';
// test/signals.test.js — C6 会话状态信号（ecosystem-round2-batch2 T2：
// 纯分类器 + db 查询族 + /api/sessions 扩展 + /api/signals/summary + EQP 机检）。
// 覆盖：C6-1 六分支逐项（含 NULL 边界与窗口注入）/ C6-2 查询族行为（卫生窗、
// MAX(rowid) 写入序最新、截断保最新侧、窗口参数）/ C6-3 signal 字段 additive 钉 /
// C6-5 summary 固定形状与全库域（分页无关）/ fixture message 索引镜像契约 /
// EQP 机检（在飞路 rowid 尾界、近窗路 started_at 索引强制，无基表 SCAN）。
// 约定（db-smoke/usage-queries 头注同款）：env 先注入再 require，db.js 模块级
// 缓存连接 → 本文件共享一个 fixture；空库 HTTP 断言先跑（新库是首次部署的
// 真实形态），其后各阶段在同库上累计插行。
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const { createFixtureDb, buildSession, buildModelUsage, buildMessage } =
  require('./helpers/fixture-db');
const { classifySessions, idleSignal, SIGNALS_WINDOW_MS } = require('../server/signals');

const fx = createFixtureDb();
process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = fx.logDir;
process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;
const dbq = require('../server/db');
const sessionsRouter = require('../server/routes/sessions');
const { makeSignalsRouter } = require('../server/routes/signals');

test.after(() => {
  try { dbq.db().close(); } catch { /* already closed */ }
  dbq.invalidateDb();
  fx.cleanup();
});

const MIN = 60e3;
// 时间轴锚（各 HTTP/查询阶段取当下时刻，分钟级余量下测试耗时漂移无影响）。
const T = (m) => Date.now() - m * MIN; // now − m 分钟
// 精确值锚：种子行的毫秒值在插入时记录（T() 每次重算 Date.now() 有毫秒漂移，
// 断言须对照插入时的原值）。
const seeded = { adv2Started: 0, adv2Completed: 0, w1Completed: 0 };

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
function makeApp() {
  const app = express();
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/signals', makeSignalsRouter());
  return app;
}

// ── C6-1：纯分类器（零 IO 直测，输入全注入）────────────────────────────────
const W = SIGNALS_WINDOW_MS; // 15min 缺省窗
const mkIn = (over = {}) => ({
  inflightSessions: over.inflightSessions || new Set(),
  recentModel: over.recentModel || new Map(),
  sessions: over.sessions || new Map(),
  now: over.now != null ? over.now : 1_000_000_000_000,
});
const N = 1_000_000_000_000;

test('C6-1(a): 在飞集合成员 → working/high，压过近窗 error 与 waiting 启发式', () => {
  const out = classifySessions(mkIn({
    inflightSessions: new Set(['sA']),
    recentModel: new Map([['sA', {
      status: 'error', error_type: 'api_error',
      started_at: N - 2 * MIN, completed_at: null, rid: 9 }]]),
    sessions: new Map([['sA', { task_type: 'interactive' }]]),
  }));
  assert.deepEqual(out.get('sA'), {
    session_id: 'sA', state: 'working', confidence: 'high', waiting_since: null,
    reason: '在飞：卫生窗内存在未收尾的 assistant 请求行（livegen 同源判据）',
  });
});

test('C6-1(b): 最新行 error 且 started_at 新鲜（completed_at=NULL 形态）→ broken/high', () => {
  const out = classifySessions(mkIn({
    recentModel: new Map([['sB', {
      status: 'error', error_type: 'api_error',
      started_at: N - 2 * MIN, completed_at: null, rid: 5 }]]),
    sessions: new Map([['sB', { task_type: 'interactive' }]]),
  }));
  assert.deepEqual(out.get('sB'), {
    session_id: 'sB', state: 'broken', confidence: 'high', waiting_since: null,
    reason: '近窗 error：最新 model 行 status=error（error_type=api_error）',
  });
  // error_type 为 NULL 的 error 行（外部库形态）：reason 不带括号尾巴
  const out2 = classifySessions(mkIn({
    recentModel: new Map([['sB2', {
      status: 'error', error_type: null,
      started_at: N - 1 * MIN, completed_at: null, rid: 6 }]]),
    sessions: new Map([['sB2', { task_type: 'subagent' }]]),
  }));
  assert.equal(out2.get('sB2').state, 'broken', 'broken 不限 task_type（近窗 error 含全部会话）');
  assert.equal(out2.get('sB2').reason, '近窗 error：最新 model 行 status=error');
});

test('C6-1(c): interactive+completed 新鲜+不在飞 → waiting/low，waiting_since=该行 completed_at', () => {
  const out = classifySessions(mkIn({
    recentModel: new Map([['sC', {
      status: 'completed', error_type: null,
      started_at: N - 5 * MIN, completed_at: N - 4 * MIN, rid: 7 }]]),
    sessions: new Map([['sC', { task_type: 'interactive' }]]),
  }));
  assert.deepEqual(out.get('sC'), {
    session_id: 'sC', state: 'waiting', confidence: 'low', waiting_since: N - 4 * MIN,
    reason: '时间启发式：interactive 会话最新 model 行已收尾且当前无在飞请求（可能误报）',
  });
});

test('C6-1(d): 无近窗活动 → idle 且 confidence===null、waiting_since===null（字段存在钉）', () => {
  const out = classifySessions(mkIn({
    sessions: new Map([['sD', { task_type: 'interactive' }]]),
  }));
  const sig = out.get('sD');
  assert.equal(sig.state, 'idle');
  assert.ok('confidence' in sig && 'waiting_since' in sig, '字段存在，非缺字段');
  assert.ok(sig.confidence === null && sig.waiting_since === null);
  assert.equal(typeof sig.reason, 'string');
  // idleSignal 缺省形状与分类器同源（路由兜底单一来源钉）
  assert.deepEqual(idleSignal(), {
    state: 'idle', confidence: null, waiting_since: null,
    reason: '近窗无在飞请求与 model 活动',
  });
});

test('C6-1(e): subagent/workflow_child completed 新鲜 → idle（task_type 过滤钉）', () => {
  for (const t of ['subagent', 'subagent_child', 'workflow_child']) {
    const out = classifySessions(mkIn({
      recentModel: new Map([['sE', {
        status: 'completed', error_type: null,
        started_at: N - 3 * MIN, completed_at: N - 2 * MIN, rid: 8 }]]),
      sessions: new Map([['sE', { task_type: t }]]),
    }));
    const sig = out.get('sE');
    assert.equal(sig.state, 'idle', `${t} 的完成是后台行为，不进 waiting`);
    assert.equal(sig.waiting_since, null);
  }
  // 会话行缺失（model 行先于 session 行落库形态）→ 不按 interactive 猜
  const out = classifySessions(mkIn({
    recentModel: new Map([['sE2', {
      status: 'completed', error_type: null,
      started_at: N - 3 * MIN, completed_at: N - 2 * MIN, rid: 9 }]]),
  }));
  assert.equal(out.get('sE2').state, 'idle');
});

test('C6-1(f): 在飞且近窗 error → working（优先级钉，既往回合不降级）', () => {
  const out = classifySessions(mkIn({
    inflightSessions: new Set(['sF']),
    recentModel: new Map([['sF', {
      status: 'error', error_type: 'api_error',
      started_at: N - 1 * MIN, completed_at: N - 50e3, rid: 10 }]]),
    sessions: new Map([['sF', { task_type: 'interactive' }]]),
  }));
  assert.equal(out.get('sF').state, 'working');
  assert.equal(out.get('sF').confidence, 'high');
});

test('C6-1 注入面: windowMs 小值生效；waiting_since 的 NULL 边界（completed+completed_at=NULL）', () => {
  // 窗口注入：error 行 started_at 距 now 6min，注入 5min 窗 → 不新鲜 → idle
  const out = classifySessions(
    mkIn({ recentModel: new Map([['sG', {
      status: 'error', error_type: 'x',
      started_at: N - 6 * MIN, completed_at: null, rid: 1 }]]),
      sessions: new Map([['sG', { task_type: 'interactive' }]]) }),
    { windowMs: 5 * MIN },
  );
  assert.equal(out.get('sG').state, 'idle', 'SIGNALS_WINDOW_MS 可注入小值可测');
  // NULL 边界：completed 行 completed_at=NULL → waiting_since=null（不参与聚合）
  const out2 = classifySessions(mkIn({
    recentModel: new Map([['sH', {
      status: 'completed', error_type: null,
      started_at: N - 2 * MIN, completed_at: null, rid: 2 }]]),
    sessions: new Map([['sH', { task_type: 'interactive' }]]),
  }));
  assert.equal(out2.get('sH').state, 'waiting');
  assert.strictEqual(out2.get('sH').waiting_since, null);
});

// ── C6-5/C6-3 空库面（先于任何种子行：新库是首次部署的真实形态）──────────────
test('C6-5 空库: /api/signals/summary → 200 全零 + generated_at 存在', async () => {
  const server = await listen(makeApp());
  try {
    const r = await get(server.address().port, '/api/signals/summary');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.deepEqual(Object.keys(j).sort(),
      ['broken_count', 'generated_at', 'oldest_waiting_ms', 'waiting_count'],
      '固定形状恰四字段');
    assert.equal(j.waiting_count, 0);
    assert.equal(j.broken_count, 0);
    assert.equal(j.oldest_waiting_ms, 0);
    assert.ok(Number.isFinite(Date.parse(j.generated_at)), 'generated_at 为 ISO 时间');
  } finally { server.close(); }
});

test('C6-3 空库: /api/sessions → 空数组（无 signal 工作也不抛错）', async () => {
  const server = await listen(makeApp());
  try {
    const r = await get(server.address().port, '/api/sessions');
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { sessions: [] });
  } finally { server.close(); }
});

// ── C6-2：查询族行为（fixture 种子，阶段累计）───────────────────────────────
test('C6-2 卫生窗: 在飞集合恰含新鲜 assistant 行会话；僵尸行（time_created 6min）与已收尾行排除', () => {
  buildSession(fx.conn, [
    { id: 'sgW', title: '在飞', task_type: 'interactive', directory: 'F:/demo',
      time_created: T(30), time_updated: T(0.4) },
    { id: 'sgZ', title: '僵尸', task_type: 'interactive', directory: 'F:/demo',
      time_created: T(30), time_updated: T(0.4) },
    { id: 'sgWait', title: '等待', task_type: 'interactive', directory: 'F:/demo',
      time_created: T(60), time_updated: T(4) },
  ]);
  buildMessage(fx.conn, [
    // 在飞：assistant + completed 缺失 + 双卫生窗内
    { id: 'm1', session_id: 'sgW', time_created: T(0.5), time_updated: T(0.1), sequence: 1,
      data: JSON.stringify({ role: 'assistant', time: { start: T(0.5) } }) },
    // 僵尸：completed 缺失但 time_created 距今 6min（> created 卫生窗 5min）
    //——time_updated 保持新鲜，钉住 created 窗单侧裁剪
    { id: 'm2', session_id: 'sgZ', time_created: T(6), time_updated: T(0.1), sequence: 1,
      data: JSON.stringify({ role: 'assistant', time: { start: T(6) } }) },
    // 已收尾：completed 存在 → 不在飞
    { id: 'm3', session_id: 'sgWait', time_created: T(4.5), time_updated: T(4), sequence: 2,
      data: JSON.stringify({ role: 'assistant', time: { start: T(4.5), completed: T(4) } }) },
  ]);
  const inflight = dbq.signalsInflightSessionIds();
  assert.deepEqual([...inflight], ['sgW'], '卫生窗 5min/90s 生效：僵尸行与已收尾行排除');
});

test('C6-2 MAX(rowid): 对抗样本——started_at 更早但 rowid 更大（晚落库长请求）被取为最新', () => {
  buildSession(fx.conn, [
    { id: 'sgAdv', title: '晚落库', task_type: 'interactive', directory: 'F:/demo',
      time_created: T(60), time_updated: T(5) },
  ]);
  // 插入序=隐式 rowid 升序：先插 started 3min 行（rowid 小），后插 started 6min
  // 行（rowid 大、写入序最新）——最新伴随列须取 rowid 大者，非 started_at 新者。
  seeded.adv2Started = T(6);
  seeded.adv2Completed = T(5);
  buildModelUsage(fx.conn, [
    { id: 'adv1', session_id: 'sgAdv', turn_id: 'k1', status: 'completed',
      started_at: T(3), completed_at: T(2.9), duration_ms: 6000, query_source: 'main_turn',
      model_id: 'glm-5', computed_total_tokens: 100 },
    { id: 'adv2', session_id: 'sgAdv', turn_id: 'k2', status: 'completed',
      started_at: seeded.adv2Started, completed_at: seeded.adv2Completed,
      duration_ms: 60e3, query_source: 'main_turn',
      model_id: 'glm-5', computed_total_tokens: 200 },
  ]);
  const m = dbq.signalsRecentModelLatest(T(15));
  assert.equal(m.get('sgAdv').started_at, seeded.adv2Started, 'MAX(rowid) 语义：取写入序最新行');
  assert.equal(m.get('sgAdv').completed_at, seeded.adv2Completed);
  assert.ok(m.get('sgAdv').rid > 0, 'rid 透出（调试对账锚）');
  // 行形状钉：五伴随列 + rid
  assert.deepEqual(Object.keys(m.get('sgAdv')).sort(),
    ['completed_at', 'error_type', 'rid', 'started_at', 'status']);
});

test('C6-2 窗口注入与多会话近窗域: 窗外行不计入；error 含 completed_at=NULL 形态照常入域', () => {
  buildSession(fx.conn, [
    { id: 'sgB', title: '报错', task_type: 'interactive', directory: 'F:/demo',
      time_created: T(60), time_updated: T(2) },
    { id: 'sgSub', title: '子代理', task_type: 'subagent', directory: 'F:/demo',
      time_created: T(60), time_updated: T(3) },
    { id: 'sgOld', title: '窗外', task_type: 'interactive', directory: 'F:/demo',
      time_created: T(600), time_updated: T(20) },
    { id: 'sgIdle', title: '无活动', task_type: 'interactive', directory: 'F:/demo',
      time_created: T(600), time_updated: T(2) },
  ]);
  seeded.w1Completed = T(4);
  buildModelUsage(fx.conn, [
    { id: 'b1', session_id: 'sgB', turn_id: 'e1', status: 'error',
      started_at: T(2), completed_at: null, duration_ms: 1000, query_source: 'main_turn',
      model_id: 'glm-5', computed_total_tokens: 10, error_type: 'api_error' },
    { id: 'w1', session_id: 'sgWait', turn_id: 'k3', status: 'completed',
      started_at: T(5), completed_at: seeded.w1Completed, duration_ms: 60e3,
      query_source: 'main_turn', model_id: 'glm-5', computed_total_tokens: 300 },
    { id: 'sb1', session_id: 'sgSub', turn_id: 'k4', status: 'completed',
      started_at: T(3), completed_at: T(2.9), duration_ms: 6000, query_source: 'subagent',
      model_id: 'glm-5', computed_total_tokens: 50 },
    { id: 'o1', session_id: 'sgOld', turn_id: 'k5', status: 'completed',
      started_at: T(20), completed_at: T(19.5), duration_ms: 30e3, query_source: 'main_turn',
      model_id: 'glm-5', computed_total_tokens: 70 },
  ]);
  const m15 = dbq.signalsRecentModelLatest(T(15));
  assert.ok(m15.has('sgB') && m15.has('sgWait') && m15.has('sgSub') && m15.has('sgAdv'));
  assert.ok(!m15.has('sgOld'), 'started_at 窗外行不计入（15min 窗）');
  assert.equal(m15.get('sgB').completed_at, null, 'error+completed_at=NULL 形态入域（不漏判面）');
  // 窗口参数注入：2.5min 窗下窗内仅剩 sgB 行（T2）——sgWait(T5)/sgSub(T3)/
  // sgAdv 两行(T3/T6) 全部裁出，窗口收窄逐会话生效
  const m2_5 = dbq.signalsRecentModelLatest(T(2.5));
  assert.deepEqual([...m2_5.keys()], ['sgB'], '窗口参数注入生效：窗外行不计入');
});

test('C6-2 截断保最新侧: SIGNALS_MAX_ROWS 注入小值——截断保最新侧且不抛错；被截会话不产生假信号', () => {
  buildModelUsage(fx.conn, [
    { id: 'new1', session_id: 'sgNew', turn_id: 'k6', status: 'completed',
      started_at: T(1), completed_at: T(0.9), duration_ms: 6000, query_source: 'main_turn',
      model_id: 'glm-5', computed_total_tokens: 10 },
    { id: 'old1', session_id: 'sgOlder', turn_id: 'k7', status: 'completed',
      started_at: T(10), completed_at: T(9.9), duration_ms: 6000, query_source: 'main_turn',
      model_id: 'glm-5', computed_total_tokens: 20 },
  ]);
  // cap=1：子查询 ORDER BY started_at DESC LIMIT 1 只留窗内最新行（sgNew，T1）
  //——若无 ORDER BY，SQLite 按索引升序返回、截断保最老行，被截会话将误判。
  const cut = dbq.signalsRecentModelLatest(T(15), { maxRows: 1 });
  assert.deepEqual([...cut.keys()], ['sgNew'], '截断保最新侧（窗内恰留最新行会话）');
  // 被截会话（sgOlder 的 T(10) 行被裁）经分类器不产生假信号：无近窗行路径 →
  // idle——组装层把截断后的 recentModel 原样喂给分类器，此处钉组合语义。
  const out = classifySessions({
    inflightSessions: new Set(),
    recentModel: cut,
    sessions: new Map([['sgOlder', { task_type: 'interactive' }],
      ['sgNew', { task_type: 'interactive' }]]),
    now: Date.now(),
  }, {});
  assert.equal(out.get('sgOlder').state, 'idle', '被截会话不因截断产生假信号');
  assert.equal(out.get('sgOlder').confidence, null);
  assert.equal(out.get('sgNew').state, 'waiting');
  // 组装层缺省 cap 不抛错（截断护栏只在异常风暴窗生效）
  assert.doesNotThrow(() => dbq.sessionsWithSignals({ sinceMs: T(15) }));
});

// ── C6-3：/api/sessions 响应扩展（additive 钉）───────────────────────────────
test('C6-3: 每行含 signal 字段（working/waiting/broken/idle 四态逐项）+ 既有字段不变', async () => {
  buildSession(fx.conn, [
    { id: 'sgP1', title: '页一首行', task_type: 'interactive', directory: 'F:/demo',
      time_created: T(10), time_updated: T(1 / 60) },
    { id: 'sgP2', title: '页一次行', task_type: 'interactive', directory: 'F:/demo',
      time_created: T(10), time_updated: T(2 / 60) },
  ]);
  const server = await listen(makeApp());
  try {
    const port = server.address().port;
    const r = await get(port, '/api/sessions');
    assert.equal(r.status, 200);
    const rows = JSON.parse(r.body).sessions;
    assert.ok(rows.length >= 8, '全部种子会话在默认页（≤100）');
    const by = Object.fromEntries(rows.map(s => [s.id, s]));
    // 既有字段不变（batch1 契约 additive 钉）
    for (const s of rows) {
      for (const k of ['id', 'title', 'task_type', 'directory', 'parent_id',
        'time_created', 'time_updated', 'model_calls', 'tool_calls',
        'total_tokens', 'latest_model', 'signal']) {
        assert.ok(k in s, `行缺既有字段/新字段 ${k}`);
      }
      assert.deepEqual(Object.keys(s.signal).sort(),
        ['confidence', 'reason', 'state', 'waiting_since'], 'signal 恰四字段');
    }
    assert.equal(by.sgWait.model_calls, 1);
    assert.equal(by.sgWait.total_tokens, 300);
    assert.equal(by.sgWait.latest_model.model_id, 'glm-5');
    // 四态逐项
    assert.equal(by.sgW.signal.state, 'working');
    assert.equal(by.sgW.signal.confidence, 'high');
    assert.equal(by.sgB.signal.state, 'broken');
    assert.equal(by.sgB.signal.confidence, 'high');
    assert.equal(by.sgWait.signal.state, 'waiting');
    assert.equal(by.sgWait.signal.confidence, 'low');
    assert.equal(by.sgWait.signal.waiting_since, seeded.w1Completed, 'waiting_since=最新 completed 行 completed_at（原值 ms）');
    assert.equal(by.sgAdv.signal.state, 'waiting');
    assert.equal(by.sgAdv.signal.waiting_since, seeded.adv2Completed, '晚落库行（MAX(rowid)）的 completed_at');
    assert.equal(by.sgSub.signal.state, 'idle', 'subagent completed → idle');
    assert.equal(by.sgIdle.signal.state, 'idle', '无近窗活动 → idle');
    assert.ok(by.sgIdle.signal.confidence === null && by.sgIdle.signal.waiting_since === null,
      'idle 字段存在值为 null');
    assert.equal(by.sgOld.signal.state, 'idle', '窗外行会话 → idle');
  } finally { server.close(); }
});

// ── C6-5：/api/signals/summary（全库近窗域，与分页无关）───────────────────────
test('C6-5: 分页域 vs 全库域分歧行（waiting 会话不在第 1 页）→ summary 计数全库一致', async () => {
  const server = await listen(makeApp());
  try {
    const port = server.address().port;
    // 页内域（limit=2）：time_updated 最新的 sgP1/sgP2 占第 1 页，waiting 会话
    //（sgWait/sgAdv，time_updated 4-5min 前）全在第 2 页。
    const p1 = await get(port, '/api/sessions?limit=2');
    const ids1 = JSON.parse(p1.body).sessions.map(s => s.id);
    assert.deepEqual(ids1.sort(), ['sgP1', 'sgP2'], '第 1 页不含 waiting 会话');
    // 全库域：waiting_count=2（sgWait 4min + sgAdv 5min）、broken_count=1（sgB）
    const r = await get(port, '/api/signals/summary');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.deepEqual(Object.keys(j).sort(),
      ['broken_count', 'generated_at', 'oldest_waiting_ms', 'waiting_count']);
    assert.equal(j.waiting_count, 2, '与 limit 无关（全库近窗域）');
    assert.equal(j.broken_count, 1);
    // oldest = now − min(waiting_since) = 约 5min（sgAdv T(5)；容忍测试耗时漂移）
    assert.ok(j.oldest_waiting_ms >= 5 * MIN && j.oldest_waiting_ms <= 5 * MIN + 60e3,
      `oldest_waiting_ms≈5min（实得 ${j.oldest_waiting_ms}ms）`);
    assert.ok(Number.isFinite(Date.parse(j.generated_at)));
  } finally { server.close(); }
});

// ── EQP 机检（fixture 计划形态守护，usage-queries 阶段 9 同款捕获缝）───────────
test('EQP 形态: 在飞路 rowid 尾界 SEARCH、近窗路 started_at 索引强制、无基表 SCAN', () => {
  const captureSql = (thunk) => {
    const proxy = dbq.db();
    const orig = proxy.prepare;
    const seen = [];
    proxy.prepare = (sql) => { seen.push(sql); return orig.call(proxy, sql); };
    try { thunk(); } finally { proxy.prepare = orig; }
    return seen;
  };
  // 预热连接级 sqlite_master 探测记忆（首次调用多一条探测 SQL，捕获只要三条业务 SQL）
  dbq.sessionsWithSignals({ sinceMs: T(15) });
  const sqls = captureSql(() => dbq.sessionsWithSignals({ sinceMs: T(15) }))
    .filter(s => !s.includes('sqlite_master'));
  assert.equal(sqls.length, 3, '查询计数钉：在飞 + 近窗最新 + task_type 补齐');
  const explain = (sql) => {
    const named = [...sql.matchAll(/@(\w+)/g)].map(m => m[1]);
    const anon = (sql.match(/\?/g) || []).length;
    const stmt = fx.conn.prepare('EXPLAIN QUERY PLAN ' + sql);
    const rows = named.length
      ? stmt.all(Object.fromEntries(named.map(n => [n, n === 'since' ? T(15) : 2000])))
      : stmt.all(...Array.from({ length: anon }, (_, i) => (i < 2 ? Date.now() : 'sgW')));
    return rows.map(r => r.detail).join('\n');
  };
  const plans = sqls.map(explain);
  // 路①（message 在飞集合）：INTEGER PRIMARY KEY 尾界，禁 GROUP BY 翻转形态
  assert.match(plans[0], /SEARCH message USING INTEGER PRIMARY KEY \(rowid>/);
  assert.ok(!/SCAN\s+message/.test(plans[0]), '禁 SCAN message（含 GROUP BY 翻转形态）');
  // 路②（model 近窗最新行）：INDEXED BY 强制 started_at 索引
  assert.match(plans[1], /SEARCH model_usage USING INDEX model_usage_started_model_idx/);
  assert.ok(!/SCAN\s+model_usage/.test(plans[1]), '禁 SCAN model_usage（TEMP B-TREE 与子查询协程允许）');
  // 路③（session task_type）：主键寻址无基表 SCAN
  assert.ok(!/SCAN\s+session/.test(plans[2]), 'session 走主键 IN 寻址');
  // 源码契约：在飞 SQL 禁 GROUP BY/DISTINCT/子查询包裹去重（EQP 翻转三形态）
  assert.ok(!/GROUP BY|DISTINCT/.test(sqls[0]), '去重在 JS 侧（new Set），SQL 形态钉');
});

// ── 缺索引库回退分支（usage-queries 阶段 10 同款，零执行缺口）────────────────
// signalsRecentModelLatest 的「缺 model_usage_started_model_idx 库不加
// INDEXED BY」回退（外部 ZCODE_DB 形态）：DROP INDEX + 拨掉连接级探测记忆后
// 同数据对拍——结果与带索引路径逐位一致（慢但可用取舍，overviewKpis 先例），
// 结束前重建索引并拨正记忆。
test('缺索引回退: 无 model_usage_started_model_idx 时近窗查询不加 INDEXED BY、结果逐位一致', () => {
  const withIdx = dbq.signalsRecentModelLatest(T(15));
  fx.conn.exec('DROP INDEX model_usage_started_model_idx');
  const conn = dbq.db();
  const cached = conn._hasStartedModelIdx;
  conn._hasStartedModelIdx = undefined; // 拨掉探测记忆，强制走 sqlite_master 重探测
  try {
    const noIdx = dbq.signalsRecentModelLatest(T(15));
    assert.deepEqual(noIdx, withIdx, '同数据对拍：回退路径结果与带索引路径逐位一致');
    assert.equal(conn._hasStartedModelIdx, false, '重探测须如实记下索引缺失');
  } finally {
    fx.conn.exec('CREATE INDEX IF NOT EXISTS model_usage_started_model_idx ON model_usage(started_at, provider_id, model_id)');
    conn._hasStartedModelIdx = cached !== undefined ? cached : true;
  }
});

// ── fixture 索引镜像契约（usage-queries 阶段 12 同款；message 面为本任务新增）──
test('fixture 索引镜像契约: message 三索引与真实库 sqlite_master 一致（名/列序/建序）', () => {
  const idxOf = (tbl) => fx.conn.pragma(`index_list(${tbl})`)
    .filter(i => i.origin === 'c')
    .map(i => ({
      name: i.name,
      unique: !!i.unique,
      cols: fx.conn.pragma(`index_info(${i.name})`).map(r => r.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(idxOf('message'), [
    { name: 'message_session_sequence_idx', unique: false,
      cols: ['session_id', 'sequence', 'time_created', 'id'] },
    { name: 'message_session_time_created_id_idx', unique: false,
      cols: ['session_id', 'time_created', 'id'] },
  ], '真库 sqlite_master 实读（2026-09-25，规格 §1.2 事实 4）；虚构 idx_message_session 已移除');
  // 建序钉（rootpage 升序＝创建序）：time_created_id_idx(真库 11) 先、
  // sequence_idx(真库 16286) 后——SQLite 在等价 session 前导覆盖索引间选
  // 「创建序最晚」者，建序即 EQP 保真度（tool_usage 三索引同族教训）。
  const seq = fx.conn.prepare(
    "SELECT name, rootpage FROM sqlite_master WHERE type='index' AND tbl_name='message' AND name IN ('message_session_time_created_id_idx','message_session_sequence_idx')"
  ).all().sort((a, b) => a.rootpage - b.rootpage);
  assert.deepEqual(seq.map(r => r.name),
    ['message_session_time_created_id_idx', 'message_session_sequence_idx'],
    '创建序照真库 rootpage 序');
});
