'use strict';
// test/usage-queries.test.js — L1 usage-attribution 查询族（ecosystem-round2-batch1
// T2：C1 窗口级 turn/tool 聚合 + C5 归因两级下钻，db 层直测）。
// 覆盖：空集稳健 / 窗口语义三档边界（31d 行不入 30d 档）/ C1-2·C1-3·C5-1 数值钉 /
// 诚实截断探针（by_error_type Top5 与归因 limit+1）/ 全 NULL ttft→null /
// fixture EXPLAIN 形态（本族每条 SQL 无基表 SCAN，TEMP B-TREE 允许）。
// 约定（db-smoke 头注）：env 先注入再 require，db.js 模块级缓存连接 → 本文件
// 共享一个 fixture，阶段按时间轴布局隔离窗口（now−X 标注），断言窗口只含目标行。
const test = require('node:test');
const assert = require('node:assert');
const { createFixtureDb, buildSession, buildModelUsage, buildToolUsage, buildTurnUsage } =
  require('./helpers/fixture-db');

const fx = createFixtureDb();
process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = fx.logDir;
process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;
const dbq = require('../server/db');

const now = Date.now();
const MIN = 60e3, DAY = 86400e3;
const H = (m) => now - m * MIN; // now − m 分钟

test.after(() => {
  try { dbq.db().close(); } catch { /* already closed */ }
  dbq.invalidateDb();
  fx.cleanup();
});

// ── 阶段 1：空库（新库是 /api/usage/* 首次部署的真实形态）──
test('空集稳健: 全函数不抛错、totals 全零/null、数组空', () => {
  const since = now - 24 * 60 * MIN;
  const s = dbq.usageTurnsSummary(since);
  assert.deepEqual(s.totals, {
    turns: 0, completed: 0, errors: 0, cancelled: 0,
    model_requests: 0, retries: 0, tool_errors: 0,
    avg_ttft_ms: null, context_exceeded: 0,
  });
  assert.deepEqual(s.by_error_type, []);
  assert.equal(s.by_error_type_truncated, false);
  assert.deepEqual(dbq.usageTurnTimeline(since, 100), []);
  assert.deepEqual(dbq.usageToolBreakdown(since), []);
  assert.deepEqual(dbq.usageAttributionBySession(since, 50), { rows: [], truncated: false });
  assert.deepEqual(dbq.usageAttributionByTurn('no-such-session', 50), { rows: [], truncated: false });
});

// ── 阶段 2：窗口语义（wsem 三组行：65min / 3d / 31d；31d 行不入 30d 档）──
test('窗口语义: 24h/7d/30d 三档聚合边界、31d 边界行不计入 30d 档', () => {
  buildTurnUsage(fx.conn, [
    { turn_id: 'w1', session_id: 'wsem', status: 'completed', started_at: H(65),
      duration_ms: 1000, time_to_first_token_ms: 500, model_request_count: 1 },
    { turn_id: 'w2', session_id: 'wsem', status: 'completed', started_at: now - 3 * DAY,
      duration_ms: 1000, model_request_count: 1 },
    { turn_id: 'w3', session_id: 'wsem', status: 'completed', started_at: now - 31 * DAY,
      duration_ms: 1000, model_request_count: 1 },
  ]);
  buildToolUsage(fx.conn, [
    { id: 'wt1', session_id: 'wsem', turn_id: 'w1', tool_name: 'Bash', status: 'completed',
      started_at: H(65), duration_ms: 100 },
    { id: 'wt2', session_id: 'wsem', turn_id: 'w2', tool_name: 'Bash', status: 'completed',
      started_at: now - 3 * DAY, duration_ms: 100 },
    { id: 'wt3', session_id: 'wsem', turn_id: 'w3', tool_name: 'Bash', status: 'completed',
      started_at: now - 31 * DAY, duration_ms: 100 },
  ]);
  buildModelUsage(fx.conn, [
    { id: 'wm1', session_id: 'wsA', turn_id: 'w1', status: 'completed', started_at: H(65),
      duration_ms: 1000, computed_total_tokens: 10, query_source: 'main_turn' },
    { id: 'wm2', session_id: 'wsB', turn_id: 'w2', status: 'completed', started_at: now - 3 * DAY,
      duration_ms: 1000, computed_total_tokens: 10, query_source: 'main_turn' },
    { id: 'wm3', session_id: 'wsC', turn_id: 'w3', status: 'completed', started_at: now - 31 * DAY,
      duration_ms: 1000, computed_total_tokens: 10, query_source: 'main_turn' },
  ]);

  const since24 = now - 24 * 60 * MIN, since7 = now - 7 * DAY, since30 = now - 30 * DAY;
  // turn 侧：24h 只含 65min 行；7d/30d 含 3d 行；31d 行两档都不计
  assert.equal(dbq.usageTurnsSummary(since24).totals.turns, 1);
  assert.equal(dbq.usageTurnsSummary(since7).totals.turns, 2);
  assert.equal(dbq.usageTurnsSummary(since30).totals.turns, 2, '31d 边界行不计入 30d 档');
  assert.equal(dbq.usageTurnTimeline(since24, 50).length, 1);
  assert.equal(dbq.usageTurnTimeline(since7, 50).length, 2);
  assert.equal(dbq.usageTurnTimeline(since30, 50).length, 2);
  // tool 侧同边界
  const g24 = dbq.usageToolBreakdown(since24), g7 = dbq.usageToolBreakdown(since7),
        g30 = dbq.usageToolBreakdown(since30);
  assert.equal(g24[0].calls, 1);
  assert.equal(g7[0].calls, 2);
  assert.equal(g30[0].calls, 2, '31d 工具行不计入 30d 档');
  // 归因 session 层同边界（wsA/wsB/wsC 各一行 → 会话数即行数）
  assert.equal(dbq.usageAttributionBySession(since24, 50).rows.length, 1);
  assert.equal(dbq.usageAttributionBySession(since7, 50).rows.length, 2);
  assert.equal(dbq.usageAttributionBySession(since30, 50).rows.length, 2,
    '31d 会话行不计入 30d 档');
});

// ── 阶段 3：C1-2 数值钉（nail 三行，窗口 now−55min 只含本组）──
test('C1-2 数值钉: totals 逐项与构造值相等、error_type 分布含 api_error', () => {
  buildTurnUsage(fx.conn, [
    { turn_id: 'tn1', session_id: 'nail', status: 'error', error_type: 'api_error',
      started_at: H(50), duration_ms: 8000, time_to_first_token_ms: 1000,
      model_request_count: 3, model_retry_count: 2, tool_error_count: 1,
      computed_total_tokens: 500, context_exceeded: 1 },
    { turn_id: 'tn2', session_id: 'nail', status: 'completed',
      started_at: H(48), duration_ms: 12000, time_to_first_token_ms: 3000,
      model_request_count: 2, computed_total_tokens: 900 },
    { turn_id: 'tn3', session_id: 'nail', status: 'cancelled',
      started_at: H(45), duration_ms: 4000, time_to_first_token_ms: 2000,
      model_request_count: 1, computed_total_tokens: 200 },
  ]);
  const s = dbq.usageTurnsSummary(H(55));
  assert.deepEqual(s.totals, {
    turns: 3, completed: 1, errors: 1, cancelled: 1,
    model_requests: 6, retries: 2, tool_errors: 1,
    avg_ttft_ms: 2000, // (1000+3000+2000)/3
    context_exceeded: 1,
  });
  // 分布含 '(none)'（无 error_type 行）与 api_error；计数互异 → 顺序确定
  assert.deepEqual(s.by_error_type, [
    { type: '(none)', count: 2 }, { type: 'api_error', count: 1 },
  ]);
  assert.equal(s.by_error_type_truncated, false);
  // 时间线：新→旧（tn3 最晚）；行形状含规格字面列集，started_at 已 ISO 化
  const tl = dbq.usageTurnTimeline(H(55), 10);
  assert.deepEqual(tl.map(r => r.turn_id), ['tn3', 'tn2', 'tn1']);
  const r0 = tl[0];
  for (const k of ['turn_id', 'session_id', 'started_at', 'duration_ms',
    'time_to_first_token_ms', 'status', 'model_retry_count', 'tool_error_count',
    'error_type', 'context_exceeded', 'computed_total_tokens']) {
    assert.ok(k in r0, `时间线行缺列 ${k}`);
  }
  assert.equal(typeof r0.started_at, 'string');
  assert.ok(Number.isFinite(Date.parse(r0.started_at)), 'started_at 须为 ISO 时间');
  assert.equal(r0.computed_total_tokens, 200);
  assert.equal(r0.status, 'cancelled');
  // db 层负值兜底（路由 clampLimit 之外的第二道防：负 LIMIT 整表物化事故形态）
  assert.equal(dbq.usageTurnTimeline(H(55), -1).length, 1);
});

// ── 阶段 4：诚实截断钉（6 种 error_type 计数递减 → 恰 Top5 + truncated）──
test('C1-2 截断钉: ≥6 种 error_type → 恰 Top 5 + truncated 如实标注', () => {
  const counts = { e1: 6, e2: 5, e3: 4, e4: 3, e5: 2, e6: 1 };
  const rows = [];
  for (const [type, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      rows.push({ turn_id: `${type}-${i}`, session_id: 'trunc', status: 'error',
        error_type: type, started_at: H(20 - (i % 3)), duration_ms: 100 });
    }
  }
  buildTurnUsage(fx.conn, rows);
  const s = dbq.usageTurnsSummary(H(25)); // 只含 6 种构造行（nail 45-50min 之外）
  assert.deepEqual(s.by_error_type, [
    { type: 'e1', count: 6 }, { type: 'e2', count: 5 }, { type: 'e3', count: 4 },
    { type: 'e4', count: 3 }, { type: 'e5', count: 2 },
  ], '第 6 名 e6 被裁，截断不静默');
  assert.equal(s.by_error_type_truncated, true);
});

// ── 阶段 5：全 NULL ttft → avg_ttft_ms === null（不伪造 0）──
test('C1-2 空值钉: 窗口内 ttft 全 NULL → avg_ttft_ms === null', () => {
  buildTurnUsage(fx.conn, [
    { turn_id: 'nz1', session_id: 'nullt', status: 'completed', started_at: H(5),
      duration_ms: 1000, model_request_count: 1 },
    { turn_id: 'nz2', session_id: 'nullt', status: 'completed', started_at: H(5),
      duration_ms: 1000, model_request_count: 1 },
  ]);
  const s = dbq.usageTurnsSummary(H(10)); // 只含 nullt 两行（trunc 18-20min 之外）
  assert.equal(s.totals.turns, 2);
  assert.equal(s.totals.avg_ttft_ms, null, 'SQLite AVG 全 NULL 语义，不伪造 0');
});

// ── 阶段 6：C1-3 工具数值钉（Bash/Read 两行，含三分布对象）──
test('C1-3 数值钉: 工具分组逐项相等（成功率/耗时口径/三分布形态）', () => {
  buildToolUsage(fx.conn, [
    { id: 'bg1', session_id: 'tnail', turn_id: 't1', tool_name: 'Bash', status: 'completed',
      started_at: H(15), duration_ms: 900, read_only: 0, destructive: 1,
      approval_status: 'none', output_bytes: 120 },
    { id: 'rd1', session_id: 'tnail', turn_id: 't1', tool_name: 'Read', status: 'error',
      started_at: H(15), duration_ms: 50, read_only: 1, destructive: 0,
      approval_status: 'denied', output_bytes: 0 },
  ]);
  const groups = dbq.usageToolBreakdown(H(17)); // 只含 tnail 两行（wsem 65min 之外）
  const byName = Object.fromEntries(groups.map(g => [g.tool_name, g]));
  assert.deepEqual(byName.Bash, {
    tool_name: 'Bash', calls: 1, errors: 0, success_rate: 1,
    avg_ms: 900, max_ms: 900, output_bytes: 120,
    read_only: { ro: 0, rw: 1 },
    destructive: { 1: 1, 0: 0 },
    approval_status: { none: 1 },
  });
  assert.deepEqual(byName.Read, {
    tool_name: 'Read', calls: 1, errors: 1, success_rate: 0,
    avg_ms: null, // 仅 completed 口径：组内无完成行 → SQLite 全 NULL AVG 语义
    max_ms: 50,   // 全行口径：错误行时长仍进 max
    output_bytes: 0,
    read_only: { ro: 1, rw: 0 },
    destructive: { 1: 0, 0: 1 },
    approval_status: { denied: 1 },
  });
});

// ── 阶段 7：C5 归因两级数值钉 + 截断钉 ──
test('C5-1/C5-2 数值钉: session 层聚合/降序/分解/标题 + turn 层逐项按 token 降序 + 截断', () => {
  buildSession(fx.conn, [
    { id: 'sA', title: '会话A', task_type: 'interactive', time_created: H(30), time_updated: H(8) },
    { id: 'sB', title: '会话B', task_type: 'interactive', time_created: H(30), time_updated: H(8) },
  ]);
  buildModelUsage(fx.conn, [
    { id: 'am1', session_id: 'sA', turn_id: 'ta', status: 'completed', started_at: H(8),
      duration_ms: 1000, computed_total_tokens: 100, query_source: 'main_turn', tool_call_count: 2 },
    { id: 'am2', session_id: 'sA', turn_id: 'tb', status: 'completed', started_at: H(8),
      duration_ms: 2000, computed_total_tokens: 50, query_source: 'subagent', tool_call_count: 0 },
    { id: 'am4', session_id: 'sA', turn_id: 'ta', status: 'completed', started_at: H(8),
      duration_ms: 100, computed_total_tokens: 25, query_source: 'workflow_child', tool_call_count: 1 },
    { id: 'bm3', session_id: 'sB', turn_id: 'tc', status: 'completed', started_at: H(8),
      duration_ms: 500, computed_total_tokens: 300, query_source: 'main_turn', tool_call_count: 1 },
  ]);
  // session 层：按 tokens 降序（sB 300 > sA 175）、标题补齐、by_query_source
  // 为 token 口径分解（火焰宽度语义）
  const { rows, truncated } = dbq.usageAttributionBySession(H(10));
  assert.equal(truncated, false);
  assert.deepEqual(rows, [
    { session_id: 'sB', title: '会话B', tokens: 300, duration_ms_sum: 500, calls: 1,
      by_query_source: { main_turn: 300 } },
    { session_id: 'sA', title: '会话A', tokens: 175, duration_ms_sum: 3100, calls: 3,
      by_query_source: { main_turn: 100, subagent: 50, workflow_child: 25 } },
  ]);
  // turn 层：会话内逐 turn 分解，按 token 降序，行含 token/耗时/model_calls/tool_calls
  const t = dbq.usageAttributionByTurn('sA', 50);
  assert.equal(t.truncated, false);
  assert.deepEqual(t.rows, [
    { turn_id: 'ta', tokens: 125, duration_ms_sum: 1100, model_calls: 2, tool_calls: 3 },
    { turn_id: 'tb', tokens: 50, duration_ms_sum: 2000, model_calls: 1, tool_calls: 0 },
  ]);
  // C5-2 诚实截断：注入小 limit → 仅 top1 + truncated
  const cut = dbq.usageAttributionBySession(H(10), 1);
  assert.deepEqual(cut.rows.map(r => r.session_id), ['sB']);
  assert.equal(cut.truncated, true);
  const cutT = dbq.usageAttributionByTurn('sA', 1);
  assert.deepEqual(cutT.rows.map(r => r.turn_id), ['ta']);
  assert.equal(cutT.truncated, true);
  // db 层负值兜底（-1 → 1，防负 LIMIT 无上限物化）
  assert.equal(dbq.usageAttributionBySession(H(10), -1).rows.length, 1);
});

// ── 阶段 8：宽窗 rowid 尾界钳制行为（slowTools 先例；30d>500ms 启用依据见
// docs/acceptance/round2-batch1-explain-timing.md）──
test('规模钳制: 宽窗（>7d）小 cap 裁最旧 rowid、窄窗不启用 cap', () => {
  // 追加 3 行工具 + 2 行 model，均落 now−9d（宽窗内）；insert 顺序=隐式 rowid
  // 升序（fixture TEXT 主键不占 rowid 别名，helpers/fixture-db.js 头注不变量）。
  buildToolUsage(fx.conn, [
    { id: 'tc1', session_id: 'capS', turn_id: 'k1', tool_name: 'CapTool', status: 'completed',
      started_at: now - 9 * DAY, duration_ms: 10 },
    { id: 'tc2', session_id: 'capS', turn_id: 'k1', tool_name: 'CapTool', status: 'completed',
      started_at: now - 9 * DAY, duration_ms: 10 },
    { id: 'tc3', session_id: 'capS', turn_id: 'k1', tool_name: 'CapTool', status: 'completed',
      started_at: now - 9 * DAY, duration_ms: 10 },
  ]);
  buildModelUsage(fx.conn, [
    { id: 'cm1', session_id: 'capS', turn_id: 'k1', status: 'completed',
      started_at: now - 9 * DAY, duration_ms: 10, computed_total_tokens: 500, query_source: 'main_turn' },
    { id: 'cm2', session_id: 'capS', turn_id: 'k2', status: 'completed',
      started_at: now - 9 * DAY, duration_ms: 10, computed_total_tokens: 50, query_source: 'main_turn' },
  ]);
  // 宽窗 + cap=2：tool_usage 尾界只留最新 2 行（tc2/tc3）——最旧 CapTool 行
  //（tc1）与其他更旧 rowid 的窗内行一并被裁，calls=2。
  const capped = dbq.usageToolBreakdown(now - 10 * DAY, { candidateCapRows: 2 });
  assert.deepEqual(capped.map(g => [g.tool_name, g.calls]), [['CapTool', 2]],
    'cap=2 恰留最新 2 行（rowid 尾界），窗内更旧行被裁');
  // 宽窗 + cap=1（attribution 页查询）：只留最新 1 行 model（cm2，tokens=50），
  // cm1（rowid 更旧，tokens=500）被裁——降序首行不是 550 证明裁剪生效。
  const a = dbq.usageAttributionBySession(now - 10 * DAY, 50, { candidateCapRows: 1 });
  assert.equal(a.rows.length, 1);
  assert.equal(a.rows[0].session_id, 'capS');
  assert.equal(a.rows[0].tokens, 50, 'cm1（更旧 rowid）被尾界裁出，不得计入 550');
  // 对偶钉：窄窗（≤7d）不启用 cap——同参数小 cap 下若误启用，尾界只剩最新 1 行
  //（tc3/CapTool），Bash/Read（更旧 rowid 的窗内行）会消失。
  const narrow = dbq.usageToolBreakdown(now - 60 * MIN, { candidateCapRows: 1 });
  assert.ok(narrow.some(g => g.tool_name === 'Bash') && narrow.some(g => g.tool_name === 'Read'),
    '窄窗走 started_at 精确路径，cap 不参与');
});

// ── 阶段 9：EXPLAIN 形态（fixture 上本族每条 SQL 无基表 SCAN）──
// 经 db() 代理的 prepare 缝捕获真实执行 SQL（零漂移——不复制 SQL 字面量），
// 对每条做 EXPLAIN QUERY PLAN：判据「不含对基表的 SCAN」，TEMP B-TREE 允许。
// 窄窗与宽窗（>7d，rowid 尾界 + NOT INDEXED 形态）两路都捕获。
test('EXPLAIN 形态: 本族每条 SQL 无基表 SCAN（TEMP B-TREE 允许）', () => {
  const captureSql = (thunk) => {
    const proxy = dbq.db();
    const orig = proxy.prepare;
    const seen = [];
    proxy.prepare = (sql) => { seen.push(sql); return orig.call(proxy, sql); };
    try { thunk(); } finally { proxy.prepare = orig; }
    return seen;
  };
  const since = H(10), wideSince = now - 10 * DAY;
  const sqls = [
    ...captureSql(() => dbq.usageTurnsSummary(since)),            // 2 条（totals + 分布）
    ...captureSql(() => dbq.usageTurnTimeline(since, 5)),         // 1 条
    ...captureSql(() => dbq.usageToolBreakdown(since)),           // 2 条（聚合 + approval）
    ...captureSql(() => dbq.usageAttributionBySession(since, 5)), // 3 条（两段 + 标题）
    ...captureSql(() => dbq.usageAttributionByTurn('sA', 5)),     // 1 条
    ...captureSql(() => dbq.usageToolBreakdown(wideSince)),       // 2 条（宽窗形态）
    ...captureSql(() => dbq.usageAttributionBySession(wideSince, 5)), // 1 条（宽窗页查询）
  ];
  assert.equal(sqls.length, 14, '查询计数钉：窄窗 9 + 宽窗 5（宽窗含两段+标题）');
  assert.equal(sqls.filter(s => /NOT INDEXED/.test(s)).length, 3,
    '宽窗形态必须钉 NOT INDEXED（tools×2 + attr 页查询×1）');
  const explain = (sql) => {
    const named = [...sql.matchAll(/@(\w+)/g)].map(m => m[1]);
    const anon = (sql.match(/\?/g) || []).length;
    const stmt = fx.conn.prepare('EXPLAIN QUERY PLAN ' + sql);
    const rows = named.length
      ? stmt.all(Object.fromEntries(named.map(n => [n, n === 'since' ? since : 5])))
      : stmt.all(...Array.from({ length: anon }, () => 's1'));
    return rows.map(r => r.detail);
  };
  for (const sql of sqls) {
    const plan = explain(sql);
    assert.ok(plan.length > 0);
    for (const line of plan) {
      assert.ok(!/SCAN\s+(turn_usage|tool_usage|model_usage|session)\b/.test(line),
        `出现基表 SCAN：${line}（SQL：${sql.slice(0, 80)}…）`);
    }
  }
});
