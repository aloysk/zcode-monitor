'use strict';
// test/db-retry.test.js — R4 修-low：db.js 连接自愈层（makeRetryingStatement/
// isBusyErr/isConnBroken）的 stub 测试。运行时行为不变，仅导出测试缝。
// BUSY 重试成功 / NOTADB invalidateDb（close 旧连接）+ 原始错误即抛 / 普通错误
// 首试即抛。
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

test('makeRetryingStatement: SQLITE_NOTADB → invalidateDb 生效（close 旧连接+缓存重开）且原始错误即抛（死语句不重试）', () => {
  // 先建立缓存连接，稍后以连接身份变化观察 invalidateDb 被调用
  const raw1 = dbq.db()._raw;
  assert.ok(raw1, '前置：连接已缓存');

  let n = 0;
  const raw = {
    get: () => { n++; throw mkErr('file is not a database', 'SQLITE_NOTADB'); },
  };
  const stmt = dbq.makeRetryingStatement(raw);
  assert.throws(() => stmt.get(), e => e.code === 'SQLITE_NOTADB',
    '按原始 NOTADB 错误上抛（进翻译层得 503 database_unavailable）');
  assert.equal(n, 1, '连接损伤首试即抛——死语句上的重试无意义'
    + '（自愈发生在调用方下次 db().prepare 重绑新连接；且 invalidateDb 已 close'
    + '旧连接，重试会抛未翻译的 not-open TypeError 把 503 退化成 500）');

  const raw2 = dbq.db()._raw;
  assert.notEqual(raw2, raw1, 'invalidateDb 已丢弃旧连接缓存（下次 db() 重开）');
  // R-26 销账钉（四席全量审查轮，2026-09-25）：invalidateDb 置 null 前已 close
  // 旧连接——以 .open 为 oracle（实测 better-sqlite3 close() 幂等、二次调用不抛
  // 错，throws 断言不可用）；此前置 null 不 close，句柄释放依赖 V8 GC 时序，
  // Windows 下曾致 fixture rmSync EPERM ~10%。
  assert.equal(raw1.open, false, '旧连接应已被 invalidateDb 关闭（R-26 运行时契约）');

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
