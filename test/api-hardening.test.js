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

const { loopbackHostGate, securityHeaders, petsStaticOptions, CSP } = require('../server/http-hardening');
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
      }
      // 图片放行（精灵管线只产 webp）
      const w = await get(port, '/pets/sheet.webp');
      assert.equal(w.status, 200);
      assert.equal(w.headers['content-type'], 'image/webp');
      assert.equal(w.headers['content-disposition'], undefined, '图片不加 attachment');
      // CSP 等值比对（R3 修-medium）：断言整个策略串与 http-hardening 导出常量
      // 一致——includes 部分匹配在策略被收窄/改写（如丢掉 default-src）时可能假绿
      assert.equal(w.headers['content-security-policy'], CSP, 'CSP 须与导出常量逐字一致');
    } finally { server.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── R3 必修-2：raw order/LIKE/COUNT 收紧 ─────────────────────────────────────
test('raw order 收紧：巨表回落 rowid DESC 且 meta 注明；索引大表白名单列放行、非白名单列回落；小表照旧', async () => {
  const app = express();
  app.use('/api', loopbackHostGate);
  app.use('/api/raw', raw);
  const server = await listen(app);
  try {
    const port = server.address().port;

    // 巨表 message：UI 下拉任选值（time_created）→ rowid DESC 回落 + meta 注明
    const giant = await get(port, '/api/raw/message?order=time_created&desc=0');
    assert.equal(giant.status, 200);
    const gj = JSON.parse(giant.body);
    assert.equal(gj.meta.order.order_effective, 'rowid DESC');
    assert.equal(gj.meta.order.order_requested, 'time_created');
    assert.ok(gj.meta.order.note.includes('回落'), '回落原因须在 meta 注明');
    assert.ok(gj.rows.length > 0, '巨表回落后仍可取行');

    // 索引大表 model_usage：started_at（索引最左列）放行、无 meta；id（TEXT 主键
    // 非 rowid 别名，排序=全表扫）回落
    const idx = await get(port, '/api/raw/model_usage?order=started_at&desc=1');
    assert.equal(idx.status, 200);
    assert.equal(JSON.parse(idx.body).meta.order, undefined);
    const idxFall = await get(port, '/api/raw/model_usage?order=id');
    assert.equal(idxFall.status, 200);
    assert.equal(JSON.parse(idxFall.body).meta.order.order_effective, 'rowid DESC');

    // 小表 session：白名单列照旧放行（无 meta）；「不排序」保持无 ORDER BY
    const small = await get(port, '/api/raw/session?order=time_updated&desc=1');
    assert.equal(small.status, 200);
    assert.equal(JSON.parse(small.body).meta.order, undefined);
    const none = await get(port, '/api/raw/session');
    assert.equal(none.status, 200);
    assert.equal(JSON.parse(none.body).meta.order, undefined);

    // 小表选了不存在的列（session 无 started_at）：不再 500，回落 + 注明
    const noCol = await get(port, '/api/raw/session?order=started_at');
    assert.equal(noCol.status, 200);
    assert.equal(JSON.parse(noCol.body).meta.order.order_effective, 'rowid DESC');
  } finally { server.close(); }
});

test('raw LIKE 红线：巨表 LIKE 一律 400；大表前导通配 400、前缀形态放行；小表不设限', async () => {
  const app = express();
  app.use('/api', loopbackHostGate);
  app.use('/api/raw', raw);
  const server = await listen(app);
  try {
    const port = server.address().port;
    const q = (table, w) => get(port, `/api/raw/${table}?where=${encodeURIComponent(w)}`);

    // 巨表 message：LIKE 整体拒绝（大小写不敏感 LIKE 用不上索引，实测无命中
    // 前缀最高 61.7s 全表扫描）。可索引列上的 LIKE 走 LIKE 禁令；无索引列
    //（data）先被字段白名单拦下——同为 400
    const likeIdx = await q('message', "session_id LIKE 's1%'");
    assert.equal(likeIdx.status, 400);
    assert.ok(JSON.parse(likeIdx.body).error.includes('不支持 LIKE'));
    for (const w of ["data LIKE '%x%'", "data LIKE 'abc%'", "session_id LIKE 's%'"]) {
      const r = await q('message', w);
      assert.equal(r.status, 400, `巨表 LIKE/无索引列须拒绝: ${w}`);
    }

    // 大表 model_usage：前导通配 400（任何索引用不上）
    const lead = await q('model_usage', "status LIKE '%err%'");
    assert.equal(lead.status, 400);
    assert.ok(JSON.parse(lead.body).error.includes('前导通配'));

    // 大表 model_usage：前缀形态放行且过滤生效（fixture status='error' 恰 1 行）
    const prefix = await q('model_usage', "status LIKE 'err%'");
    assert.equal(prefix.status, 200);
    assert.equal(JSON.parse(prefix.body).count, 1, "LIKE 'err%' 前缀过滤生效");

    // 小表 session：前导通配照旧放行（全表扫毫秒级；fixture DDL 无 todo 表）
    const small = await q('session', "title LIKE '%主%'");
    assert.equal(small.status, 200);
    assert.equal(JSON.parse(small.body).count, 1);
  } finally { server.close(); }
});

test('raw 巨表 where 字段白名单 + COUNT 近似 + 列名大小写不敏感', async () => {
  const app = express();
  app.use('/api', loopbackHostGate);
  app.use('/api/raw', raw);
  const server = await listen(app);
  try {
    const port = server.address().port;
    const q = (table, w) => get(port, `/api/raw/${table}?where=${encodeURIComponent(w)}`);

    // 巨表 message：可索引列（session_id 等值）放行；无索引列（time_created 范围）400
    const okField = await q('message', "session_id='s1'");
    assert.equal(okField.status, 200);
    assert.equal(JSON.parse(okField.body).count, 2);
    const badField = await q('message', 'time_created>=0');
    assert.equal(badField.status, 400);
    assert.ok(JSON.parse(badField.body).error.includes('可索引寻址'), '巨表无索引列须拒绝并说明');

    // COUNT 近似：巨表无 where → meta.count_approx=true；带 where → 精确
    const approx = await get(port, '/api/raw/part');
    assert.equal(approx.status, 200);
    const aj = JSON.parse(approx.body);
    assert.equal(aj.meta.count_approx, true);
    assert.equal(aj.count, 2, 'MAX(rowid) 近似与 fixture 行数一致');
    const exact = await q('part', "message_id='2'");
    assert.equal(exact.status, 200);
    assert.equal(JSON.parse(exact.body).meta.count_approx, undefined);

    // 列白名单大小写不敏感：列名大写变体等价识别（值本身仍按 SQL 大小写敏感）
    const ci = await q('model_usage', "STATUS='error'");
    assert.equal(ci.status, 200, '列名大写变体应等价识别');
    assert.equal(JSON.parse(ci.body).count, 1);
  } finally { server.close(); }
});

