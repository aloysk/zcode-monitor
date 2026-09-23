'use strict';
// test/api-hardening.test.js — R2 加固面的端点测试：
// 1) /api 全局回环 Host 闸（loopbackHostGate，防 DNS rebinding）；
// 2) /api/raw where 受限文法（参数化绑定，UNION 等注入面拒绝）；
// 3) /api/checkpoint 三分支（409 wal_active / 409 zcode_running / 503 checkpoint_busy / 放行）；
// 4) /pets 静态收紧 + CSP/nosniff 响应头。
// fixture 全部在 os.tmpdir() 下构建；db 环境变量在 require 前 注入
//（server/db.js 在 require 时读 env，连接惰性）。
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

const { loopbackHostGate, securityHeaders, petsStaticOptions } = require('../server/http-hardening');
const { makeCheckpointRoute } = require('../server/checkpoint-route');
const raw = require('../server/routes/raw');

test.after(() => {
  try { require('../server/db').db().close(); } catch { /* already closed */ }
  try { require('../server/db').invalidateDb(); } catch { /* ignore */ }
  fx.cleanup();
  assert.equal(fs.existsSync(fx.root), false, 'A0-7: fixture 目录已清理');
});

function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise(resolve => server.on('listening', () => resolve(server)));
}

// 原生 http.get：可自定 Host 头（fetch/undici 对 Host 覆写不稳定）
function get(port, p, host) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: host ? { Host: host } : {} },
      res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
  });
}

test('Host 闸：非回环 Host 403；127.0.0.1/localhost/[::1]（含端口变体）放行', async () => {
  const app = express();
  app.use('/api', loopbackHostGate);
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  const server = await listen(app);
  try {
    const port = server.address().port;
    for (const evil of ['evil.example:7331', 'evil.example', '127.0.0.1.evil.example']) {
      const r = await get(port, '/api/ping', evil);
      assert.equal(r.status, 403, `应拒绝 Host「${evil}」`);
      assert.equal(JSON.parse(r.body).error, 'forbidden');
    }
    // 本机 UI/壳的正常形态：页面与壳都从 127.0.0.1（或 localhost）加载
    for (const okHost of ['127.0.0.1', `127.0.0.1:${port}`, 'localhost', `localhost:${port}`, `[::1]:${port}`]) {
      const r = await get(port, '/api/ping', okHost);
      assert.equal(r.status, 200, `应放行 Host「${okHost}」`);
    }
    // 完全不带 Host 头（HTTP/1.0 形态，裸 socket）：同样拒绝
    const noHost = await new Promise((resolve, reject) => {
      const net = require('net');
      const s = net.connect(port, '127.0.0.1', () => s.write('GET /api/ping HTTP/1.0\r\n\r\n'));
      let b = '';
      s.on('data', d => { b += d; });
      s.on('end', () => resolve(b));
      s.on('error', reject);
    });
    assert.match(noHost, / 403 /, '无 Host 头须 403');
  } finally { server.close(); }
});

test('raw where 受限文法：合法条件放行且过滤生效；UNION/越表/坏列/坏字法拒绝', async () => {
  const app = express();
  app.use('/api', loopbackHostGate);
  app.use('/api/raw', raw);
  const server = await listen(app);
  try {
    const port = server.address().port;
    const q = (w) => get(port, `/api/raw/model_usage?where=${encodeURIComponent(w)}`);

    // 合法：字符串等值（seed 里 status='error' 恰 1 行）
    const okStr = await q("status='error'");
    assert.equal(okStr.status, 200);
    assert.equal(JSON.parse(okStr.body).count, 1, "status='error' 过滤生效");

    // 合法：数值比较 + AND 连接
    const okNum = await q('started_at>=1 AND status=\'completed\'');
    assert.equal(okNum.status, 200);
    assert.equal(JSON.parse(okNum.body).count, 3, '数值比较 + AND 生效');

    // 合法：IS NOT NULL
    const okNull = await q('error_type IS NOT NULL');
    assert.equal(okNull.status, 200);
    assert.equal(JSON.parse(okNull.body).count, 1, 'IS NOT NULL 生效');

    // 注入面：单语句 UNION 可越出表白名单读任意表（分号/注释过滤拦不住的形态）
    for (const bad of [
      "1=1 UNION SELECT * FROM session",
      "status='error' UNION SELECT id FROM sqlite_master",
      "status='error'; DROP TABLE model_usage",
      "status='error'--comment",
      "status='error' OR 1=1",
      "(status='error')",
    ]) {
      const r = await q(bad);
      assert.equal(r.status, 400, `应拒绝 where: ${bad}`);
    }

    // 坏列（字段白名单）：文法合法但列不存在
    const badCol = await q('evil_column=1');
    assert.equal(badCol.status, 400);
    assert.ok(JSON.parse(badCol.body).error.includes('unknown column'));

    // 非回环 Host 下的 raw 请求也被全局闸拦（高-A 组合面）
    const evil = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/api/raw/model_usage', headers: { Host: 'evil.example' } },
        res => { let b = ''; res.on('data', d => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); })
        .on('error', reject);
    });
    assert.equal(evil.status, 403);
  } finally { server.close(); }
});

test('checkpoint 路由三分支：409 wal_active（force 也不越）/ 409 zcode_running / 503 busy / 放行', async () => {
  const makeRuntime = ({ idleMs, busy }) => ({
    walIdleMs: () => idleMs,
    walStatus: () => ({ walBytes: 10, shmBytes: 0, mainBytes: 100 }),
    checkpointNow: () => ({ ok: true, busy, after: { walBytes: 2, shmBytes: 0, mainBytes: 108 } }),
  });
  let successHook = 0;
  const mount = (runtime, runtimeState) => {
    const app = express();
    app.get('/api/checkpoint', makeCheckpointRoute({
      dbPath: fx.dbPath, runtime, runtimeState,
      activeWindowMs: 60 * 1000,
      onSuccess: () => { successHook++; },
    }));
    return app;
  };

  // 场景 1：wal_active —— -wal 1s 前有写入 → 409，force=1 也不越过
  const s1 = await listen(mount(makeRuntime({ idleMs: 1000, busy: 0 }), { running: false, lastCheckpoint: null }));
  try {
    const a = await get(s1.address().port, '/api/checkpoint');
    assert.equal(a.status, 409);
    assert.equal(JSON.parse(a.body).error, 'wal_active');
    const af = await get(s1.address().port, '/api/checkpoint?force=1');
    assert.equal(af.status, 409, 'force 不越过 walIdle 否决（绝不与真实 writer 抢锁）');
    assert.equal(JSON.parse(af.body).error, 'wal_active');
  } finally { s1.close(); }

  // 场景 2：zcode_running —— wal 无反证 + running 状态否决；force 越过状态否决
  const s2 = await listen(mount(makeRuntime({ idleMs: null, busy: 0 }), { running: true, lastCheckpoint: null }));
  try {
    const b = await get(s2.address().port, '/api/checkpoint');
    assert.equal(b.status, 409);
    assert.equal(JSON.parse(b.body).error, 'zcode_running');
    const bf = await get(s2.address().port, '/api/checkpoint?force=1');
    assert.equal(bf.status, 200, 'force 越过状态否决（wal 已静默）');
  } finally { s2.close(); }

  // 场景 3：checkpoint_busy —— 放行执行但 busy=1 → 503 可重试
  const s3 = await listen(mount(makeRuntime({ idleMs: null, busy: 1 }), { running: false, lastCheckpoint: null }));
  try {
    const c = await get(s3.address().port, '/api/checkpoint');
    assert.equal(c.status, 503);
    const cj = JSON.parse(c.body);
    assert.equal(cj.error, 'checkpoint_busy');
    assert.equal(cj.retryable, true);
  } finally { s3.close(); }

  // 场景 4：放行 —— 200 + onSuccess 钩子 + lastCheckpoint 记录
  const st4 = { running: false, lastCheckpoint: null };
  const s4 = await listen(mount(makeRuntime({ idleMs: null, busy: 0 }), st4));
  try {
    const before = successHook;
    const d = await get(s4.address().port, '/api/checkpoint');
    assert.equal(d.status, 200);
    assert.equal(JSON.parse(d.body).ok, true);
    assert.equal(successHook, before + 1, 'onSuccess（连接失效钩子）被调用');
    assert.equal(st4.lastCheckpoint.ok, true);
    assert.equal(st4.lastCheckpoint.walBefore, 10);
    assert.equal(st4.lastCheckpoint.walAfter, 2);
  } finally { s4.close(); }
});

test('/pets 静态收紧 + CSP/nosniff 头：非图片 octet-stream+attachment，webp 照常', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-petstatic-'));
  const petsDir = path.join(root, 'pets');
  fs.mkdirSync(petsDir);
  fs.writeFileSync(path.join(petsDir, 'evil.html'), '<script>x</script>');
  fs.writeFileSync(path.join(petsDir, 'icon.svg'), '<svg/>');
  fs.writeFileSync(path.join(petsDir, 'sheet.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]));
  try {
    const app = express();
    app.use(securityHeaders);
    app.use('/pets', express.static(petsDir, petsStaticOptions()));
    const server = await listen(app);
    try {
      const port = server.address().port;
      // 非图片（含可执行面 .html/.svg）：强制下载，不再以面板同源渲染
      for (const f of ['evil.html', 'icon.svg']) {
        const r = await get(port, `/pets/${f}`);
        assert.equal(r.status, 200, f);
        assert.equal(r.headers['content-type'], 'application/octet-stream', `${f} 须 octet-stream`);
        assert.equal(r.headers['content-disposition'], 'attachment', `${f} 须 attachment`);
        assert.equal(r.headers['x-content-type-options'], 'nosniff', '全站 nosniff');
        assert.ok(String(r.headers['content-security-policy']).includes("default-src 'self'"), 'CSP 在响应上');
      }
      // 图片放行（精灵管线只产 webp）
      const w = await get(port, '/pets/sheet.webp');
      assert.equal(w.status, 200);
      assert.equal(w.headers['content-type'], 'image/webp');
      assert.equal(w.headers['content-disposition'], undefined, '图片不加 attachment');
    } finally { server.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

