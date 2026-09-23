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

// 查询函数清单按 server/db.js 导出面逐一点得（23 个；行号易漂移，权威以
// module.exports 为准——触碰导出面时本清单同步修订，见 Spec A0-4）。
// R4：recentModelRows/recentToolRows/latestModelStartedAt/latestToolStartedAt
//（started_at 单键水位）由 recentModelRowsAfterRowid/latestModelRowid 等 rowid
// 水位查询取代（语义由 test/live-rowid.test.js 覆盖）；
// recentToolRowsAfterRowid/latestToolRowid 的行形状由 test/livegen-error.test.js
// 与 test/live-rowid.test.js 集成覆盖（rowid 水位语义），此处只守护可跑通。
// makeRetryingStatement/isBusyErr/isConnBroken（连接自愈缝）由
// test/db-retry.test.js 直测。
// R5：SLOW_TOOLS_CANDIDATE_CAP_ROWS 是常量非查询函数（slowTools 的候选集规模
// 口径，行为测试在 test/slow-tools.test.js），不进本清单。
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
  ['slowTools', () => [{}]],
  ['recentModelRowsAfterRowid', () => [0]], ['latestModelRowid', () => []],
  ['recentToolRowsAfterRowid', () => [0]], ['latestToolRowid', () => []],
  ['agentsForest', () => [{}]],
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
  // A0-7 守护断言：运行中记录的临时路径在钩子内已不存在
  const fs = require('fs');
  assert.equal(fs.existsSync(fx.root), false, 'fixture 目录必须已清理: ' + fx.root);
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
  assert.equal(out.completedSince.length, 3, 'id1+id2+id4 的完成时间均在 1h 窗口内；id3 是 error');
  // completedSince 的 2h pad 预过滤等价性（db.js 关键优化）的数值级守护：
  // id4 开始于一小时窗前 90min、完成于窗内 50min——pad 被收紧为 0（预过滤
  // 退化为 started_at >= since）时该行会被漏掉，此处即红。
  // id 对齐真实库为 TEXT 主键（fixture-db.js 头注），数字种子经 affinity 存为
  // 字符串，断言按字符串比较。
  assert.ok(out.completedSince.some(r => r.id === '4'),
    '「开始于窗前、完成于窗内」的载荷行必须计入（2h pad 预过滤等价性）');
  // overviewSpeed 数值口径：started_at >= since 过滤下 id4 不参与（90min 前开始），
  // 分子 = 200 + (100+50) = 350，分母 = (10000+8000)/1000 = 18s → 350/18 = 19.4
  assert.equal(out.overviewSpeed.weighted_tps, 19.4);
  assert.equal(out.overviewSpeed.total_tokens, 350);
  assert.equal(out.overviewSpeed.request_count, 2);
  assert.equal(out.agentsForest.roots.length, 1); // s1 为根
  assert.equal(out.agentsForest.total, 2); // s1 + s2
});

test('回退: 缺 model_usage_started_model_idx 的库 overviewKpis 不抛 500（回退慢查询）', () => {
  // 可写连接临时 DROP 官方索引，模拟旧版 ZCode / 外部 ZCODE_DB 的 schema。
  // invalidateDb 只清引用不关旧句柄（为连接损伤设计）；Windows 上句柄未关时
  // cleanup 的 rmSync 会 EPERM，故每次换连接前先显式 close。
  const closeAndInvalidate = () => {
    try { dbq.db().close(); } catch { /* already closed */ }
    dbq.invalidateDb();
  };
  const Database = require('better-sqlite3');
  const w = new Database(fx.dbPath);
  try {
    w.exec('DROP INDEX model_usage_started_model_idx');
    closeAndInvalidate(); // 复位 sqlite_master 探测记忆，强制重查
    const kpis = dbq.overviewKpis(Date.now() - 3600e3);
    assert.equal(kpis.active_sessions, 2); // s1 + s2（回退查询结果不变）
    assert.equal(kpis.model.calls, 3);     // id1/2/3 在 1h 窗内；id4 开始窗前
  } finally {
    try {
      w.exec('CREATE INDEX IF NOT EXISTS model_usage_started_model_idx ' +
             'ON model_usage(started_at, provider_id, model_id)');
    } finally {
      w.close();
      closeAndInvalidate();
    }
  }
});
