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
// 2) 会话侧挂链前提：sessionChildren / agentsForest / sessionList 均按
//    parent_id 无类型过滤——workflow_child 子行不被排除（修复的语义前提，
//    防后续改动把树 / children 也带上类型过滤）；taskType 筛选接线一并覆盖；
// 3) raw 白名单放行 dwf_* 四表（workflow_run / workflow_activity 实测为空表，
//    dwf_* 才是真身运行册），未白名单表仍 400；
// 4) 前端源码契约（frontend-contract.test.js 同款形态）：徽标映射 / 筛选下拉 /
//    速度卡求和 / How 文档 / raw 页表清单四处纳入 workflow_child；
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
// dwf 运行册最小形状（列名对齐真实库 PRAGMA 实测；raw 路由 SELECT * 透传）。
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
// 两个 actor 站点共用同一 session_id 是真实库实测形态（复审 actor 复用会话）——
// 按会话 DISTINCT 计数会塌并，行为计数（overviewSpeed）按行不受影响。
fx.conn.prepare(`INSERT INTO dwf_actor (id, run_id, site_id, name, session_id, time_created, time_updated)
  VALUES ('1', 'dwfrun-1', 'actor#1', '执行员', 'w1', 1, 2),
         ('2', 'dwfrun-1', 'actor#2', '审查员', 'w1', 3, 4)`).run();

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
  // taskType 筛选接线：前端新增 workflow_child 选项依赖此参数端到端生效
  const onlyWf = dbq.sessionList({ taskType: 'workflow_child' });
  assert.deepEqual(onlyWf.map(s => s.id), ['w1'], 'taskType=workflow_child 只返回 w1');
});

test('raw: dwf_* 四表运行册放行（含空表），未白名单表仍 400', async () => {
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

    for (const t of ['dwf_node', 'dwf_event']) {
      const r = await get(`/api/raw/${t}?limit=5`);
      assert.equal(r.status, 200, `${t} 须放行（空表 → count 0）`);
      assert.equal(JSON.parse(r.body).count, 0);
    }

    const r3 = await get('/api/raw/sqlite_sequence?limit=1');
    assert.equal(r3.status, 400, '非白名单表必须保持 400 拒绝');
  } finally {
    server.close();
  }
});

test('前端契约: 徽标/筛选/速度卡/raw表清单/How 文档纳入 workflow_child', () => {
  const readPublic = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
  const ov = readPublic('views/overview.js');
  // 两处来源徽标映射（速度表 r.* 与 by_model m.*）都须三态+purple
  assert.ok(ov.includes("r.query_source==='workflow_child'?'purple'"),
    '速度表徽标须把 workflow_child 标 purple');
  assert.ok(ov.includes("m.query_source==='workflow_child'?'purple'"),
    'by_model 徽标须把 workflow_child 标 purple');
  // 速度卡「子agent」= subagent+workflow 之和的求和表达式须按原形锁定
  //（仅断言出现 workflow_child_count 子串时，删掉求和改回纯 subagent_count 不红）
  assert.ok(ov.includes('(s && s.subagent_count || 0) + (s && s.workflow_child_count || 0)'),
    '速度卡「子agent(含工作流)」须为 subagent_count+workflow_child_count 求和');
  assert.ok(ov.includes('<span class="lbl">工作流</span>'),
    '速度表 footer 须单列工作流计数');

  const ss = readPublic('views/sessions.js');
  assert.ok(ss.includes('value="workflow_child"'),
    '类型筛选下拉须含 workflow_child 选项');
  assert.ok(ss.includes("task_type === 'workflow_child' ? '<span class=\"badge purple\">workflow</span>'"),
    '列表徽标须三态（workflow_child 不得再被错标 main）');
  assert.ok(ss.includes("c.task_type === 'workflow_child'"),
    '子 Agent 表的行徽标须有 workflow_child 兜底分支（无 metadata.profile 的主路径）');
  assert.ok(ss.includes('工作流 actor ${wfs}'),
    '子 Agent 表头须拆出工作流 actor 计数');

  const rawView = readPublic('views/raw.js');
  assert.ok(rawView.includes("'dwf_run'") && rawView.includes("'dwf_event'"),
    'raw 页表下拉须含 dwf 运行册表（后端放行 UI 可选，防特性落半截）');
  assert.ok(rawView.includes('value="sequence"'),
    'raw 页排序下拉须含 sequence（dwf_event 天然阅读序）');

  const how = readPublic('views/how.js');
  assert.ok(how.includes('分四类'), 'Session 概念须写四类 task_type');
  assert.ok(how.includes('workflow_child'), 'How 页须解释 workflow_child 来源');
  assert.ok(how.includes('瞬时在飞口径'), 'widget ×N 的在飞/存活口径差异须文档化');

  // 本轮冒烟顺带修复的既有缺陷：切走 overview 后 SSE 推送撞 null innerHTML
  //（实测每分钟 47 条 TypeError）。源码契约锁住「元素不在即自愈关闭」形态。
  assert.ok(/const feed = \$\('#feed'\);[\s\S]{0,500}if \(!feed\)[\s\S]{0,200}liveEs\.close\(\)/.test(ov),
    'renderFeed 须在 #feed 缺席时自愈关闭 EventSource（防切页后控制台刷错）');
});
