'use strict';
// test/live-rowid.test.js — R4 修-low：live SSE 行流的 rowid 水位（三视角交叉
// 印证的 started_at 单键水位盲区守护）。仿 livegen-error.test.js 的同毫秒批量
// 用例形态：boot/connect 水位 = MAX(rowid)（历史行不回放）；同一毫秒插入 >100
// 行（超过单次 LIMIT 100）后，SSE 轮询分多 poll 续扫全部行——旧 started_at 水位
// 会把截断点之后的同毫秒行永久跳过。另直测新导出的 rowid 水位查询函数的
// 分页/rid 单调/列完整性。fixture 经 ZCODE_DB 注入，绝不触碰真实库。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { createFixtureDb, buildModelUsage, buildToolUsage } = require('./helpers/fixture-db');

const fx = createFixtureDb();
process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = path.join(os.tmpdir(), 'unused-zcode-log-dir');
process.env.ZCODE_ROLLOUT_DIR = path.join(os.tmpdir(), 'unused-zcode-rollout-dir');
const dbq = require(path.join(__dirname, '..', 'server', 'db'));
const live = require(path.join(__dirname, '..', 'server', 'routes', 'live'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(cond, deadlineMs, stepMs = 50) {
  const deadline = Date.now() + deadlineMs;
  while (!cond() && Date.now() < deadline) await sleep(stepMs);
  return cond();
}

function resetTables() {
  fx.conn.exec('DELETE FROM model_usage; DELETE FROM tool_usage;');
}

test.after(() => {
  try { dbq.db().close(); } catch { /* already closed */ }
  dbq.invalidateDb();
  fx.cleanup();
  assert.equal(fs.existsSync(fx.root), false, 'A0-7: fixture 目录已清理');
});

function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise(resolve => server.on('listening', () => resolve(server)));
}

// 打开一条 SSE 连接，解析 event/data 帧推入 events（{model:[], tool:[]}）
function openSse(port, events) {
  return http.get({ host: '127.0.0.1', port, path: '/api/live/events' }, res => {
    res.setEncoding('utf8');
    let buf = '';
    res.on('data', d => {
      buf += d;
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const evm = /^event: (.+)$/m.exec(frame);
        const dm = /^data: (.+)$/m.exec(frame);
        if (!evm || !dm) continue; // 心跳/注释帧
        try { events[evm[1]].push(JSON.parse(dm[1])); } catch { /* error 帧等 */ }
      }
    });
  });
}

test('rowid 水位查询函数: 同毫秒行 LIMIT 截断后余量可续扫、rid 严格递增、含 SSE 消费的完整列', () => {
  resetTables();
  try {
    const t = Date.now(); // 全部行同一 started_at（毫秒）
    buildModelUsage(fx.conn, Array.from({ length: 15 }, (_, i) => ({
      id: 'm' + i, session_id: 's1', turn_id: 't1', status: 'completed',
      started_at: t, duration_ms: 100, query_source: 'main_turn',
      model_id: 'glm-5', variant: 'v1', input_tokens: 1, output_tokens: 2,
    })));
    const page1 = dbq.recentModelRowsAfterRowid(0, 10);
    assert.equal(page1.length, 10, 'LIMIT 10 截断');
    for (let i = 1; i < page1.length; i++) {
      assert.ok(page1[i].rid > page1[i - 1].rid, 'rid 严格递增（水位可推进）');
    }
    assert.equal(typeof page1[0].rid, 'number');
    assert.equal(page1[0].model_id, 'glm-5');
    assert.equal(typeof page1[0].started_at, 'string', 'started_at 已 ISO 化（前端直接消费）');

    const page2 = dbq.recentModelRowsAfterRowid(page1[page1.length - 1].rid, 100);
    assert.equal(page2.length, 5, '截断点之后的同毫秒余量按 rowid 续扫可见');
    assert.deepEqual(page2.map(r => r.id), ['m10', 'm11', 'm12', 'm13', 'm14']);

    // 工具行流同款（livegen 与 SSE 双消费者共享的查询）
    buildToolUsage(fx.conn, Array.from({ length: 3 }, (_, i) => ({
      id: 'tu' + i, session_id: 's1', tool_name: 'T' + i, status: 'error', started_at: t,
    })));
    const tools = dbq.recentToolRowsAfterRowid(0, 50);
    assert.equal(tools.length, 3);
    assert.equal(tools[0].tool_name, 'T0', '按 rowid ASC（写入序）');
    assert.equal(tools[2].status, 'error');
    assert.equal(typeof tools[2].started_at, 'string');
  } finally { resetTables(); }
});

test('SSE rowid 水位: boot 水位后历史行不回放；同毫秒插入 >100 行（超单次 LIMIT）全部行可见', async () => {
  resetTables();
  try {
    // 连接前的历史行：connect 水位 = MAX(rowid)，不得回放
    buildModelUsage(fx.conn, [
      { id: 'old-m', session_id: 's1', status: 'completed', started_at: Date.now() - 60e3 },
    ]);
    buildToolUsage(fx.conn, [
      { id: 'old-t', session_id: 's1', tool_name: 'Old', status: 'completed', started_at: Date.now() - 60e3 },
    ]);

    const app = express();
    app.use('/api/live', live);
    const server = await listen(app);
    const events = { model: [], tool: [] };
    const req = openSse(server.address().port, events);
    try {
      // 覆盖至少一个 1.5s 轮询周期：历史行必须零发射
      await sleep(1700);
      assert.equal(events.model.length, 0, 'connect 水位（MAX rowid）后历史行不回放');
      assert.equal(events.tool.length, 0);

      // 同一毫秒插入 120 行（> 单次 LIMIT 100）：首个 poll 取 100，余量下个
      // poll 续扫——旧 started_at 水位会把同毫秒余量永久跳过。
      const t = Date.now();
      buildModelUsage(fx.conn, Array.from({ length: 120 }, (_, i) => ({
        id: 'mm' + i, session_id: 's1', status: 'completed', started_at: t,
        model_id: 'glm-5', duration_ms: 5,
      })));
      buildToolUsage(fx.conn, Array.from({ length: 120 }, (_, i) => ({
        id: 'tt' + i, session_id: 's1', tool_name: 'T' + i, status: 'completed', started_at: t,
      })));

      const ok = await waitFor(() => events.model.length >= 120 && events.tool.length >= 120, 12000);
      assert.ok(ok, `全部行可见（model=${events.model.length}/120, tool=${events.tool.length}/120）`);
      assert.equal(events.model.length, 120, 'model 行不多不少');
      assert.equal(events.tool.length, 120, 'tool 行不多不少');
      // 行携带 rid（水位推进载荷）且 per-connection 水位确实分 poll 续扫
      assert.ok(events.model.every(m => typeof m.rid === 'number'));
    } finally {
      req.destroy();
      server.close();
    }
  } finally { resetTables(); }
});
