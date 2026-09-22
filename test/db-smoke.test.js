'use strict';
// db-smoke.test.js — 冒烟：fixture + server/db.js 查询可跑。
// 约定：先注入 process.env.ZCODE_DB / ZCODE_LOG_DIR / ZCODE_ROLLOUT_DIR 指向
// tmpdir fixture，再 require('../server/db')（db.js:16-23 在 require 时读 env）。
// db.js 在模块级缓存连接，本文件内共享一个 fixture；after 钩子里先关 db.js 的
// 连接再清理（Windows 上文件句柄未释放时 rmSync 会 EBUSY）。
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { createFixtureDb } = require('./helpers/fixture-db');

// 查询函数清单按 server/db.js:707-718 导出面逐一点得（23 个）。
const QUERIES = [
  ['overviewKpis', s => [s]], ['timeseries', () => [24]],
  ['breakdownByModel', s => [s]], ['breakdownByTool', s => [s]],
  ['overviewSpeed', s => [s]], ['recentSpeed', s => [s]],
  ['completedSince', s => [s]], ['todayUsage', () => []],
  ['sessionList', () => [{}]], ['sessionGet', () => ['s1']],
  ['sessionTurns', () => ['s1']], ['sessionConversation', () => ['s1']],
  ['sessionActivity', () => ['s1']], ['sessionChildren', () => ['s1']],
  ['sessionReasoning', () => ['s1']],
  ['errorsList', () => [{}]], ['errorSummary', s => [s]],
  ['slowTools', () => [{}]], ['recentModelRows', () => [0]],
  ['recentToolRows', () => [0]], ['latestModelStartedAt', () => []],
  ['latestToolStartedAt', () => []], ['agentsForest', () => [{}]],
];

const fx = createFixtureDb();
fx.seed();
process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = fx.logDir;
process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;
const dbq = require('../server/db');

test.after(() => {
  try { dbq.db().close(); } catch { /* already closed */ }
  dbq.invalidateDb();
  fx.cleanup();
});

test('冒烟: 注入后 DB_PATH/LOG_DIR/ROLLOUT_DIR 均在 tmpdir 下且不含 .zcode 段', () => {
  const inTmp = p => {
    const rel = path.relative(os.tmpdir(), p);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  for (const p of [dbq.DB_PATH, dbq.LOG_DIR, dbq.ROLLOUT_DIR]) {
    assert.ok(inTmp(p), `不在 tmpdir 下: ${p}`);
    assert.ok(!p.includes('.zcode'), `包含 .zcode 段: ${p}`);
  }
});

test('冒烟: 23 个查询函数在 fixture 上全部跑通且抽查结构正确', () => {
  const since = Date.now() - 3600e3;
  const out = {};
  for (const [name, argf] of QUERIES) {
    assert.ok(typeof dbq[name] === 'function', `db.js 未导出 ${name}`);
    out[name] = dbq[name](...argf(since)); // 不抛错即过第一关
  }
  // 抽查断言（种子数据 → 期望值）
  assert.equal(typeof out.overviewKpis.tokens.input, 'number');
  assert.ok(out.overviewKpis.tokens.input >= 1510); // 1000 + 500 + 10
  assert.equal(out.overviewKpis.model.errors, 1);
  assert.ok(Array.isArray(out.timeseries) && out.timeseries.length >= 1);
  for (const b of out.timeseries) assert.ok('bucket' in b && 'calls' in b);
  for (const row of out.sessionList) {
    assert.ok(row.total_tokens === null || typeof row.total_tokens === 'number');
  }
  assert.equal(out.sessionGet.id, 's1');
  assert.equal(out.sessionConversation.length, 2);
  assert.equal(out.sessionConversation[1].parts.length, 2); // reasoning + text
  assert.equal(out.sessionReasoning.length, 1);
  assert.equal(out.errorsList.model.length, 1);
  assert.equal(out.errorsList.model[0].error_message, 'boom');
  assert.equal(out.completedSince.length, 2); // id1+id2 完成时间均在 1h 窗口内；id3 是 error
  assert.equal(out.agentsForest.roots.length, 1); // s1 为根
  assert.equal(out.agentsForest.total, 2); // s1 + s2
});
