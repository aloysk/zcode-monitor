'use strict';
// test/counter-autorefresh.test.js — 计数自动刷新源码契约（frontend-contract /
// shell-mode-mutex 同款形态：浏览器态 IIFE 无可跑 DOM 面，用源码形态锁行为）。
//
// 2026-09-27 用户实锤：overview 速度卡「主/子agent(含工作流)」等计数与
// sessions 详情「子 Agent N 个」只在页面/tab 加载时查询一次——SSE 只喂
// 活动 feed，计数完全冻结，观感即「不准/延时非常久」。修复形态：
// overview 5s 全量重拉（段级 JSON 比较防闪）+ Agents tab 5s 轮询。
// 本文件钉住：定时间隔、三重生命周期守卫（入口清理/回调自停/在途跳过）、
// 防闪比较、失败静默、空态可翻页——逐条对应变异点（删守卫/改间隔/退回
// 直调渲染/空态 early return 均须红）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const readPublic = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');

// ── overview.js ────────────────────────────────────────────────────────────

test('契约: overview 计数 5s 自动刷新——间隔常量与定时器接线', () => {
  const src = readPublic('views/overview.js');
  // 间隔字面量 5000（改慢即回归：用户期待的秒级刷新）
  assert.ok(/const OV_REFRESH_MS = 5000;/.test(src), 'OV_REFRESH_MS 须为 5000（秒级刷新契约）');
  assert.ok(/autoTimer = setInterval\(autoRefresh, OV_REFRESH_MS\);/.test(src),
    'view 存续期须挂 autoRefresh 定时器');
});

test('契约: overview 自动刷新三重生命周期守卫', () => {
  const src = readPublic('views/overview.js');
  // 入口清理：view() 重入摘旧定时器（防重复定时器堆叠打库）
  assert.ok(/stopAutoRefresh\(\);\s*\n\s*destroyCharts\(\);/.test(src),
    'view() 入口须在重建前 stopAutoRefresh');
  // 回调自停：视图切走（#kpis 不在 DOM）即停——refreshSnapshot 同款第二道防线
  assert.ok(/if \(!\$\('#kpis'\)\) \{ stopAutoRefresh\(\); return; \}/.test(src),
    'autoRefresh 须有 #kpis 不在即自停守卫');
  // 在途跳过：上一轮未返回不堆叠请求
  assert.ok(/if \(refreshInFlight\) return;/.test(src), 'autoRefresh 须有在途跳过守卫');
  // stopAutoRefresh 调用恰两处（view 入口 + 回调自停）——多一处少一处都是形态漂移
  const calls = src.match(/stopAutoRefresh\(\);/g) || [];
  assert.strictEqual(calls.length, 2, `stopAutoRefresh() 调用须恰 2 处（view 入口+自停），实测 ${calls.length}`);
});

test('契约: overview 防闪——数据未变的段跳过重渲染（loadOverview 不再直调渲染器）', () => {
  const src = readPublic('views/overview.js');
  // 段级比较存在：六个渲染段必须全部包在 same() 守卫内
  for (const key of ['kpis', 'speed', 'series', 'breakdown', 'recent']) {
    assert.ok(new RegExp(`if \\(!same\\('${key}'`).test(src),
      `渲染段 ${key} 须包在 if (!same('${key}', …)) 防闪守卫内`);
  }
  // kpis 段比较须剔除 since 与 window_ms（两个墙钟衍生字段：since 每轮重算、
  // window_ms=Date.now()−sinceMs 随毫秒抖动——任一不剔除该段比较恒失效，
  // KPI 每 5s 必重渲染。代码席评审 MAJOR 实锤后补钉）
  assert.ok(/delete kpisCore\.since;/.test(src) && /delete kpisCore\.window_ms;/.test(src),
    'kpis 段比较前须 delete since 与 window_ms 字段');
  // loadOverview 本体只做取数+分发（直调 renderKpis = 防闪被旁路，闪/打断回归）
  const loadBody = src.match(/async function loadOverview\(force\) \{[\s\S]*?\n  \}/);
  assert.ok(loadBody, 'loadOverview(force) 函数形态须在');
  assert.ok(!/renderKpis\(/.test(loadBody[0]), 'loadOverview 不得直调 renderKpis（须经 renderOverview 的防闪比较）');
  // 手动/首载/主题路径走 force=true（恰 4 处：首载/手动刷新/切窗/主题——
  // 测试席 V1/V7：forceCalls>=3 抓不住「自动路径被改成 force」的后门）
  const forceCalls = src.match(/loadOverview\(true\)/g) || [];
  assert.strictEqual(forceCalls.length, 4, `loadOverview(true) 须恰 4 处（首载/手动/切窗/主题），实测 ${forceCalls.length}`);
  // 自动刷新路径必须不带 force——带 force 即防闪全灭（每 5s 全段重渲）
  assert.ok(/try \{ await loadOverview\(\); \}/.test(src), 'autoRefresh 须调 loadOverview()（不带 force）');
});

test('契约: overview 防闪有效性——same() 稳态可命中（V2/V3/V5 补钉）', () => {
  const src = readPublic('views/overview.js');
  // V2: lastPayload.window 的赋值行删掉 → same() 恒 false → 第 2 拍起永久全量重渲
  assert.ok(/if \(!lastPayload\.window \|\| lastPayload\.window !== w\) lastPayload\.window = w;/.test(src),
    'renderOverview 须同步 lastPayload.window（否则防闪比较稳态恒失效）');
  // V3: wideTick 复位删掉 → 7d 档 30s 后退回 5s 全量重拉（性能红线静默复发）
  assert.ok(/^ {4}wideTick = 0;$/m.test(src), 'autoRefresh 宽窗分支须复位 wideTick');
  // V5: 在途标志置位行（只钉检查行不钉置位 = 守卫恒不触发）
  assert.match(src, /refreshInFlight = true;/);
  assert.strictEqual((src.match(/refreshInFlight/g) || []).length, 4,
    'refreshInFlight 须恰 4 处（声明/置位/检查/复位）');
});

test('契约: overview 自动刷新失败静默——不弹 errorCard、不清已有渲染', () => {
  const src = readPublic('views/overview.js');
  const auto = src.match(/async function autoRefresh\(\) \{[\s\S]*?\n  \}/);
  assert.ok(auto, 'autoRefresh 函数形态须在');
  assert.ok(/catch \(e\) \{ console\.warn\(/.test(auto[0]), 'autoRefresh 失败须 console.warn 留痕');
  assert.ok(!/errorCard/.test(auto[0]), 'autoRefresh 失败不得弹 errorCard（瞬时故障不清空监控页）');
  assert.ok(/finally \{ refreshInFlight = false; \}/.test(auto[0]), '在途标志须 finally 复位（异常路径不得卡死在途守卫）');
});

// ── sessions.js Agents tab ──────────────────────────────────────────────────

test('契约: Agents tab 子代理计数 5s 轮询——间隔常量与定时器接线', () => {
  const src = readPublic('views/sessions.js');
  assert.ok(/const AGENTS_POLL_MS = 5000;/.test(src), 'AGENTS_POLL_MS 须为 5000');
  assert.ok(/agentsTimer = setInterval\(/.test(src), 'renderAgents 须挂轮询定时器');
});

test('契约: Agents tab 轮询生命周期——view/loadTab 入口停 + 回调双重 alive 复查', () => {
  const src = readPublic('views/sessions.js');
  // view() 与 loadTab() 入口统一停（注释锚 + 调用形态分别钉）
  assert.ok(/stopAgentsPoll\(\); \/\/ 同上：摘掉 Agents tab 可能存续的轮询定时器/.test(src),
    'view() 入口须 stopAgentsPoll');
  assert.ok(/stopAgentsPoll\(\); \/\/ 切 tab 统一先停旧轮询/.test(src),
    'loadTab() 入口须 stopAgentsPoll');
  // 回调进入与 await 返回后各查一次 alive（在途响应回来时 tab 已切——
  // 不复查会以旧数据覆写新 tab 的 #tab-body）
  const guardCalls = src.match(/if \(!alive\(\)\) \{ stopAgentsPoll\(\); return; \}/g) || [];
  assert.strictEqual(guardCalls.length, 2,
    `alive() 自停守卫须恰 2 处（回调进入+await 后复查），实测 ${guardCalls.length}`);
  // 初始取数迟到自弃（loadTab 已把 body 换成 loading，迟到 render 会覆写新 tab）
  assert.ok(/if \(!alive\(\)\) return; \/\/ 取数在途期间已切走/.test(src),
    'renderAgents 初始取数后须有 alive 自弃');
  // 代际守卫（gaugeGen 同款）：setInterval 在 await 后执行，交叠调用会孤儿化
  // 定时器——入口 ++agentsGen + alive() 内含 gen 比对，旧实例整批自弃
  assert.ok(/let agentsGen = 0;/.test(src), '须有 agentsGen 代际 token');
  assert.ok(/const gen = \+\+agentsGen;/.test(src), 'renderAgents 入口须自增代际');
  assert.ok(/gen === agentsGen/.test(src), 'alive() 须含代际比对（孤儿定时器防御）');
});

test('契约: overview view() 代际守卫——交叠重入不装配孤儿定时器', () => {
  const src = readPublic('views/overview.js');
  assert.ok(/let viewGen = 0;/.test(src), '须有 viewGen 代际 token');
  assert.ok(/const gen = \+\+viewGen;/.test(src), 'view() 入口须自增代际');
  assert.ok(/if \(gen !== viewGen\) return; \/\/ 交叠重入/.test(src),
    'await 取数后须有代际自弃（autoTimer/snapTimer/themeHandler 均在其后装配）');
});

test('契约: loadOverview 窗一致性守卫——在途响应不得覆写切窗后的新窗', () => {
  const src = readPublic('views/overview.js');
  // 代码席评审 MINOR：autoRefresh(24h) 在途时用户切 7d，旧窗响应晚到若照常
  // 渲染＝select 显 7d、页面显 24h。await 后回读 select 不一致即丢弃。
  assert.ok(/\$\('#ov-window'\)\.value !== w\) return;/.test(src),
    'loadOverview 取数返回后须回读窗 select，与发出时不一致即自弃');
});

test('契约: Agents tab 防闪与空态翻页', () => {
  const src = readPublic('views/sessions.js');
  // 数据相同跳过（删守卫 = 每 5s 重渲染打断 hover/文本选择）
  assert.ok(/if \(j === lastJson\) return; \/\/ 数据相同跳过/.test(src),
    '轮询回调须有数据相同跳过守卫');
  // 空态/表格同门渲染：空态在 render 闭包内（early return 后不再轮询翻页 = 回归）
  assert.ok(/const render = \(children\) => \{[\s\S]{0,120}if \(!children\.length\)/.test(src),
    '空态分支须在 render 闭包内（未派生→派生了须能翻页）');
  assert.ok(/render\(data\.children\);/.test(src), '初始渲染须经统一 render 路径');
  // 轮询失败静默保留旧表
  assert.ok(/console\.warn\('\[sessions\] 子 agent 列表轮询失败/.test(src),
    '轮询失败须 console.warn 留痕（不弹 errorCard）');
});

test('契约: Agents tab 在途守卫——重会话 enrich 慢时不堆叠在途请求', () => {
  const src = readPublic('views/sessions.js');
  // 性能席 CRITICAL 发现 ③：路由 enrich 在重会话上可达秒级，无守卫的轮询
  // 每 5s 再进一个 tick 排队串行处理。overview refreshInFlight 同款。
  // V5 补钉：置位/检查/复位三面齐（只钉检查行不钉置位 = 守卫恒不触发）。
  assert.match(src, /pollInFlight = true;/);
  assert.ok(/if \(pollInFlight\) return;/.test(src), '轮询回调须有在途跳过守卫');
  assert.ok(/finally \{ pollInFlight = false; \}/.test(src), '在途标志须 finally 复位');
});

test('契约: Agents tab 防闪基线更新与双路渲染（V4/V6 补钉）', () => {
  const src = readPublic('views/sessions.js');
  // V4: 轮询回调删 lastJson = j → 基线冻结在初始值 → 数据首次变化后每拍恒重渲
  assert.match(src, /^ {8}lastJson = j;$/m, '轮询回调须更新 lastJson 基线');
  // V6: 轮询路径与初始路径同走 render 闭包（两路内联漂移 = 标题口径/徽标改一处漏一处）
  assert.ok((src.match(/render\(d\.children\);/g) || []).length === 1
    && (src.match(/render\(data\.children\);/g) || []).length === 1,
    '初始/轮询两路渲染须同走 render(children)');
});

test('契约: Agents tab 标题拆活跃/等待——「多少在工作」可读（累计口径澄清）', () => {
  const src = readPublic('views/sessions.js');
  // 用户实锤：总数 20+ 被误读为并发（账号上限 15）——标题须写明「累计派生」
  // 且拆出活跃/等待计数（C6 逐子代理信号消费）
  assert.ok(/累计派生 \$\{children\.length\} 个/.test(src), '标题须标明「累计派生」口径');
  assert.ok(/c\.signal && c\.signal\.state === 'working'/.test(src), '活跃计数须消费 signal.state');
  assert.ok(/c\.signal && c\.signal\.state === 'waiting'/.test(src), '等待计数须消费 signal.state');
  assert.ok(/signalBadgesHtml\(c\.signal\)/.test(src), '行内须渲染信号徽标（同源组件）');
});

test('契约: 服务端 children 附逐子代理信号（C6 同源）+ enrich 单遍缓存', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'sessions.js'), 'utf8');
  // 信号合并与列表路由同款（sessionsWithSignals 寻址域），四字段形状
  assert.ok(/sessionsWithSignals\(\{\s*\n\s*sinceMs: Date\.now\(\) - SIGNALS_WINDOW_MS,\s*\n\s*sessionIds: children\.map/.test(src),
    'children 路由须以寻址域调 sessionsWithSignals');
  assert.ok(/signal: sig \? \{/.test(src) && /state: sig\.state/.test(src),
    'child 项须附 signal 四字段');
  // O(N) 单遍 + mtime/TTL 缓存（性能席 CRITICAL 修复主体）
  assert.ok(/function childMetaIndex\(parentDir\)/.test(src), '须有单遍索引函数 childMetaIndex');
  assert.ok(/byChild\.get\(c\.id\)/.test(src), 'enrich 须查 Map 而非内层重扫目录');
  assert.ok(/CHILD_META_CACHE_MAX = 200;/.test(src) && /CHILD_META_TTL_MS = 60_000;/.test(src),
    '缓存须有界（200 键）+ TTL（60s）');
});

test('契约: overview 7d 宽窗分频——重窗不按 5s 全量重拉', () => {
  const src = readPublic('views/overview.js');
  // 性能席 MAJOR：7d 档热态 1.4-2s/请求（27-40% 占空比），5s 全量越红线
  // 纪律——固定 5s 心跳下每 6 拍（30s）才执行一次重拉。
  assert.ok(/const OV_WIDE_SKIP_TICKS = 6;/.test(src), '须有宽窗跳拍常量（30s 陈旧上限）');
  assert.ok(/w === '7d' && \+\+wideTick < OV_WIDE_SKIP_TICKS\) return;/.test(src),
    'autoRefresh 须对 7d 档跳拍（删守卫=7d 恢复 5s 全量重拉即回归）');
});
