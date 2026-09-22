'use strict';
// test/livegen-error.test.js — livegen 工具失败边（T5 错误态信号源）+ 在飞检测
// 与 gen 边（start/end/lanes）+ 僵尸窗判据。
//
// dbq 直接复用 server/db.js 真实查询（ZCODE_DB 注入 fixture，与 db-smoke 同法）：
// livegen 与 db.js 的集成缝（recentToolRowsAfterRowid/latestToolRowid 的行形状、
// started_at 口径）因此被真实覆盖，而不是门面手抄复刻——真实查询漂移时本文件报警。
// fixture 表在每个用例开头清空（单进程内 db.js 模块级连接按文件隔离，node:test
// 的 run() 按每文件独立子进程执行，见 test/index.js 头注）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFixtureDb, buildToolUsage, buildMessage } = require(path.join(__dirname, 'helpers', 'fixture-db'));

// R8 守护：先注入 tmpdir 路径再 require（db.js 的连接是惰性的，require 只解析
// 路径；本文件从不触碰真实库与真实 ~/.zcode）
const fx = createFixtureDb();
process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = path.join(os.tmpdir(), 'unused-zcode-log-dir');
const dbq = require(path.join(__dirname, '..', 'server', 'db'));
const { createGenWatcher } = require(path.join(__dirname, '..', 'server', 'livegen'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(cond, deadlineMs, stepMs = 20) {
  const deadline = Date.now() + deadlineMs;
  while (!cond() && Date.now() < deadline) await sleep(stepMs);
  return cond();
}

// 「事件必须已到达」用 waitFor 轮询（慢机/事件循环饥饿下固定 sleep 会假失败）；
// 「不得出现」半边用定长 sleep 覆盖若干 tick 后断言没有。
async function waitTicks(ticks = 6) { await sleep(ticks * 20 + 60); }

function resetTables() {
  fx.conn.exec('DELETE FROM message; DELETE FROM tool_usage;');
}

function inFlightMessage({ id, session, created, updated }) {
  const now = Date.now();
  buildMessage(fx.conn, [{
    id, session_id: session,
    time_created: created ?? now,
    time_updated: updated ?? now,
    sequence: Number(id), // sequence 列是 INTEGER，id（TEXT 主键）只作行标识
    data: JSON.stringify({ role: 'assistant', time: {} }), // 无 time.completed → 在飞
  }]);
}

function completeMessage(id) {
  fx.conn.prepare('UPDATE message SET data = ? WHERE id = ?')
    .run(JSON.stringify({ role: 'assistant', time: { completed: Date.now() } }), id);
}

test.after(() => {
  try { dbq.db().close(); } catch { /* already closed */ }
  dbq.invalidateDb();
  fx.cleanup();
  // A0-7 守护断言：运行中记录的临时路径在钩子内已不存在
  assert.equal(require('fs').existsSync(fx.root), false, 'A0-7: fixture 目录已清理');
});

test('tool_error: boot 不回放历史错误，新失败行才发射（带 tool 名）', async () => {
  resetTables();
  try {
    const now = Date.now();
    buildToolUsage(fx.conn, [
      { id: '1', session_id: 's1', tool_name: 'Read', status: 'error', started_at: now - 60e3 },
    ]);
    const events = [];
    const watcher = createGenWatcher(dbq, { pollMs: 20 });
    const off = watcher.onEvent(ev => events.push(ev));
    await waitTicks();
    assert.equal(events.filter(e => e.phase === 'tool_error').length, 0, 'boot 不得回放历史错误');

    buildToolUsage(fx.conn, [
      { id: '2', session_id: 's1', tool_name: 'Bash', status: 'error', started_at: Date.now() },
    ]);
    await waitFor(() => events.some(e => e.phase === 'tool_error'), 3000);
    const errs = events.filter(e => e.phase === 'tool_error');
    assert.equal(errs.length, 1);
    assert.equal(errs[0].tool, 'Bash');
    assert.equal(typeof errs[0].session, 'string');
    off();
    watcher.stop();
  } finally { resetTables(); }
});

test('tool_error: 已完成行不发射；state().lastToolError 记录最近一次失败', async () => {
  resetTables();
  try {
    const watcher = createGenWatcher(dbq, { pollMs: 20 });
    const events = [];
    const off = watcher.onEvent(ev => events.push(ev));
    buildToolUsage(fx.conn, [
      { id: '1', session_id: 's1', tool_name: 'Bash', status: 'completed', started_at: Date.now() },
    ]);
    await waitTicks();
    assert.equal(events.filter(e => e.phase === 'tool_error').length, 0, '成功行不是失败边');
    assert.equal(watcher.state().lastToolError, null);

    buildToolUsage(fx.conn, [
      { id: '2', session_id: 's1', tool_name: 'Read', status: 'error', started_at: Date.now() },
    ]);
    await waitFor(() => events.some(e => e.phase === 'tool_error'), 3000);
    assert.equal(events.filter(e => e.phase === 'tool_error').length, 1);
    assert.equal(watcher.state().lastToolError.tool, 'Read');
    assert.equal(typeof watcher.state().lastToolError.at, 'number');
    off();
    watcher.stop();
  } finally { resetTables(); }
});

test('tool_error: 同毫秒批量失败超过单 tick LIMIT 也全量发射（rowid 水位不丢同毫秒行）', async () => {
  resetTables();
  try {
    const watcher = createGenWatcher(dbq, { pollMs: 20 });
    const events = [];
    const off = watcher.onEvent(ev => events.push(ev));
    // 60 行同一 started_at：旧 started_at 水位在 LIMIT 50 截断后把同毫秒余量
    // 永久跳过；rowid 水位下一 tick 续扫，60 行全见。
    const t = Date.now();
    buildToolUsage(fx.conn, Array.from({ length: 60 }, (_, i) => ({
      id: 'tu-' + i, session_id: 's1', tool_name: 'T' + i, status: 'error', started_at: t,
    })));
    await waitFor(() => events.filter(e => e.phase === 'tool_error').length >= 60, 5000);
    const errs = events.filter(e => e.phase === 'tool_error');
    assert.equal(errs.length, 60);
    assert.equal(new Set(errs.map(e => e.tool)).size, 60);
    assert.equal(watcher.state().lastToolError.tool, 'T59');
    off();
    watcher.stop();
  } finally { resetTables(); }
});

test('tool_error: 启动前开始、启动后才落库的行仍发射（rowid 水位补 boot 盲区）', async () => {
  resetTables();
  try {
    // boot 时已有旧行（watermark = MAX(rowid) = 1）；随后落库的错误行 started_at
    // 比 boot 已见行更老——started_at 水位会永久跳过它，rowid 水位照常发射。
    const now = Date.now();
    buildToolUsage(fx.conn, [
      { id: '1', session_id: 's1', tool_name: 'Read', status: 'completed', started_at: now - 60e3 },
    ]);
    const watcher = createGenWatcher(dbq, { pollMs: 20 });
    const events = [];
    const off = watcher.onEvent(ev => events.push(ev));
    await waitTicks();
    buildToolUsage(fx.conn, [
      { id: '2', session_id: 's1', tool_name: 'Bash', status: 'error', started_at: now - 90e3 },
    ]);
    await waitFor(() => events.some(e => e.phase === 'tool_error'), 3000);
    assert.equal(events.filter(e => e.phase === 'tool_error').length, 1);
    assert.equal(events.find(e => e.phase === 'tool_error').tool, 'Bash');
    off();
    watcher.stop();
  } finally { resetTables(); }
});

test('gen 边: 在飞 assistant 行 → start（带 sessions/inflight），补全 completed → end', async () => {
  resetTables();
  try {
    const watcher = createGenWatcher(dbq, { pollMs: 20 });
    const events = [];
    const off = watcher.onEvent(ev => events.push(ev));
    await waitTicks(); // 空表基线：不得凭空 start
    assert.equal(watcher.state().generating, false);
    assert.equal(events.filter(e => e.phase === 'start').length, 0);

    inFlightMessage({ id: '1', session: 's1' });
    await waitFor(() => events.some(e => e.phase === 'start'), 3000);
    const start = events.find(e => e.phase === 'start');
    assert.equal(start.sessions, 1);
    assert.equal(start.inflight, 1);
    assert.equal(watcher.state().generating, true);

    completeMessage('1');
    await waitFor(() => events.some(e => e.phase === 'end'), 3000);
    assert.equal(watcher.state().generating, false);
    off();
    watcher.stop();
  } finally { resetTables(); }
});

test('gen 边: 第二会话在飞 → lanes 事件（sessions=2，×N 徽章信号源）', async () => {
  resetTables();
  try {
    const watcher = createGenWatcher(dbq, { pollMs: 20 });
    const events = [];
    const off = watcher.onEvent(ev => events.push(ev));
    inFlightMessage({ id: '1', session: 's1' });
    await waitFor(() => events.some(e => e.phase === 'start'), 3000);
    assert.equal(events.filter(e => e.phase === 'lanes').length, 0, '首会话不额外发 lanes');

    inFlightMessage({ id: '2', session: 's2' });
    await waitFor(() => events.some(e => e.phase === 'lanes'), 3000);
    const lanes = events.find(e => e.phase === 'lanes');
    assert.equal(lanes.sessions, 2);
    assert.equal(lanes.inflight, 2);
    off();
    watcher.stop();
  } finally { resetTables(); }
});

test('僵尸窗: time_created 超过 5min 或 time_updated 沉默超过 90s 的行不在飞', async () => {
  resetTables();
  try {
    const watcher = createGenWatcher(dbq, { pollMs: 20 });
    const events = [];
    const off = watcher.onEvent(ev => events.push(ev));
    const now = Date.now();
    inFlightMessage({ id: '1', session: 's1', created: now - 6 * 60e3, updated: now }); // 老僵尸：创建超窗
    inFlightMessage({ id: '2', session: 's2', created: now, updated: now - 2 * 60e3 }); // 新僵尸：沉默超窗
    await waitTicks(10);
    assert.equal(watcher.state().generating, false, '僵尸行不得计入在飞');
    assert.equal(watcher.state().sessions, 0);
    assert.equal(events.filter(e => e.phase === 'start').length, 0);
    off();
    watcher.stop();
  } finally { resetTables(); }
});
