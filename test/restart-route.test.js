'use strict';
// test/restart-route.test.js — POST /api/restart 的回归（壳右键菜单「重启面板」
// 的服务端落地）。spawn/exit 全量注入记录器（restart-route.js 工厂参数），
// 绝不真杀测试进程；真实端口交接冒烟由 7399 实机轮覆盖（AGENTS.md 冒烟约定）。
// 假 child 用 EventEmitter：child.on('error') 是真实 spawn 失败的唯一到达路径
// （ENOENT/EPERM 异步），{unref(){}} 形态的假 child 会静默跳过挂监听、让整条
// 分支零覆盖——首轮测试席实锤。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const express = require('express');
const { makeRestartRoute, RESTART_HEADER } = require('../server/restart-route');

// 跨语言契约：C# 壳硬编码同名字面量（Program.cs），服务端改名会让全套 JS 测试
// 照绿而生产断线——常量值本身即契约，钉死。
assert.strictEqual(RESTART_HEADER, 'X-Zcode-Monitor-Restart');

function mount(route) {
  const app = express();
  app.post('/api/restart', route);
  return app;
}

function req(app, { method = 'post', header } = {}) {
  const opts = { method };
  if (header !== undefined) opts.headers = { [RESTART_HEADER]: header };
  return new Promise((resolve, reject) => {
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
// 生产直通该签名，7399 实机曾栽在单对象形态上）；假 child 是 EventEmitter
// （可 emit 'error'）带 unref 桩；exit 只记不退。
function recorder() {
  const calls = { spawn: [], exit: [] };
  const fakeChild = new EventEmitter();
  fakeChild.unref = () => { calls.unrefed = true; };
  return {
    calls, fakeChild,
    spawn: (execPath, argv, opts) => { calls.spawn.push({ execPath, argv, opts }); return fakeChild; },
    exit: (code) => { calls.exit.push(code); },
  };
}

test('restart: 缺首部 403（含完全无首部形态），不 spawn 不退出', async () => {
  const rec = recorder();
  const app = mount(makeRestartRoute({ spawn: rec.spawn, exit: rec.exit, exitDelayMs: 5, stderrPath: path.join(process.env.TEMP || '/tmp', 't-1.log') }));
  const r0 = await req(app, { header: '0' });
  assert.strictEqual(r0.status, 403);
  assert.strictEqual(r0.body.error, 'forbidden');
  const rAbs = await req(app, {}); // 完全无首部
  assert.strictEqual(rAbs.status, 403);
  assert.strictEqual(rec.calls.spawn.length, 0);
  assert.strictEqual(rec.calls.exit.length, 0);
});

test('restart: 带首部 200，spawn 参数齐整（入口/延迟/OPEN_BROWSER=0/detached/继承环境/stderr 落盘）且延迟退出', async () => {
  const rec = recorder();
  const stderrPath = path.join(process.env.TEMP || '/tmp', 'restart-t2.log');
  const app = mount(makeRestartRoute({ spawn: rec.spawn, exit: rec.exit, exitDelayMs: 5, bootDelayMs: 4321, stderrPath }));
  process.env.PORT_FOR_PIN = '7555'; // 继承面：PORT 类 knob 必须透传（companion/端口契约）
  try {
    const r = await req(app, { header: '1' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(rec.calls.spawn.length, 1);
    const a = rec.calls.spawn[0];
    assert.strictEqual(a.execPath, process.execPath);
    assert.ok(a.argv[0].endsWith(path.join('server', 'index.js')), '接替入口须是 server/index.js 绝对路径');
    assert.strictEqual(a.opts.detached, true);
    assert.strictEqual(a.opts.env.OPEN_BROWSER, '0');
    assert.strictEqual(a.opts.env.ZCODE_RESTART_BOOT_DELAY_MS, '4321');
    assert.strictEqual(a.opts.env.PORT_FOR_PIN, '7555', '接替进程继承父环境（PORT/ZCODE_WIDGET_CHILD 等随行）');
    // stderr 落盘而非全忽略（stdout 才是 'ignore'——请求 logger 太吵）
    assert.strictEqual(typeof a.opts.stdio[2], 'number', '接替 stderr 须指向日志 fd（崩溃栈可追溯）');
    assert.strictEqual(a.opts.stdio[0], 'ignore');
    assert.strictEqual(a.opts.stdio[1], 'ignore');
    assert.ok(fs.existsSync(stderrPath), 'stderr 日志文件须已创建');
    assert.strictEqual(rec.calls.unrefed, true, 'child.unref()：父退出不连坐');
    // 延迟退出（exitDelayMs=5）：等 50ms 足以观察到
    await new Promise((ok) => setTimeout(ok, 50));
    assert.deepStrictEqual(rec.calls.exit, [0]);
  } finally { delete process.env.PORT_FOR_PIN; }
});

test('restart: 幂等闩——受理后二次 POST 回 already，不重复 spawn、不重复安排退出', async () => {
  const rec = recorder();
  const app = mount(makeRestartRoute({ spawn: rec.spawn, exit: rec.exit, exitDelayMs: 5, stderrPath: path.join(process.env.TEMP || '/tmp', 't-3.log') }));
  const r1 = await req(app, { header: '1' });
  const r2 = await req(app, { header: '1' });
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(r2.body.already, true);
  assert.strictEqual(rec.calls.spawn.length, 1);
  await new Promise((ok) => setTimeout(ok, 50));
  // 「一次生命周期只安排一次退出」——二次 POST 不得武装第二个退出定时器
  assert.deepStrictEqual(rec.calls.exit, [0]);
});

test('restart: spawn 同步抛错 500 如实上报，本进程不退出，且失败不置闩（同实例可重试）', async () => {
  const rec = recorder();
  let fail = true;
  const flap = (...a) => {
    if (fail) { fail = false; throw new Error('ENOENT node'); } // 首次抛错
    return rec.spawn(...a); // 第二次走真实记录器
  };
  const app = mount(makeRestartRoute({ spawn: flap, exit: rec.exit, exitDelayMs: 5, stderrPath: path.join(process.env.TEMP || '/tmp', 't-4.log') }));
  const r1 = await req(app, { header: '1' });
  assert.strictEqual(r1.status, 500);
  assert.strictEqual(r1.body.error, 'spawn_failed');
  assert.strictEqual(rec.calls.exit.length, 0);
  // 同一实例重试（不是重新 mount——那会拿到全新闭包，断言空转）
  const r2 = await req(app, { header: '1' });
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(rec.calls.spawn.length, 1);
});

test('restart: child 异步 error 撤销退出定时器并回退闩——旧进程不退出、可再受理（四席共识 CRITICAL 的回归钉）', async () => {
  const rec = recorder();
  const app = mount(makeRestartRoute({ spawn: rec.spawn, exit: rec.exit, exitDelayMs: 5, stderrPath: path.join(process.env.TEMP || '/tmp', 't-5.log') }));
  const r1 = await req(app, { header: '1' });
  assert.strictEqual(r1.status, 200);
  // 真实 spawn 失败形态：'error' 事件异步到达（ENOENT/EPERM/EMFILE 从不同步抛）
  rec.fakeChild.emit('error', new Error('EPERM node.exe'));
  // 若退出定时器未被撤销，5ms 后 exit 就会被调——等 50ms 足以判死
  await new Promise((ok) => setTimeout(ok, 50));
  assert.deepStrictEqual(rec.calls.exit, [], 'child 异步 error 后旧进程绝不能退出（「答应了重启却谁都没起来」）');
  // 闩已回退：再 POST 是全新受理、重新 spawn
  const r2 = await req(app, { header: '1' });
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(r2.body.already, undefined);
  assert.strictEqual(rec.calls.spawn.length, 2);
  // 第二次成功受理后退出恢复武装
  await new Promise((ok) => setTimeout(ok, 50));
  assert.deepStrictEqual(rec.calls.exit, [0]);
});

test('restart: GET 不命中（POST-only）；生产装配以直通 child_process.spawn 挂载（源码契约）', async () => {
  const rec = recorder();
  const app = mount(makeRestartRoute({ spawn: rec.spawn, exit: rec.exit, stderrPath: path.join(process.env.TEMP || '/tmp', 't-6.log') }));
  const r = await req(app, { method: 'get', header: '1' });
  assert.strictEqual(r.status, 404);
  // 位置参数契约的另一半：index.js 必须直通 spawn（包一层对象适配会让全部
  // 注入测试照绿、生产重演 7399 事故）
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  assert.ok(/app\.post\('\/api\/restart', makeRestartRoute\(\{ spawn: require\('child_process'\)\.spawn \}\)\)/.test(src),
    "index.js 须以 spawn: require('child_process').spawn 直通挂载 /api/restart");
});

test('restart: index.js 接替进程延迟 listen 契约（源码形态：延迟分支 + 正常启动 else 分支）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  assert.ok(src.includes('ZCODE_RESTART_BOOT_DELAY_MS'), 'index.js 须读 ZCODE_RESTART_BOOT_DELAY_MS');
  assert.ok(/if \(RESTART_BOOT_DELAY_MS > 0\) \{[\s\S]{0,260}setTimeout\(startListen, RESTART_BOOT_DELAY_MS\)/.test(src),
    '延迟>0 时 listen 须推迟（直接 bind 会 EADDRINUSE）');
  assert.ok(/\} else \{\s*startListen\(\);\s*\}/.test(src),
    '正常启动（延迟=0）必须走 else 分支立即 listen——删掉它则 npm start 全套测试照绿而服务永不监听');
  // EADDRINUSE 带界重试（重启路径）：接替进程撞上迟退的旧进程应重试而非无声死
  assert.ok(/EADDRINUSE[\s\S]{0,200}setTimeout\(startListen, 500\)/.test(src),
    'listen EADDRINUSE 在重启重试窗口内须 500ms 重试（旧进程事件循环阻塞迟退的自愈）');
});

test('restart: 壳侧接线源码契约（Program.cs）——首部字面量/双击闩/ensure 闩/非2xx早退/导航重试', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'shell', 'Program.cs'), 'utf8');
  // C# 侧无测试面（仓内无 C# harness），按 frontend-contract 先例钉接线点
  assert.ok(src.includes('"X-Zcode-Monitor-Restart"'),
    '壳须以与服务端常量同名的字面量携带重启首部（改名即断线，JS 侧测试不会红）');
  assert.ok(/if \(_restartBusy\)/.test(src), '双击竞态闩：交接窗内的第二次点击不得再走 was-down 分支双拉起 node');
  assert.ok(/if \(_ensureBusy\)/.test(src), 'Shown 启动拉起与菜单重启并发时的 ensure 闩');
  assert.ok(/if \(!resp\.IsSuccessStatusCode\) return;/.test(src), '非 2xx 早退：拒绝的重启不得烧 4s 等待并做无谓重载');
  assert.ok(/_navRetries < 3/.test(src), '导航失败（错误页无脚本=菜单也没了）须有界重试');
  assert.ok(/HttpLong\.SendAsync/.test(src), '重启 POST 须走长超时客户端（2s 探测预算会被冷查询拖爆）');
});
