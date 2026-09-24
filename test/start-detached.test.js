'use strict';
// test/start-detached.test.js — scripts/start-detached.js 的 E2E 回归：拉起 →
// 幂等（已在跑不重复 spawn）→ 回收（kill 后端口释放）。走 7399 冒烟端口
//（AGENTS.md 冒烟约定），前置断言端口干净防残留进程假绿；杀进程用
// taskkill（控制台程序必带 windowsHide:true——AGENTS 硬红线）。
// pid 在断言前先解析并注册 t.after 兜底回收——脚本超时路径的 pid 只在
// stderr，若等 assert 失败再回收会漏掉，把 7399 泄给后续测试。
const test = require('node:test');
const assert = require('node:assert');
const { execFile } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'start-detached.js');
const PORT = 7399;
const BASE = `http://127.0.0.1:${PORT}`;

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runScript() {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT], {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, PORT: String(PORT), START_TIMEOUT_MS: '20000' },
      timeout: 30000,
    }, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  });
}

function healthGreen() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/api/health`, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

function killTree(pid) {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (err) => resolve(!err));
  });
}

test('start-detached：拉起 7399 健康 → 重跑幂等不重复 spawn → kill 后端口释放', async (t) => {
  assert.ok(await portFree(PORT), `前置失败：${PORT} 被占用（残留进程？），先排查再跑`);

  const first = await runScript();
  const pidMatch = /pid=(\d+)/.exec(first.stdout + first.stderr);
  if (pidMatch) {
    const pid = Number(pidMatch[1]);
    t.after(async () => { await killTree(pid); });
  }
  assert.strictEqual(first.err, null, `首次拉起应退出 0：stderr=${first.stderr}`);
  assert.match(first.stdout, /已拉起 pid=\d+/);

  assert.ok(await healthGreen(), '拉起后 /api/health 应为 200');

  const second = await runScript();
  assert.strictEqual(second.err, null, `幂等重跑应退出 0：stderr=${second.stderr}`);
  assert.match(second.stdout, /已有健康实例/);
  assert.doesNotMatch(second.stdout, /已拉起 pid=/, '幂等重跑不应再 spawn');

  const pid = Number(pidMatch[1]);
  assert.ok(await killTree(pid), 'taskkill 应成功');
  let freed = false;
  for (let i = 0; i < 20 && !(freed = await portFree(PORT)); i++) await sleep(250);
  assert.ok(freed, 'kill 后端口应在 5s 内释放');
});
