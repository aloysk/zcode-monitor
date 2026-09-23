'use strict';
// test/restart-route.test.js — POST /api/restart 的回归（壳右键菜单「重启面板」
// 的服务端落地）。spawn/exit 全量注入记录器（restart-route.js 工厂参数），
// 绝不真杀测试进程；真实端口交接冒烟由 7399 实机轮覆盖（AGENTS.md 冒烟约定）。
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { makeRestartRoute, RESTART_HEADER } = require('../server/restart-route');

function mount(route) {
  const app = express();
  app.post('/api/restart', route);
  return app;
}

function req(app, { method = 'post', header } = {}) {
  const opts = { method };
  if (header !== undefined) opts.headers = { [RESTART_HEADER]: header };
  return app.inject ? app.inject(opts) : new Promise((resolve, reject) => {
    // 轻量直连：不引 supertest，用 http 监 0 端口跑一次真请求
    const http = require('http');
    const srv = app.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      const r = http.request({ host: '127.0.0.1', port, path: '/api/restart', method, headers: opts.headers || {} }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          // Express 默认 404（GET 未命中）是 HTML——只在本体是 JSON 时解析
          const json = body && body.trimStart().startsWith('{') ? JSON.parse(body) : {};
          srv.close(() => resolve({ status: res.statusCode, body: json }));
        });
      });
      r.on('error', (e) => srv.close(() => reject(e)));
      r.end();
    });
  });
}

// 记录器形态的注入件：spawn 按位置参数记录（与 child_process.spawn 同形——
// 生产直通该签名，7399 实机曾栽在单对象形态上），返回假 child；exit 只记不退
function recorder() {
  const calls = { spawn: [], exit: [] };
  const fakeChild = { unref() { calls.unrefed = true; } };
  return {
    calls,
    spawn: (execPath, argv, opts) => { calls.spawn.push({ execPath, argv, opts }); return fakeChild; },
    exit: (code) => { calls.exit.push(code); },
  };
}

test('restart: 缺首部 403，不 spawn 不退出', async () => {
  const rec = recorder();
  const app = mount(makeRestartRoute({ spawn: rec.spawn, exit: rec.exit, exitDelayMs: 5 }));
  const r = await req(app, { header: '0' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.error, 'forbidden');
  assert.strictEqual(rec.calls.spawn.length, 0);
  assert.strictEqual(rec.calls.exit.length, 0);
});

test('restart: 带首部 200，spawn 参数齐整（入口/延迟/OPEN_BROWSER=0/detached/继承环境）且延迟退出', async () => {
  const rec = recorder();
  const app = mount(makeRestartRoute({ spawn: rec.spawn, exit: rec.exit, exitDelayMs: 5, bootDelayMs: 4321 }));
  const r = await req(app, { header: '1' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(rec.calls.spawn.length, 1);
  const a = rec.calls.spawn[0];
  assert.strictEqual(a.execPath, process.execPath);
  assert.ok(a.argv[0].endsWith(path_join('server', 'index.js')), '接替入口须是 server/index.js 绝对路径');
  assert.strictEqual(a.opts.detached, true);
  assert.strictEqual(a.opts.env.OPEN_BROWSER, '0');
  assert.strictEqual(a.opts.env.ZCODE_RESTART_BOOT_DELAY_MS, '4321');
  assert.ok(a.opts.env.PATH !== undefined, '接替进程继承父环境（PORT/ZCODE_WIDGET_CHILD 等随行）');
  assert.strictEqual(rec.calls.unrefed, true, 'child.unref()：父退出不连坐');
  // 延迟退出（exitDelayMs=5）：等 50ms 足以观察到
  await new Promise((ok) => setTimeout(ok, 50));
  assert.deepStrictEqual(rec.calls.exit, [0]);
});

test('restart: 幂等闩——受理后二次 POST 回 already，不重复 spawn', async () => {
  const rec = recorder();
  const app = mount(makeRestartRoute({ spawn: rec.spawn, exit: rec.exit, exitDelayMs: 60 * 1000 }));
  const r1 = await req(app, { header: '1' });
  const r2 = await req(app, { header: '1' });
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(r2.body.already, true);
  assert.strictEqual(rec.calls.spawn.length, 1);
});

test('restart: spawn 抛错 500 如实上报，本进程不退出（不许「答应了却谁都没起来」)', async () => {
  const rec = recorder();
  const boom = () => { throw new Error('ENOENT node'); };
  const app = mount(makeRestartRoute({ spawn: boom, exit: rec.exit }));
  const r = await req(app, { header: '1' });
  assert.strictEqual(r.status, 500);
  assert.strictEqual(r.body.error, 'spawn_failed');
  assert.strictEqual(rec.calls.exit.length, 0);
  // 失败不置闩：排除故障后可重试
  const app2 = mount(makeRestartRoute({ spawn: rec.spawn, exit: rec.exit, exitDelayMs: 60 * 1000 }));
  const r2 = await req(app2, { header: '1' });
  assert.strictEqual(r2.status, 200);
});

test('restart: GET 不命中（POST-only，与既有 /api 未匹配行为一致）', async () => {
  const rec = recorder();
  const app = mount(makeRestartRoute({ spawn: rec.spawn, exit: rec.exit }));
  const r = await req(app, { method: 'get', header: '1' });
  assert.strictEqual(r.status, 404);
});

test('restart: index.js 接替进程延迟 listen 契约（源码形态）', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  assert.ok(src.includes('ZCODE_RESTART_BOOT_DELAY_MS'), 'index.js 须读 ZCODE_RESTART_BOOT_DELAY_MS');
  assert.ok(/if \(RESTART_BOOT_DELAY_MS > 0\) \{[\s\S]{0,200}setTimeout\(startListen, RESTART_BOOT_DELAY_MS\)/.test(src),
    '延迟>0 时 listen 须推迟（直接 bind 会 EADDRINUSE）');
});

// path.join 的小包装（仅测试内断言用，避免 win 分隔符差异）
function path_join(...p) { return require('path').join(...p); }
