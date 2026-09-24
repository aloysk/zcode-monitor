'use strict';
// test/freshness.test.js — C9 数据新鲜度恒显与空态诚实化（T1）：
//   C9-1（行为）/api/health 的 freshness 对象：db/jsonl 双源 lag_ms + ok/warn/err
//        三档——判定全在服务端、阈值经 opts 注入（小值可测）；档位归属 >= 含等值；
//        无行/无文件 → lag_ms 与 level 均 null（诚实空态，不伪造 0）；
//   C9-2（源码契约）顶栏 chip：index.html 有 chip 元素；app.js 渲染「数据落后」
//        与 severity 语义色；5min/30min 分档阈值字面量在 app.js 0 命中
//        （分档判定不得漂移进前端——60s/1h 显示格式化阈值不在此列）；
//   C9-3（模块+契约）empty-state.js：node 侧 require 直测（双文本 + 注入转义）；
//        index.html 引入、组件 browser 分支自挂 window.ZC.emptyState、
//        app.js 无挂载赋值（挂载责任单点）；
//   C9-4（源码契约）timeline.js found:false 分支：经 ZC.emptyState 渲染、
//        含「已停写」两情形、/api/sessions/ 取 task_type 判型。
// fixture 全在 os.tmpdir()（绝不触碰真实库）；ZCODE_DB/ZCODE_LOG_DIR 于
// require server 模块前注入（db.js/log-tail.js 模块加载时读取，
// sessions-routes.test.js 同法；test/index.js 的 run() 按文件独立子进程，
// 跨文件 env 不互染）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { createFixtureDb } = require('./helpers/fixture-db');

const fx = createFixtureDb(); // 不 seed：freshness 用例自控 model_usage 行集
process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = fx.logDir;

const dbq = require('../server/db');
const { makeHealthRoute } = require('../server/health-route');
const { defaultTodayFile } = require('../server/log-tail');

const RUNTIME = { walStatus: () => null }; // WAL 面不在本用例覆盖内（既有套守护）
const RUNTIME_STATE = { running: false, lastCheckpoint: null };

function makeApp(extraOpts = {}) {
  const app = express();
  app.get('/api/health', makeHealthRoute({
    dbq, runtime: RUNTIME, runtimeState: RUNTIME_STATE,
    dbPath: dbq.DB_PATH, logDir: dbq.LOG_DIR, ...extraOpts,
  }));
  return app;
}

function listen(app) { // sessions-routes.test.js:43-46 同款形态
  const server = app.listen(0, '127.0.0.1');
  return new Promise(resolve => server.on('listening', () => resolve(server)));
}

function getJson(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(body) }));
    }).on('error', reject);
  });
}

async function getHealth(extraOpts) {
  const server = await listen(makeApp(extraOpts));
  try { return await getJson(server.address().port, '/api/health'); }
  finally { server.close(); }
}

// 「名字最新」语义的日志文件：未来日期名字典序大于任何真实日期名，构造与
// UTC/本地命名惯例无关；测试与生产同用 defaultTodayFile 发现它（见下述用例
// 内的自洽钉——不是同名巧合掩盖 UTC 映射误报）。
const LOG_FILE = path.join(fx.logDir, 'zcode-2999-01-01.jsonl');
function writeTodayLog(mtimeMs) {
  fs.writeFileSync(LOG_FILE, '{"ts":"fixture"}\n');
  const d = new Date(mtimeMs);
  fs.utimesSync(LOG_FILE, d, d); // 只动 fixture 文件（os.tmpdir()），非仓库面
}

function insertModelRow(id, startedAt) {
  fx.conn.prepare('INSERT INTO model_usage (id, started_at) VALUES (?, ?)').run(id, startedAt);
}
function clearModelRows() { fx.conn.prepare('DELETE FROM model_usage').run(); }

test.after(() => {
  try { dbq.db().close(); } catch { /* already closed */ }
  try { dbq.invalidateDb(); } catch { /* ignore */ }
  fx.cleanup();
});

// ── C9-1 行为 ────────────────────────────────────────────────────────────

test('C9-1: 空库+无日志文件 → 双源 lag_ms 与 level 均 null（诚实空态，不伪造 0）', async () => {
  clearModelRows();
  const r = await getHealth();
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true, 'fixture 库可读，探活应 ok');
  const fr = r.json.freshness;
  assert.ok(fr, '响应须含 freshness 对象');
  assert.deepEqual(fr.db, { lag_ms: null, level: null }, '无行 → null/null');
  assert.deepEqual(fr.jsonl, { lag_ms: null, level: null }, '无文件 → null/null');
  assert.equal(fr.zcode_running, false, 'freshness.zcode_running 复用既有字段值');
});

test('C9-1: db 落后 10min → warn、jsonl 落后 40min → err（缺省阈值 5min/30min）', async () => {
  const t0 = Date.now();
  clearModelRows();
  insertModelRow('m-warn', t0 - 10 * 60 * 1000);
  writeTodayLog(t0 - 40 * 60 * 1000);
  // 自洽钉：生产读路径（defaultTodayFile「名字最新」）确实选中构造文件——
  // 若用 todayLogFile 同名构造，恰好掩盖 UTC 映射误报（C9-1 验收文案点名）。
  assert.equal(defaultTodayFile(), LOG_FILE);
  const r = await getHealth();
  const fr = r.json.freshness;
  assert.ok(Math.abs(fr.db.lag_ms - 600000) <= 30000, `db lag ≈600000±30000，实得 ${fr.db.lag_ms}`);
  assert.equal(fr.db.level, 'warn', '10min ≥ 5min 阈 → warn');
  assert.ok(Math.abs(fr.jsonl.lag_ms - 2400000) <= 30000, `jsonl lag ≈2400000±30000，实得 ${fr.jsonl.lag_ms}`);
  assert.equal(fr.jsonl.level, 'err', '40min ≥ 30min 阈 → err');
});

test('C9-1: db 落后 1min、jsonl 刚写 → 双源 ok', async () => {
  const t0 = Date.now();
  clearModelRows();
  insertModelRow('m-ok', t0 - 60 * 1000);
  writeTodayLog(t0);
  const r = await getHealth();
  const fr = r.json.freshness;
  assert.ok(Math.abs(fr.db.lag_ms - 60000) <= 30000);
  assert.equal(fr.db.level, 'ok', '1min < 5min 阈 → ok');
  assert.equal(fr.jsonl.level, 'ok');
});

test('C9-1: 阈值注入（warn=100/err=200）生效 + 档位归属 >= 含等值钉', async () => {
  // Date.now 钉在固定值 T：lag = T − started_at 恰等于阈值，等值归属可确定性
  // 断言（不靠墙钟 ε 撞界——正值 ε 下 >= 与 > 同判，分不出语义）。
  const T = Date.now();
  const realNow = Date.now;
  Date.now = () => T;
  try {
    const OPTS = { freshnessWarnMs: 100, freshnessErrMs: 200 };
    // 100 ≤ 150 < 200 → warn
    clearModelRows();
    insertModelRow('m-150', T - 150);
    let r = await getHealth(OPTS);
    assert.equal(r.json.freshness.db.level, 'warn', '150ms：warn ≤ lag < err → warn');
    // 新行（rowid 更大）250ms → err
    insertModelRow('m-250', T - 250);
    r = await getHealth(OPTS);
    assert.equal(r.json.freshness.db.level, 'err', '250ms ≥ err 阈 → err');
    // 恰等于 warn 阈（lag=100）→ warn（含等值；> 语义下会误落 ok）
    clearModelRows();
    insertModelRow('m-eq-warn', T - 100);
    r = await getHealth(OPTS);
    assert.equal(r.json.freshness.db.level, 'warn', 'lag 恰等于 warnMs → warn（>= 含等值）');
    // 恰等于 err 阈（lag=200）→ err（含等值）
    clearModelRows();
    insertModelRow('m-eq-err', T - 200);
    r = await getHealth(OPTS);
    assert.equal(r.json.freshness.db.level, 'err', 'lag 恰等于 errMs → err（>= 含等值）');
    // jsonl 源等值钉：mtime 实测后把 err 阈钉在同一 lag 值上（同浮点运算，
    // 消除 mtimeMs 亚毫秒舍入方向的抖动）
    writeTodayLog(T - 200);
    const m = fs.statSync(LOG_FILE).mtimeMs;
    r = await getHealth({ freshnessWarnMs: 100, freshnessErrMs: T - m });
    assert.ok(Math.abs(r.json.freshness.jsonl.lag_ms - 200) < 1, `jsonl lag ≈200，实得 ${r.json.freshness.jsonl.lag_ms}`);
    assert.equal(r.json.freshness.jsonl.level, 'err', 'jsonl lag 恰等于 errMs → err（>= 含等值）');
  } finally {
    Date.now = realNow;
  }
});

// ── C9-2 / C9-3 / C9-4 源码契约 ─────────────────────────────────────────

const readPublic = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');

test('C9-2 契约: index.html 有 chip 元素；app.js 渲染「数据落后」+severity 语义色；分档阈值字面量 0 命中', () => {
  const html = readPublic('index.html');
  assert.ok(/id="freshness-chip"/.test(html), '顶栏须有 freshness chip 元素');

  const app = readPublic('app.js');
  assert.ok(app.includes('数据落后'), 'app.js 须渲染「数据落后」文案');
  assert.ok(app.includes('var(--sev-warn)') && app.includes('var(--sev-err)'),
    'warn/err 档须用 severity 语义色（--sev-warn/--sev-err，双主题同源）');
  assert.ok(/renderFreshnessChip\(h\.freshness\)/.test(app), 'healthLoop 须接线 freshness 渲染');
  // 分档判定不在前端：5min/30min 阈值的字面量与乘式变体一律禁入 app.js
  //（60000/3600000 等 <60s/>1h 显示格式化阈值合法——判定与显示分离）。
  const BAN = /300000|300_000|1800000|1_800_000|5\s*\*\s*60\s*\*\s*1000|30\s*\*\s*60\s*\*\s*1000/;
  const hits = app.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => BAN.test(l));
  assert.deepEqual(hits, [], `app.js 不得含分档阈值字面量（判定在服务端）: ${JSON.stringify(hits)}`);
});

test('C9-3: emptyState(label, hint) 含双文本；注入的 label/hint 已转义（组件内转义义务）', () => {
  const emptyState = require('../public/empty-state.js');
  const html = emptyState('transcript.jsonl', '去 Context 看对话');
  assert.ok(html.includes('transcript.jsonl'), '须含数据源名');
  assert.ok(html.includes('去 Context 看对话'), '须含处置指引');

  const dirty = emptyState('<script>x</script>', '<img src=x onerror=alert(1)>');
  assert.ok(!/<script>|<img\s/.test(dirty), '注入的 HTML 不得原样落入输出');
  assert.ok(dirty.includes('&lt;script&gt;'), '转义实体须在输出中');
});

test('C9-3 契约: index.html 引入 empty-state.js；组件自挂 window.ZC.emptyState；app.js 无挂载赋值', () => {
  const html = readPublic('index.html');
  assert.ok(html.includes('<script src="/empty-state.js"'), 'index.html 须引入组件');
  const src = readPublic('empty-state.js');
  assert.ok(/root\.ZC\s*=\s*root\.ZC\s*\|\|\s*\{\}/.test(src), 'browser 分支须确保 ZC 存在');
  assert.ok(/ZC\.emptyState\s*=/.test(src), '组件自身挂 window.ZC.emptyState（挂载责任单点）');
  const app = readPublic('app.js');
  assert.ok(!/window\.ZC\.emptyState\s*=/.test(app), 'app.js 不得含挂载赋值');
});

test('C9-4 契约: timeline found:false 经 ZC.emptyState 渲染、含「已停写」、/api/sessions/ 取 task_type 判型', () => {
  const src = readPublic('views/timeline.js');
  assert.ok(/(window\.)?ZC\.emptyState\(/.test(src), '空态须经共享组件渲染');
  assert.ok(src.includes('已停写'), '子代理/未知型情形须明示「已停写」（诚实呈现）');
  assert.ok(src.includes("'/api/sessions/'"), '判型须经 /api/sessions/:id');
  assert.ok(src.includes('task_type') && src.includes('interactive'),
    'task_type 判型区分 interactive 两情形');
});
