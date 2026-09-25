'use strict';
// test/signals-view.test.js — C6 前端消费面（T3）的源码契约 + pet-state 行为
// 单测（spec 验收 C6-4 / C6-6）。readPublic 形态沿 frontend-contract.test.js
// 先例：断言浏览器实际加载的那份源文件（无构建器，无副本漂移面）；pet-state.js
// 经 node require 直测行为（双端导出，pet-state.test.js 同款纪律——本文件只补
// permission 接线面，既有 A4 契约继续由 pet-state.test.js 各自守护）。
//
// 「新增 signal 代码段」的提取范围钉（spec C6-4 范围钉：sessions.js 既有
// pending 字样均非 approval 语义且在范围外，整文件断言必挂）：
//   - sessions.js：C6 徽标注释块起 → renderListActive 之前（徽标/置顶/组头/
//     renderList/renderListRow 全在内，renderContext 的 orphan 归并局部变量
//     与 renderTasks 的 todo 状态色映射在外）；
//   - app.js：signalsLoop 段 + waiting-chip 点击绑定段；
//   - index.html：C6 chip 注释块 → 元素行；
//   - pet.html：WAITING_HOLD_MS 常量段 + poll 内 summary fetch 段。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const readPublic = (name) => fs.readFileSync(path.join(PUB, name), 'utf8');
const readRepo = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const PS = require(path.join(PUB, 'pet-state.js'));

// ── 提取器：C6 新增 signal 代码段（范围钉见头注）─────────────────────────
function signalSegments() {
  const sessions = readPublic('views/sessions.js');
  const app = readPublic('app.js');
  const index = readPublic('index.html');
  const pet = readPublic('pet.html');
  const seg = (src, startMarker, endMarker) => {
    const s = src.indexOf(startMarker);
    const e = src.indexOf(endMarker);
    assert.ok(s >= 0 && e > s, `提取锚缺失：${startMarker.slice(0, 24)}…`);
    return src.slice(s, e);
  };
  return {
    sessions: seg(sessions, '// ── C6 会话状态徽标', 'function renderListActive()'),
    appLoop: seg(app, '// C6 顶栏 waiting chip', "document.addEventListener('DOMContentLoaded'"),
    appBind: seg(app, '// C6 waiting chip 跳转', '  // Checkpoint button:'),
    chip: seg(index, '<!-- C6 顶栏 waiting chip', 'aria-label="会话等待中，点击查看"></a>'),
    petConst: seg(pet, '// C6 waiting hold', 'const WAITING_HOLD_MS ='),
    petPoll: seg(pet, '// C6 waiting 行：随 poll 通道', "  } catch { /* silent: dead server keeps the last known mood */ }"),
  };
}

// ── C6-4：sessions 列表三态徽标 + broken 叠加（源码契约）──────────────────
test('C6-4: renderList 含三态徽标与 broken 叠加渲染；broken 会话三态位=idle 形态', () => {
  const seg = signalSegments().sessions;
  // 三态位：working/waiting/idle 三分支 + 缺失守卫（旧缓存/旧服务不渲染不抛错）
  assert.ok(seg.includes('function signalBadgesHtml'), 'signalBadgesHtml 渲染函数在案');
  assert.ok(seg.includes("if (!sig || !sig.state) return '';"),
    'signal 字段缺失守卫在案（装饰性元素不得拖垮列表）');
  assert.ok(seg.includes('>working</span>'), 'working 三态位在案');
  assert.ok(seg.includes('>waiting</span>'), 'waiting 三态位在案');
  assert.ok(seg.includes('>idle</span>'), 'idle 三态位在案');
  // broken 三态位=idle 形态钉：threeState 三元只判 working/waiting，broken 落
  // 兜底分支（渲染 idle）；broken 可见性由叠加徽标独占。
  const three = seg.slice(seg.indexOf('const threeState'), seg.indexOf('const broken ='));
  assert.ok(!three.includes('broken'), '三态位分支不含 broken（broken 落 idle 兜底）');
  assert.ok(three.includes('>idle</span>'), '三态位兜底分支渲染 idle 形态');
  assert.ok(seg.includes("sig.state === 'broken'") && seg.includes('>broken</span>'),
    'broken 叠加徽标独占可见性');
});

test('C6-4: waiting 徽标低置信形态＝虚线描边 + 置信标注 hover 文案（「启发式」锚）', () => {
  const seg = signalSegments().sessions;
  const waiting = seg.slice(seg.indexOf("sig.state === 'waiting'"), seg.indexOf('>waiting</span>'));
  assert.ok(waiting.includes('border-style:dashed'),
    'waiting 徽标虚线描边（低置信形态）在案');
  // hover title 固定文案照抄 spec §2.1 需求 4（含「启发式」grep 锚）
  assert.ok(seg.includes('SIGNAL_WAIT_TITLE'), '置信标注常量在案');
  assert.ok(seg.includes('启发式判定：最近一次模型活动正常收尾且当前无在飞请求'),
    '置信标注 hover 文案（spec 照抄前半）在案');
  assert.ok(seg.includes('——数据面无权限等待信号源，判定为时间启发式（可能误报）'),
    '置信标注 hover 文案（spec 照抄后半）在案');
});

// ── C6-4：needs-attention 置顶——已按 C6-8 降级处置摘除（降级态契约）─────
// 处置链：48h 回放 580 样本误报 41.2% > 20% 线 → 收窗 8min 重测 47.8% 反升
// → spec §2.1 需求 7 降级条款（置顶摘除、徽标与置信标注保留），详见
// round2-batch2-explain-timing.md C6-8 节与 residuals R-28。本用例钉降级
// 落实：置顶分区代码不在案（防悄悄回潮）+ 降级注记在案（决策可追溯）。
test('C6-4（降级态）: needs-attention 置顶分组已按 C6-8 处置摘除，注记在案', () => {
  const src = readPublic('views/sessions.js');
  assert.ok(!src.includes('const attention = items.filter'),
    '置顶分区代码不得在案（C6-8 降级处置，residuals R-28）');
  assert.ok(!src.includes('需关注'),
    '置顶组头文案不得在案（同上）');
  const seg = signalSegments().sessions;
  assert.ok(seg.includes('C6-8') && seg.includes('置顶') && seg.includes('R-28'),
    '降级处置注记必须在案（决策与依据可追溯）');
  assert.ok(seg.includes('waiting 徽标与') && seg.includes('置信标注保留'),
    '降级保留面（徽标+置信标注）注记在案');
});

test('C6-4: 新增 signal 代码段不含 approval 语义措辞（「待批/pending」禁令，范围钉）', () => {
  const segs = signalSegments();
  // petPoll 段截到 catch 前（marker 含尾巴），与其余五段一并断言
  for (const [name, seg] of Object.entries(segs)) {
    assert.ok(!/待批|pending/.test(seg), `${name} 段不得含 approval 语义措辞`);
  }
});

// ── C6-4：顶栏 waiting chip 契约（index.html 元素 + app.js 轮询与跳转）─────
test('C6-4: 顶栏 waiting chip——元素在案、summary 30s 轮询、点击跳会话页', () => {
  const segs = signalSegments();
  assert.ok(segs.chip.includes('id="waiting-chip"'), 'chip 元素在案');
  assert.ok(segs.chip.includes('href="#sessions"'), 'chip 链接指向会话页');
  assert.ok(segs.appLoop.includes("getJSON('/api/signals/summary'"), 'summary 轮询取数在案');
  assert.ok(segs.appLoop.includes('s.waiting_count > 0'), 'waiting_count>0 显示判据在案');
  assert.ok(segs.appLoop.includes('30 * 1000'), '30s 轮询周期在案（分钟级信号降频）');
  assert.ok(segs.appLoop.includes('fmtFreshnessLag(s.oldest_waiting_ms'), 'oldest_waiting_ms 显示格式化在案');
  assert.ok(segs.appBind.includes("location.hash = 'sessions'"), 'chip 点击跳转代码在案');
  const app = readPublic('app.js');
  assert.ok(/\bsignalsLoop\(\);/.test(app), 'boot 区 signalsLoop() 启动在案');
  // hidden 生效钉（评审第 1 轮 blocker 同轮加钉）：.badge 的 display:inline-block
  // 会盖过 UA 对 [hidden] 的 display:none——chip 必须复用 .snap-alert 类（styles.css
  // 的 .snap-alert[hidden]{display:none} 兜底），否则 waiting=0 默认态常显空黄徽标。
  assert.ok(segs.chip.includes('class="badge yellow snap-alert"'),
    'chip 复用 snap-alert 类（[hidden] 兜底 + 锚点指针语义，styles.css 零触碰约束内修复）');
  const css = readPublic('styles.css');
  assert.ok(/\.snap-alert\[hidden\]\s*\{\s*display:\s*none;?\s*\}/.test(css),
    'styles.css 的 .snap-alert[hidden] 兜底规则在案（删兜底即挂）');
});

test('C6-4: 服务端装配面——routes/signals.js 存在、index.js 挂 /api/signals', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'server', 'routes', 'signals.js')),
    'server/routes/signals.js 存在（T2 交付）');
  const idx = readRepo('server/index.js');
  assert.ok(idx.includes("app.use('/api/signals'"), '/api/signals 装配在案');
});

// ── C6-6：pet-state permission 接线（行为）────────────────────────────────
const T0 = 1_000_000; // 任意基准时刻（纯函数不取真实时钟，pet-state.test.js 同款）
function state(over = {}) {
  return Object.assign({
    lastActive: T0, gen: false, lanes: 0, errorHoldUntil: 0, comboHoldUntil: 0,
    permHoldUntil: 0,
  }, over);
}

test('C6-6: permHoldUntil 未过期 + gen=false → permission / waiting_permission 行', () => {
  const s = state({ permHoldUntil: T0 + 5_000 });
  assert.equal(PS.computeMood(T0, s), 'permission');
  assert.equal(PS.animFor('permission'), 'waiting_permission');
  // hold 到期回落常规路径（sleep/cruise 判定不受污染）
  const s2 = state({ permHoldUntil: T0 - 1, lastActive: T0 });
  assert.equal(PS.computeMood(T0, s2), 'cruise');
});

test('C6-6: 位次钉——gen 优先于 permission；error/tantrum 压过 permission', () => {
  const s = state({ permHoldUntil: T0 + 5_000 });
  assert.equal(PS.computeMood(T0, { ...s, gen: true }), 'gen',
    '生成画面优先（permission 在 gen 之后）');
  assert.equal(PS.computeMood(T0, { ...s, errorHoldUntil: T0 + 1_000 }), 'error',
    'error 压过 permission');
  assert.equal(PS.computeMood(T0, { ...s, comboHoldUntil: T0 + 1_000 }), 'tantrum',
    'tantrum 压过 permission');
  // sleep 与 permission 的位次：hold 未过期时即便超过入睡阈值也不入睡
  const sleepy = state({ permHoldUntil: T0 + 5_000, lastActive: T0 - PS.SLEEP_AFTER_MS * 10 });
  assert.equal(PS.computeMood(T0, sleepy), 'permission', 'permission 位次在 sleep 之前');
});

test('C6-6: ROW_ANIMS 恒等 9 行且次序与基线一致（9 行契约不动钉）', () => {
  assert.deepStrictEqual(PS.ROW_ANIMS,
    ['idle', 'running_right', 'running_left', 'waving', 'jumping',
     'failed', 'waiting_permission', 'running', 'review']);
});

// ── C6-6：pet.html 轮询接线（源码契约）────────────────────────────────────
test('C6-6: pet.html 含 summary fetch 与 permHoldUntil 推进；WAITING_HOLD_MS ≥ 2×5000', () => {
  const pet = readPublic('pet.html');
  assert.ok(pet.includes("fetch('/api/signals/summary'"), 'summary fetch 在案');
  assert.ok(pet.includes('st.permHoldUntil = Date.now() + WAITING_HOLD_MS'),
    'permHoldUntil 推进代码在案');
  assert.ok(/setInterval\(poll, 5000\)/.test(pet), 'poll 周期 5s 在案（hold 判据的分母）');
  // WAITING_HOLD_MS 提取求值：hold 不得短于两个轮询周期（ERROR_HOLD_MS=4s
  // 形态拒收——hold 在两次 poll 之间失效会让 mood 落 sleep、动画抖动断裂）
  const m = pet.match(/const WAITING_HOLD_MS = ([^;\n]+);/);
  assert.ok(m, 'WAITING_HOLD_MS 常量在案');
  const holdMs = Function('return (' + m[1].replace(/\/\/.*$/, '') + ')')();
  assert.ok(holdMs >= 2 * 5000, `WAITING_HOLD_MS=${holdMs} 须 ≥ 2×5000`);
});
