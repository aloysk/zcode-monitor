'use strict';
// fixture-db.js — tmpdir SQLite fixture：伪造 ~/.zcode/cli/db/db.sqlite 的形状。
// DDL 编码 server/db.js 现行查询所假设的最小列集（逐列对照 db.js 的 SQL：
// model_usage 含 mode/agent（db.js sessionActivity/recentModelRows）、
// computed_total_tokens（db.js sessionList/sessionChildren/agentsForest）、
// part.data 供 sessionReasoning 的 json_extract 使用）。
// 只在 os.tmpdir() 下建库，绝不触碰真实库；不读 cwd（测试文件用 __dirname 定位）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const DDL = `
CREATE TABLE session (
  id TEXT PRIMARY KEY, title TEXT, task_type TEXT, directory TEXT,
  parent_id TEXT, project_id TEXT, time_created INTEGER, time_updated INTEGER);
-- id 列类型对齐真实库（2026-09-23 只读实测 sqlite_master：model_usage/
-- tool_usage/message/part 的 id 均为 text primary key）。TEXT 主键不是 rowid
-- 别名：recentToolRowsAfterRowid/latestToolRowid 与 livegen 主查询的水位走的是
-- 独立隐式 rowid——fixture 若用 INTEGER PRIMARY KEY，该列恰是 rowid 别名，会让
-- 「rowid 水位」特性的集成测试在这条列上失去分辨力（真实查询漂移测不出）。
-- 种子行给的数字 id 经 TEXT affinity 存为字符串，断言侧以字符串比较。
CREATE TABLE model_usage (
  id TEXT PRIMARY KEY, session_id TEXT, turn_id TEXT, trace_id TEXT,
  status TEXT, started_at INTEGER, completed_at INTEGER, duration_ms INTEGER,
  first_token_at INTEGER, time_to_first_token_ms INTEGER,
  query_source TEXT, model_id TEXT, provider_id TEXT, variant TEXT, mode TEXT,
  agent TEXT, input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
  cache_read_input_tokens INTEGER, cache_creation_input_tokens INTEGER,
  tool_call_count INTEGER, computed_total_tokens INTEGER,
  error_type TEXT, error_code TEXT, error_message TEXT);
-- 索引名与官方 migration 0010_usage_observability 一致（db.js overviewKpis 的
-- COUNT(DISTINCT session_id) 用 INDEXED BY model_usage_started_model_idx 强制
-- 走 started_at 索引，fixture 必须提供同名索引）。
CREATE INDEX model_usage_started_model_idx ON model_usage(started_at, provider_id, model_id);
CREATE INDEX model_usage_session_turn_idx ON model_usage(session_id, turn_id);
CREATE TABLE tool_usage (
  id TEXT PRIMARY KEY, session_id TEXT, turn_id TEXT, trace_id TEXT,
  tool_call_id TEXT, tool_name TEXT, status TEXT, started_at INTEGER,
  completed_at INTEGER, duration_ms INTEGER, side_effect_scope TEXT,
  read_only INTEGER, destructive INTEGER, time_to_first_output_ms INTEGER,
  approval_status TEXT, exit_code INTEGER,
  output_bytes INTEGER, stderr_bytes INTEGER,
  error_type TEXT, error_code TEXT, error_message TEXT);
-- destructive / time_to_first_output_ms 是官方 schema 列（zai-org/ZCode MIG
-- 0010_usage_observability；usage-accounting.md §1），WP0 约定 fixture 随
-- db.js 现行查询所假设列集扩列（C1 usageToolBreakdown 的 destructive 分布）。
-- 索引名与列序对齐真实库 sqlite_master 实读（四席全量审查轮修正，2026-09-25；
-- 第 2 轮勘误：tool_usage session 前导索引真库是 session_turn_idx(session_id,
-- turn_id) + UNIQUE session_tool_call_idx(session_id, tool_call_id)——第一轮误拼
-- 的 session_tool_idx(session_id, tool_name) 真库不存在）：
--   tool_usage_started_tool_idx(started_at, tool_name) 覆盖索引、
--   tool_usage_session_turn_idx(session_id, turn_id)、
--   model_usage_session_turn_idx(session_id, turn_id) 复合索引（真实库
--   usageAttributionByTurn 的 GROUP BY turn_id 免 TEMP B-TREE 即由此提供）。
-- 对齐动机：fixture EXPLAIN 门禁只能守护 fixture 计划形态，名字/形状双漂移时
-- 真实库 planner 翻转（加索引/ANALYZE）CI 抓不到，复合索引带来的计划差异
-- fixture 也复现不了。UNIQUE 镜像列 tool_call_id 允许多行 NULL（fixture 种子
-- 行常缺该列，SQLite UNIQUE 对 NULL 互不判重）。
-- 创建序镜像真库 rootpage 序（第 3 轮 SQL 席终审实证）：SQLite 在两个等价
-- session 前导覆盖索引间选「创建序最晚」者——真库 rootpage 是
-- session_tool_call_idx(76) 先、session_turn_idx(78) 后，fixture 若倒序建，
-- sessionList toolAgg 的 EQP 会选另一个等价索引（COVERING …session_turn_idx
-- vs …session_tool_call_idx），16 条同组 EQP 对照即漂一条。UNIQUE 镜像列
-- tool_call_id 允许多行 NULL（fixture 种子行常缺该列，SQLite UNIQUE 对 NULL
-- 互不判重）。
CREATE INDEX tool_usage_started_tool_idx ON tool_usage(started_at, tool_name);
CREATE UNIQUE INDEX tool_usage_session_tool_call_idx ON tool_usage(session_id, tool_call_id);
CREATE INDEX tool_usage_session_turn_idx ON tool_usage(session_id, turn_id);
-- 主键 (session_id, turn_id) 镜像真实库（usage-accounting.md §1 实测记载；
-- 真实库 sessionTurns 的 session 寻址即走其自动索引 sqlite_autoindex_）。
CREATE TABLE turn_usage (
  turn_id TEXT, session_id TEXT, status TEXT, trace_id TEXT, user_message_id TEXT,
  started_at INTEGER, first_token_at INTEGER, completed_at INTEGER,
  duration_ms INTEGER, time_to_first_token_ms INTEGER,
  model_request_count INTEGER, model_retry_count INTEGER,
  tool_call_count INTEGER, tool_error_count INTEGER,
  input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
  cache_read_input_tokens INTEGER, cache_creation_input_tokens INTEGER,
  computed_total_tokens INTEGER, context_exceeded INTEGER,
  error_type TEXT, error_code TEXT,
  PRIMARY KEY (session_id, turn_id));
-- 真实库同名索引 turn_usage_started_idx(started_at)（usage-accounting.md §1）；
-- 本族窗口查询（usageTurnsSummary/Timeline）在真实库即命中它。
CREATE INDEX turn_usage_started_idx ON turn_usage(started_at);
CREATE TABLE message (
  id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER,
  time_updated INTEGER,
  sequence INTEGER, data TEXT);
-- time_updated 是 server/livegen.js 主查询的在飞判据（真实库实测列序
-- id, session_id, time_created, time_updated, data, sequence），缺了它
-- livegen 每个 tick 抛 "no such column" 提前返回，下游边事件全灭。
-- 同理该查询的 rowid 尾界（MAX(rowid)-8000）是隐式 rowid，非本 TEXT 主键。
CREATE INDEX idx_message_session ON message(session_id);
CREATE TABLE part (
  id TEXT PRIMARY KEY, message_id TEXT, sequence INTEGER,
  time_created INTEGER, data TEXT);
CREATE INDEX idx_part_message ON part(message_id);
`;

function insertRows(conn, table, rows) {
  if (!rows.length) return;
  // 列集取全部行的并集：批次内第一行可能缺可选列（如 model_usage 首行无
  // error_*，末行有），只按首行取列会把后续行的可选列静默丢成 NULL。
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const stmt = conn.prepare(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  for (const r of rows) stmt.run(cols.map(c => (r[c] === undefined ? null : r[c])));
}
// 按表构建器：行对象字段即上面对应 DDL 的列名，缺省补 NULL。
const buildSession = (conn, rows) => insertRows(conn, 'session', rows);
const buildModelUsage = (conn, rows) => insertRows(conn, 'model_usage', rows);
const buildToolUsage = (conn, rows) => insertRows(conn, 'tool_usage', rows);
const buildTurnUsage = (conn, rows) => insertRows(conn, 'turn_usage', rows);
const buildMessage = (conn, rows) => insertRows(conn, 'message', rows);
const buildPart = (conn, rows) => insertRows(conn, 'part', rows);

function createFixtureDb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-fx-'));
  const dbPath = path.join(root, 'db.sqlite');
  const logDir = path.join(root, 'log');
  const rolloutDir = path.join(root, 'rollout');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(rolloutDir, { recursive: true });
  const conn = new Database(dbPath);
  conn.exec(DDL);
  const fx = {
    root, dbPath, logDir, rolloutDir, conn,
    seed() {
      const now = Date.now();
      buildSession(conn, [
        { id: 's1', title: '主会话', task_type: 'interactive', directory: 'F:/demo',
          parent_id: null, project_id: 'p1', time_created: now - 3600e3, time_updated: now - 60e3 },
        { id: 's2', title: '子代理', task_type: 'subagent_child', directory: 'F:/demo',
          parent_id: 's1', project_id: 'p1', time_created: now - 1800e3, time_updated: now - 120e3 },
      ]);
      buildModelUsage(conn, [
        // time_to_first_token_ms 三态种子：id1 有值（gen=duration−ttft）、
        // id2 留 NULL（速度分母回退全时长——真实库约 23% 行无首等数据）、
        // id4 有值（2h pad 载荷行的 gen 口径）。
        { id: '1', session_id: 's1', turn_id: 't1', trace_id: 'tr1', status: 'completed',
          started_at: now - 300e3, completed_at: now - 290e3, duration_ms: 10000,
          first_token_at: now - 298e3, time_to_first_token_ms: 2000,
          query_source: 'main_turn', model_id: 'glm-5', provider_id: 'zai',
          mode: 'code', agent: 'main',
          input_tokens: 1000, output_tokens: 200, reasoning_tokens: null,
          cache_read_input_tokens: 400, cache_creation_input_tokens: 100,
          tool_call_count: 2, computed_total_tokens: 1300 },
        { id: '2', session_id: 's2', turn_id: 't2', trace_id: 'tr1', status: 'completed',
          started_at: now - 200e3, completed_at: now - 190e3, duration_ms: 8000,
          query_source: 'subagent', model_id: 'glm-5', provider_id: 'zai',
          input_tokens: 500, output_tokens: 100, reasoning_tokens: 50,
          cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
          tool_call_count: 1, computed_total_tokens: 650 },
        { id: '3', session_id: 's1', turn_id: 't3', trace_id: 'tr2', status: 'error',
          started_at: now - 60e3, completed_at: now - 59e3, duration_ms: 1000,
          query_source: 'main_turn', model_id: 'glm-5', provider_id: 'zai',
          input_tokens: 10, output_tokens: 0, reasoning_tokens: null,
          cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
          tool_call_count: 0, computed_total_tokens: 10,
          error_type: 'api_error', error_code: '500', error_message: 'boom' },
        { // completedSince 的 2h pad 预过滤载荷行：开始于 1h 窗前 90min、完成于
          // 窗内 50min（duration 40min）——pad 被收紧为 0 时该行会被漏掉
          id: '4', session_id: 's1', turn_id: 't4', trace_id: 'tr4', status: 'completed',
          started_at: now - 5400e3, completed_at: now - 3000e3, duration_ms: 2400e3,
          time_to_first_token_ms: 60000,
          query_source: 'main_turn', model_id: 'glm-5', provider_id: 'zai',
          input_tokens: 800, output_tokens: 300, reasoning_tokens: 20,
          cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
          tool_call_count: 1, computed_total_tokens: 1120 },
      ]);
      buildToolUsage(conn, [
        { id: '1', session_id: 's1', turn_id: 't1', trace_id: 'tr1', tool_call_id: 'c1',
          tool_name: 'Bash', status: 'completed', started_at: now - 280e3,
          completed_at: now - 279e3, duration_ms: 900, side_effect_scope: 'workspace',
          read_only: 0, approval_status: 'none', exit_code: 0,
          output_bytes: 120, stderr_bytes: 0 },
        { id: '2', session_id: 's1', turn_id: 't3', trace_id: 'tr2', tool_call_id: 'c2',
          tool_name: 'Read', status: 'error', started_at: now - 55e3,
          completed_at: now - 54e3, duration_ms: 50, side_effect_scope: 'none',
          read_only: 1, approval_status: 'none', exit_code: 1,
          output_bytes: 0, stderr_bytes: 40,
          error_type: 'not_found', error_code: 'ENOENT', error_message: 'missing.txt' },
      ]);
      buildTurnUsage(conn, [
        { turn_id: 't1', session_id: 's1', status: 'completed', trace_id: 'tr1',
          user_message_id: '1', started_at: now - 300e3, first_token_at: now - 298e3,
          completed_at: now - 290e3, duration_ms: 10000, time_to_first_token_ms: 2000,
          model_request_count: 1, model_retry_count: 0, tool_call_count: 2,
          tool_error_count: 0, input_tokens: 1000, output_tokens: 200,
          reasoning_tokens: null, cache_read_input_tokens: 400,
          cache_creation_input_tokens: 100, computed_total_tokens: 1300,
          context_exceeded: 0 },
      ]);
      buildMessage(conn, [
        { id: '1', session_id: 's1', time_created: now - 300e3,
          time_updated: now - 300e3, sequence: 1,
          data: JSON.stringify({ role: 'user', tokens: 12 }) },
        { id: '2', session_id: 's1', time_created: now - 290e3,
          time_updated: now - 290e3, sequence: 2,
          data: JSON.stringify({ role: 'assistant', modelID: 'glm-5',
            time: { completed: now - 290e3 } }) },
      ]);
      buildPart(conn, [
        { id: '1', message_id: '2', sequence: 1, time_created: now - 295e3,
          data: JSON.stringify({ type: 'reasoning', text: '思考中' }) },
        { id: '2', message_id: '2', sequence: 2, time_created: now - 292e3,
          data: JSON.stringify({ type: 'text', text: '回答' }) },
      ]);
    },
    close() { conn.close(); },
    cleanup() {
      try { conn.close(); } catch { /* already closed */ }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  return fx;
}
module.exports = { createFixtureDb, buildSession, buildModelUsage, buildToolUsage,
  buildTurnUsage, buildMessage, buildPart };
