'use strict';
// test/usage-queries.test.js — L1 usage-attribution 查询族（ecosystem-round2-batch1
// T2：C1 窗口级 turn/tool 聚合 + C5 归因两级下钻，db 层直测）。
// 覆盖：空集稳健 / 窗口语义三档边界（31d 行不入 30d 档）/ C1-2·C1-3·C5-1 数值钉 /
// 诚实截断探针（by_error_type Top5 与归因 limit+1）/ 全 NULL ttft→null /
// fixture EXPLAIN 形态（本族每条 SQL 无基表 SCAN，TEMP B-TREE 允许）。
// 约定（db-smoke 头注）：env 先注入再 require，db.js 模块级缓存连接 → 本文件
// 共享一个 fixture，阶段按时间轴布局隔离窗口（now−X 标注），断言窗口只含目标行。
// ⚠ 禁止单筛本文件用例（node --test --test-name-pattern / IDE 单用例重跑）及
// 删除/改名早段用例：阶段 1 是空库断言（须最先跑），其后各阶段在同库上累计
// 插行，早段构造是晚段窗口语义的一部分——单筛晚段会因基线行缺失而失红。
// 整文件顺序跑是唯一受支持形态（I-测-1 评审钉：test.before 前插基线与阶段 1
// 空库断言互斥，故以头注警告为约）。构造行与 usage-routes.test.js 共享
// test/helpers/usage-baselines.js 单点定义（I-测-7）；期望值因窗口隔离语义独有。
const test = require('node:test');
const assert = require('node:assert');
const { createFixtureDb, buildSession, buildModelUsage, buildToolUsage, buildTurnUsage } =
  require('./helpers/fixture-db');
const { wsemRows, nailRows, tnailRows, attrRows } = require('./helpers/usage-baselines');

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
  const wsem = wsemRows(H, now);
  buildTurnUsage(fx.conn, wsem.turns);
  buildToolUsage(fx.conn, wsem.tools);
  buildModelUsage(fx.conn, wsem.models);

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
  buildTurnUsage(fx.conn, nailRows(H));
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
  buildToolUsage(fx.conn, tnailRows(H));
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
  const attr = attrRows(H);
  buildSession(fx.conn, attr.sessions);
  buildModelUsage(fx.conn, attr.models);
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
// docs/acceptance/round2-batch1-explain-timing.md；宽窗判定阈值 8d 见阶段 9）──
test('规模钳制: 宽窗（≥8d）小 cap 裁最旧 rowid、窄窗不启用 cap', () => {
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
  // 分解与行总量同口径（I-码-3 回归钉）：by_query_source 亦按 cap 窗聚合——
  // 旧实现按全窗聚合会得 { main_turn: 550 }（11 倍于行 tokens，子条份额超 100%）。
  assert.deepEqual(a.rows[0].by_query_source, { main_turn: 50 },
    'by_query_source 与该行 tokens 同 cap 窗（对账一致），不得为全窗 550');
  // 对偶钉：窄窗（≤7d）不启用 cap——同参数小 cap 下若误启用，尾界只剩最新 1 行
  //（tc3/CapTool），Bash/Read（更旧 rowid 的窗内行）会消失。
  const narrow = dbq.usageToolBreakdown(now - 60 * MIN, { candidateCapRows: 1 });
  assert.ok(narrow.some(g => g.tool_name === 'Bash') && narrow.some(g => g.tool_name === 'Read'),
    '窄窗走 started_at 精确路径，cap 不参与');
});

// ── 阶段 9：EXPLAIN 形态（fixture 上本族每条 SQL 无基表 SCAN）──
// 经 db() 代理的 prepare 缝捕获真实执行 SQL（零漂移——不复制 SQL 字面量），
// 对每条做 EXPLAIN QUERY PLAN：判据「不含对基表的 SCAN」，TEMP B-TREE 允许。
// 窄窗（24h/7d 两形态）、宽窗（rowid 尾界 + NOT INDEXED 形态）三路都捕获——
// 7d 直调是 I-码-1 回归钉：宽窄判定阈值 8d 下 7d 必须走窄窗精确路径（无 cap、
// 无 NOT INDEXED；旧阈值 7d 时 7d 因「路由早时刻 sinceMs vs db 晚时刻 now」
// 恒被判宽窗，此路曾永不可达且套件全绿看不见）。
test('EXPLAIN 形态: 本族每条 SQL 无基表 SCAN（TEMP B-TREE 允许）；7d 走窄窗', () => {
  const captureSql = (thunk) => {
    const proxy = dbq.db();
    const orig = proxy.prepare;
    const seen = [];
    proxy.prepare = (sql) => { seen.push(sql); return orig.call(proxy, sql); };
    try { thunk(); } finally { proxy.prepare = orig; }
    return seen;
  };
  const since = H(10), wideSince = now - 10 * DAY, since7d = now - 7 * DAY;
  // F-测-2 补两路：本批新增的两条 session 寻址 SQL 纳入 EXPLAIN 机检——
  // contextGaugeRows（C2 水位种子）与 sessionList 的 latestModel 第三聚合
  //（C2 mini 条数据面；直调 sessionList 捕获同款 4 条 SQL：页 + model/tool/
  // latestModel 三条页内 IN 聚合，与 GET /api/sessions 的服务端路径零漂移——
  // captureSql 经 db() 代理捕获真实执行 SQL）。
  const sqls = [
    ...captureSql(() => dbq.usageTurnsSummary(since)),            // 2 条（totals + 分布）
    ...captureSql(() => dbq.usageTurnTimeline(since, 5)),         // 1 条
    ...captureSql(() => dbq.usageToolBreakdown(since)),           // 2 条（聚合 + approval）
    ...captureSql(() => dbq.usageAttributionBySession(since, 5)), // 2 条（单趟分组 + 标题）
    ...captureSql(() => dbq.usageAttributionByTurn('sA', 5)),     // 1 条
    ...captureSql(() => dbq.usageToolBreakdown(wideSince)),       // 2 条（宽窗形态）
    ...captureSql(() => dbq.usageAttributionBySession(wideSince, 5)), // 2 条（宽窗单趟分组 + 标题）
    ...captureSql(() => dbq.usageToolBreakdown(since7d)),         // 2 条（7d 窄窗形态钉）
    ...captureSql(() => dbq.usageAttributionBySession(since7d, 5)), // 2 条（7d 窄窗形态钉）
    ...captureSql(() => dbq.contextGaugeRows('sA', 5)),           // 1 条（C2 水位种子，session 索引寻址）
    ...captureSql(() => dbq.sessionList({ limit: 5 })),           // 4 条（含 latestModel 第三聚合）
  ];
  assert.equal(sqls.length, 21, '查询计数钉：窄窗 8 + 宽窗 4 + 7d 窄窗 4 + contextGauge 1 + sessionList 4');
  // F-SQL-4（六席终审第 2 轮）：显式排除集——session 页查询（「FROM session s」
  // 识别）是既有两段式 LIMIT 页扫描形态（sessionList 分节头注性能声明），有意
  // 不判；EQP 对别名形态打的是别名（实测「SCAN s」），全名正则本就抓不到——
  // 旧实现的「不在本族判据面」只是注释里的隐式豁免，未来本族语句用别名（如
  // FROM model_usage m）时真基表 SCAN 会静默逸出。改为显式滤出并留排除钉：
  // 除白名单页查询外，捕获到的每条 SQL（含别名形态）一律过基表 SCAN 判据。
  const checked = sqls.filter(s => !/\bFROM session s\b/.test(s));
  assert.equal(checked.length, 20, '排除钉：21 条捕获 − session 页查询 1 条 = 20 条受检');
  assert.equal(sqls.filter(s => /NOT INDEXED/.test(s)).length, 3,
    '宽窗形态必须钉 NOT INDEXED（tools×2 + attr 单趟分组×1）');
  // 7d 窄窗形态钉（I-码-1）：无 NOT INDEXED/无 rowid 尾界；归因分组查询钉
  // INDEXED BY started_at 索引。（slice(12,16) 显式取 7d 四条——其后追加了
  // contextGauge/sessionList 捕获条目。）
  const d7 = sqls.slice(12, 16);
  assert.equal(d7.filter(s => /NOT INDEXED|rowid >/.test(s)).length, 0,
    '7d 档不得走宽窗 rowid 钳制路径（阈值 8d 语义）');
  assert.ok(d7.some(s => /INDEXED BY model_usage_started_model_idx/.test(s)),
    '7d 归因分组查询须钉 started_at 索引（窄窗精确路径）');
  const explain = (sql) => {
    const named = [...sql.matchAll(/@(\w+)/g)].map(m => m[1]);
    const anon = (sql.match(/\?/g) || []).length;
    const stmt = fx.conn.prepare('EXPLAIN QUERY PLAN ' + sql);
    const rows = named.length
      ? stmt.all(Object.fromEntries(named.map(n => [n, n === 'since' ? since : 5])))
      : stmt.all(...Array.from({ length: anon }, () => 's1'));
    return rows.map(r => r.detail);
  };
  for (const sql of checked) {
    const plan = explain(sql);
    assert.ok(plan.length > 0);
    for (const line of plan) {
      assert.ok(!/SCAN\s+(turn_usage|tool_usage|model_usage|session)\b/.test(line),
        `出现基表 SCAN：${line}（SQL：${sql.slice(0, 80)}…）`);
    }
  }
});

// ── 阶段 10：缺索引库回退分支（I-测-2 零执行缺口）──
// 窄窗归因页查询的「缺 model_usage_started_model_idx 库不加 INDEXED BY」回退
// （服务外部 ZCODE_DB 无索引形态）此前从未被任何测试执行（fixture DDL 恒建
// 索引）。DROP INDEX + 拨掉连接级探测记忆后同数据对拍：结果与带索引路径逐位
// 一致（慢但可用取舍，overviewKpis 同款），结束前重建索引并拨正记忆。
test('缺索引回退: 无 model_usage_started_model_idx 时窄窗归因不加 INDEXED BY、结果逐位一致', () => {
  const withIdx = dbq.usageAttributionBySession(H(10), 50);
  fx.conn.exec('DROP INDEX model_usage_started_model_idx');
  const conn = dbq.db();
  const cached = conn._hasStartedModelIdx;
  conn._hasStartedModelIdx = undefined; // 拨掉探测记忆，强制走 sqlite_master 重探测
  try {
    const noIdx = dbq.usageAttributionBySession(H(10), 50);
    assert.deepEqual(noIdx, withIdx, '同数据对拍：回退路径结果与带索引路径逐位一致');
    assert.equal(conn._hasStartedModelIdx, false, '重探测须如实记下索引缺失');
  } finally {
    fx.conn.exec('CREATE INDEX IF NOT EXISTS model_usage_started_model_idx ON model_usage(started_at, provider_id, model_id)');
    conn._hasStartedModelIdx = cached !== undefined ? cached : true;
  }
});

// ── 阶段 11：attrLimit 非有限数兜底（F-SQL-3）──
// +limit=Infinity 直调（测试/未来调用方形态）：Math.floor(+Infinity)=Infinity
// 穿透旧防线、better-sqlite3 对非有限数绑定抛错——修复后回落 1（与
// http-hardening.js clampAtLeast 的 NaN/±Infinity 语义对齐）。NaN 走既有
// `Math.floor(NaN)||1` → 1 路径，一并钉住。
test('attrLimit 兜底: limit=Infinity / -Infinity / NaN → 钳 1 不抛错（sA 两 turn 载荷下恰 1 行）', () => {
  const inf = dbq.usageAttributionByTurn('sA', Infinity);
  assert.equal(inf.rows.length, 1, 'Infinity 须回落 1（旧实现在此抛绑定错）');
  assert.equal(inf.rows[0].turn_id, 'ta', '钳 1 后恰 token 降序首行');
  assert.equal(inf.truncated, true, 'sA 两 turn → truncated 如实');
  assert.equal(dbq.usageAttributionByTurn('sA', -Infinity).rows.length, 1);
  assert.equal(dbq.usageAttributionByTurn('sA', NaN).rows.length, 1);
  assert.equal(dbq.contextGaugeRows('sA', Infinity).length, 1, 'contextGaugeRows 同款兜底');
});
