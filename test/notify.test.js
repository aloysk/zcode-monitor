'use strict';
// test/notify.test.js — C8 本地提醒规则引擎（ecosystem-round2-batch2 T4：
// evaluateRules 纯函数 + 引擎防噪 + SSE notify 事件 + 源码契约 + EQP 机检）。
// 覆盖：C8-1 触发语义（纯函数层四规则逐项 + 引擎层 interactive 过滤与无状态
// 钉）/ C8-2 防噪（同规则冷却窗、waiting per-session 独立、跨规则互不冷却、
// 默认值对表钉）/ C8-3 SSE notify 帧（载荷字段+id 形态+severity 映射+session
// 仅 per-session 规则携带、close 退订无泄漏、text/event-stream 写头点仍 2 处、
// live.js 无评估调用点）+ notify 新增 SQL 的 fixture EQP 机检。
// 约定（signals.test.js 头注同款）：env 先注入再 require，db.js 模块级缓存
// 连接 → 本文件共享一个 fixture；各测试阶段 wipe 后按需重种（会话 id 不复用）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const EventEmitter = require('events');
const { createFixtureDb, buildSession, buildModelUsage, buildToolUsage } =
  require('./helpers/fixture-db');
const notify = require('../server/notify');
const { RULE_DEFAULTS, evaluateRules, makeNotifyEngine, sharedNotifyBus,
  NOTIFY_TICK_MS } = notify;

const fx = createFixtureDb();
process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = fx.logDir;
process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;
const dbq = require('../server/db');
const live = require('../server/routes/live');

test.after(() => {
  try { dbq.db().close(); } catch { /* already closed */ }
  dbq.invalidateDb();
  fx.cleanup();
});

const MIN = 60e3;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(cond, deadlineMs, stepMs = 50) {
  const deadline = Date.now() + deadlineMs;
  while (!cond() && Date.now() < deadline) await sleep(stepMs);
  return cond();
}
function wipe() {
  fx.conn.exec(
    'DELETE FROM model_usage; DELETE FROM tool_usage; DELETE FROM session; DELETE FROM message;');
}
// 测试引擎：注入总线捕获发射 + 超长 tick（手动 tick() 驱动，间隔不自发触发）。
function makeTestEngine(ruleOverrides = {}) {
  const bus = new EventEmitter();
  const sent = [];
  bus.on('notify', p => sent.push(p));
  const engine = makeNotifyEngine({ dbq, bus, tickMs: 1e9, rules: ruleOverrides });
  return { engine, sent };
}

function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise(resolve => server.on('listening', () => resolve(server)));
}

// ── C8-1：纯函数层（输入全注入，零 IO 直测）──────────────────────────────────
const N = 1_700_000_000_000; // 与宿主时刻无关的固定锚

test('C8-1 error_burst: 5min 窗 error 行（model+tool）≥3 触发、2 行不触发', () => {
  const fire = evaluateRules(
    { errorCounts: { model: 2, tool: 1 }, now: N }, { rules: RULE_DEFAULTS });
  assert.equal(fire.length, 1);
  assert.equal(fire[0].rule, 'error_burst');
  assert.equal(fire[0].severity, 'err');
  assert.equal(fire[0].intensity, 'sound');
  assert.ok(!('session' in fire[0]), '全局规则不带 session 键');
  assert.equal(fire[0].id, `error_burst:all:${N}`, 'id=rule:session|all:at 模板串');
  assert.match(fire[0].body, /错误 3 行（model 2 \+ tool 1）/);

  const quiet = evaluateRules(
    { errorCounts: { model: 1, tool: 1 }, now: N }, { rules: RULE_DEFAULTS });
  assert.equal(quiet.length, 0, '2 行不触发');
});

test('C8-1 waiting_timeout: 持续=now−waiting_since ≥5min 触发、不足不触发', () => {
  // 默认关（R-28 降级处置）——判定语义用显式开启钉（回翻 enabled 即恢复）。
  const on = { rules: { ...RULE_DEFAULTS,
    waiting_timeout: { ...RULE_DEFAULTS.waiting_timeout, enabled: true } } };
  const mk = (since) => evaluateRules({
    waitingSessions: [{ session_id: 'w1', waiting_since: since }],
    titles: new Map([['w1', '调试会话']]),
    now: N,
  }, on);
  const fire = mk(N - 6 * MIN);
  assert.equal(fire.length, 1);
  assert.equal(fire[0].rule, 'waiting_timeout');
  assert.equal(fire[0].session, 'w1');
  assert.equal(fire[0].id, `waiting_timeout:w1:${N}`);
  assert.ok(fire[0].body.includes('调试会话'), 'body 含会话标题（库内字符串，消费侧消毒）');
  assert.equal(fire[0].severity, 'warn');
  assert.equal(fire[0].intensity, 'alert');
  assert.equal(mk(N - 4 * MIN).length, 0, '4min 不足 5min 不触发');
  // waiting_since=null 边界：不参与时长判定（NaN 防护，数据层滤后纯函数侧再守）
  assert.equal(evaluateRules({
    waitingSessions: [{ session_id: 'w2', waiting_since: null }], now: N,
  }, on).length, 0);
});

test('C8-1 token_threshold: 1M 档触发、5M 档再触发（每档一候选）；900k 不触发', () => {
  const mk = (sum) => evaluateRules({
    sessionTokens: new Map([['t1', sum]]),
    titles: new Map([['t1', null]]), // 标题缺失回退会话 id
    now: N,
  }, { rules: RULE_DEFAULTS });
  // 默认关：不喂 config 覆盖时 enabled=false → 无候选
  assert.equal(mk(1_200_000).length, 0, '默认关（§2.2 需求 2 表）');
  const on = { rules: { ...RULE_DEFAULTS,
    token_threshold: { ...RULE_DEFAULTS.token_threshold, enabled: true } } };
  assert.deepEqual(
    evaluateRules({ sessionTokens: new Map([['t1', 900_000]]), now: N }, on),
    [], '900k 低于首档');
  const t1 = evaluateRules({ sessionTokens: new Map([['t1', 1_200_000]]), now: N }, on);
  assert.equal(t1.length, 1);
  assert.equal(t1[0].rule, 'token_threshold');
  assert.ok(t1[0].body.includes('按 30 天保留窗口径'), '气泡文案披露保留窗口径');
  assert.ok(t1[0].body.includes('已跨 1M 档'));
  assert.ok(t1[0].body.includes('t1'), '标题缺失回退会话 id');
  const t2 = evaluateRules({ sessionTokens: new Map([['t1', 5_500_000]]), now: N }, on);
  assert.deepEqual(t2.map(n => n.cooldownKey),
    ['token_threshold:t1:1000000', 'token_threshold:t1:5000000'],
    '跨两档两候选，冷却键按档位分立');
});

test('C8-1 inactive: 无新行 ≥30min 且 24h 窗曾有活动触发；其余三形态不触发', () => {
  const on = { rules: { ...RULE_DEFAULTS,
    inactive: { ...RULE_DEFAULTS.inactive, enabled: true } } };
  const mk = (startedAt, recent) => evaluateRules(
    { lastModelRow: startedAt == null ? null : { started_at: startedAt },
      recentActivity: recent, now: N }, on);
  const fire = mk(N - 40 * MIN, true);
  assert.equal(fire.length, 1);
  assert.equal(fire[0].rule, 'inactive');
  assert.equal(fire[0].severity, 'ok');
  assert.equal(fire[0].intensity, 'quiet');
  assert.ok(!('session' in fire[0]));
  assert.equal(mk(N - 40 * MIN, false).length, 0, '24h 窗无活动（如空库/静默库）不触发');
  assert.equal(mk(N - 20 * MIN, true).length, 0, '20min 不足 30min 不触发');
  assert.equal(mk(null, true).length, 0, '空表（无 model 行）不触发');
});

test('C8-1 无状态钉: 注入两次相同输入，条件评估结果一致', () => {
  const inputs = {
    errorCounts: { model: 3, tool: 0 },
    waitingSessions: [{ session_id: 'w1', waiting_since: N - 6 * MIN }],
    sessionTokens: new Map([['t1', 1_200_000]]),
    titles: new Map([['w1', 'A']]),
    lastModelRow: { started_at: N - 40 * MIN },
    recentActivity: true,
    now: N,
  };
  const all = { rules: Object.fromEntries(Object.entries(RULE_DEFAULTS).map(
    ([k, v]) => [k, { ...v, enabled: true }])) };
  const a = evaluateRules(inputs, all);
  const b = evaluateRules(inputs, all);
  assert.deepEqual(a, b, '纯函数不维护 per-session 首次判定时刻等任何跨调用状态');
  assert.deepEqual(a.map(n => n.rule),
    ['error_burst', 'waiting_timeout', 'token_threshold', 'inactive'],
    '四规则同输入齐触发（severity/intensity 两轴逐项可断言）');
});

// ── C8-2：默认值钉（§2.2 需求 2 表逐项相等——常量导出断言）───────────────────
test('C8-2 默认值钉: 四规则 on/off、窗/阈值、冷却、强度、severity 与表逐项相等', () => {
  assert.equal(NOTIFY_TICK_MS, 30 * 1000, 'tick 缺省 30s');
  assert.deepEqual(RULE_DEFAULTS.error_burst, {
    enabled: true, windowMs: 5 * MIN, minErrors: 3,
    cooldownMs: 10 * MIN, intensity: 'sound', severity: 'err',
  });
  assert.deepEqual(RULE_DEFAULTS.waiting_timeout, {
    // 默认关＝R-28 降级处置（C6-8 误报 39.8% 超 20% 线，spec §2.1 需求 7——
    // spec §2.2 需求 2 表原值 true，交付默认按处置决策落「默认关」臂）。
    enabled: false, timeoutMs: 5 * MIN,
    cooldownMs: 15 * MIN, intensity: 'alert', severity: 'warn',
  });
  assert.deepEqual(RULE_DEFAULTS.token_threshold, {
    enabled: false, tiers: [1e6, 5e6, 2e7],
    cooldownMs: Infinity, intensity: 'quiet', severity: 'warn',
  }, 'cooldownMs=Infinity 即「每会话每档位一次」的统一冷却模型');
  assert.deepEqual(RULE_DEFAULTS.inactive, {
    enabled: false, idleMs: 30 * MIN, recentMs: 24 * 60 * MIN,
    cooldownMs: 60 * MIN, intensity: 'quiet', severity: 'ok',
  });
});

// ── C8-1 引擎层：分类器消费（interactive 过滤）+ 无状态钉 ────────────────────
test('C8-1 引擎层: waiting_timeout 仅 interactive（subagent waiting 不触发）；evaluate 无状态', () => {
  wipe();
  buildSession(fx.conn, [
    { id: 'it1', title: '交互等待', task_type: 'interactive', directory: 'F:/demo',
      time_created: Date.now() - 60 * MIN, time_updated: Date.now() - 7 * MIN },
    { id: 'sub1', title: '子代理', task_type: 'subagent', directory: 'F:/demo',
      time_created: Date.now() - 60 * MIN, time_updated: Date.now() - 5 * MIN },
  ]);
  buildModelUsage(fx.conn, [
    { id: 'iw1', session_id: 'it1', turn_id: 'k1', status: 'completed',
      started_at: Date.now() - 8 * MIN, completed_at: Date.now() - 7.5 * MIN,
      duration_ms: 30e3, query_source: 'main_turn', model_id: 'glm-5',
      computed_total_tokens: 100 },
    { id: 'sw1', session_id: 'sub1', turn_id: 'k2', status: 'completed',
      started_at: Date.now() - 6 * MIN, completed_at: Date.now() - 5.5 * MIN,
      duration_ms: 30e3, query_source: 'subagent', model_id: 'glm-5',
      computed_total_tokens: 100 },
  ]);
  const { engine } = makeTestEngine({ waiting_timeout: { enabled: true } });
  try {
    const notes = engine.evaluate();
    assert.equal(notes.length, 1, 'subagent 的 completed 不构成等待（分类器 task_type 过滤）');
    assert.equal(notes[0].rule, 'waiting_timeout');
    assert.equal(notes[0].session, 'it1');
    assert.ok(notes[0].body.includes('交互等待'), '标题经 session 表补齐');
    // 无状态钉（引擎条件评估）：两次 evaluate 的 at/id 随时钟必然推进，归一化
    // 时间戳后逐字段一致——钉「不维护 per-session 首次判定时刻等隐藏状态把
    // 候选吞掉/翻倍」。
    const norm = (arr) => arr.map(({ at, id, ...rest }) => rest);
    assert.deepEqual(norm(engine.evaluate()), norm(notes));
  } finally { engine.stop(); }
});

// ── C8-2：引擎防噪（冷却门只在发送路径）─────────────────────────────────────
test('C8-2 error_burst 全局冷却: 同条件第二次 tick 不再发', () => {
  wipe();
  const now = Date.now();
  buildModelUsage(fx.conn, Array.from({ length: 3 }, (_, i) => ({
    id: 'eb' + i, session_id: 'eb1', turn_id: 'e' + i, status: 'error',
    started_at: now - 60e3, completed_at: now - 59e3, duration_ms: 1000,
    query_source: 'main_turn', model_id: 'glm-5', error_type: 'api_error',
  })));
  const { engine, sent } = makeTestEngine();
  try {
    engine.tick();
    assert.equal(sent.filter(p => p.rule === 'error_burst').length, 1);
    engine.tick(); // 同数据二次评估：条件仍成立，冷却拦发送
    assert.equal(sent.filter(p => p.rule === 'error_burst').length, 1, '10min 全局冷却窗内不重发');
  } finally { engine.stop(); }
});

test('C8-2 waiting_timeout per-session 冷却独立 + 跨规则互不冷却', async () => {
  wipe();
  const t0 = Date.now();
  buildSession(fx.conn, [
    { id: 'wA', title: '等待A', task_type: 'interactive', directory: 'F:/demo',
      time_created: t0 - 60 * MIN, time_updated: t0 - 3e3 },
    { id: 'wB', title: '等待B', task_type: 'interactive', directory: 'F:/demo',
      time_created: t0 - 60 * MIN, time_updated: t0 - 1e3 },
  ]);
  // A 已等 2.5s、B 已等 0.5s；注入 timeoutMs=1.5s 使阈值在秒级可分辨。
  buildModelUsage(fx.conn, [
    { id: 'wa', session_id: 'wA', turn_id: 'k1', status: 'completed',
      started_at: t0 - 2600, completed_at: t0 - 2500, duration_ms: 100,
      query_source: 'main_turn', model_id: 'glm-5', computed_total_tokens: 10 },
    { id: 'wb', session_id: 'wB', turn_id: 'k2', status: 'completed',
      started_at: t0 - 600, completed_at: t0 - 500, duration_ms: 100,
      query_source: 'main_turn', model_id: 'glm-5', computed_total_tokens: 10 },
  ]);
  // 同 tick 让 error_burst 也触发：跨规则互不冷却（同 tick 双发）。
  buildToolUsage(fx.conn, [
    { id: 'et1', session_id: 'wA', turn_id: 'k1', tool_name: 'Bash',
      status: 'error', started_at: t0 - 30e3 },
    { id: 'et2', session_id: 'wB', turn_id: 'k2', tool_name: 'Read',
      status: 'error', started_at: t0 - 30e3 },
    { id: 'et3', session_id: 'wA', turn_id: 'k1', tool_name: 'Grep',
      status: 'error', started_at: t0 - 30e3 },
  ]);
  const { engine, sent } = makeTestEngine(
    { waiting_timeout: { enabled: true, timeoutMs: 1500 } });
  try {
    engine.tick();
    const rules1 = sent.map(p => `${p.rule}:${p.session || 'all'}`).sort();
    assert.deepEqual(rules1, ['error_burst:all', 'waiting_timeout:wA'],
      '首 tick：error_burst 与 waiting:A 同发（跨规则互不冷却）；B 未满阈值');
    // 等待 B 越过阈值（A 仍在 15min per-session 冷却内）：
    // B 照发（A 的冷却不占 B）、A 不重发、error_burst 全局冷却不重发。
    await sleep(1600);
    engine.tick();
    assert.deepEqual(sent.map(p => `${p.rule}:${p.session || 'all'}`),
      ['error_burst:all', 'waiting_timeout:wA', 'waiting_timeout:wB'],
      'A 会话触发不占 B 会话冷却；两规则冷却互不影响重发判定');
  } finally { engine.stop(); }
});

test('C8-2 token_threshold 每会话每档位一次: 1M 档一次、5M 档再触发、重复 tick 不发', () => {
  wipe();
  buildSession(fx.conn, [
    { id: 'tt1', title: '烧 token', task_type: 'interactive', directory: 'F:/demo',
      time_created: Date.now() - 60 * MIN, time_updated: Date.now() - 30e3 },
  ]);
  buildModelUsage(fx.conn, [
    { id: 'tk1', session_id: 'tt1', turn_id: 'k1', status: 'completed',
      started_at: Date.now() - 50e3, completed_at: Date.now() - 49e3,
      duration_ms: 1000, query_source: 'main_turn', model_id: 'glm-5',
      computed_total_tokens: 600_000 },
    { id: 'tk2', session_id: 'tt1', turn_id: 'k2', status: 'completed',
      started_at: Date.now() - 40e3, completed_at: Date.now() - 39e3,
      duration_ms: 1000, query_source: 'main_turn', model_id: 'glm-5',
      computed_total_tokens: 600_000 },
  ]);
  const { engine, sent } = makeTestEngine({
    error_burst: { enabled: false }, waiting_timeout: { enabled: false },
    token_threshold: { enabled: true },
  });
  try {
    engine.tick();
    assert.equal(sent.length, 1, '累计 1.2M → 1M 档一次');
    assert.ok(sent[0].body.includes('已跨 1M 档'));
    engine.tick();
    assert.equal(sent.length, 1, '同档重复满足不再发（每档位一次）');
    buildModelUsage(fx.conn, [
      { id: 'tk3', session_id: 'tt1', turn_id: 'k3', status: 'completed',
        started_at: Date.now() - 20e3, completed_at: Date.now() - 19e3,
        duration_ms: 1000, query_source: 'main_turn', model_id: 'glm-5',
        computed_total_tokens: 4_400_000 },
    ]);
    engine.tick();
    assert.equal(sent.length, 2, '累计 5.6M → 5M 档再触发');
    assert.ok(sent[1].body.includes('已跨 5M 档'));
    assert.equal(sent[1].session, 'tt1');
    // 同 tick 跨多档收敛（真实库 dwf actor 直跳形态）：新会话首见即 5.6M →
    // 纯函数照回两档候选（无状态），发送侧只发最高档、低档标已发不倒挂补发。
    buildSession(fx.conn, [
      { id: 'tt2', title: '直跳', task_type: 'interactive', directory: 'F:/demo',
        time_created: Date.now() - 60 * MIN, time_updated: Date.now() - 10e3 },
    ]);
    buildModelUsage(fx.conn, [
      { id: 'tk4', session_id: 'tt2', turn_id: 'k4', status: 'completed',
        started_at: Date.now() - 9e3, completed_at: Date.now() - 8.9e3,
        duration_ms: 1000, query_source: 'main_turn', model_id: 'glm-5',
        computed_total_tokens: 5_600_000 },
    ]);
    const cand = engine.evaluate();
    assert.deepEqual(cand.filter(n => n.session === 'tt2').map(n => n.tier),
      [1000000, 5000000], '条件评估照回两档候选（冷却不进评估）');
    engine.tick();
    const tt2 = sent.filter(p => p.session === 'tt2');
    assert.equal(tt2.length, 1, '同 tick 只发最高档（低档不发不撞 id）');
    assert.ok(tt2[0].body.includes('已跨 5M 档'));
    engine.tick();
    assert.equal(sent.filter(p => p.session === 'tt2').length, 1,
      '低档 1M 不倒挂补发（已被高档涵盖并标已发）');
    assert.ok(!('tier' in sent[0]) && !('cooldownKey' in sent[0]), '内部字段不上线');
  } finally { engine.stop(); }
});

// ── C8-3：SSE notify 事件（真实发射路径：engine → 共享 bus → live.js 转发）───
// 打开一条 SSE 连接，解析 event/data 帧推入 events.notify；首帧数据（connected
// 注释）置 open 标志——订阅在 handler 内同步完成，open 后 tick 即可全链路送达。
function openSse(port, events) {
  return http.get({ host: '127.0.0.1', port, path: '/api/live/events' }, res => {
    res.setEncoding('utf8');
    let buf = '';
    res.on('data', d => {
      events.open = true;
      buf += d;
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const evm = /^event: (.+)$/m.exec(frame);
        const dm = /^data: (.+)$/m.exec(frame);
        if (!evm || !dm) continue; // 心跳/注释帧
        try { (events[evm[1]] = events[evm[1]] || []).push(JSON.parse(dm[1])); } catch { /* error 帧等 */ }
      }
    });
  });
}

test('C8-3 SSE: notify 帧载荷契约 + close 退订无泄漏', async () => {
  wipe();
  const now = Date.now();
  buildModelUsage(fx.conn, Array.from({ length: 3 }, (_, i) => ({
    id: 'nb' + i, session_id: 'nb1', turn_id: 'e' + i, status: 'error',
    started_at: now - 30e3, duration_ms: 500, query_source: 'main_turn',
    model_id: 'glm-5', error_type: 'api_error',
  })));
  buildToolUsage(fx.conn, [
    { id: 'nt1', session_id: 'nb1', turn_id: 'e0', tool_name: 'Bash',
      status: 'error', started_at: now - 20e3 },
  ]);
  const app = express();
  app.use('/api/live', live);
  const server = await listen(app);
  const events = { open: false };
  const req = openSse(server.address().port, events);
  try {
    assert.ok(await waitFor(() => events.open, 3000), 'SSE 连接建立（订阅已挂）');
    // 共享 bus（live.js 的订阅面）——真实发射路径全链路
    const engine = makeNotifyEngine({ dbq, tickMs: 1e9 });
    try {
      engine.tick();
      assert.ok(await waitFor(() => (events.notify || []).length >= 1, 5000),
        'notify 帧到达（engine→sharedNotifyBus→live.js 转发）');
      const p = events.notify[0];
      // 载荷六字段 + intensity（additive：T5 降级矩阵强度轴，单一来源在服务端）
      for (const k of ['id', 'rule', 'title', 'body', 'severity', 'at', 'intensity']) {
        assert.ok(k in p, `载荷含 ${k}`);
      }
      assert.equal(p.rule, 'error_burst');
      assert.equal(p.severity, 'err', 'severity 映射钉：error_burst→err');
      assert.ok(!('session' in p), 'session 字段仅 per-session 规则携带（整键缺席）');
      assert.ok(/^error_burst:all:\d+$/.test(p.id), 'id 形如 rule:session|all:at');
      assert.equal(typeof p.at, 'number');
      assert.ok(!('cooldownKey' in p), '内部冷却键不上线');
    } finally { engine.stop(); }
  } finally {
    req.destroy();
    server.close();
    assert.ok(
      await waitFor(() => sharedNotifyBus().listenerCount('notify') === 0, 2000),
      '连接关闭后退订，共享 bus 无残留订阅（无泄漏）');
  }
});

// ── 源码契约（C8-3 钉：写头点不新增、评估不在 live.js、取数形态钉）────────────
function listJsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJsFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('C8-3 源码契约: text/event-stream 写头点仍 2 处；live.js 无评估调用；notify.js 无全表 GROUP BY session', () => {
  const serverDir = path.join(__dirname, '..', 'server');
  const hits = listJsFiles(serverDir)
    .filter(f => fs.readFileSync(f, 'utf8').includes('text/event-stream'));
  assert.equal(hits.length, 2, `写头点恰 2 处（live.js 与 index.js），实得：${
    hits.map(h => path.basename(h)).join(', ')}`);

  const liveSrc = fs.readFileSync(path.join(serverDir, 'routes', 'live.js'), 'utf8');
  assert.ok(liveSrc.includes("sharedNotifyBus().on('notify'"), 'live.js 订阅共享 bus');
  assert.ok(liveSrc.includes("sharedNotifyBus().off('notify'"), 'close 退订配对');
  assert.ok(!liveSrc.includes('evaluate(') && !liveSrc.includes('makeNotifyEngine'),
    '评估调用点不在 live.js（自有 tick 钉——live.js 只订阅转发）');

  const notifySrc = fs.readFileSync(path.join(serverDir, 'notify.js'), 'utf8');
  for (const m of notifySrc.matchAll(/GROUP BY session_id/g)) {
    const before = notifySrc.slice(Math.max(0, m.index - 400), m.index);
    assert.ok(before.includes('IN ('),
      'GROUP BY session_id 仅出现在有界 IN 寻址语句内（禁全表无界聚合）');
  }
  assert.ok(!/require\('(http|https|node:fetch)'|fetch\(/.test(notifySrc),
    '无外呼通道代码（webhook 明确不做——模块仅 events/signals 两个 require）');
});

// ── EQP 机检（fixture 计划形态守护，signals.test.js 捕获缝同款）───────────────
test('EQP 形态: notify 取数 SQL 各路走索引窗/rowid 尾点/会话复合索引，无基表 SCAN', () => {
  wipe();
  const now = Date.now();
  buildSession(fx.conn, [
    { id: 'eq1', title: 'EQP', task_type: 'interactive', directory: 'F:/demo',
      time_created: now - 60 * MIN, time_updated: now - 30e3 },
  ]);
  buildModelUsage(fx.conn, [
    { id: 'qm1', session_id: 'eq1', turn_id: 'k1', status: 'completed',
      started_at: now - 40e3, completed_at: now - 39e3, duration_ms: 1000,
      query_source: 'main_turn', model_id: 'glm-5', computed_total_tokens: 100 },
  ]);
  // 全规则开启的全新引擎：固定 SQL 首次 prepare 全部经过代理（捕获缝生效）。
  const proxy = dbq.db();
  const orig = proxy.prepare;
  const seen = [];
  proxy.prepare = (sql) => { seen.push(sql); return orig.call(proxy, sql); };
  let engine;
  try {
    engine = makeNotifyEngine({ dbq, tickMs: 1e9, rules: {
      token_threshold: { enabled: true }, inactive: { enabled: true },
    } });
    engine.evaluate();
  } finally {
    proxy.prepare = orig;
    if (engine) engine.stop();
  }
  const pick = (pred) => seen.filter(pred);
  // EXPLAIN 参数装配：按各 ? 前缀判定形态——started_at 下界喂时间值、其余
  // （IN 寻址占位）喂占位 id（EQP 只看计划形态，参数值不改变索引选择）。
  const explain = (sql) => {
    const params = [];
    let rest = sql;
    for (;;) {
      const i = rest.indexOf('?');
      if (i < 0) break;
      params.push(/started_at >=\s*$/.test(rest.slice(Math.max(0, i - 20), i))
        ? now - 5 * MIN : 'zz');
      rest = rest.slice(i + 1);
    }
    const rows = fx.conn.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params);
    return rows.map(r => r.detail).join('\n');
  };
  // 路①②：error 窗计数（model+tool started_at 索引窗）
  const errCountSqls = pick(s => s.includes("status = 'error'"));
  assert.equal(errCountSqls.length, 2, 'model+tool 两路窗计数');
  const modelErrPlan = explain(errCountSqls.find(s => s.includes('model_usage')));
  assert.match(modelErrPlan,
    /SEARCH model_usage USING (COVERING )?INDEX model_usage_started_model_idx/);
  assert.ok(!/SCAN\s+model_usage/.test(modelErrPlan));
  const toolErrPlan = explain(errCountSqls.find(s => s.includes('tool_usage')));
  assert.match(toolErrPlan, /SEARCH tool_usage USING (COVERING )?INDEX tool_usage_started_tool_idx/);
  assert.ok(!/SCAN\s+tool_usage/.test(toolErrPlan));
  // 路③：token 会话内 SUM（有界 IN + 会话复合索引）
  const tokenSql = pick(s => s.includes('SUM(computed_total_tokens)') && s.includes('IN ('))[0];
  assert.ok(tokenSql, 'token 会话内 SUM 语句在案');
  const tokenPlan = explain(tokenSql);
  assert.match(tokenPlan, /SEARCH model_usage USING INDEX model_usage_session_turn_idx \(session_id=\?\)/);
  assert.ok(!/SCAN\s+model_usage/.test(tokenPlan), '禁基表/全索引扫描');
  // 路④⑤：inactive 两路（rowid 尾点 + started_at 存在性探测）
  const tailSql = pick(s => s.includes('rowid = (SELECT MAX(rowid)'))[0];
  assert.match(explain(tailSql), /SEARCH model_usage USING INTEGER PRIMARY KEY \(rowid=\?\)/);
  const probeSql = pick(s => /started_at >= \? LIMIT 1/.test(s))[0];
  const probePlan = explain(probeSql);
  assert.match(probePlan,
    /SEARCH model_usage USING (COVERING )?INDEX model_usage_started_model_idx/);
  assert.ok(!/SCAN\s+model_usage/.test(probePlan));
  // 标题补齐：session 主键 IN 寻址
  const titleSql = pick(s => s.includes('SELECT id, title FROM session'))[0];
  assert.ok(!/SCAN\s+session/.test(explain(titleSql)), 'session 走主键 IN 寻址');
});
