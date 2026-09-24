'use strict';
// test/context-view.test.js — C2 前端面（T7）：
//   C2-3：public/context-gauge.js 纯函数（node 侧 require 同一份文件——UMD 双端
//         导出，测试守护的就是页面实际加载的那份）——占用比逐行 input/窗口、
//         input=0 行回退 (cache_creation+cache_read)/窗口 且标 fallback、
//         compact 边界前后回落值=前后两行占用差、context_tokens null → 占用
//         null 不显百分比（unknown 态）、增量曲线值=相邻行分子差（compact 后为负）；
//   C2-5：源码契约——sessions.js renderContext 四要素（SSE 订阅 /api/live/events、
//         增量曲线、compaction 边界竖线、回落摘要）+ 空序列经 ZC.emptyState +
//         context-gauge.js 禁硬编码色值 + index.html 引入形态 + app.js 不含挂载赋值；
//   C2-6：源码契约——widget.html「缓存命中」副行渲染与 null→「—」分支；
//   C2-7：源码契约——server/ 递归 text/event-stream 出现次数恰为 2（live.js 与
//         index.js 各一，SSE 复用不加新通道）；
//   C2-4（renderList 部分）：源码契约——mini 条渲染段与「未知模型不显百分比」
//         「无 model 行不渲染」两分支（API 数值面已由 test/context-gauge.test.js
//         T6 用例守护，两文件互补不重叠）。
// 接线点没有可跑的 DOM 行为面（前端无构建、无 jsdom），用源码形态锁住不回归
// ——frontend-contract.test.js / usage-view.test.js 同款 readPublic 形态。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CG = require('../public/context-gauge.js');
const readPublic = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');

// C1-5/C5-3/C2-5 判据同款具名色名单（单词边界匹配）：red|orange|yellow|lime|green|
// teal|cyan|blue|violet|purple|magenta|pink|brown|gray|grey|silver|white|black|gold
// ——新文件（context-gauge.js）颜色一律 var(--sev-*/--cat-*) 引用。
const NAMED_COLORS = /\b(red|orange|yellow|lime|green|teal|cyan|blue|violet|purple|magenta|pink|brown|gray|grey|silver|white|black|gold)\b/;

// C2-2 同款序列（T6 fixture s1 的五行形态）+ 窗口 200000：input 递增 3 行 +
// compact 行（input=5000，路由层形状 compact_boundary:true）+ input=0 的 error 行
//（cache_creation=100/cache_read=50 → §2.0 勘误回退分子 150）。
const WIN = 200000;
const base = (over) => Object.assign({
  started_at: '2026-09-25T10:00:00Z', turn_id: 't', model_id: 'GLM-5.1',
  query_source: 'main_turn', input_tokens: 0,
  cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
  context_tokens: WIN,
}, over);
const ROWS = [
  base({ turn_id: 't1', input_tokens: 100, cache_read_input_tokens: 40, cache_creation_input_tokens: 5 }),
  base({ turn_id: 't2', input_tokens: 200, cache_read_input_tokens: 80, cache_creation_input_tokens: 8 }),
  base({ turn_id: 't3', input_tokens: 300, cache_read_input_tokens: 120, cache_creation_input_tokens: 10 }),
  base({ turn_id: 't4', query_source: 'compact', compact_boundary: true, input_tokens: 5000 }),
  base({ turn_id: 't5', input_tokens: 0, cache_read_input_tokens: 50, cache_creation_input_tokens: 100 }),
];

test('C2-3: 占用比逐行 = 分子/窗口（toFixed(4) 口径）；input=0 行回退分子且标 fallback', () => {
  const series = CG.computeGaugeSeries(ROWS);
  assert.equal(series.length, 5);
  // 逐行 input/200000（组件口径 +(...).toFixed(4)：150/200000=0.00075 → 0.0008）
  assert.deepStrictEqual(series.map(p => p.ratio),
    [0.0005, 0.001, 0.0015, 0.025, 0.0008]);
  // 回退行（§2.0 勘误执行证据）：input=0 → 分子 = cache_creation(100)+cache_read(50)
  assert.equal(series[4].molecule, 150);
  assert.strictEqual(series[4].fallback, true, 'input=0 行须标 fallback:true');
  assert.ok(series.slice(0, 4).every(p => p.fallback === false), 'input>0 行不标 fallback');
  // 原行字段保留（spread——消费面 hover/摘要可直接取）
  assert.equal(series[3].query_source, 'compact');
  assert.strictEqual(series[3].compact_boundary, true, 'compact_boundary 透传');
  // query_source='compact' 单独出现（SSE model 行无 compact_boundary 字段形态）也判边界
  const sseShape = CG.computeGaugeSeries([
    base({ turn_id: 'a', input_tokens: 10 }),
    base({ turn_id: 'b', query_source: 'compact', input_tokens: 900 }),
  ]);
  assert.deepStrictEqual(sseShape.map(p => p.compact_boundary), [false, true]);
});

test('C2-3: 增量曲线值 = 相邻行分子差（首行 null，compact 后为负）', () => {
  const series = CG.computeGaugeSeries(ROWS);
  assert.deepStrictEqual(series.map(p => p.delta), [null, 100, 100, 4700, -4850]);
  assert.ok(series[4].delta < 0, 'compact 边界后一行增量须为负（压掉的上下文）');
});

test('C2-3: compact 边界前后回落值 = 前后两行占用差（token 差不依赖窗口照发）', () => {
  const series = CG.computeGaugeSeries(ROWS);
  const drops = CG.compactDrops(series);
  assert.equal(drops.length, 1, '恰一个 compact 边界产出回落条目');
  const d = drops[0];
  assert.equal(d.index, 3, '边界行下标（t4 compact 行）');
  assert.equal(d.before, 0.025, '边界行占用（压缩前全部上下文）');
  assert.equal(d.after, 0.0008, '边界后一行占用（压缩后首个请求）');
  assert.equal(d.drop, 0.0242, '回落值 = 前后两行占用差');
  assert.equal(d.dropTokens, 4850, 'token 差 = 5000-150（事实，不依赖窗口）');
  // 边界是序列末行 → 无「后」可对比，不产出回落条目
  const tailBoundary = CG.computeGaugeSeries([
    base({ turn_id: 'x1', input_tokens: 10 }),
    base({ turn_id: 'x2', query_source: 'compact', input_tokens: 900 }),
  ]);
  assert.deepStrictEqual(CG.compactDrops(tailBoundary), [], '末行边界无后行 → 不产出回落条目');
});

test('C2-3: context_tokens null → 占用 null、unknown 态不显百分比（不猜窗口）', () => {
  const series = CG.computeGaugeSeries([
    base({ turn_id: 'u1', input_tokens: 100, context_tokens: null }),
    base({ turn_id: 'u2', input_tokens: 200, context_tokens: null, compact_boundary: false }),
  ]);
  assert.deepStrictEqual(series.map(p => p.ratio), [null, null], '未知模型占用 null');
  assert.strictEqual(CG.severityClass(null), null, 'unknown 档位为 null');
  // 渲染面：unknown 态不含任何百分比（含 % 的形态即红）
  const bar = CG.gaugeBarHtml(series[1].ratio);
  assert.ok(!bar.includes('%'), 'unknown 态水位条不得出现百分比');
  assert.ok(bar.includes('—'), 'unknown 态以「—」占位');
  const mini = CG.miniGaugeHtml(200, null);
  assert.ok(mini.includes('—') && !mini.includes('%'), '未知模型 mini 条渲染但不显百分比');
  // 回落条目比率侧诚实为 null（窗口未知），token 差仍照发
  const mixed = CG.computeGaugeSeries([
    base({ turn_id: 'm1', input_tokens: 5000, query_source: 'compact', compact_boundary: true }),
    base({ turn_id: 'm2', input_tokens: 100, context_tokens: null }),
  ]);
  const drops = CG.compactDrops(mixed);
  assert.equal(drops.length, 1);
  assert.strictEqual(drops[0].drop, null, '后行窗口未知 → 回落比率 null（不猜）');
  assert.equal(drops[0].dropTokens, 4900, 'token 差照发（事实不依赖窗口）');
});

test('C2-3: currentLevel 取末行分子/最近已知窗口（会话内模型切换以最新种子行为准）', () => {
  const series = CG.computeGaugeSeries(ROWS);
  const lvl = CG.currentLevel(series);
  assert.equal(lvl.molecule, 150, '末行（回退行）分子');
  assert.equal(lvl.window, WIN, '窗口取最近的非空 context_tokens');
  assert.equal(lvl.ratio, 0.0008);
  assert.equal(lvl.severity, 'ok');
  assert.strictEqual(lvl.fallback, true, '末行回退标记透传');
  // 空序列：全 null 的空态形状
  const empty = CG.currentLevel(CG.computeGaugeSeries([]));
  assert.strictEqual(empty.molecule, null);
  assert.strictEqual(empty.ratio, null);
  // 窗口全未知 → unknown（SSE 行不带窗口字段、种子亦未命中的消费面兜底）
  const unknown = CG.currentLevel(CG.computeGaugeSeries([
    base({ turn_id: 'k1', input_tokens: 100, context_tokens: null }),
  ]));
  assert.strictEqual(unknown.window, null);
  assert.strictEqual(unknown.ratio, null);
});

test('C2-3: 档位阈值（呈现层分档，数据不因分档改变）：<60% ok / ≥60% warn / ≥85% err', () => {
  assert.equal(CG.severityClass(0.59), 'ok');
  assert.equal(CG.severityClass(0.6), 'warn');
  assert.equal(CG.severityClass(0.84), 'warn');
  assert.equal(CG.severityClass(0.85), 'err');
  assert.equal(CG.severityClass(1.2), 'err');
});

test('C2-3: mini 条三态——已知窗口带百分比、input null 不渲染（空字符串）', () => {
  const known = CG.miniGaugeHtml(100000, 200000);
  assert.ok(/\d+%/.test(known), '已知窗口 mini 条含百分比');
  assert.ok(known.includes('非官方权威'), '「非官方权威」标注挂 title');
  assert.strictEqual(CG.miniGaugeHtml(null, 200000), '', 'input null → 不渲染（无 model 行分支之外的防线）');
  // 增量曲线 / 回落摘要渲染面结构锚（零图表库 div 形态 + compaction 竖线）
  const curve = CG.deltaCurveHtml(CG.computeGaugeSeries(ROWS));
  assert.ok(curve.includes('compaction 边界'), '增量曲线 hover 载荷含 compaction 边界标注');
  assert.ok(curve.includes('width:2px'), 'compaction 竖线（2px 竖标记）');
  assert.ok(curve.includes('回退行'), '回退行在曲线 hover 载荷中如实标注');
  const summary = CG.dropSummaryHtml(CG.compactDrops(CG.computeGaugeSeries(ROWS)));
  assert.ok(summary.includes('回落'), '回落摘要含「回落」');
  assert.ok(summary.includes('→'), '回落摘要为前后对比形态（before → after）');
  assert.ok(CG.dropSummaryHtml([]) === '', '无边界 → 摘要为空');
});

test('C2-5: sessions.js renderContext 四要素——SSE 订阅 / 增量曲线 / compaction 边界竖线 / 回落摘要', () => {
  const src = readPublic('views/sessions.js');
  // ① live 水位条：SSE 订阅既有通道（复用不加新通道，C2-7 联动）
  assert.ok(src.includes('/api/live/events'),
    'renderContext 须订阅 /api/live/events 的 model 行');
  assert.ok(src.includes('context-gauge?limit=100'),
    '水位区种子须走 GET /api/sessions/:id/context-gauge?limit=100');
  // ② 逐轮增量曲线
  assert.ok(src.includes('增量曲线'), '水位区须含逐轮增量曲线锚');
  assert.ok(src.includes('deltaCurveHtml'), '增量曲线经组件渲染 helper');
  // ③ compaction 边界竖线
  assert.ok(src.includes('compaction 边界') && src.includes('竖线'),
    '水位区须含 compaction 边界竖线锚');
  // ④ 水位回落摘要
  assert.ok(src.includes('回落摘要'), '水位区须含回落摘要锚');
  assert.ok(src.includes('dropSummaryHtml'), '回落摘要经组件渲染 helper');
  // 空序列出口钉死：规格 C2-5 显式正则（共享组件出口）
  assert.ok(/(window\.)?ZC\.emptyState\(/.test(src),
    'sessions.js 水位区空序列须命中 /(window\\.)?ZC\\.emptyState\\(/');
  // 口径说明文案义务（C2-9 评审锚的机检面）
  assert.ok(src.includes('水位随已落库请求推进、生成中不跳动'),
    '水位区须含「水位随已落库请求推进、生成中不跳动」口径说明');
  assert.ok(src.includes('非官方权威'), '水位区须含「非官方权威」标注');
  // 幂等 close（overview.js:453 同步 close 先例——杜绝孤儿 EventSource）
  assert.ok(/closeGaugeLive\(\)/.test(src) && /gaugeEs\.close\(\)/.test(src),
    'live 订阅须有幂等 close 路径');
});

test('C2-5: context-gauge.js 无硬编码色值（#hex / rgb( / hsl( / 具名色 0 命中，色值走 var(--sev-*)）', () => {
  const src = readPublic('context-gauge.js');
  assert.ok(!/#[0-9a-f]{3,6}/.test(src),
    'context-gauge.js 不得含 #[0-9a-f]{3,6} 色值字面量');
  assert.ok(!/rgba?\(/.test(src),
    'context-gauge.js 不得含 rgb(/rgba( 函数记法色值');
  assert.ok(!/hsla?\(/.test(src),
    'context-gauge.js 不得含 hsl(/hsla( 函数记法色值');
  assert.ok(!NAMED_COLORS.test(src),
    'context-gauge.js 不得含 CSS 具名色单词（red/green/…/gold 名单）');
  // severity 三档通道存在（styles.css 既有 var(--sev-ok/warn/err)，双主题同源；
  // 双端模块不经 window.ZC.cssVar 取值——node 侧无 getComputedStyle，颜色以
  // var(--*) 引用交浏览器绘制期解析，主题切换自动生效）
  assert.ok(src.includes('var(--sev-'),
    'context-gauge.js 档位色须走 var(--sev-*) 主题变量');
});

test('C2-5: index.html 引入形态 + 挂载责任单点（app.js 不含挂载赋值）', () => {
  const html = readPublic('index.html');
  assert.ok(html.includes('<script src="/context-gauge.js">'),
    'index.html 须含 <script src="/context-gauge.js">（单一可机检形态）');
  assert.ok(html.indexOf('/context-gauge.js') < html.indexOf('/views/overview.js'),
    'context-gauge.js 须置于 views script 之前');
  assert.ok(html.indexOf('/context-gauge.js') > html.indexOf('/app.js'),
    'context-gauge.js 须置于 app.js 之后（app.js 末行重建 window.ZC）');
  const app = readPublic('app.js');
  assert.ok(!app.includes('window.ZC.ContextGauge ='),
    'app.js 不得含 window.ZC.ContextGauge = 挂载赋值（挂载责任单点在组件文件自身）');
  const cg = readPublic('context-gauge.js');
  assert.ok(cg.includes('root.ZC.ContextGauge = factory()'),
    'context-gauge.js browser 分支须自挂 window.ZC.ContextGauge');
});

test('C2-6: widget.html「缓存命中」副行渲染 + null→「—」分支（纯渲染不计算）', () => {
  const src = readPublic('widget.html');
  assert.ok(src.includes('缓存命中'), 'widget.html hover 卡须含「缓存命中」副行');
  assert.ok(src.includes('cache_hit_rate'), '副行读响应侧算好的 cache_hit_rate');
  assert.ok(src.includes("'—'"), 'null/undefined → 「—」（共享 formatter null 语义）');
  assert.ok(src.includes('Math.round(d.cache_hit_rate * 100)'),
    '数值经 Math.round(rate*100)+% 呈现（纯渲染，不在前端算比率）');
});

test('C2-7: server/ 递归 text/event-stream 出现次数恰为 2（live.js 与 index.js 各一）', () => {
  const serverDir = path.join(__dirname, '..', 'server');
  const perFile = {};
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile()) {
        const n = (fs.readFileSync(p, 'utf8').match(/text\/event-stream/g) || []).length;
        if (n) perFile[path.relative(serverDir, p).replace(/\\/g, '/')] = n;
      }
    }
  };
  walk(serverDir);
  const total = Object.values(perFile).reduce((a, b) => a + b, 0);
  assert.equal(total, 2, `SSE 写头点须恰为 2（实测分布 ${JSON.stringify(perFile)}）——水位 live 复用既有通道，不加新 SSE 通道`);
  assert.equal(perFile['routes/live.js'], 1, 'live.js 恰一处');
  assert.equal(perFile['index.js'], 1, 'index.js 恰一处');
});

test('C2-4（renderList 部分）: mini 条渲染段 +「未知模型不显百分比」「无 model 行不渲染」两分支锚', () => {
  const src = readPublic('views/sessions.js');
  assert.ok(src.includes('miniGaugeHtml'), 'renderList 须含 mini 条渲染段（组件 helper）');
  assert.ok(src.includes('latest_model'), 'mini 条数据面走 sessionList latest_model 三字段');
  // 分支一：未知模型（context_tokens===null）→ 条可渲染但不显百分比
  assert.ok(src.includes('未知模型') && src.includes('不显百分比'),
    'renderList 须含「未知模型…不显百分比」分支锚');
  // 分支二：无 model 行会话（model_id===null）→ 不渲染 mini 条（空数据形状钉死）
  assert.ok(src.includes('无 model 行') && src.includes('不渲染'),
    'renderList 须含「无 model 行…不渲染」分支锚');
  assert.ok(/lm\.model_id != null/.test(src),
    '不渲染分支须以 model_id 判空实现（空数据形状钉死，不留实施歧义）');
});
