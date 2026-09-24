'use strict';
// test/db-retry.test.js — R4 修-low：db.js 连接自愈层（makeRetryingStatement/
// isBusyErr/isConnBroken）的 stub 测试。运行时行为不变，仅导出测试缝。
// BUSY 重试成功 / NOTADB 耗尽上抛且 invalidateDb 生效 / 普通错误首试即抛。
// fixture 经 ZCODE_DB 注入（观察 invalidateDb 用真实连接身份变化：缓存被丢弃
// 后下次 db() 重开新连接）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createFixtureDb } = require('./helpers/fixture-db');

const fx = createFixtureDb();
fx.seed();
process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = fx.logDir;
process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;
const dbq = require(path.join(__dirname, '..', 'server', 'db'));

const mkErr = (msg, code) => Object.assign(new Error(msg), { code });

test.after(() => {
  try { dbq.db().close(); } catch { /* already closed */ }
  dbq.invalidateDb();
  fx.cleanup();
  assert.equal(fs.existsSync(fx.root), false, 'A0-7: fixture 目录已清理');
});

test('makeRetryingStatement: BUSY 前两次失败第三次成功 → 返回结果（all/get 同语义）', () => {
  let n = 0;
  const raw = {
    get: (...a) => {
      if (++n <= 2) throw mkErr('database is locked', 'SQLITE_BUSY');
      return { value: a.length };
    },
    all: () => { throw mkErr('should not be called', 'SQLITE_BUSY'); },
  };
  const stmt = dbq.makeRetryingStatement(raw);
  assert.deepEqual(stmt.get('x'), { value: 1 });
  assert.equal(n, 3, '恰好两次重试');
});

test('makeRetryingStatement: SQLITE_NOTADB → invalidateDb 生效（连接缓存被丢弃重开）且耗尽后如实上抛', () => {
  // 先建立缓存连接，稍后以连接身份变化观察 invalidateDb 被调用
  const raw1 = dbq.db()._raw;
  assert.ok(raw1, '前置：连接已缓存');

  const raw = {
    get: () => { throw mkErr('file is not a database', 'SQLITE_NOTADB'); },
  };
  const stmt = dbq.makeRetryingStatement(raw);
  assert.throws(() => stmt.get(), e => e.code === 'SQLITE_NOTADB',
    '重试耗尽后按原错误上抛');

  const raw2 = dbq.db()._raw;
  assert.notEqual(raw2, raw1, 'invalidateDb 已丢弃旧连接缓存（下次 db() 重开）');
  // 显式关闭被 invalidateDb 丢弃的旧连接（越界修复经授权，2026-09-25）：Windows
  // 下句柄释放不依赖 GC 时序，否则 after 钩子 rmSync 报 EPERM——已实证（30 循环
  // 3 复现）；根因是 db.js invalidateDb 置 null 前不 close，本轮以测试侧显式
  // 关闭绕行、未改运行时行为。
  try { raw1.close(); } catch { /* 已随 GC 释放则无妨 */ }

  // isBusyErr/isConnBroken 分类缝（导出面直测）
  assert.equal(dbq.isBusyErr(mkErr('x', 'SQLITE_BUSY')), true);
  assert.equal(dbq.isBusyErr(mkErr('database is locked')), true);
  assert.equal(dbq.isBusyErr(mkErr('x', 'SQLITE_NOTADB')), false);
  assert.equal(dbq.isConnBroken(mkErr('x', 'SQLITE_NOTADB')), true);
  assert.equal(dbq.isConnBroken(mkErr('file is not a database')), true);
  assert.equal(dbq.isConnBroken(mkErr('x', 'SQLITE_BUSY')), false);
});

test('makeRetryingStatement: 普通错误首次即上抛（不重试不失效）', () => {
  let n = 0;
  const raw1 = dbq.db()._raw;
  const raw = {
    get: () => { n++; throw mkErr('no such table: whatever', 'SQLITE_ERROR'); },
  };
  const stmt = dbq.makeRetryingStatement(raw);
  assert.throws(() => stmt.get(), /no such table/);
  assert.equal(n, 1, '非 busy/非损伤不消耗重试');
  assert.equal(dbq.db()._raw, raw1, '不触发 invalidateDb');
});
