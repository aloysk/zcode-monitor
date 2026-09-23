'use strict';
// test/slow-tools.test.js — R5 阻断-2：slowTools window=all 的候选集钳制行为。
// c69a145 只钳 30d 时间窗，但真实库时间跨度恰为 30.0d → 窗口不裁任何行
//（52.3万行照旧进 TEMP B-TREE 排序）。R5 加 rowid 尾部候选集规模钳制后：
// ① dbq.slowTools（sinceMs:null）只返回近端行（40d 最慢行被 30d 语义口径钳出）；
// ② 路由级 GET /api/trace/slow-tools?window=all → meta.slow_tools_scope 存在
//    且如实（由导出常量拼出）、items 不含 40d 行；
// ③ 显式窗口（24h）路径不受影响（不套用规模钳制——那是用户点名的时间窗）；
// ④ candidateCapRows 测试缝：注入小 cap 验证 rowid 尾部裁剪独立于时间窗生效。
// fixture 全部在 os.tmpdir()；env 在 require 前注入（与 db-smoke 同法）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { createFixtureDb, buildToolUsage } = require('./helpers/fixture-db');

const fx = createFixtureDb();
const now = Date.now();
// 插入顺序即隐式 rowid 升序（append-only 不变量，fixture 的 TEXT 主键不占用
// rowid 别名，见 helpers/fixture-db.js 头注）：
//  - t40：40d 前、全库最慢（999s）——只应被 30d 语义口径钳出；
//  - t5a：5d 前、次慢（500s，rowid 第 2）——cap=2 时被 rowid 尾界裁出；
//  - t5b：5d-1h 前、10s（rowid 第 3，近端行中最快）；
//  - h1：2h 前、20s（rowid 第 4，最新）——24h 窗口内唯一行。
buildToolUsage(fx.conn, [
  { id: 't40', session_id: 's1', turn_id: 'tt', trace_id: 'tr', tool_call_id: 'c40',
    tool_name: 'Bash', status: 'completed', started_at: now - 40 * 86400e3,
    completed_at: now - 40 * 86400e3 + 999e3, duration_ms: 999000 },
  { id: 't5a', session_id: 's1', turn_id: 'tt', trace_id: 'tr', tool_call_id: 'c5a',
    tool_name: 'Read', status: 'completed', started_at: now - 5 * 86400e3,
    completed_at: now - 5 * 86400e3 + 500e3, duration_ms: 500000 },
  { id: 't5b', session_id: 's1', turn_id: 'tt', trace_id: 'tr', tool_call_id: 'c5b',
    tool_name: 'Grep', status: 'completed', started_at: now - 5 * 86400e3 + 3600e3,
    completed_at: now - 5 * 86400e3 + 3600e3 + 10e3, duration_ms: 10000 },
  { id: 'h1', session_id: 's1', turn_id: 'tt', trace_id: 'tr', tool_call_id: 'c1h',
    tool_name: 'Glob', status: 'completed', started_at: now - 2 * 3600e3,
    completed_at: now - 2 * 3600e3 + 20e3, duration_ms: 20000 },
]);
process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = fx.logDir;
process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;

const dbq = require('../server/db');
const trace = require('../server/routes/trace');

test.after(() => {
  try { dbq.db().close(); } catch { /* already closed */ }
  try { dbq.invalidateDb(); } catch { /* ignore */ }
  fx.cleanup();
  assert.equal(fs.existsSync(fx.root), false, 'A0-7: fixture 目录已清理');
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

test('slowTools window=all：40d 最慢行被钳出，近端行按 duration 降序', () => {
  const items = dbq.slowTools({ sinceMs: null, limit: 50 });
  assert.deepEqual(items.map(i => i.id), ['t5a', 'h1', 't5b'],
    '40d 行（全库最慢）不得出现；近端行按 duration_ms 降序');
});

test('slowTools candidateCapRows 测试缝：rowid 尾部裁剪独立于时间窗生效', () => {
  // cap=2 → 候选集=最新 2 行（t5b、h1）。t5a 是近端行里最慢的（500s）却在
  // rowid 尾界之外——被规模钳制裁出，证明钳的是规模而非时间。
  const items = dbq.slowTools({ sinceMs: null, limit: 50, candidateCapRows: 2 });
  assert.deepEqual(items.map(i => i.id), ['h1', 't5b'],
    'rowid 尾界外的最慢行须被裁出，候选集内按 duration 降序');
  // 导出常量：路由 meta 口径与 db 层钳制共用同一权威值
  assert.equal(dbq.SLOW_TOOLS_CANDIDATE_CAP_ROWS, 100000,
    '缺省候选集规模须为 10 万行（真实库红线口径）');
});

test('slowTools 显式窗口不套规模钳制（24h/7d 是用户点名的时间窗）', () => {
  // cap=1 也只裁 window=all 兜底路径：7d 显式窗口内三行（t5a/t5b/h1）全部参评
  const items = dbq.slowTools({ sinceMs: now - 7 * 86400e3, limit: 50, candidateCapRows: 1 });
  assert.deepEqual(items.map(i => i.id), ['t5a', 'h1', 't5b'],
    '显式窗口不受 candidateCapRows 影响（隐藏截断会改语义）');
});

test('路由级 slow-tools：window=all 的 meta 口径如实、40d 行不出现；24h 不受影响', async () => {
  const app = express();
  app.use('/api/trace', trace);
  const server = await listen(app);
  try {
    const port = server.address().port;
    // window=all：meta.slow_tools_scope 存在且与导出常量拼出的口径逐字一致
    const all = await get(port, '/api/trace/slow-tools?window=all&limit=50');
    assert.equal(all.status, 200);
    const aj = JSON.parse(all.body);
    const expectedScope = `recent_30d_capped_${dbq.SLOW_TOOLS_CANDIDATE_CAP_ROWS}_rows`;
    assert.equal(aj.meta.slow_tools_scope, expectedScope, '口径须如实（近 30d + 最新 cap 行）');
    assert.deepEqual(aj.items.map(i => i.id), ['t5a', 'h1', 't5b'], '40d 行不得出现');

    // window=24h：无 meta（未走兜底路径），只返回窗口内行
    const w24 = await get(port, '/api/trace/slow-tools?window=24h&limit=50');
    assert.equal(w24.status, 200);
    const wj = JSON.parse(w24.body);
    assert.equal(wj.meta, undefined);
    assert.deepEqual(wj.items.map(i => i.id), ['h1'], '24h 窗口语义照常');
  } finally { server.close(); }
});
