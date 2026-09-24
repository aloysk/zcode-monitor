'use strict';
// test/start-detached.test.js — scripts/start-detached.js 的回归：E2E 拉起→
// 幂等→回收、占口不 spawn（三态探活）、spawn 形态源码契约。走 7399 冒烟
// 端口（AGENTS.md 冒烟约定），前置断言端口干净防残留进程假绿。回收用
// process.kill(SIGKILL→Win TerminateProcess)：纯 API、零控制台程序依赖——
// taskkill 在无控制台谱系+系统高负载下实测可无限吊死（目标死亡才返回，
// 2026-09-24 套件挂 196s 后靠外部击杀解封）；E2E 目标是无子进程的裸 node
// server，单 pid 终结即足够。
// pid 在断言前先解析并注册 t.after 兜底回收——脚本超时路径的 pid 只在
// stderr，若等 assert 失败再回收会漏掉，把 7399 泄给后续测试。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');

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

function runScript(extraEnv) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT], {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, PORT: String(PORT), START_TIMEOUT_MS: '20000', ...extraEnv },
      timeout: 30000,
    }, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  });
}

function healthGreen() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/api/health`, { timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(res.statusCode === 200 && body.includes('"ok":true')));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

function killPid(pid) {
  try { process.kill(pid, 'SIGKILL'); return true; }
  catch {
    try { process.kill(pid, 0); return false; } // 仍活着：真失败
    catch { return true; }                       // 已亡=目标达成（竞态下先死于击杀）
  }
}

test('start-detached：拉起 7399 健康 → 重跑幂等不重复 spawn → kill 后端口释放', async (t) => {
  assert.ok(await portFree(PORT), `前置失败：${PORT} 被占用（残留进程？），先排查再跑`);

  const first = await runScript();
  const pidMatch = /pid=(\d+)/.exec(first.stdout + first.stderr);
  const pid = pidMatch ? Number(pidMatch[1]) : null; // 仅失败路径可能为 null——显式事实，不靠断言顺序推理
  if (pid) t.after(() => { killPid(pid); });
  assert.strictEqual(first.err, null, `首次拉起应退出 0：stderr=${first.stderr}`);
  assert.match(first.stdout, /已拉起 pid=\d+/);

  assert.ok(await healthGreen(), '拉起后 /api/health 应为 200 且 body.ok=true');

  const second = await runScript();
  assert.strictEqual(second.err, null, `幂等重跑应退出 0：stderr=${second.stderr}`);
  assert.match(second.stdout, /已有健康实例/);
  assert.doesNotMatch(second.stdout, /已拉起 pid=/, '幂等重跑不应再 spawn');

  assert.ok(pid, '成功路径 stdout 必含 pid=');
  assert.ok(killPid(pid), 'SIGKILL 应成功（或已亡）');
  let freed = false;
  for (let i = 0; i < 20 && !(freed = await portFree(PORT)); i++) await sleep(250);
  assert.ok(freed, 'kill 后端口应在 5s 内释放');
});

test('start-detached：占口但无响应（卡死形态）不得 spawn 竞速者，须如实报因退出 1', async () => {
  assert.ok(await portFree(PORT), `前置失败：${PORT} 被占用（残留进程？），先排查再跑`);
  // 测试内起占口桩：accept 后永不响应——事件循环卡死的探测签名。resume()
  // 必须有：不消费流的连接在客户端 FIN 后永远不终结，server.close() 的
  // 回调就永不触发（本轮实机实锤——单文件跑挂 3 分钟+的最小复现形态）
  const stub = net.createServer((s) => { s.resume(); s.on('error', () => {}); });
  await new Promise((resolve) => stub.listen(PORT, '127.0.0.1', resolve));
  try {
    const r = await runScript();
    assert.notStrictEqual(r.err, null, '卡死形态应退出 1（不是拉起成功）');
    assert.match(r.stderr, /被占用但无响应|卡死/, '失败消息须指向真因（端口被占）与下一步（桌宠重启/手动结束 node）');
    assert.doesNotMatch(r.stdout, /已拉起 pid=/, '占口时绝不能 spawn 竞速者（对被占端口的 racer 必败）');
    assert.ok(stub.listening, '桩不应被脚本杀死（脚本无强杀逻辑，占口者原样保留——此刻桩自身仍在监听）');
  } finally {
    await new Promise((resolve) => stub.close(() => resolve()));
  }
});

test('start-detached：spawn 形态源码契约（detached/windowsHide 红线/OPEN_BROWSER 三态/stderr 落点/fd 规范）', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(/detached: true/.test(src) && /windowsHide: true/.test(src),
    '拉起的是 node.exe 控制台程序且脚本可能出自无控制台环境——detached+windowsHide 是 AGENTS 红线');
  assert.ok(/OPEN_BROWSER: process\.argv\.includes\('--open'\) \? '1' : '0'/.test(src),
    'OPEN_BROWSER 默认 0、--open 显式开（环境泄漏会弹浏览器标签）');
  assert.ok(/restart-child\.log/.test(src) && /openSync\(STDERR_LOG, 'a'\)/.test(src),
    'stderr 追加 logs/restart-child.log——与接替进程同一 grep 落点');
  assert.ok(/fs\.closeSync\(errFd\)/.test(src), '父侧即关 errFd（子进程持继承副本——restart-route 同款规范）');
  assert.ok(/e\.code === 'ECONNREFUSED'/.test(src) && /"ok":true/.test(src),
    '探活须区分拒连（唯一可 spawn 态）且读 body.ok（坏实例回 200 不得当健康）');
});