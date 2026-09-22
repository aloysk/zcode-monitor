'use strict';
// test/pet-state.test.js — 桌宠行为纯决策模块 public/pet-state.js 的行为单测
// （Spec WP4：A4-1 事件→动画、A4-2 惊醒、A4-3 入睡阈值、A4-4 手势不变量、
// A4-6 契约守护）。require 的就是 pet.html <script src="/pet-state.js"> 实际
// 加载的那份文件（双端导出，无副本）；页面接线（script 引用、内联脚本可编译）
// 由 pet-page.test.js 守护。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const PS = require(path.join(__dirname, '..', 'public', 'pet-state.js'));

const T0 = 1_000_000; // 任意基准时刻（纯函数不取真实时钟）

function state(over = {}) {
  return Object.assign({
    lastActive: T0, gen: false, lanes: 0, errorHoldUntil: 0, comboHoldUntil: 0,
  }, over);
}

test('A4-6 契约: ROW_ANIMS 恒等 9 行且顺序固定（含 failed/waiting_permission）', () => {
  assert.deepEqual(PS.ROW_ANIMS,
    ['idle', 'running_right', 'running_left', 'waving', 'jumping',
     'failed', 'waiting_permission', 'running', 'review']);
  // pet.html 必须引用同一份文件且无内联副本（守护页面实际加载的那份）
  const pet = fs.readFileSync(path.join(__dirname, '..', 'public', 'pet.html'), 'utf8');
  assert.ok(pet.includes('<script src="/pet-state.js"></script>'),
    'pet.html 必须以 <script src> 引入 pet-state.js');
  assert.ok(!/const ROW_ANIMS = \[/.test(pet),
    'pet.html 不得保留 ROW_ANIMS 内联副本（唯一权威在 pet-state.js）');
});

test('A4-1: 工具失败事件 → errorHold 置位，心情为 error、目标动画 failed（生成中也先报错）', () => {
  // 生成进行中收到 tool_error：gen 保持 true（失败不是生成结束）
  const s = state({ gen: true, lanes: 2, lastActive: T0 });
  const { patch, awoke } = PS.applyGenEvent(s, { phase: 'tool_error' }, T0 + 100);
  assert.equal(awoke, true, '失败也是活动：惊醒');
  assert.equal(patch.gen, undefined, 'tool_error 不改变 gen（呼吸态不清零）');
  assert.equal(patch.lanes, undefined, 'tool_error 不改变 lanes');
  assert.equal(patch.errorHoldUntil, T0 + 100 + PS.ERROR_HOLD_MS);
  const s2 = Object.assign(state({ gen: true }), patch);
  const mood = PS.computeMood(T0 + 200, { ...s2, sleepAfterMs: PS.SLEEP_AFTER_MS });
  assert.equal(mood, 'error');
  assert.equal(PS.animFor('error', 50), 'failed');
  // hold 到期后回到常规判定路径（gen 仍在 → gen 档位，而非 error）
  const mood2 = PS.computeMood(patch.errorHoldUntil + 1,
    { ...s2, sleepAfterMs: PS.SLEEP_AFTER_MS });
  assert.equal(mood2, 'gen');
  assert.equal(PS.animFor('gen', 50), 'jumping');
});

test('A4-1: gen end 事件后回到 cruise / sleep 判定路径', () => {
  const s = state({ gen: true, lanes: 1, lastActive: T0 });
  const { patch } = PS.applyGenEvent(s, { phase: 'end' }, T0 + 100);
  const s2 = Object.assign(state(), patch);
  assert.equal(s2.gen, false);
  assert.equal(s2.lanes, 0);
  // end 推进了活动时钟（an end IS traffic）→ 未达阈值 → cruise
  const mood = PS.computeMood(T0 + 100, { ...s2, sleepAfterMs: PS.SLEEP_AFTER_MS });
  assert.equal(mood, 'cruise');
  assert.equal(PS.animFor('cruise'), 'review');
});

test('A4-2: sleep 状态下任一活动事件立即惊醒（参数化：start/lanes/end/tool_error）', () => {
  const phases = ['start', 'lanes', 'end', 'tool_error'];
  for (const phase of phases) {
    // lastActive 已陈旧：若没有新事件，now 时刻应判 sleep
    const s = state({ lastActive: T0 - 10 * PS.SLEEP_AFTER_MS });
    const ev = phase === 'start' ? { phase, sessions: 1 } : { phase };
    const now = T0;
    const { patch, awoke } = PS.applyGenEvent(s, ev, now);
    assert.equal(awoke, true, `${phase} 必须报告惊醒副作用`);
    const s2 = Object.assign(state(), patch);
    const mood = PS.computeMood(now, { ...s2, sleepAfterMs: PS.SLEEP_AFTER_MS });
    assert.notEqual(mood, 'sleep', `${phase} 到达后不得仍处于 sleep`);
    // idle 计时被重置：lastActive 补丁 = 事件时刻
    assert.equal(patch.lastActive, now, `${phase} 必须重置 idle 计时`);
  }
});

test('A4-2: 工作事件与入睡条件同时满足时工作态胜出（error/gen 优先于 sleep）', () => {
  const s = state({ gen: true, lastActive: T0 - 10 * PS.SLEEP_AFTER_MS });
  const mood = PS.computeMood(T0, { ...s, sleepAfterMs: PS.SLEEP_AFTER_MS });
  assert.equal(mood, 'gen', '生成中即使超过入睡阈值也不入睡');
  const s2 = state({ errorHoldUntil: T0 + 1000, lastActive: T0 - 10 * PS.SLEEP_AFTER_MS });
  const mood2 = PS.computeMood(T0, { ...s2, sleepAfterMs: PS.SLEEP_AFTER_MS });
  assert.equal(mood2, 'error', '错误 hold 优先于入睡');
});

test('A4-3: idle 时长跨过注入阈值才入睡（阈值可注入，不取真实时钟）', () => {
  const S = 5000; // 注入一个非默认阈值
  const s = state({ lastActive: T0 });
  assert.equal(PS.computeMood(T0 + S - 1, { ...s, sleepAfterMs: S }), 'cruise',
    '未达阈值不入睡');
  assert.equal(PS.computeMood(T0 + S, { ...s, sleepAfterMs: S }), 'sleep',
    '恰达阈值入睡');
  assert.equal(PS.computeMood(T0 + S + 1, { ...s, sleepAfterMs: S }), 'sleep');
  // 惊醒重置后重新计时：从惊醒时刻起重新计满整个阈值窗口才入睡
  //（用 tool_error 惊醒——它不置 gen，sleep/cruise 判定路径干净；
  //  start 惊醒会让 gen 态优先、归属 A4-2 的工作态胜出断言）
  const { patch } = PS.applyGenEvent(s, { phase: 'tool_error' }, T0 + S - 1);
  const s2 = Object.assign(state(), patch);
  assert.equal(patch.lastActive, T0 + S - 1, '惊醒把 idle 计时重置到事件时刻');
  assert.equal(PS.computeMood(T0 + S - 1 + S - 1, { ...s2, sleepAfterMs: S }), 'cruise',
    '重新计时未满窗口不入睡');
  assert.equal(PS.computeMood(T0 + S - 1 + S, { ...s2, sleepAfterMs: S }), 'sleep',
    '重新计满整个窗口后才入睡');
});

test('A4-4 手势不变量（参数化）: [c,c]→切换；[c,c,c,c]→连击不切换；[c,c,c]→切换；[c]→无动作', () => {
  const W = PS.GESTURE_WINDOW_MS;
  const at = (i) => T0 + i * (W / 10); // 全部落在窗口内
  // [c,c] → 切换且无连击
  assert.deepEqual(PS.classifyGesture([at(0), at(1)], W),
    { count: 2, action: 'switch' });
  // [c,c,c,c] → 连击且不切换
  assert.deepEqual(PS.classifyGesture([at(0), at(1), at(2), at(3)], W),
    { count: 4, action: 'combo' });
  // [c,c,c] → 窗口关闭时执行切换
  assert.deepEqual(PS.classifyGesture([at(0), at(1), at(2)], W),
    { count: 3, action: 'switch' });
  // [c] → 无动作
  assert.deepEqual(PS.classifyGesture([at(0)], W), { count: 1, action: 'none' });
  // 乱序输入等价（内部排序）
  assert.equal(PS.classifyGesture([at(2), at(0), at(1)], W).action, 'switch');
  // 第 4 击在窗口外 → 只有窗口内 3 击有效，判 switch 而非 combo
  assert.deepEqual(PS.classifyGesture([at(0), at(1), at(2), at(0) + W + 1], W),
    { count: 3, action: 'switch' });
  // 空序列无动作（防御面）
  assert.deepEqual(PS.classifyGesture([], W), { count: 0, action: 'none' });
});

test('心情优先级阶梯: error > tantrum > gen > (permission 预留) > sleep > cruise', () => {
  const S = PS.SLEEP_AFTER_MS;
  const now = T0;
  // 全部置位 → error 最高
  let s = state({ errorHoldUntil: now + 1, comboHoldUntil: now + 1, gen: true, lastActive: T0 - 10 * S });
  assert.equal(PS.computeMood(now, { ...s, sleepAfterMs: S }), 'error');
  // error 过期 → tantrum
  s = state({ errorHoldUntil: now - 1, comboHoldUntil: now + 1, gen: true, lastActive: T0 - 10 * S });
  assert.equal(PS.computeMood(now, { ...s, sleepAfterMs: S }), 'tantrum');
  assert.equal(PS.animFor('tantrum'), 'failed');
  // tantrum 过期 → gen
  s = state({ errorHoldUntil: now - 1, comboHoldUntil: now - 1, gen: true, lastActive: T0 - 10 * S });
  assert.equal(PS.computeMood(now, { ...s, sleepAfterMs: S }), 'gen');
  // gen 档位 → 行映射（低/中/高）
  assert.equal(PS.animFor('gen', null), 'running');
  assert.equal(PS.animFor('gen', 29.9), 'running');
  assert.equal(PS.animFor('gen', 30), 'jumping');
  assert.equal(PS.animFor('gen', 80), 'jumping');
  assert.equal(PS.animFor('gen', 80.1), 'running_right');
  // gen 退出 + 超时 → sleep
  s = state({ lastActive: T0 - S });
  assert.equal(PS.computeMood(T0, { ...s, sleepAfterMs: S }), 'sleep');
  assert.equal(PS.animFor('sleep'), 'idle'); // 复用 idle 行（9 行契约不动）
  // 未超时 → cruise
  s = state({ lastActive: T0 - S + 1 });
  assert.equal(PS.computeMood(T0, { ...s, sleepAfterMs: S }), 'cruise');
});
