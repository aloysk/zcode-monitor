'use strict';
// test/export-routes.test.js — /api/export/:dataset 的 HTTP 契约（C12-1~C12-6，
// ecosystem-round2-batch2 §2.4）。形态：express listen(0) + http.get（usage-
// routes.test.js 同款）；env 指向 os.tmpdir() fixture 后再 require 路由。
// 同源对照面（C12-2）：同进程挂载源端点路由（/api/usage/turns、/api/recap、
// /api/overview），同 fixture 同参数下核心数值逐项相等。
// 毒字段说明（C12-3）：导出面无会话标题列（usage 时间线无 title、overview 行
// 标识是模型/工具名）——毒字段等价构造于 turn 行 error_type 与 by_model 的
// model_id（均为库内自由字符串），转义断言面对 CSV 单元格转义器本身。
// ⚠ 禁止单筛本文件用例及删除/改名早段用例：阶段 1 是空库断言（须最先跑），
// 其后在同库上累计插行（seed→毒行→bulk），晚段期望值计入早段基线行——整文件
// 顺序跑是唯一受支持形态（usage-routes.test.js 头注同款约定）。
// 空态口径注（C12-6）：「CSV 仅首行列名」按字面仅 usage（行集空）满足——
// overview 的 kpis/speed 叶子恒在（值为 0/null，非伪造数据行）、recap 空库当日
// 产出「已知零」真 0 桶行（T6 日桶边界钉），两者按「空集字段为空 + 行数一致
// （C12-4）」口径断言。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { createFixtureDb, buildModelUsage, buildTurnUsage } = require('./helpers/fixture-db');

const fx = createFixtureDb(); // 不 seed：空库起步（C12-6 空态先行）
process.env.ZCODE_DB = fx.dbPath;
process.env.ZCODE_LOG_DIR = fx.logDir;
process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;

const { makeExportRouter } = require('../server/routes/export');
const { makeUsageRouter } = require('../server/routes/usage');
const { makeRecapRouter } = require('../server/routes/recap');
const overviewRouter = require('../server/routes/overview');
const { securityHeaders } = require('../server/http-hardening');

const now = Date.now();
const H = (m) => now - m * 60e3;

test.after(() => {
  try { require('../server/db').db().close(); } catch { /* already closed */ }
  try { require('../server/db').invalidateDb(); } catch { /* ignore */ }
  fx.cleanup();
});

function listen(a) {
  const server = a.listen(0, '127.0.0.1');
  return new Promise(resolve => server.on('listening', () => resolve(server)));
}
function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        buf: Buffer.concat(chunks),
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    }).on('error', reject);
  });
}
async function getJson(port, p) {
  const r = await get(port, p);
  return { status: r.status, body: JSON.parse(r.text) };
}
// 挂载顺序对齐 index.js 装配契约（securityHeaders → /api/* 路由族）。
async function withServer(fn) {
  const a = express();
  a.use(securityHeaders);
  a.use('/api/overview', overviewRouter);
  a.use('/api/usage', makeUsageRouter());
  a.use('/api/recap', makeRecapRouter());
  a.use('/api/export', makeExportRouter());
  const server = await listen(a);
  try { await fn(server.address().port); } finally { server.close(); }
}

const isIso = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s));
const csvLines = (text) => text.split('\r\n').filter(l => l !== '');
// 叶子计数（C12-4 overview 断言的独立 oracle——不 import 生产实现）
const leafCount = (v) => v === null || typeof v !== 'object' ? 1
  : Object.values(v).reduce((s, x) => s + leafCount(x), 0);

// ── 阶段 1：C12-6 空态（须最先跑；收尾处 seed 供后续阶段）──
test('C12-6 空态: 三数据集空库 200、JSON 空集形状+meta 完整（overview 补装）、CSV 不抛错', async () => {
  await withServer(async (port) => {
    // usage：行集空 → data.timeline=[] + CSV 仅首行列名（三数据集中唯一满足
    // 「仅首行」字面的形态）。
    const uj = await getJson(port, '/api/export/usage?window=24h');
    assert.equal(uj.status, 200);
    assert.deepEqual(uj.body.data.timeline, []);
    assert.deepEqual(uj.body.data.by_error_type, []);
    assert.equal(uj.body.meta.retention_days, 30);
    assert.ok(isIso(uj.body.generated_at));
    const uc = await get(port, '/api/export/usage?window=24h&format=csv');
    assert.equal(uc.status, 200);
    assert.deepEqual(csvLines(uc.text), [
      'turn_id,session_id,started_at,duration_ms,time_to_first_token_ms,'
      + 'status,model_retry_count,tool_error_count,error_type,context_exceeded,computed_total_tokens',
    ], '空库 usage CSV 仅首行列名');

    // overview：空集字段为空（series/by_model/by_tool/recent_speed）；kpis/speed
    // 叶子恒在（0/null 值——见文件头空态口径注）；meta 补装三字段。
    const oj = await getJson(port, '/api/export/overview?window=24h');
    assert.equal(oj.status, 200);
    assert.deepEqual(oj.body.data.series, []);
    assert.deepEqual(oj.body.data.by_model, []);
    assert.deepEqual(oj.body.data.by_tool, []);
    assert.deepEqual(oj.body.data.recent_speed, []);
    assert.equal(oj.body.data.kpis.model.calls, 0);
    assert.equal(oj.body.data.speed.weighted_tps, null);
    assert.deepEqual(Object.keys(oj.body.meta).sort(),
      ['retention_days', 'since', 'window'], 'overview 补装 meta 三字段');
    assert.equal(oj.body.meta.retention_days, 30, 'overview 的 retention_days 由 export 层补装');
    const oc = await get(port, '/api/export/overview?window=24h&format=csv');
    assert.equal(oc.status, 200);
    assert.equal(csvLines(oc.text)[0], 'section,key,value', 'CSV 首行列名');

    // recap：空库当日产出「已知零」真 0 桶行（T6 日桶边界语义），不抛错、
    // meta 完整；CSV 行数与 JSON days 行数一致（C12-4 口径，见头注）。
    const rj = await getJson(port, '/api/export/recap?period=week');
    assert.equal(rj.status, 200);
    assert.ok(Array.isArray(rj.body.data.days) && rj.body.data.days.length >= 1);
    assert.equal(rj.body.data.days[rj.body.data.days.length - 1].calls, 0, '当日真 0 桶');
    assert.equal(rj.body.meta.retention_days, 30);
    assert.ok(isIso(rj.body.meta.token_coverage_from));
    const rc = await get(port, '/api/export/recap?period=week&format=csv');
    assert.equal(rc.status, 200);
    assert.equal(rc.text.split('\r\n').filter(Boolean).length, rj.body.data.days.length + 1,
      'CSV 行数=JSON days 行数+首行');
  });

  // 阶段 1 收尾 seed：既有种子（s1/s2 会话 + model/tool/turn 行）+ 导出专用毒字段。
  fx.seed();
  // 公式注入毒集＝OWASP CSV Injection 建议集（= + - @ 四符 + TAB/CR 前缀形态，
  // 终审第 1 轮安全席 note 补齐后两形态）。
  buildTurnUsage(fx.conn, [
    '=SUM(A1:A5)', '逗号, "引号"', '行一\n行二', '-2+3+cmd', '@cmd', '+4200',
    '\tTAB 开头公式形态', '\rCR 开头公式形态',
  ].map((t, i) => ({
    turn_id: `poison${i + 1}`, session_id: 's1', status: 'error', error_type: t,
    started_at: H(30 - i), duration_ms: 100,
  })));
  // by_model 行标识毒值（overview 长表 value 列 JSON 序列化的引号/逗号转义面）
  buildModelUsage(fx.conn, [{
    id: 'pm1', session_id: 's1', turn_id: 'pt1', status: 'completed',
    started_at: H(4), duration_ms: 500, query_source: 'main_turn',
    model_id: 'model,"x', provider_id: 'zai', input_tokens: 1, output_tokens: 1,
    computed_total_tokens: 2,
  }]);
});

// ── 阶段 2：C12-1 白名单钉 ──
test('C12-1 白名单: 3 dataset × 2 format 六组合 200；未知 400 可读错误码；缺省 json；?dataset= 不参与路由', async () => {
  await withServer(async (port) => {
    for (const dataset of ['overview', 'usage', 'recap']) {
      for (const format of ['json', 'csv']) {
        const r = await get(port, `/api/export/${dataset}?format=${format}`);
        assert.equal(r.status, 200, `${dataset}/${format} 六组合全 200`);
      }
    }
    const bogus = await getJson(port, '/api/export/bogus');
    assert.equal(bogus.status, 400);
    assert.equal(bogus.body.error, 'unknown_dataset', '未知 dataset 可读错误码');
    const xml = await getJson(port, '/api/export/overview?format=xml');
    assert.equal(xml.status, 400);
    assert.equal(xml.body.error, 'unknown_format', '未知 format 可读错误码（不回退钉）');
    // format 缺省=json（包络回显）
    const dflt = await getJson(port, '/api/export/usage?window=24h');
    assert.equal(dflt.body.format, 'json', 'format 缺省 json');
    // dataset 是路径参数：query 形态 ?dataset= 不参与路由判定
    const q = await getJson(port, '/api/export/usage?dataset=bogus');
    assert.equal(q.status, 200, '?dataset= query 不改路由判定（仍走路径参数 usage）');
    assert.equal(q.body.dataset, 'usage');
  });
});

// ── 阶段 3：C12-2 同源钉 + 包络 ──
test('C12-2 同源+包络: usage/recap 与源端点核心数值逐项相等；schema_version/generated_at/meta 三数据集统一', async () => {
  await withServer(async (port) => {
    // usage 同源对照（不比 since/generated_at——两请求的 Date.now() 毫秒基不同）
    const exp = await getJson(port, '/api/export/usage?window=7d');
    const src = await getJson(port, '/api/usage/turns?window=7d');
    assert.equal(exp.status, 200);
    assert.deepEqual(exp.body.data.totals, src.body.totals, 'totals 同源逐项相等');
    assert.deepEqual(exp.body.data.timeline, src.body.timeline, 'timeline 深相等（含毒字段行）');
    assert.deepEqual(exp.body.data.by_error_type, src.body.by_error_type);
    assert.equal(exp.body.meta.retention_days, src.body.meta.retention_days);

    // recap 同源对照（days/activity/top_focus；period_start 同为时间基不比）
    const rex = await getJson(port, '/api/export/recap?period=week');
    const rsrc = await getJson(port, '/api/recap?period=week');
    assert.equal(rex.status, 200);
    assert.deepEqual(rex.body.data.days, rsrc.body.days, 'days 日桶同源深相等');
    assert.deepEqual(rex.body.data.activity, rsrc.body.activity);
    assert.deepEqual(rex.body.data.top_focus, rsrc.body.top_focus);

    // overview 行为等价对照（HTTP 面）：稳定子集深比较（窗口内行固定，
    // since/window_ms 是毫秒基字段不比）
    const oexp = await getJson(port, '/api/export/overview?window=24h');
    const osrc = await getJson(port, '/api/overview?window=24h');
    assert.equal(oexp.status, 200);
    assert.deepEqual(oexp.body.data.series, osrc.body.series, 'series 行为等价（桶对齐小时）');
    assert.deepEqual(oexp.body.data.by_model, osrc.body.by_model);
    assert.deepEqual(oexp.body.data.by_tool, osrc.body.by_tool);
    assert.deepEqual(oexp.body.data.recent_speed, osrc.body.recent_speed);
    assert.deepEqual(oexp.body.data.kpis.model, osrc.body.kpis.model);
    assert.deepEqual(oexp.body.data.kpis.tokens, osrc.body.kpis.tokens);

    // 包络统一断言：三数据集 schema_version===1、generated_at ISO、meta.retention_days===30
    for (const ds of ['overview', 'usage', 'recap']) {
      const j = await getJson(port, `/api/export/${ds}`);
      assert.equal(j.body.schema_version, 1, `${ds} schema_version===1`);
      assert.ok(isIso(j.body.generated_at), `${ds} generated_at ISO`);
      assert.equal(j.body.meta.retention_days, 30, `${ds} meta.retention_days===30`);
      assert.equal(j.body.dataset, ds);
      assert.equal(j.body.format, 'json');
    }
  });
});

// ── 阶段 4：C12-2 源码契约（frontend-contract 读文件形态）──
test('C12-2 源码契约: 消费源端点查询函数清单、零新 SQL、resolveWindow 复用、overview 映射注释锚', () => {
  const readServer = (p) => fs.readFileSync(path.join(__dirname, '..', 'server', p), 'utf8');
  const src = readServer(path.join('routes', 'export.js'));
  for (const fn of ['overviewKpis', 'timeseries', 'breakdownByModel', 'breakdownByTool',
    'overviewSpeed', 'recentSpeed', 'usageTurnsSummary', 'usageTurnTimeline']) {
    assert.ok(src.includes(fn), `export.js 须消费 ${fn}（与源端点同清单）`);
  }
  assert.ok(src.includes("require('./usage-window')"), 'usage 值域窗口解析走共享模块');
  assert.ok(src.includes("require('./recap')") && src.includes('buildRecapPayload'),
    'recap 走 buildRecapPayload 同源装配');
  assert.ok(!/\.prepare\(/.test(src), 'export.js 零新 SQL（同源钉）');
  // usage 值域零第二处：30d 分支只活在 usage-window.js（overview 值域无 30d）
  assert.ok(!src.includes("'30d'"), 'usage 值域窗口分支不内联（走 resolveWindow 复用）');
  // overview 值域映射仅 export.js 内一处、注释含指向 overview.js 的锚点引用
  assert.ok(src.includes('overview.js:13-22'), 'overview 值域映射注释含源锚点');
  assert.equal((src.match(/Date\.now\(\) - 24 \* 3600_000/g) || []).length, 1,
    '24h 窗口映射仅 overviewWindow 一处（授权例外单点）');
  // 装配契约：index.js 含 /api/export 装配且在全局闸之后
  const idx = readServer('index.js');
  assert.ok(idx.includes("app.use('/api/export'"), "index.js 须含 app.use('/api/export'");
  assert.ok(idx.indexOf('app.use(securityHeaders)') < idx.indexOf("app.use('/api/export'"),
    '装配在 securityHeaders 之后');
  assert.ok(idx.indexOf("app.use('/api', loopbackHostGate)") < idx.indexOf("app.use('/api/export'"),
    '装配在回环 Host 闸之后');
});

// ── 阶段 5：C12-3 CSV 转义钉 ──
test('C12-3 CSV 转义: 毒字段 RFC 4180 + 公式注入前置 \'；首行列名；\\r\\n 行尾；无 BOM；三数据集列集', async () => {
  await withServer(async (port) => {
    const csv = await get(port, '/api/export/usage?window=24h&format=csv');
    assert.equal(csv.status, 200);
    // 首行列名 + 行尾 \r\n
    assert.ok(csv.text.startsWith(
      'turn_id,session_id,started_at,duration_ms,time_to_first_token_ms,'
      + 'status,model_retry_count,tool_error_count,error_type,context_exceeded,computed_total_tokens\r\n'),
      'usage 首行列名（C1 timeline 行字段）');
    assert.ok(csv.text.endsWith('\r\n'), '行尾 CRLF');
    // 公式注入防护：= + - @ 开头的字段前置 '（断言失败时携带 CSV 全文——
    // 2026-09-25 终审第 1 轮登记的「首跑间歇红只剩用例名不可诊断」处置面：
    // 下次复现即有完整响应体可定位，residuals R-34 留痕）。
    const csvDump = () => `\n[CSV 全文 ${csv.text.length} 字符]\n${csv.text}`;
    assert.ok(csv.text.includes("'=SUM(A1:A5)"), '= 前置转义' + csvDump());
    assert.ok(csv.text.includes("'@cmd"), '@ 前置转义' + csvDump());
    assert.ok(csv.text.includes("'+4200"), '+ 前置转义' + csvDump());
    assert.ok(csv.text.includes("'-2+3+cmd"), '- 前置转义' + csvDump());
    assert.ok(csv.text.includes("'\tTAB 开头公式形态"),
      'TAB 前置转义（OWASP 扩展字符集）' + csvDump());
    assert.ok(csv.text.includes("'\rCR 开头公式形态"),
      'CR 前置转义（OWASP 扩展字符集）' + csvDump());
    // RFC 4180：毒字段双引号包裹、内部 " 加倍
    assert.ok(csv.text.includes('"逗号, ""引号"""'), '逗号/引号字段包裹+加倍');
    assert.ok(csv.text.includes('"行一\n行二"'), '换行字段包裹（多行单元格）');
    // UTF-8 无 BOM
    assert.ok(!(csv.buf[0] === 0xEF && csv.buf[1] === 0xBB && csv.buf[2] === 0xBF),
      'Buffer 首三字节非 EF BB BF');

    // recap 列集（§2.4 需求 4 字面清单）
    const rc = await get(port, '/api/export/recap?period=week&format=csv');
    assert.ok(rc.text.startsWith('date,tokens,calls,sessions,active_minutes,parallel_max\r\n'),
      'recap 首行列集');
    // overview 列集 + by_model 毒标识的转义形态（key 列含引号 → RFC 加倍 ""）
    const oc = await get(port, '/api/export/overview?window=24h&format=csv');
    assert.ok(oc.text.startsWith('section,key,value\r\n'), 'overview 首行列集');
    assert.ok(oc.text.includes('model,""x'), '毒 model_id 进长表（引号加倍转义形态）');
  });
});

// ── 阶段 6：C12-5 响应头钉 ──
test('C12-5 响应头: Content-Disposition 形态、schema-version 头双形态、全局头不破坏', async () => {
  await withServer(async (port) => {
    const csv = await get(port, '/api/export/usage?window=7d&format=csv');
    assert.match(csv.headers['content-disposition'],
      /^attachment; filename="zcode-monitor-usage-7d-[0-9TZ]+\.csv"$/,
      'Content-Disposition 附件下载形态');
    assert.equal(csv.headers['x-zcode-monitor-export-schema-version'], '1', 'CSV 带 schema-version 头');
    const j = await getJson(port, '/api/export/recap?period=week&format=json');
    assert.equal(j.status, 200);
    // getJson 丢 headers，重取裸响应验头
    const jr = await get(port, '/api/export/recap?period=week&format=json');
    assert.equal(jr.headers['x-zcode-monitor-export-schema-version'], '1', 'JSON 同带头（双保险）');
    assert.match(jr.headers['content-disposition'],
      /^attachment; filename="zcode-monitor-recap-week-[0-9TZ]+\.json"$/);
    // 全局既有头不因 export 路由破坏（securityHeaders 同链挂载，C12-5 装配契约）
    assert.equal(csv.headers['x-content-type-options'], 'nosniff', 'nosniff 在');
    assert.ok(String(csv.headers['content-security-policy']).includes("default-src 'self'"),
      'CSP 在');
  });
});

// ── 阶段 7：C12-4 钳界 + 行数一致性（晚段插 bulk 行不再影响早段期望）──
test('C12-4 钳界+行数一致性: limit=-1 钳 1、99999 钳 500；CSV 行数=JSON 行数（分数据集口径）', async () => {
  // 601 行 bulk（H(2) 段）→ 24h 窗内总行数超 500 上限，钳界可判
  const bulk = [];
  for (let i = 1; i <= 601; i++) {
    bulk.push({ turn_id: `cb${String(i).padStart(3, '0')}`, session_id: 'capbulk',
      status: 'completed', started_at: H(2), duration_ms: 10, model_request_count: 1 });
  }
  buildTurnUsage(fx.conn, bulk);

  await withServer(async (port) => {
    const neg = await getJson(port, '/api/export/usage?window=24h&limit=-1');
    assert.equal(neg.status, 200);
    assert.equal(neg.body.data.timeline.length, 1, 'limit=-1 钳 1');
    const big = await getJson(port, '/api/export/usage?window=24h&limit=99999');
    assert.equal(big.body.data.timeline.length, 500, 'limit=99999 钳上限 500');

    // usage：CSV 数据行数=JSON data.timeline 行数（两格式同源同界）
    const cj = await getJson(port, '/api/export/usage?window=24h&limit=2');
    const cc = await get(port, '/api/export/usage?window=24h&limit=2&format=csv');
    assert.equal(csvLines(cc.text).length, cj.body.data.timeline.length + 1,
      'usage CSV 行数=JSON timeline 行数+首行');

    // recap：CSV 行数=JSON days 行数
    const rj = await getJson(port, '/api/export/recap?period=week');
    const rc = await get(port, '/api/export/recap?period=week&format=csv');
    assert.equal(csvLines(rc.text).length, rj.body.data.days.length + 1,
      'recap CSV 行数=JSON days 行数+首行');

    // overview：各 section 行数=JSON 对应 section 元素数（叶子口径，不按行集）
    const oj = await getJson(port, '/api/export/overview?window=24h');
    const oc = await get(port, '/api/export/overview?window=24h&format=csv');
    const secRows = {};
    for (const line of csvLines(oc.text).slice(1)) {
      const sec = line.split(',')[0]; // section 列为固定枚举，首个逗号前即 section
      secRows[sec] = (secRows[sec] || 0) + 1;
    }
    assert.equal(secRows.kpis, leafCount(oj.body.data.kpis), 'kpis 行数=叶子数');
    assert.equal(secRows.speed, leafCount(oj.body.data.speed), 'speed 行数=叶子数');
    assert.equal(secRows.recent_speed,
      oj.body.data.recent_speed.reduce((s, r) => s + Object.keys(r).length, 0),
      'recent_speed 行数=各元素叶子数之和');
    assert.equal(secRows.series, oj.body.data.series.length, 'series 行数=桶数');
    assert.equal(secRows.by_model, oj.body.data.by_model.length, 'by_model 行数');
    assert.equal(secRows.by_tool, oj.body.data.by_tool.length, 'by_tool 行数');
  });
});
