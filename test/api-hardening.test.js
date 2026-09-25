'use strict';
// test/api-hardening.test.js — R2/R4/R5 加固面的端点测试：
// 1) /api 全局回环 Host 闸（loopbackHostGate，防 DNS rebinding）；
// 2) /api/raw where 受限文法（参数化绑定，UNION 等注入面拒绝）+ limit/offset 钳界；
// 3) /api/checkpoint 四分支（403 force 首部闸 / 409 wal_active / 409 zcode_running
//    / 503 checkpoint_busy / 放行）；
// 4) /pets 静态收紧 + CSP/nosniff 响应头；
// 5) makeErrorTranslator（锁竞争/连接损伤 → 503 契约形态，依赖注入供挂载）；
// 6) R5 阻断-1：limit/max 负值横向钳界（trace/sessions/transcript/raw 全端点）；
// 7) R5 T6：makeHealthRoute 工厂（正常/抛错两形态）。
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
// R5：T1 挂载 sessions/transcript 路由，AGENTS/EXEC 目录在 require 前注入
// tmpdir（routes/sessions.js / server/transcript.js require 时读取，与
// ZCODE_DB 同法）——绝不触碰真实 ~/.zcode。
const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-apih-'));
process.env.ZCODE_AGENTS_DIR = path.join(envRoot, 'agents');
process.env.ZCODE_EXEC_DIR = path.join(envRoot, 'exec');

const { loopbackHostGate, securityHeaders, petsStaticOptions, CSP, makeErrorTranslator } = require('../server/http-hardening');
const { makeCheckpointRoute, CHECKPOINT_FORCE_HEADER } = require('../server/checkpoint-route');
const { makeHealthRoute } = require('../server/health-route');
const raw = require('../server/routes/raw');
const traceRoutes = require('../server/routes/trace');
const sessionsRoutes = require('../server/routes/sessions');
const transcriptRoutes = require('../server/routes/transcript');
const agentsRoutes = require('../server/routes/agents');
const overviewRoutes = require('../server/routes/overview');

test.after(() => {
  try { require('../server/db').db().close(); } catch { /* already closed */ }
  try { require('../server/db').invalidateDb(); } catch { /* ignore */ }
  fx.cleanup();
  assert.equal(fs.existsSync(fx.root), false, 'A0-7: fixture 目录已清理');
  fs.rmSync(envRoot, { recursive: true, force: true });
  assert.equal(fs.existsSync(envRoot), false, 'A0-7: env 注入目录已清理');
});

function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise(resolve => server.on('listening', () => resolve(server)));
}

// 原生 http.get：可自定 Host 头（fetch/undici 对 Host 覆写不稳定），extraHeaders
// 供自定义首部（如 checkpoint force 闸）注入
function get(port, p, host, extraHeaders) {
  const headers = { ...(extraHeaders || {}) };
  if (host) headers.Host = host;
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers },
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

  // 场景 1：wal_active —— -wal 1s 前有写入 → 409，force（带头部）也不越过
  const s1 = await listen(mount(makeRuntime({ idleMs: 1000, busy: 0 }), { running: false, lastCheckpoint: null }));
  try {
    const a = await get(s1.address().port, '/api/checkpoint');
    assert.equal(a.status, 409);
    assert.equal(JSON.parse(a.body).error, 'wal_active');
    const af = await get(s1.address().port, '/api/checkpoint?force=1', null,
      { [CHECKPOINT_FORCE_HEADER]: '1' });
    assert.equal(af.status, 409, 'force 不越过 walIdle 否决（绝不与真实 writer 抢锁）');
    assert.equal(JSON.parse(af.body).error, 'wal_active');
  } finally { s1.close(); }

  // 场景 2：zcode_running —— wal 无反证 + running 状态否决；force 越过状态否决
  //（R4 起 force 须带 X-Zcode-Monitor-Checkpoint 首部，见下方专项用例）
  const s2 = await listen(mount(makeRuntime({ idleMs: null, busy: 0 }), { running: true, lastCheckpoint: null }));
  try {
    const b = await get(s2.address().port, '/api/checkpoint');
    assert.equal(b.status, 409);
    assert.equal(JSON.parse(b.body).error, 'zcode_running');
    const bf = await get(s2.address().port, '/api/checkpoint?force=1', null,
      { [CHECKPOINT_FORCE_HEADER]: '1' });
    assert.equal(bf.status, 200, 'force（带头部）越过状态否决（wal 已静默）');
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

// ── R4：limit/offset 钳界 + NOT LIKE 分支 + where 长度闸 ────────────────────
test('raw limit/offset 钳界：负值/0/非数字 limit 与负 offset 均落在安全界内', async () => {
  const app = express();
  app.use('/api', loopbackHostGate);
  app.use('/api/raw', raw);
  const server = await listen(app);
  try {
    const port = server.address().port;
    // ?limit=-1：旧实现产出 -1（SQLite 负 LIMIT=无上限 → 整表物化），
    // 钳后回落 1；?limit=0/abc → 缺省 100；?limit=99999 → 上限 1000
    const cases = [
      ['limit=-1', 1], ['limit=0', 100], ['limit=abc', 100],
      ['limit=99999', 1000], ['limit=5', 5],
    ];
    for (const [qs, expect] of cases) {
      const r = await get(port, `/api/raw/session?${qs}`);
      assert.equal(r.status, 200, qs);
      const j = JSON.parse(r.body);
      assert.equal(j.limit, expect, `${qs} → limit`);
      assert.ok(j.limit >= 1 && j.limit <= 1000, `${qs} → limit ∈ [1,1000]`);
      assert.ok(j.rows.length <= 1000, `${qs} → rows ≤ 1000`);
      assert.ok(j.rows.length <= j.limit, `${qs} → rows ≤ 钳后 limit`);
    }
    // ?offset=-5：旧实现产出 -5（SQLite 负 OFFSET 语义未定义），钳后回落 0
    const off = await get(port, '/api/raw/session?offset=-5');
    assert.equal(off.status, 200);
    assert.equal(JSON.parse(off.body).offset, 0);
  } finally { server.close(); }
});

test('raw NOT LIKE 分支：与 LIKE 互补（计数相加=全表）；where ≥500 → 400', async () => {
  const app = express();
  app.use('/api', loopbackHostGate);
  app.use('/api/raw', raw);
  const server = await listen(app);
  try {
    const port = server.address().port;
    const q = (w) => get(port, `/api/raw/model_usage?where=${encodeURIComponent(w)}`);

    const notLike = await q("status NOT LIKE 'err%'");
    assert.equal(notLike.status, 200, 'NOT LIKE 属受限文法，应放行');
    const nl = JSON.parse(notLike.body);
    assert.equal(nl.count, 3, "NOT LIKE 'err%' 排除唯一 error 行");
    const like = await q("status LIKE 'err%'");
    const lk = JSON.parse(like.body);
    assert.equal(lk.count, 1);
    // 不带 where 取全表：与 LIKE/NOT LIKE 计数互补
    const total = JSON.parse((await get(port, '/api/raw/model_usage')).body).count;
    assert.equal(nl.count + lk.count, total, 'NOT LIKE 与 LIKE 计数互补（无遗漏/重叠）');

    // 超长 where（≥500 字符）：文法不必要展开，直接 400
    const long = "status='a' AND ".repeat(40); // 680 字符
    assert.ok(long.length >= 500);
    const too = await q(long);
    assert.equal(too.status, 400);
    assert.ok(JSON.parse(too.body).error.includes('too long'));
  } finally { server.close(); }
});

// ── R4：checkpoint force 首部闸（防跨站 <img> 触发） ────────────────────────
test('checkpoint force 首部闸：?force=1 无首部 403；带头部进入既有 force 逻辑；非 force 保留简单 GET', async () => {
  const makeRuntime = () => ({
    walIdleMs: () => null,
    walStatus: () => ({ walBytes: 10, shmBytes: 0, mainBytes: 100 }),
    checkpointNow: () => ({ ok: true, busy: 0, after: { walBytes: 2, shmBytes: 0, mainBytes: 108 } }),
  });
  const app = express();
  app.get('/api/checkpoint', makeCheckpointRoute({
    dbPath: fx.dbPath, runtime: makeRuntime(),
    runtimeState: { running: true, lastCheckpoint: null },
    activeWindowMs: 60 * 1000,
  }));
  const server = await listen(app);
  try {
    const port = server.address().port;
    // 跨站 <img src="...?force=1"> 带不了自定义首部 → 403
    const noHeader = await get(port, '/api/checkpoint?force=1');
    assert.equal(noHeader.status, 403);
    assert.equal(JSON.parse(noHeader.body).error, 'forbidden');
    // 面板同源 fetch 带首部 → 进入既有 force 逻辑（running 否决被越过，200）
    const withHeader = await get(port, '/api/checkpoint?force=1', null,
      { [CHECKPOINT_FORCE_HEADER]: '1' });
    assert.equal(withHeader.status, 200);
    assert.equal(JSON.parse(withHeader.body).ok, true);
    // 非 force 分支不受首部闸影响（保留简单 GET 语义）：running 否决 → 409
    const plain = await get(port, '/api/checkpoint');
    assert.equal(plain.status, 409);
    assert.equal(JSON.parse(plain.body).error, 'zcode_running');
  } finally { server.close(); }
});

// ── R5 阻断-1：负 limit/max 横向钳界（trace/sessions/transcript/raw 全端点）──
// 旧行为：`Math.min(+q.limit || 默认, 上限)` 对 ?limit=-1 产出 -1 = SQLite 无上限
// LIMIT（真实库实测 slowTools 8.8s / sessionList 6.4s / errorsList 1.8s 同步冻结）。
// 钳后 ?limit=-1 / ?max=-1 → 1；fixture 数据量刻意小——断言的是钳界行为不是性能。
test('limit/max 负值横向钳界：?limit=-1 / ?max=-1 在全部同类端点不再全量返回', async () => {
  // transcript 侧 found:true 需要真实 agent fixture（2 行事件，供 limit 语义可判）
  const uuid = '00112233-4455-6677-8899-aabbccddeeff';
  const agentDir = path.join(process.env.ZCODE_AGENTS_DIR, 'parent-1', 'agent_' + uuid);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'metadata.json'), JSON.stringify({ agentId: 'agent_x' }));
  fs.writeFileSync(path.join(agentDir, 'transcript.jsonl'), [
    { sequenceNumber: 1, type: 'turn_started', timestamp: '2026-09-23T01:00:00.000Z', payload: { input: 'a' } },
    { sequenceNumber: 2, type: 'model_complete', timestamp: '2026-09-23T01:00:01.000Z', payload: {} },
  ].map(l => JSON.stringify(l)).join('\n') + '\n');
  const child = 'sess_subagent_agent_' + uuid;

  const app = express();
  app.use('/api', loopbackHostGate);
  app.use('/api/trace', traceRoutes);
  app.use('/api/sessions', sessionsRoutes);
  app.use('/api/transcript', transcriptRoutes);
  app.use('/api/raw', raw);
  const server = await listen(app);
  try {
    const port = server.address().port;
    // 每端点：路径 + 钳后断言（?limit=-1 → 1：响应数组 ≤1 行即证明未全量返回；
    // fixture 中会话 2 条/消息 2 条/活动 5 行，全量返回必然 >1）
    const cases = [
      ['/api/trace/errors?window=all&limit=-1', j => j.items.model.length <= 1 && j.items.tool.length <= 1],
      ['/api/trace/slow-tools?window=all&limit=-1', j => j.items.length <= 1],
      ['/api/sessions?limit=-1', j => j.sessions.length <= 1],
      ['/api/sessions/s1/conversation?max=-1', j => j.messages.length <= 1],
      ['/api/sessions/s1/activity?limit=-1', j => j.activity.length <= 1],
      ['/api/sessions/s1/reasoning?limit=-1', j => j.reasoning.length <= 1],
      ['/api/raw/session?limit=-1', j => j.rows.length <= 1 && j.limit === 1],
    ];
    for (const [p, check] of cases) {
      const r = await get(port, p);
      assert.equal(r.status, 200, p);
      const j = JSON.parse(r.body);
      assert.ok(check(j), `${p} 负值须钳为 1，不得全量返回`);
    }

    // transcript：limit 钳非负——?limit=-1 → 0 条（旧行为 slice(0,-1) 静默丢
    // 最后一行）；?limit=1 → 1 条；缺省 → 不限（2 条）
    const neg = await get(port, `/api/transcript/${child}?limit=-1`);
    assert.equal(neg.status, 200);
    const negJ = JSON.parse(neg.body);
    assert.equal(negJ.found, true);
    assert.equal(negJ.events.length, 0, '?limit=-1 须钳为 0，不得 slice(0,-1) 丢尾行');
    assert.equal(negJ.count, 2, 'count 仍为事件总数（limit 只影响返回集）');
    const one = await get(port, `/api/transcript/${child}?limit=1`);
    assert.equal(JSON.parse(one.body).events.length, 1);
    const all = await get(port, `/api/transcript/${child}`);
    assert.equal(JSON.parse(all.body).events.length, 2, '缺省 limit = 不限');

    // 正常值不受钳界影响（各端点 limit=1 均可正常返回 1 行）
    const okSess = await get(port, '/api/sessions?limit=1');
    assert.equal(JSON.parse(okSess.body).sessions.length, 1);
    const okConv = await get(port, '/api/sessions/s1/conversation?max=1');
    assert.equal(JSON.parse(okConv.body).messages.length, 1);
  } finally { server.close(); }
});

// 四席全量审查第 2/3 轮（2026-09-25，SEC-R2/SEC-R3-001）：重复/bracket/对象
// query 形态不再 500——firstParam 归一族。usage/sessions 族在各自文件已钉
//（usage-routes SEC-安-1 / context-gauge C2-4 附），本例收口存量路由
//（agents/transcript/trace/overview——第 2/3 轮代码席与安全席实测 500/失真
// 实锤）与 window/limit 首值语义。
test('重复/bracket query 形态: agents/transcript/trace/overview 不再 500（数组取首值、深层形态同缺参）', async () => {
  const app = express();
  app.use('/api', loopbackHostGate);
  app.use('/api/agents', agentsRoutes);
  app.use('/api/trace', traceRoutes);
  app.use('/api/transcript', transcriptRoutes);
  app.use('/api/overview', overviewRoutes);
  const server = await listen(app);
  try {
    const port = server.address().port;
    const cases = [
      // agents project_id：重复数组取首值；bracket 对象同缺参（null → 全树）
      '/api/agents/tree?project_id=p1&project_id=p2',
      '/api/agents/tree?project_id[foo]=bar',
      // transcript types：重复数组取首值（无此会话 → found:false 200；此前
      // 数组无 .split 抛 TypeError 500）；对象形态同缺参
      '/api/transcript/sess_x?types=a&types=b',
      '/api/transcript/sess_x?types[foo]=bar',
      // trace window/kind：重复取首值；对象回退缺省档
      '/api/trace/errors?window=7d&window=all',
      '/api/trace/errors?kind=model&kind=tool',
      '/api/trace/errors?window[foo]=bar&kind[foo]=baz',
      '/api/trace/slow-tools?window=7d&window=all',
      // overview window（第 3 轮 SEC-R3-001，main 既有收口）：重复取首值、
      // 对象回缺省档——此前数组被原样回显进响应 window 字段（形状类型漂移）
      '/api/overview?window=7d&window=today',
      '/api/overview?window[foo]=bar',
    ];
    for (const p of cases) {
      const r = await get(port, p);
      assert.equal(r.status, 200, `${p} 不得 500`);
      const j = JSON.parse(r.body);
      assert.ok(j.error === undefined, `${p} 不得是错误体`);
    }
    // 首值语义钉：trace/overview window 回显首值（次值不参与）
    const w = JSON.parse((await get(port, '/api/trace/errors?window=7d&window=all')).body);
    assert.equal(w.window, '7d', 'trace 数组取首值');
    const ow = JSON.parse((await get(port, '/api/overview?window=7d&window=today')).body);
    assert.equal(ow.window, '7d', 'overview 数组取首值（不得回显数组）');
    // transcript limit 数组取首值（第 3 轮代码席收口：此前 +['5','6']→NaN→
    // 钳 0 静默空转录）——无此会话 found:false 不受 limit 影响，形状不破即可
    const tl = await get(port, '/api/transcript/sess_x?limit=5&limit=6');
    assert.equal(tl.status, 200);
    // trace lines 下界（第 3 轮安全席观察项收口）：?lines=-5 钳 1（旧形态
    // 负数行静默空 events）
    const ln = await get(port, '/api/trace/logs/tail?lines=-5');
    assert.equal(ln.status, 200);
    assert.ok(Array.isArray(JSON.parse(ln.body).events), 'lines 负值钳 1 后形状正常');
  } finally { server.close(); }
});

// ── R5 T6：makeHealthRoute（server/health-route.js 工厂，index.js 装配）──────
test('makeHealthRoute: 正常路径 ok:true 全字段；dbq.db 抛错 → ok:false + error 透传 + invalidateDb', async () => {
  const lastCheckpoint = { at: '2026-09-23T00:00:00.000Z', ok: true, walBefore: 10, walAfter: 2 };
  const runtime = { walStatus: () => ({ walBytes: 4096, shmBytes: 0, mainBytes: 100 }) };
  const mount = (dbqStub, state) => {
    const app = express();
    app.get('/api/health', makeHealthRoute({
      dbq: dbqStub, runtime, runtimeState: state, dbPath: 'P', logDir: 'L',
    }));
    return app;
  };

  // ① 正常路径：ok:true + 全字段（zcode_running/wal_bytes/wal_pending_checkpoint/
  //    last_checkpoint/db/log_dir），且 ok 路径不触发 invalidateDb
  const okDbq = {
    db: () => ({ prepare: () => ({ get: () => ({ one: 1 }) }) }),
    invalidateDb: () => { throw new Error('ok path must not invalidate'); },
  };
  const s1 = await listen(mount(okDbq, { running: false, lastCheckpoint }));
  try {
    const r = await get(s1.address().port, '/api/health');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.equal(j.ok, true);
    assert.equal(j.error, null);
    assert.equal(j.db, 'P');
    assert.equal(j.log_dir, 'L');
    assert.equal(j.zcode_running, false);
    assert.equal(j.wal_bytes, 4096);
    assert.equal(j.wal_pending_checkpoint, true);
    assert.deepStrictEqual(j.last_checkpoint, lastCheckpoint);
  } finally { s1.close(); }

  // ② 抛错形态：dbq.db() 抛错 → ok:false + error 透传 + invalidateDb 被调；
  //    WAL 态照常上报（walStatus 走 fs stat，不依赖 db 连接）
  let invalidated = 0;
  const badDbq = {
    db: () => { throw new Error('no such file'); },
    invalidateDb: () => { invalidated++; },
  };
  const s2 = await listen(mount(badDbq, { running: true, lastCheckpoint: null }));
  try {
    const r = await get(s2.address().port, '/api/health');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.equal(j.ok, false);
    assert.equal(j.error, 'no such file');
    assert.equal(invalidated, 1, '须丢弃缓存连接（下次请求重开自愈）');
    assert.equal(j.zcode_running, true);
    assert.equal(j.wal_bytes, 4096);
    assert.equal(j.wal_pending_checkpoint, true);
    assert.equal(j.last_checkpoint, null);
  } finally { s2.close(); }

  // ③ walStatus 缺失（-wal/-shm 不存在或不可 stat）→ wal_bytes:null、pending:false
  const s3 = await listen((() => {
    const app = express();
    app.get('/api/health', makeHealthRoute({
      dbq: okDbq, runtime: { walStatus: () => null },
      runtimeState: { running: true, lastCheckpoint: null }, dbPath: 'P', logDir: 'L',
    }));
    return app;
  })());
  try {
    const j = JSON.parse((await get(s3.address().port, '/api/health')).body);
    assert.equal(j.wal_bytes, null);
    assert.equal(j.wal_pending_checkpoint, false);
  } finally { s3.close(); }
});

// ── R4：makeErrorTranslator（server/http-hardening.js 工厂，index.js 装配）───
test('makeErrorTranslator：SQLITE_BUSY→503 database_busy+invalidateDb；SQLITE_NOTADB→503 database_unavailable；普通错误 next 透传', async () => {
  let invalidated = 0;
  const mkErr = (msg, code) => Object.assign(new Error(msg), { code });
  const app = express();
  app.get('/boom/:kind', (req, _res, next) => {
    const kind = req.params.kind;
    if (kind === 'busy') return next(mkErr('database is locked', 'SQLITE_BUSY'));
    if (kind === 'notadb') return next(mkErr('file is not a database', 'SQLITE_NOTADB'));
    next(new Error('plain failure'));
  });
  app.use(makeErrorTranslator({ invalidateDb: () => { invalidated++; } }));
  // 透传终点：普通错误必须原样到达（非 503 契约形态）
  app.use((err, _req, res, _next) => res.status(599).json({ caught: err.message }));
  const server = await listen(app);
  try {
    const port = server.address().port;
    const before = invalidated;
    const busy = await get(port, '/boom/busy');
    assert.equal(busy.status, 503);
    const bj = JSON.parse(busy.body);
    assert.equal(bj.error, 'database_busy');
    assert.equal(bj.retryable, true);
    assert.equal(invalidated, before + 1, 'BUSY 分支须丢弃只读连接缓存');

    const notadb = await get(port, '/boom/notadb');
    assert.equal(notadb.status, 503);
    assert.equal(JSON.parse(notadb.body).error, 'database_unavailable');
    assert.equal(invalidated, before + 2, 'NOTADB 分支须丢弃只读连接缓存');

    const plain = await get(port, '/boom/plain');
    assert.equal(plain.status, 599, '普通错误不被翻译，next(err) 原样透传');
    assert.equal(JSON.parse(plain.body).caught, 'plain failure');
    assert.equal(invalidated, before + 2, '普通错误不触发 invalidateDb');
  } finally { server.close(); }
});

