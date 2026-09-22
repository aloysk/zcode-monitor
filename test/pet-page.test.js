'use strict';
// test/pet-page.test.js — pet.html/widget.html 的页面契约守护（T5）：
// 9 行动画契约不被内联改动、消毒模块被两页引用且展示点过闸、心情优先级
// 阶梯在判定函数里可读。纯静态检查，不启动服务器。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const readPage = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');

test('契约: ROW_ANIMS 恒等 9 行且顺序固定（含 failed/waiting_permission）', () => {
  const html = readPage('pet.html');
  const m = html.match(/const ROW_ANIMS = (\[[^\]]+\]);/);
  assert.ok(m, 'pet.html 必须内联声明 ROW_ANIMS（无构建器，本页是权威版本）');
  const rows = JSON.parse(m[1].replace(/'/g, '"'));
  assert.deepEqual(rows, ['idle', 'running_right', 'running_left', 'waving', 'jumping',
                          'failed', 'waiting_permission', 'running', 'review']);
});

test('契约: 两页都引入 /sanitize.js，气泡展示点过消毒闸', () => {
  const pet = readPage('pet.html');
  const widget = readPage('widget.html');
  assert.ok(pet.includes('<script src="/sanitize.js"></script>'), 'pet.html 引入 sanitize.js');
  assert.ok(widget.includes('<script src="/sanitize.js"></script>'), 'widget.html 引入 sanitize.js');
  // widget 现有的气泡类展示点（悬浮 tip）必须经过 sanitizeSpeech
  assert.ok(/tip\.textContent = [\s\S]*sanitizeSpeech\(/.test(widget),
            'widget 悬浮 tip 文本必须过 sanitizeSpeech');
  // pet 气泡默认只显示数值（既定决策：不展示 agent 原始文本），契约留痕
  assert.ok(pet.includes('SanitizeSpeech.sanitizeSpeech'), 'pet.html 保留消毒闸契约注释');
});

test('契约: 心情优先级阶梯 error > tantrum > gen > (permission 预留) > sleep > cruise', () => {
  const html = readPage('pet.html');
  const m = html.match(/function computeMood\(\) \{([\s\S]*?)\n\}/);
  assert.ok(m, 'computeMood 单一判定函数必须存在');
  const body = m[1];
  const idx = (re) => { const r = body.search(re); assert.ok(r >= 0, re); return r; };
  const order = [
    idx(/errorHoldUntil/), idx(/comboHoldUntil/), idx(/gen\)/), idx(/SLEEP_AFTER_MS/),
  ];
  assert.deepEqual([...order].sort((a, b) => a - b), order, '优先级必须按阶梯顺序排列');
  // waiting_permission 未接线（无信号源），但预留位次必须有注释留痕
  assert.ok(/预留/.test(html), 'permission 预留说明必须留痕');
});

test('契约: pet.html 内联脚本可编译（无构建器，页面即交付物）', () => {
  const html = readPage('pet.html');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 1, '内联脚本存在');
  for (const s of scripts) assert.doesNotThrow(() => new Function(s[1]), '内联脚本语法错误');
});

test('契约: 睡眠与错误态的可视接线齐备（静帧+呼吸+zzz / failed 行 / SSE 分派）', () => {
  const html = readPage('pet.html');
  assert.ok(html.includes('body.state-sleep #pet'), '睡眠呼吸 CSS');
  assert.ok(html.includes('content: "zzz"'), 'zzz 角标');
  assert.ok(html.includes("m.phase === 'tool_error'"), 'SSE tool_error 分派');
  assert.ok(/animFor\([^)]*\)[\s\S]*'failed'/.test(html), 'failed 行由 animFor 分派');
  assert.ok(html.includes('SLEEP_AFTER_MS = 60 * 1000'), '60s 入睡阈值');
});
