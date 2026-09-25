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

// plans:370 点名的 live 边界钉（I-码-2 评审修复）：SSE model 行缺 cache 两列
//（recentModelRowsAfterRowid 载荷形态——undefined 而非 0）→ 分子 null、绝不按
// 0 计（JS 语义 null/N === 0，仅判 context_tokens 会把缺列行算成 0% 占用）；
// delta 不产出、下一行相对最近已知分子；currentLevel 末行缺列 → 维持上一已知
// 读数并标 unavailable。
test('C2-3: live 缺列行（input=0 且 cache 两列 undefined）分子 null、不按 0 计', () => {
  const series = CG.computeGaugeSeries([
    base({ turn_id: 'v1', input_tokens: 300 }),
    { // SSE live 行形态：无 cache 两列（键不存在），input=0（error/cancelled 全零行）
      started_at: '2026-09-25T10:01:00Z', turn_id: 'v2', model_id: 'GLM-5.1',
      query_source: 'main_turn', input_tokens: 0, context_tokens: WIN,
    },
    base({ turn_id: 'v3', input_tokens: 500 }),
  ]);
  assert.strictEqual(series[1].molecule, null, '缺列行分子 null（缺列即未知，不按 0 计）');
  assert.strictEqual(series[1].ratio, null, '分子 null → ratio null（显式判空，不得 0/N===0）');
  assert.strictEqual(series[1].delta, null, '缺列行不产出 delta（按 0 计会得 -300 大负值）');
  assert.strictEqual(series[1].fallback, false, '缺列行不是回退估算行');
  assert.strictEqual(series[2].delta, 200, '下一行相对最近已知分子（500-300），缺列行不进基准');
  // currentLevel：末行缺列 → 不推进水位，回退最近已知分子并标 unavailable
  const lvl = CG.currentLevel(series.slice(0, 2));
  assert.strictEqual(lvl.unavailable, true, '末行分子不可得须如实标注');
  assert.equal(lvl.molecule, 300, '水位维持上一已知读数');
  assert.equal(lvl.ratio, +(300 / WIN).toFixed(4));
  // 全序列无已知分子（首行即缺列）→ 分子 null 空读数（不伪造 0）
  const allUnknown = CG.currentLevel(CG.computeGaugeSeries([
    { started_at: '2026-09-25T10:00:00Z', turn_id: 'z1', model_id: 'GLM-5.1',
      query_source: 'main_turn', input_tokens: 0, context_tokens: WIN },
  ]));
  assert.strictEqual(allUnknown.molecule, null);
  assert.strictEqual(allUnknown.unavailable, true);
  // compact 回落任一侧分子不可得 → dropTokens null（token 差无从算，不猜）
  const mixed = CG.computeGaugeSeries([
    base({ turn_id: 'c1', input_tokens: 5000, query_source: 'compact', compact_boundary: true }),
    { started_at: '2026-09-25T10:02:00Z', turn_id: 'c2', model_id: 'GLM-5.1',
      query_source: 'main_turn', input_tokens: 0, context_tokens: WIN },
  ]);
  assert.strictEqual(CG.compactDrops(mixed)[0].dropTokens, null, '后行分子不可得 → dropTokens null');
  // 渲染面：缺列行 hover 载荷如实标注（曲线不显假 0、不误标首行——缺列行
  // delta 同为 null 但非首行，I-码-7 三分支钉）
  const curve = CG.deltaCurveHtml(series);
  assert.ok(curve.includes('分子不可得'), '缺列行 hover 标注「分子不可得」');
  const v2Col = curve.split('title="')[2]; // 第二列即缺列行 v2（构造序 v1,v2,v3）
  assert.ok(v2Col.includes('增量 —（分子不可得）'), '缺列行增量文案为「分子不可得」三态分支');
  assert.ok(!v2Col.includes('（首行）'), '中段缺列行不得误标「（首行）」');
  assert.ok(curve.split('title="')[1].includes('增量 —（首行）'), '真首行仍标「（首行）」');
});

// SSE 防重叠闸（I-测-3 评审钉；F-码-3/F-败-3 六席终审改行序基准）：闸静默失效
// 会双计污染增量曲线。行序（rowid）三态：live.js 每连接水位是连接时刻的
// MAX(rowid)（不回放），闸以末种子行 rid 判重——rid 更大才是真增量；started_at
// 时间闸的两个误伤（同毫秒 rowid 更新的真新行 / started_at 早于种子但晚落库的
// 长请求行——从未进种子）在行序基准下均正确接受。
test('C2-3: shouldAcceptLiveRow 行序三态——rid≤末种子行跳过/更大接受/缺 rid 兜底', () => {
  assert.equal(CG.shouldAcceptLiveRow(500, { rid: 500 }), false,
    '等于末种子行 rid → 跳过（种子已含的行再从流里到达，双计）');
  assert.equal(CG.shouldAcceptLiveRow(500, { rid: 499 }), false,
    '小于末种子行 rid → 跳过（同上）');
  assert.equal(CG.shouldAcceptLiveRow(500, { rid: 501 }), true,
    'rid 更大 → 接受（真增量——含同毫秒行与晚落库的长请求行）');
  assert.equal(CG.shouldAcceptLiveRow(500, {}), true,
    'live 行缺 rid → 兜底接受（无法判序时不丢行）');
  assert.equal(CG.shouldAcceptLiveRow(0, { rid: 1 }), true,
    '无种子（空会话首行）→ 接受');
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
  // SSE 防重叠闸经组件纯函数（I-测-3 钉：闸失效=双计污染增量曲线，消费面
  // 必须走 shouldAcceptLiveRow——直测见 C2-3 纯函数用例）
  assert.ok(src.includes('shouldAcceptLiveRow'),
    'startGaugeLive 须消费组件导出的 shouldAcceptLiveRow 防重叠闸');
  // 末行分子不可得的视图消费锚（I-测-10 钉）：unavailable 分支的 sub 文案
  // 拼接——水位维持上一已知读数并如实标注（组件纯函数已直测，此处钉接线）。
  assert.ok(src.includes('lvl.unavailable') && src.includes('分子不可得'),
    '水位区 sub 文案须消费 lvl.unavailable 并标注「分子不可得」');
});

// 六席终审修复轮（F-码-3/4、F-败-2/3/4）的 sessions.js 源码契约——接线点无
// DOM 行为面（无 jsdom），源码形态锁住不回归（本文件既有形态）。
// F-码-8（六席终审第 2 轮）：曲线列数截断——长开标签下种子 100 + live 有界
// 累积可达数百行，亚像素列宽不可读；maxCols 超限时只渲最近 N 列、左端「+k」
// 占位如实标示，hover 序号用全局序号（截断后仍可对账行位）。缺省不截断
//（既有消费面零变化）。
test('F-码-8: deltaCurveHtml maxCols——截断占位/全局序号/缺省不截断', () => {
  const series = CG.computeGaugeSeries(Array.from({ length: 6 }, (_, i) =>
    base({ turn_id: 't' + i, input_tokens: 100 + i * 10 })));
  const cut = CG.deltaCurveHtml(series, { maxCols: 4 });
  assert.ok(cut.includes('+2'), '被截 2 行须有「+2」占位列');
  assert.ok(cut.includes('更早 2 行'), '占位列 hover 须如实说明被截段');
  assert.ok(cut.includes('#5'), '截断后首列 hover 序号为全局 #5');
  assert.ok(!cut.includes('#1'), '被截行不得渲染（无 #1）');
  // 缺省（不传 maxCols）：无截断占位，全列渲染（既有行为零变化）
  const full = CG.deltaCurveHtml(series);
  assert.ok(!/更早 \d+ 行/.test(full), '未传 maxCols 不得截断');
  assert.ok(full.includes('#1') && full.includes('#6'), '全列渲染序号连续');
  // 恰等于上限：不截断（> 才截）
  const exact = CG.deltaCurveHtml(series, { maxCols: 6 });
  assert.ok(!/更早 \d+ 行/.test(exact), '恰等于上限不截断');
});

test('终审钉: rowid 防重叠闸接线 + 代际 token 防孤儿 EventSource + 种子失败/空区分 + tool 帧自愈', () => {
  const src = readPublic('views/sessions.js');
  // F-码-3/F-败-3：闸按行序——末种子行 rid（非 started_at），SSE 行载荷 rid 比对。
  assert.ok(src.includes('lastSeedRid'),
    '防重叠闸须以末种子行 rid 为闸（rowid 行序，非 started_at 时间闸）');
  assert.ok(!src.includes('lastSeedAt'),
    '不得保留 started_at 时间闸旧形态（同毫秒误丢/晚落库长请求误弃）');
  // F-码-4：代际 token——renderContext 入口自增，在途取数完成后比对自弃，
  // 防跨会话竞态覆写 gaugeEs 单槽成孤儿连接。
  assert.ok(/\+\+gaugeGen/.test(src) && /gen !== gaugeGen/.test(src),
    'renderContext 须有代际 token 与迟到自弃守卫（防孤儿 EventSource）');
  // F-败-2：种子取数失败渲染错误卡（emptyState），与「该会话没有模型调用行」
  // 空态文案区分——静默折叠成空=失败与空不可辨。
  assert.ok(src.includes('failed: true') && src.includes('取数失败'),
    '种子取数失败须置 failed 标记并渲染错误卡（区分失败与空）');
  // F-败-4：tool 帧自愈守卫——model 帧守卫之外的第二触发面（纯工具活动时段）。
  assert.ok(/addEventListener\('tool'/.test(src) && /addEventListener\('model'/.test(src),
    '水位 live 订阅须 model+tool 双帧自愈守卫');
  // F-码-8：live 行有界累积——超软上限丢最旧（种子 100 行设计对齐），防长开
  // 标签序列数千行、每条新行 O(n) 全量重渲；曲线呈现列数上限接线。
  assert.ok(src.includes('GAUGE_LIVE_ROWS_CAP')
    && /liveRows\.splice\(0, liveRows\.length - GAUGE_LIVE_ROWS_CAP\)/.test(src),
    'liveRows 须有界累积（超 2× 种子上限丢最旧 live 行）');
  assert.ok(/deltaCurveHtml\(series, \{ maxCols: GAUGE_CURVE_MAX_COLS \}\)/.test(src),
    '增量曲线须经 maxCols 列数上限渲染（最近 N 列 + 「+k」占位）');
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

// ── XSS 黑盒（四席全量审查轮 SEC-安-2，2026-09-25）──
// context-gauge 的 HTML 构建器（gauge/mini/曲线）消费库内字符串（模型名等），
// 此前只有源码契约钉（escapeHtml 字面形态）——重构改名会静默失效。本例以
// 实际载荷过构建器断言输出无裸注入向量（视图锁 IIFE 的 usage/attribution 面
// 维持源码钉；UMD 双端导出的本组件走黑盒——freshness.test.js C9-3 对
// emptyState 的同款已存在，两处合围共享组件面）。
test('SEC-安-2: HTML 构建器对模型名/title 载荷全转义（无裸 <img 注入向量）', () => {
  const PAYLOAD = '<img src=x onerror=alert(1)>';
  const bar = CG.gaugeBarHtml(0.5, { title: PAYLOAD });
  assert.ok(!bar.includes('<img'), 'gaugeBarHtml title 不得含裸 <img');
  assert.ok(bar.includes('&lt;img'), '载荷须以转义形态出现');

  const mini = CG.miniGaugeHtml(100, 200, { title: PAYLOAD });
  assert.ok(!mini.includes('<img') && mini.includes('&lt;img'),
    'miniGaugeHtml opts.title 同款全转义');

  const curve = CG.deltaCurveHtml([
    { started_at: 1_800_000_000_000, model_id: PAYLOAD, molecule: 100, delta: 50 },
    { started_at: 1_800_000_060_000, model_id: 'GLM-5.1', molecule: 150, delta: 50 },
  ]);
  assert.ok(!curve.includes('<img'), 'deltaCurveHtml hover bits（model_id）不得含裸 <img');
  assert.ok(curve.includes('&lt;img'), 'model_id 载荷须以转义形态出现');
});
