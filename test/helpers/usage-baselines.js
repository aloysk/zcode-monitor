'use strict';
// usage-baselines.js — usage-routes / usage-queries 两测试文件的共享构造行单点
// 定义（I-测-7 评审修复：两文件对 wsem/nail/tnail/attr 四组构造近乎逐字重复，
// db 口径改动需两处同步——现抽为本 helper 单点持有）。两文件时间轴约定相同
//（H = m => now − m 分钟、now 于测试文件加载时定格、DAY=86400e3），行工厂经
// (H, now) 注入保持相对时间锚。期望值不在此共享——两文件断言语义相异
//（routes 是 24h 窗跨阶段累计、queries 是窗口隔离），期望值与累计说明仍留各自
// 文件逐处标注。字段取两文件超集（routes 版 tool 行多 read_only/destructive/
// approval_status/output_bytes；queries 版相关断言只看 calls/rows.length，超集
// 字段不影响其值）。

// wsem：窗口语义基线三组行（65min / 3d / 31d——31d 行不入 30d 档，两文件同锚）。
// w1 带 time_to_first_token_ms:500（queries 旧版独有字段——I-测-9 评审钉回：
// 超集声明下不得丢字段；routes 侧 C1-2 期望已按其计入 AVG）。
function wsemRows(H, now) {
  return {
    turns: [
      { turn_id: 'w1', session_id: 'wsem', status: 'completed', started_at: H(65),
        duration_ms: 1000, time_to_first_token_ms: 500, model_request_count: 1 },
      { turn_id: 'w2', session_id: 'wsem', status: 'completed', started_at: now - 3 * 86400e3,
        duration_ms: 1000, model_request_count: 1 },
      { turn_id: 'w3', session_id: 'wsem', status: 'completed', started_at: now - 31 * 86400e3,
        duration_ms: 1000, model_request_count: 1 },
    ],
    tools: [
      { id: 'wt1', session_id: 'wsem', turn_id: 'w1', tool_name: 'Bash', status: 'completed',
        started_at: H(65), duration_ms: 100, read_only: 1, destructive: 0,
        approval_status: 'none', output_bytes: 100 },
      { id: 'wt2', session_id: 'wsem', turn_id: 'w2', tool_name: 'Bash', status: 'completed',
        started_at: now - 3 * 86400e3, duration_ms: 100, read_only: 1, destructive: 0,
        approval_status: 'none', output_bytes: 100 },
      { id: 'wt3', session_id: 'wsem', turn_id: 'w3', tool_name: 'Bash', status: 'completed',
        started_at: now - 31 * 86400e3, duration_ms: 100, read_only: 1, destructive: 0,
        approval_status: 'none', output_bytes: 100 },
    ],
    models: [
      { id: 'wm1', session_id: 'wsA', turn_id: 'w1', status: 'completed', started_at: H(65),
        duration_ms: 1000, computed_total_tokens: 10, query_source: 'main_turn' },
      { id: 'wm2', session_id: 'wsB', turn_id: 'w2', status: 'completed', started_at: now - 3 * 86400e3,
        duration_ms: 1000, computed_total_tokens: 10, query_source: 'main_turn' },
      { id: 'wm3', session_id: 'wsC', turn_id: 'w3', status: 'completed', started_at: now - 31 * 86400e3,
        duration_ms: 1000, computed_total_tokens: 10, query_source: 'main_turn' },
    ],
  };
}

// nail：C1-2 数值钉三行（45-50min——24h 窗内，routes 期望值计入 w1 基线）。
function nailRows(H) {
  return [
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
  ];
}

// tnail：C1-3 工具数值钉两行（15min）。
function tnailRows(H) {
  return [
    { id: 'bg1', session_id: 'tnail', turn_id: 't1', tool_name: 'Bash', status: 'completed',
      started_at: H(15), duration_ms: 900, read_only: 0, destructive: 1,
      approval_status: 'none', output_bytes: 120 },
    { id: 'rd1', session_id: 'tnail', turn_id: 't1', tool_name: 'Read', status: 'error',
      started_at: H(15), duration_ms: 50, read_only: 1, destructive: 0,
      approval_status: 'denied', output_bytes: 0 },
  ];
}

// attr：C5 两级数值钉（sA/sB 会话 + 四 model 行，8min）。
function attrRows(H) {
  return {
    sessions: [
      { id: 'sA', title: '会话A', task_type: 'interactive', time_created: H(30), time_updated: H(8) },
      { id: 'sB', title: '会话B', task_type: 'interactive', time_created: H(30), time_updated: H(8) },
    ],
    models: [
      { id: 'am1', session_id: 'sA', turn_id: 'ta', status: 'completed', started_at: H(8),
        duration_ms: 1000, computed_total_tokens: 100, query_source: 'main_turn', tool_call_count: 2 },
      { id: 'am2', session_id: 'sA', turn_id: 'tb', status: 'completed', started_at: H(8),
        duration_ms: 2000, computed_total_tokens: 50, query_source: 'subagent', tool_call_count: 0 },
      { id: 'am4', session_id: 'sA', turn_id: 'ta', status: 'completed', started_at: H(8),
        duration_ms: 100, computed_total_tokens: 25, query_source: 'workflow_child', tool_call_count: 1 },
      { id: 'bm3', session_id: 'sB', turn_id: 'tc', status: 'completed', started_at: H(8),
        duration_ms: 500, computed_total_tokens: 300, query_source: 'main_turn', tool_call_count: 1 },
    ],
  };
}

module.exports = { wsemRows, nailRows, tnailRows, attrRows };
