'use strict';
// test/workflow-child-accounting.test.js — workflow_child（动态工作流 dwf 派生的
// actor）全面漏计修复的回归测试。背景（2026-09-23 实证，直查真实库）：
// 三个 workflow 并行时 11 个 actor + 3 个 Task 子代理活跃，但面板所有「子代理」
// 口径只认 query_source='subagent' / task_type='subagent_child'，workflow_child
// 在速度计数 / 徽标 / 筛选 / How 文档四处全被排除（24h 窗口漏计 ≈17% 请求，
// 2415/14176 次）。修复语义：workflow_child 与 subagent 同为 agent 侧请求，
// 分列展示、不再混入 main 或丢弃。
// 覆盖面：
// 1) overviewSpeed 三来源分列纯计数（仅 completed 且 duration>0，窗口内）——
//    fixture 故意让 computed_total_tokens ≠ 速度分子（m3: 999 vs 300）、
//    三来源计数不对称（subagent 播 2 行 → 1/2/1），使口径漂移与列错位都可分辨；
//    窄窗用例另锁 NULL→0 兜底路径；
// 2) 会话侧挂链前提：sessionChildren / agentsForest / sessionList 均按
//    parent_id 无类型过滤——workflow_child 子行不被排除（修复的语义前提，
//    防后续改动把树 / children 也带上类型过滤）；taskType 查询参数契约一并锁定
//   （注意：会话列表下拉的实际过滤在前端 client-side 完成，该参数的既有消费方
//    是 how.js 的 reasoning 示例——锁参数防端上语义静默漂移）；
// 3) raw 白名单放行 dwf_* 四表（workflow_run / workflow_activity 实测为空表，
//    dwf_* 才是真身运行册）；order=sequence 按序返回不回落；本库不存在的
//    白名单表 400 可读错误（老 ZCode 库对 dwf_* 的同形态，六视角终审修复）；
//    未白名单表仍 400；
// 4) 前端源码契约（frontend-contract.test.js 同款形态）：SRC_COLOR 单点映射 /
//    筛选下拉 / 速度卡求和 / raw 表清单 / How 跨组求和 / SSE 自愈守卫（含 return）
//    与 startLive 入口幂等 close；
// 5) 本轮冒烟顺带修复的既有缺陷：切走 overview 后 SSE 推送撞 null innerHTML
//    （renderFeed 自愈守卫：#feed 缺席即关闭 EventSource）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { createFixtureDb, buildSession, buildModelUsage } = require('./helpers/fixture-db');

// ── fixture：主会话 + Task 子代理 + 工作流 actor 三态，及 dwf 运行册表 ──
const fx = createFixtureDb();
buildSession(fx.conn, [
  { id: 'p1', title: '主', task_type: 'interactive', parent_id: null, project_id: 'pp',
    time_created: 1000, time_updated: 5000 },
  { id: 'c1', title: 'Task 子代理', task_type: 'subagent_child', parent_id: 'p1', project_id: 'pp',
    time_created: 2000, time_updated: 4000 },
  { id: 'w1', title: 'workflow subagent actor#1@1', task_type: 'workflow_child', parent_id: 'p1', project_id: 'pp',
    time_created: 3000, time_updated: 6000 },
]);
buildModelUsage(fx.conn, [
  { id: 'm1', session_id: 'p1', status: 'completed', started_at: Date.now() - 60e3,
    duration_ms: 10000, query_source: 'main_turn', output_tokens: 200, reasoning_tokens: null,
    computed_total_tokens: 200 },
  // subagent 播两行打破三来源计数对称（1/2/1）：列错位/复制粘贴错 CASE 时可分辨
  { id: 'm2', session_id: 'c1', status: 'completed', started_at: Date.now() - 50e3,
    duration_ms: 8000, query_source: 'subagent', output_tokens: 100, reasoning_tokens: 50,
    computed_total_tokens: 150 },
  { id: 'm6', session_id: 'c1', status: 'completed', started_at: Date.now() - 45e3,
    duration_ms: 3000, query_source: 'subagent', output_tokens: 60, reasoning_tokens: 0,
    computed_total_tokens: 111 },
  // computed_total_tokens 故意 ≠ 速度分子（999 vs 300）：速度口径若被「简化」成
  // 官方预计算列，total_tokens 断言即红（与 w1 会话侧 1499 互相区分两处口径）
  { id: 'm3', session_id: 'w1', status: 'completed', started_at: Date.now() - 40e3,
    duration_ms: 6000, query_source: 'workflow_child', output_tokens: 300, reasoning_tokens: 0,
    computed_total_tokens: 999 },
  // 错误行不进速度口径（status 过滤）
  { id: 'm4', session_id: 'w1', status: 'error', started_at: Date.now() - 30e3,
    duration_ms: 500, query_source: 'workflow_child' },
  { id: 'm5', session_id: 'p1', status: 'completed', started_at: Date.now() - 20e3,
    duration_ms: 2000, query_source: 'compact', output_tokens: 50, reasoning_tokens: 0,
    computed_total_tokens: 50 },
  // completed 但 duration_ms=0：速度口径排除（duration>0 过滤）
  { id: 'm7', session_id: 'p1', status: 'completed', started_at: Date.now() - 10e3,
    duration_ms: 0, query_source: 'main_turn', output_tokens: 42, reasoning_tokens: 0,
    computed_total_tokens: 42 },
  // 窗外行（3h 前）：速度口径排除，但 sessionChildren 聚合无时间过滤、照常计入 w1
  { id: 'm8', session_id: 'w1', status: 'completed', started_at: Date.now() - 3 * 3600e3,
    duration_ms: 5000, query_source: 'workflow_child', output_tokens: 100, reasoning_tokens: 0,
    computed_total_tokens: 500 },
]);
// dwf 运行册：列名为真实库 PRAGMA 的子集（省略 script_text/persona_json 等大文本
// 列——raw SELECT * 透传与 order/where 白名单在运行时对真实库 PRAGMA 复核，
// fixture 缺列不产生假绿面；六视角类型视角核实）。
fx.conn.exec(`
  CREATE TABLE dwf_run (id TEXT PRIMARY KEY, name TEXT, status TEXT,
    parent_session_id TEXT, time_created INTEGER, time_updated INTEGER);
  CREATE TABLE dwf_actor (id TEXT PRIMARY KEY, run_id TEXT, site_id TEXT,
    name TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER);
  CREATE TABLE dwf_node (id TEXT PRIMARY KEY, run_id TEXT, time_created INTEGER, time_updated INTEGER);
  CREATE TABLE dwf_event (id TEXT PRIMARY KEY, run_id TEXT, sequence INTEGER,
    type TEXT, payload_json TEXT, time_created INTEGER);
`);
fx.conn.prepare(`INSERT INTO dwf_run (id, name, status, parent_session_id, time_created, time_updated)
  VALUES ('dwfrun-1', '统一命名重构全流程', 'running', 'p1', 1, 2)`).run();
// dwf_actor 形态（2026-09-23 两次只读实测）：主导形态是 session_id 可空（792 行
// 中 324 行 NULL，终态 run 亦有）+ 非空与 session 表 1:1；08:46Z 曾观察到复审
// actor 创建瞬间三站点共用同一 session_id 的瞬态。本 fixture 用两行共用 w1 模拟
// 该共用形态——raw 按行透传、不被 DISTINCT 塌并即所要锁定的行为。
fx.conn.prepare(`INSERT INTO dwf_actor (id, run_id, site_id, name, session_id, time_created, time_updated)
  VALUES ('1', 'dwfrun-1', 'actor#1', '执行员', 'w1', 1, 2),
         ('2', 'dwfrun-1', 'actor#2', '审查员', 'w1', 3, 4)`).run();
// dwf_event 乱序插入（rowid 序 ≠ sequence 序）：order=sequence 用例依赖此形状
fx.conn.prepare(`INSERT INTO dwf_event (id, run_id, sequence, type, payload_json, time_created)
  VALUES ('e3', 'dwfrun-1', 3, 'node_end', '{}', 3),
         ('e1', 'dwfrun-1', 1, 'run_start', '{}', 1),
         ('e2', 'dwfrun-1', 2, 'node_start', '{}', 2)`).run();

process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = fx.logDir;
process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;

const dbq = require('../server/db');
const raw = require('../server/routes/raw');

test.after(() => {
  try { dbq.db().close(); } catch { /* already closed */ }
  try { dbq.invalidateDb(); } catch { /* ignore */ }
  fx.cleanup();
  assert.equal(fs.existsSync(fx.root), false, 'fixture 目录已清理');
});

test('overviewSpeed: 三来源分列纯计数（不对称 1/2/1），错误/零时长/窗外行不计入', () => {
  const s = dbq.overviewSpeed(Date.now() - 3600e3);
  assert.equal(s.main_count, 1, 'm7（duration=0）不得计入');
  assert.equal(s.subagent_count, 2, 'm2+m6 两行 subagent');
  assert.equal(s.workflow_child_count, 1, 'm3 计入；m4（error）与 m8（窗外）不得计入');
  assert.equal(s.request_count, 5, '速度口径 = completed 且 duration>0 且窗内（含 compact）');
  // 速度分子口径 Σ(output+COALESCE(reasoning,0))=760；若误用 computed_total_tokens
  // 会得 1510（m3 的 999 是故意岔开的口径探针）——两口径由此可分辨。
  assert.equal(s.total_tokens, 760);
});

test('overviewSpeed: 窄窗无有效完成行时三计数全 0（SUM(CASE) 全 NULL→||0 兜底）', () => {
  // 窗内至多剩 m7（completed 但 duration=0，被过滤）——真实库常见形态恰是
  // 「窗口内无任何工作流请求」：漏掉 || 0 时字段为 null，速度卡显示 — 而非 0。
  const z = dbq.overviewSpeed(Date.now() - 15e3);
  assert.equal(z.main_count, 0);
  assert.equal(z.subagent_count, 0);
  assert.equal(z.workflow_child_count, 0);
  assert.equal(z.request_count, 0);
  assert.equal(z.weighted_tps, null);
});

test('会话侧挂链: children/forest/list 按 parent_id 无类型过滤，workflow_child 不被排除', () => {
  const kids = dbq.sessionChildren('p1');
  assert.deepEqual(kids.map(k => k.id).sort(), ['c1', 'w1'],
    'sessionChildren 必须同时返回 Task 子代理与工作流 actor');
  assert.equal(kids.find(k => k.id === 'w1').total_tokens, 1499,
    'workflow_child 的 token 记在其子会话名下（999+500，无时间过滤）');
  const forest = dbq.agentsForest({});
  const root = forest.roots.find(r => r.id === 'p1');
  assert.ok(root, 'p1 应为根会话');
  assert.deepEqual(root.children.map(c => c.id).sort(), ['c1', 'w1'],
    '关系树须把 workflow_child 挂在 parent 会话下');
  const all = dbq.sessionList({});
  assert.equal(all.find(s => s.id === 'w1').task_type, 'workflow_child',
    '列表须原样透出 task_type 供前端三态徽标');
  // taskType 查询参数契约：列表下拉的实际过滤在前端 client-side 完成（不发该
  // 参数），此参数的既有消费方是 how.js 的 reasoning 示例——锁参数防接线回归。
  const onlyWf = dbq.sessionList({ taskType: 'workflow_child' });
  assert.deepEqual(onlyWf.map(s => s.id), ['w1'], 'taskType=workflow_child 只返回 w1');
});

test('raw: dwf_* 四表运行册放行、order=sequence 不回落、缺表 400、未白名单 400', async () => {
  const app = express();
  app.use('/api/raw', raw);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  const port = server.address().port;
  const get = p => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
  try {
    const r1 = await get('/api/raw/dwf_run?limit=10');
    assert.equal(r1.status, 200);
    const j1 = JSON.parse(r1.body);
    assert.equal(j1.table, 'dwf_run');
    assert.equal(j1.count, 1);
    assert.equal(j1.rows[0].name, '统一命名重构全流程');

    const r2 = await get('/api/raw/dwf_actor?limit=10');
    assert.equal(r2.status, 200);
    assert.equal(JSON.parse(r2.body).rows.length, 2, '共用 session_id 的多 actor 站点按行返回');

    const rNode = await get('/api/raw/dwf_node?limit=5');
    assert.equal(rNode.status, 200);
    assert.equal(JSON.parse(rNode.body).count, 0, '空表 → count 0');

    // order=sequence（dwf_event 天然阅读序，本轮新增 UI 选项）：乱序插入的行按
    // 值排序返回，且 meta 无回落注记（若被收紧策略回落 rowid DESC，仅断 200 不红）
    const r5 = await get('/api/raw/dwf_event?order=sequence&desc=0');
    assert.equal(r5.status, 200);
    const j5 = JSON.parse(r5.body);
    assert.deepEqual(j5.rows.map(r => r.sequence), [1, 2, 3], '乱序插入须按 sequence 排序');
    assert.ok(!(j5.meta && j5.meta.order), 'sequence 是白名单列，不得回落 rowid DESC');

    // 白名单放行但本库不存在的表（老 ZCode 库上 dwf_* 的同形态）：400 可读错误
    // 而非 Express 默认 500 HTML（六视角终审修复，R-16② 销账）
    const r4 = await get('/api/raw/workflow_definition?limit=5');
    assert.equal(r4.status, 400);
    assert.ok(r4.body.includes('not present'), '错误文案须说明表不在本库');

    const r3 = await get('/api/raw/sqlite_sequence?limit=1');
    assert.equal(r3.status, 400, '非白名单表必须保持 400 拒绝');
  } finally {
    server.close();
  }
});

test('前端契约: 徽标/筛选/速度卡/raw表清单/How 求和纳入 workflow_child', () => {
  const readPublic = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
  const ov = readPublic('views/overview.js');
  // query_source 徽标色收敛为单点映射（散落三元链正是 dwf 漏计 bug 的根因形态），
  // 两处调用点（速度表 r.* 与 by_model m.*）须走查表 + dim 兜底
  assert.ok(ov.includes("const SRC_COLOR = { main_turn: 'blue', subagent: 'teal', workflow_child: 'purple' }"),
    'query_source 徽标色须收敛为 SRC_COLOR 单点映射');
  assert.ok((ov.match(/SRC_COLOR\[[rm]\.query_source\] \|\| 'dim'/g) || []).length >= 2,
    '速度表与 by_model 调用点须走 SRC_COLOR 查表');
  // 速度卡「子agent」= subagent+workflow 之和的求和表达式须按原形锁定
  //（仅断言出现 workflow_child_count 子串时，删掉求和改回纯 subagent_count 不红）
  assert.ok(ov.includes('(s && s.subagent_count || 0) + (s && s.workflow_child_count || 0)'),
    '速度卡「子agent(含工作流)」须为 subagent_count+workflow_child_count 求和');
  assert.ok(ov.includes('<span class="lbl">工作流</span>'),
    '速度表 footer 须单列工作流计数');

  const ss = readPublic('views/sessions.js');
  assert.ok(ss.includes('value="workflow_child"'),
    '类型筛选下拉须含 workflow_child 选项');
  assert.ok(ss.includes("tt === 'workflow_child' ? '<span class=\"badge purple\">workflow</span>'"),
    '列表徽标须三态（workflow_child 不得再被错标 main）');
  assert.ok(ss.includes("tt === 'interactive' ? '<span class=\"badge blue\">main</span>'"),
    'interactive 须显式映射 main——未知类型不得再冒充 main（selection_side_chat 曾被错标）');
  assert.ok(ss.includes('escapeHtml(tt || \'?\')'),
    '未知 task_type 须落 dim + 原值文本');
  assert.ok(ss.includes('function childBadge'),
    '子 Agent 行徽标须走 childBadge 小函数（非嵌套三元）');
  assert.ok(ss.includes("c.task_type === 'workflow_child'"),
    'childBadge 须 task_type 优先（对 metadata 覆盖面变化稳定）');
  assert.ok(ss.includes('工作流 actor ${wfs}'),
    '子 Agent 表头须拆出工作流 actor 计数');
  assert.ok(ss.includes("isWf?'<span class=\"badge purple\">workflow</span>'"),
    '详情头须有 workflow 徽标分支');

  const rawView = readPublic('views/raw.js');
  for (const t of ['dwf_run', 'dwf_actor', 'dwf_node', 'dwf_event']) {
    assert.ok(rawView.includes(`'${t}'`),
      `raw 页表下拉须含 ${t}（后端放行 UI 可选，防特性落半截）`);
  }
  assert.ok(rawView.includes('value="sequence"'),
    'raw 页排序下拉须含 sequence（dwf_event 天然阅读序）');

  const how = readPublic('views/how.js');
  assert.ok(how.includes("sumSrc('workflow_child')"),
    'How 页示例行须跨模型组求和（find 只取首组曾少报 41%）');
  assert.ok(how.includes('分四类'), 'Session 概念须写四类 task_type');
  assert.ok(how.includes('瞬时在飞口径'), 'widget ×N 的在飞/存活口径差异须文档化');

  // 本轮冒烟顺带修复的既有缺陷：切走 overview 后 SSE 推送撞 null innerHTML
  //（实测每分钟 47 条 TypeError）。源码契约锁住「元素不在即自愈关闭 + return」
  // 形态——只删 return 不删 close 时下一行仍撞 null，须一并锁。
  assert.ok(/const feed = \$\('#feed'\);[\s\S]{0,500}if \(!feed\)[\s\S]{0,200}liveEs\.close\(\);[\s\S]{0,80}return;/.test(ov),
    'renderFeed 须在 #feed 缺席时自愈关闭 EventSource 并 return');
  // startLive 入口幂等 close（防快速 overview→X→overview 的孤儿连接/双行）
  assert.ok((ov.match(/if \(liveEs\) \{ liveEs\.close\(\); liveEs = null; \}/g) || []).length >= 2,
    'view() 与 startLive 两处均须有幂等 close');
});
