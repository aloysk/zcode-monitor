'use strict';
// db-caliber.test.js — A2-1：口径边界行 fixture 测试，固化 docs/usage-accounting.md
// 的核实结论（分支 A：computed_total_tokens 官方预计算权威、全量行不去重）。
// 边界设计（与计划 T4 Step 3 一致）：
//   边界1：cache_read 与 cache_creation 并存、reasoning 为 NULL（COALESCE 路径）、
//          computed_total_tokens 故意 ≠ 公式和（1400 vs 1300）——保证分支 A / B 可区分；
//   边界2：子代理组（parent_id 归组语义面：子行属于子会话、官方口径全量计入）；
//   边界3：token 列全空（SUM 稳健性）。
// side call 标注为注释级交付（turn_usage 数字无变化），按计划显式缩减、不入断言，
// 理由留痕于 docs/usage-accounting.md §side call 缺口。
const test = require('node:test');
const assert = require('node:assert');
const { createFixtureDb, buildSession, buildModelUsage } = require('./helpers/fixture-db');

test('A2-1: 口径边界行（cache 并存 / reasoning NULL / parent_id 组 / SUM 稳健）', () => {
  const fx = createFixtureDb();
  buildSession(fx.conn, [
    { id: 'p1', title: '主', task_type: 'interactive', parent_id: null, project_id: 'pp',
      time_created: 1, time_updated: 2 },
    { id: 'c1', title: '子', task_type: 'subagent', parent_id: 'p1', project_id: 'pp',
      time_created: 1, time_updated: 2 },
  ]);
  buildModelUsage(fx.conn, [
    // 边界1：cache_read 与 cache_creation 并存；reasoning 为 NULL（COALESCE 路径）；
    // computed_total_tokens 故意 ≠ 分项和（1400 vs 1300），模拟官方预计算与
    // 自造公式的差异——分支 A / 分支 B 的期望值由此可区分。
    { id: 1, session_id: 'p1', status: 'completed', started_at: Date.now() - 60e3,
      duration_ms: 1000, query_source: 'main_turn', input_tokens: 1000,
      output_tokens: 200, reasoning_tokens: null, cache_read_input_tokens: 400,
      cache_creation_input_tokens: 100, computed_total_tokens: 1400 },
    // 边界2：子代理组（parent_id 归组语义的 fixture 面）
    { id: 2, session_id: 'c1', status: 'completed', started_at: Date.now() - 50e3,
      duration_ms: 1000, query_source: 'subagent', input_tokens: 500,
      output_tokens: 100, reasoning_tokens: 50, cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0, computed_total_tokens: 650 },
    // 边界3：NULL token 列全空（SUM 稳健性）
    { id: 3, session_id: 'p1', status: 'error', started_at: Date.now() - 40e3,
      duration_ms: null, query_source: 'main_turn' },
  ]);
  process.env.ZCODE_DB = fx.dbPath;
  process.env.ZCODE_LOG_DIR = fx.logDir;
  process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;
  const dbq = require('../server/db');
  try {
    const k = dbq.overviewKpis(Date.now() - 3600e3);
    // 分支无关断言（无论核实结论如何都成立）：
    assert.equal(k.tokens.input, 1500);          // 1000+500（input 列原样含 cache-read）
    assert.equal(k.tokens.input_ex_cache, 1100); // 1500 − 400（展示拆分，去重）
    assert.equal(k.tokens.cache_read, 400);
    assert.equal(k.tokens.cache_write, 100);
    // ——总量断言：分支 A（官方预计算权威），分支 B（自造公式 1950）按核实门结论删除——
    // 核实结论：USAGE recordModelUsage 预计算 + queryAppUsage 直接 SUM 该列；
    // 真实库 381,548/381,548 行 == input+output（docs/usage-accounting.md §总量口径）。
    assert.equal(k.tokens.total, 2050); // 分支 A：官方预计算权威（1400+650，含 side call 差异）
    // ——parent_id 归组断言：分支 A（官方口径全量行、无重复计入），分支 B（排除子代理行）删除——
    // 核实结论：官方 queryAppUsage 全量求和；model_usage 每行只属于一个 session，
    // 子代理行记在子会话名下，时间窗聚合不重复（docs/usage-accounting.md §去重规则）。
    assert.equal(k.model.calls, 3);       // 分支 A：官方口径全量计入、无重复计入
    // 会话维度同口径（sessionList / sessionChildren / agentsForest 三处保持
    // SUM(computed_total_tokens)）：主会话 1400，子会话 650，不叠加。
    assert.equal(dbq.sessionList({}).find(s => s.id === 'p1').total_tokens, 1400);
    assert.equal(dbq.sessionList({}).find(s => s.id === 'c1').total_tokens, 650);
    assert.equal(dbq.sessionChildren('p1')[0].total_tokens, 650);
    const forest = dbq.agentsForest({});
    assert.equal(forest.roots[0].tokens, 1400);
    assert.equal(forest.roots[0].children[0].tokens, 650);
  } finally {
    try { dbq.db().close(); } catch { /* already closed */ }
    dbq.invalidateDb();
    fx.cleanup();
  }
});
