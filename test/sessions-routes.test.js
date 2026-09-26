'use strict';
// test/sessions-routes.test.js — R4 修-medium：sessions 路由的密闭路径测试。
// 覆盖面：
// 1) :id / :toolCallId 路径段闸（防 `..%2F..%2F` 越出 EXEC_DIR/AGENTS_DIR——
//    Express 对单段参数 decodeURIComponent，编码分隔符可穿越）；
// 2) tool-output 的 stdout/stderr 命中、>200KB truncated、目录缺失 → null；
// 3) children 的 metadata.json 富化（ZCODE_AGENTS_DIR 注入生效）。
// 全部 fixture 在 os.tmpdir()；EXEC/AGENTS 目录经 ZCODE_EXEC_DIR/ZCODE_AGENTS_DIR
// require 前注入（routes/sessions.js require 时读取，与 ZCODE_DB 同法）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { createFixtureDb } = require('./helpers/fixture-db');

const fx = createFixtureDb();
fx.seed();
process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = fx.logDir;
process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-sessroute-'));
const execDir = path.join(root, 'exec');
const agentsDir = path.join(root, 'agents');
fs.mkdirSync(execDir, { recursive: true });
fs.mkdirSync(agentsDir, { recursive: true });
process.env.ZCODE_EXEC_DIR = execDir;
process.env.ZCODE_AGENTS_DIR = agentsDir;

const sessions = require('../server/routes/sessions');

test.after(() => {
  try { require('../server/db').db().close(); } catch { /* already closed */ }
  try { require('../server/db').invalidateDb(); } catch { /* ignore */ }
  fx.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(fs.existsSync(root), false, 'A0-7: exec/agents fixture 目录已清理');
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

test('tool-output: stdout/stderr 双文件命中；stdout>200KB → truncated:true', async () => {
  const sess = 'sess-exec-001';
  const dir = path.join(execDir, sess);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'call-1-stdout.log'), 'OUT-DATA');
  fs.writeFileSync(path.join(dir, 'call-1-stderr.log'), 'ERR-DATA');
  const app = express();
  app.use('/api/sessions', sessions);
  const server = await listen(app);
  try {
    const port = server.address().port;

    const r = await get(port, `/api/sessions/${sess}/tool-output/call-1`);
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.equal(j.stdout, 'OUT-DATA');
    assert.equal(j.stderr, 'ERR-DATA');
    assert.equal(j.truncated, false);

    fs.writeFileSync(path.join(dir, 'call-2-stdout.log'), 'x'.repeat(200 * 1024 + 500));
    const r2 = await get(port, `/api/sessions/${sess}/tool-output/call-2`);
    assert.equal(r2.status, 200);
    const j2 = JSON.parse(r2.body);
    assert.equal(j2.truncated, true, '超 200KB stdout 须置 truncated');
    assert.ok(j2.stdout.length < 200 * 1024 + 500, '超限 stdout 须截断');
    assert.match(j2.stdout, /truncated/, '截断须注明余量');
  } finally { server.close(); }
});

test('tool-output: 会话目录不存在 → 全 null（200）；children 不存在的会话 → 空列表', async () => {
  const app = express();
  app.use('/api/sessions', sessions);
  const server = await listen(app);
  try {
    const port = server.address().port;
    const r = await get(port, '/api/sessions/no-such-sess/tool-output/call-9');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.equal(j.stdout, null);
    assert.equal(j.stderr, null);
    assert.equal(j.truncated, false);

    const c = await get(port, '/api/sessions/no-such-sess/children');
    assert.equal(c.status, 200);
    assert.equal(JSON.parse(c.body).children.length, 0);
  } finally { server.close(); }
});

test('路径段闸: 含 `..%2F` 的 id/toolCallId → 400（不触文件系统）；children 同闸', async () => {
  const app = express();
  app.use('/api/sessions', sessions);
  const server = await listen(app);
  try {
    const port = server.address().port;
    // Express 对单段参数 decodeURIComponent：`..%2F..%2Fwinnt` 解码后含分隔符，
    // 旧实现 path.join(EXEC_DIR, id) 可越出 exec 根。闸后一律 400。
    const attacks = [
      '/api/sessions/..%2F..%2Fwinnt/tool-output/call-1',
      '/api/sessions/..%2F..%2Fwinnt%2Fsystem32/tool-output/call-1',
      '/api/sessions/sess-exec-001/tool-output/..%2F..%2Fevil',
      '/api/sessions/sess-exec-001/tool-output/..',
      '/api/sessions/..%2F..%2Fetc/children',
      '/api/sessions/..%2E/children', // `..` 前缀段（保守拒绝，与 pet-import 同款）
      '/api/sessions/sess%2E%2E%2F..%2Fevil/children',
    ];
    for (const p of attacks) {
      const r = await get(port, p);
      assert.equal(r.status, 400, `应拒绝路径形态: ${p}`);
      assert.equal(JSON.parse(r.body).error.includes('invalid'), true);
    }
    // 合法单段 id（字符集内）照常放行（上文用例已覆盖 200 路径，此处复核不误伤点号）
    const ok = await get(port, '/api/sessions/sess-exec-001/tool-output/call-1');
    assert.equal(ok.status, 200);
  } finally { server.close(); }
});

test('children: ZCODE_AGENTS_DIR 注入生效——metadata.json 富化 profile/prompt', async () => {
  // fixture: s2 是 s1 的子会话；agents/<parent>/agent_x/metadata.json 匹配 s2
  const parent = path.join(agentsDir, 's1', 'agent_abc123');
  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(path.join(parent, 'metadata.json'), JSON.stringify({
    childSessionId: 's2', profileId: 'Explore',
    prompt: '找到内存泄漏', parentToolUseId: 'toolu_1',
  }));
  const app = express();
  app.use('/api/sessions', sessions);
  const server = await listen(app);
  try {
    const r = await get(server.address().port, '/api/sessions/s1/children');
    assert.equal(r.status, 200);
    const children = JSON.parse(r.body).children;
    assert.equal(children.length, 1);
    assert.equal(children[0].id, 's2');
    assert.equal(children[0].profile, 'Explore');
    assert.equal(children[0].prompt, '找到内存泄漏');
    assert.equal(children[0].parentToolUseId, 'toolu_1');
    // C6 信号同源合并（2026-09-27 用户「多少在工作」诉求）：四字段形状在；
    // 无活动 fixture → idle（idleSignal 缺省，与列表路由同款）。
    const sig = children[0].signal;
    assert.ok(sig && sig.state === 'idle', `signal 形状须在且无活动为 idle（实测 ${JSON.stringify(sig)}）`);
    assert.ok('confidence' in sig && 'waiting_since' in sig && 'reason' in sig, 'signal 四字段形状');
  } finally { server.close(); }
});

test('children enrich: O(N) 单遍 + mtime 缓存命中（性能席 CRITICAL 回归钉）', async () => {
  // 旧形态对每个 child 内层重扫整个 agents/<parent>/ 目录——6 children ×
  // 30 子目录 = 180 次 metadata 读；单遍索引 = 30 次（每子目录恰一次）。
  // 缓存命中后第二次请求零 metadata 读（readdir/stat 不经 readFileSync）。
  for (let i = 1; i <= 5; i++) {
    fx.conn.prepare(`INSERT INTO session (id, parent_id, task_type, title, time_created, time_updated)
                     VALUES (?, 's1', 'subagent_child', ?, ?, ?)`)
      .run('sc' + i, 'child' + i, 1758900000000 + i, 1758900000000 + i);
    const sub = path.join(agentsDir, 's1', 'agent_sub' + i);
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'metadata.json'),
      JSON.stringify({ childSessionId: 'sc' + i, profileId: 'Explore', prompt: 'p' + i }));
    for (let j = 1; j <= 5; j++) { // 不匹配的干扰子目录（旧形态的重复扫描面）
      const noise = path.join(agentsDir, 's1', 'noise' + i + '_' + j);
      fs.mkdirSync(noise, { recursive: true });
      fs.writeFileSync(path.join(noise, 'metadata.json'),
        JSON.stringify({ childSessionId: 'none' + j }));
    }
  }
  const orig = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (...a) { reads++; return orig.apply(this, a); };
  const app = express();
  app.use('/api/sessions', sessions);
  const server = await listen(app);
  try {
    let r = await get(server.address().port, '/api/sessions/s1/children');
    const children = JSON.parse(r.body).children;
    assert.equal(children.length, 6, 's2 + sc1..5');
    const firstPass = reads;
    assert.ok(firstPass <= 36, `单遍 enrich：metadata 读次数 O(子目录数)=30（实测 ${firstPass}；旧 O(N²) 形态=180）`);
    reads = 0;
    r = await get(server.address().port, '/api/sessions/s1/children');
    assert.equal(JSON.parse(r.body).children.length, 6);
    assert.equal(reads, 0, `缓存命中零 metadata 读（实测 ${reads}）`);
    // 富化语义仍正确（干扰目录不劫持匹配）
    const byId = Object.fromEntries(JSON.parse(r.body).children.map(c => [c.id, c]));
    for (let i = 1; i <= 5; i++) assert.equal(byId['sc' + i].prompt, 'p' + i);
  } finally {
    fs.readFileSync = orig;
    server.close();
  }
});
