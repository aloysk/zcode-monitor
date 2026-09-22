'use strict';
// test/livegen-error.test.js — livegen 工具失败边（T5 错误态信号源）。
// fixture 上验证三件事：boot 不回放历史错误（水位取 MAX(started_at)）、
// 新失败行发射 phase:'tool_error'（带 tool 名）、已完成行不发射且 state()
// 记录最近一次失败。dbq 门面按 server/db.js 的真实形态复刻（recentToolRows
// 把 started_at 映射为 ISO 字符串，livegen 里做 Date.parse）。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { createFixtureDb, buildToolUsage } = require(path.join(__dirname, 'helpers', 'fixture-db'));
const { createGenWatcher } = require(path.join(__dirname, '..', 'server', 'livegen.js'));

// 与 server/db.js recentToolRows(:711) 同形的最小门面（fixture 列已够用）
function makeDbq(conn) {
  return {
    db: () => conn,
    latestToolStartedAt: () =>
      conn.prepare('SELECT MAX(started_at) AS m FROM tool_usage').get().m || 0,
    recentToolRows: (after, limit = 50) =>
      conn.prepare(`SELECT id, session_id, tool_name, status, started_at
                    FROM tool_usage WHERE started_at > ?
                    ORDER BY started_at ASC LIMIT ?`).all(after, limit)
        .map(r => ({ ...r, started_at: new Date(Number(r.started_at)).toISOString() })),
  };
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

test('tool_error: boot 不回放历史错误，新失败行才发射（带 tool 名）', async () => {
  const fx = createFixtureDb();
  try {
    const now = Date.now();
    buildToolUsage(fx.conn, [
      { id: 1, session_id: 's1', tool_name: 'Read', status: 'error', started_at: now - 60e3 },
    ]);
    const events = [];
    const watcher = createGenWatcher(makeDbq(fx.conn), { pollMs: 20 });
    const off = watcher.onEvent(ev => events.push(ev));
    await wait(120); // 覆盖若干个 tick：历史错误行必须一次都不发
    assert.equal(events.filter(e => e.phase === 'tool_error').length, 0, 'boot 不得回放历史错误');

    buildToolUsage(fx.conn, [
      { id: 2, session_id: 's1', tool_name: 'Bash', status: 'error', started_at: Date.now() },
    ]);
    await wait(120);
    const errs = events.filter(e => e.phase === 'tool_error');
    assert.equal(errs.length, 1);
    assert.equal(errs[0].tool, 'Bash');
    assert.equal(typeof errs[0].session, 'string');
    off();
    watcher.stop();
  } finally { fx.cleanup(); }
});

test('tool_error: 已完成行不发射；state().lastToolError 记录最近一次失败', async () => {
  const fx = createFixtureDb();
  try {
    const watcher = createGenWatcher(makeDbq(fx.conn), { pollMs: 20 });
    const events = [];
    const off = watcher.onEvent(ev => events.push(ev));
    buildToolUsage(fx.conn, [
      { id: 1, session_id: 's1', tool_name: 'Bash', status: 'completed', started_at: Date.now() },
    ]);
    await wait(120);
    assert.equal(events.filter(e => e.phase === 'tool_error').length, 0, '成功行不是失败边');
    assert.equal(watcher.state().lastToolError, null);

    buildToolUsage(fx.conn, [
      { id: 2, session_id: 's1', tool_name: 'Read', status: 'error', started_at: Date.now() },
    ]);
    await wait(120);
    assert.equal(events.filter(e => e.phase === 'tool_error').length, 1);
    assert.equal(watcher.state().lastToolError.tool, 'Read');
    assert.equal(typeof watcher.state().lastToolError.at, 'number');
    off();
    watcher.stop();
  } finally { fx.cleanup(); }
});
