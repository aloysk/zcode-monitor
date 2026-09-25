'use strict';
// test/pet-page.test.js — pet.html/widget.html 的页面契约守护（T5）：
// 两页对共享模块的引用齐备、内联脚本可编译、可视接线（CSS/SSE 分派）在页面上。
// 行为语义（ROW_ANIMS 契约、心情优先级、事件→状态、手势不变量）已随共享模块
// 抽取移至 test/pet-state.test.js 的行为单测（A4-1~A4-6），本文件不再用正则
// 守护内联字面量——那曾对文件后段任意出现的目标串误报/漏报。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const readPage = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');

test('契约: 两页都引入 /sanitize.js，气泡展示点过消毒闸', () => {
  const pet = readPage('pet.html');
  const widget = readPage('widget.html');
  assert.ok(pet.includes('<script src="/sanitize.js"></script>'), 'pet.html 引入 sanitize.js');
  assert.ok(widget.includes('<script src="/sanitize.js"></script>'), 'widget.html 引入 sanitize.js');
  // widget 现有的气泡类展示点（悬浮 tip）必须经过 sanitizeSpeech。
  // 正则限定单行（[^\n;]）：[\s\S]* 跨行贪婪会把文件后段任意位置的 sanitizeSpeech(
  // 误配到 tip 赋值行，形成假阴性守护。
  assert.ok(/tip\.textContent\s*=[^;\n]*sanitizeSpeech\(/.test(widget),
            'widget 悬浮 tip 文本必须过 sanitizeSpeech');
  // pet 气泡默认只显示数值（既定决策：不展示 agent 原始文本），契约留痕
  assert.ok(pet.includes('SanitizeSpeech.sanitizeSpeech'), 'pet.html 保留消毒闸契约注释');
});

test('契约: pet.html 消费 pet-state.js 共享模块且无内联副本（A4-6 页面侧）', () => {
  const pet = readPage('pet.html');
  assert.ok(pet.includes('<script src="/pet-state.js"></script>'),
    'pet.html 必须以 <script src> 引入 pet-state.js（守护页面实际加载的那份）');
  assert.ok(pet.includes('window.PetState'), '页面从全局取决策模块');
  // 内联副本禁令：契约常量与决策逻辑不得回迁页面（行为单测在 pet-state.test.js）
  assert.ok(!/const ROW_ANIMS = \[/.test(pet), '无 ROW_ANIMS 内联副本');
  assert.ok(!/function computeMood\(now/.test(pet), '无 computeMood 内联实现（页面侧只包装取材）');
});

test('契约: widget.html 的 gen 分派显式处理 tool_error（不把它当 end 清零呼吸/徽章）', () => {
  const widget = readPage('widget.html');
  assert.ok(widget.includes("m.phase === 'tool_error'"),
    'widget 的 gen 事件分派必须显式认得 tool_error phase（livegen 在同一条 SSE 上发射）');
});

test('契约: pets-preview 的 LICENSE_UNKNOWN 走 confirm 知情确认后带 ack 重试', () => {
  const html = readPage('pets-preview.html');
  assert.ok(html.includes("j.error === 'LICENSE_UNKNOWN'"), '识别许可证未知错误码');
  assert.ok(/window\.confirm\(/.test(html), '导入前弹出知情确认');
  assert.ok(html.includes('importPack(source, true)'), '确认后带确认位重试');
  assert.ok(html.includes('ackUnknownLicense: !!ackUnknownLicense'), '确认位随请求体传入');
});

test('契约: pet.html 内联脚本可编译（无构建器，页面即交付物）', () => {
  const html = readPage('pet.html');
  // 枚举所有 <script> 开标签（含带属性形态），跳过外链 src 后逐段编译内联脚本：
  // 无属性限定的字面 <script> 匹配会把未来带属性的内联脚本静默漏掉
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(m => !/\bsrc\s*=/.test(m[1]));
  assert.ok(scripts.length >= 1, '内联脚本存在');
  for (const s of scripts) assert.doesNotThrow(() => new Function(s[2]), '内联脚本语法错误');
  // widget.html 同法（它在同一条 SSE 契约上）
  const widgetScripts = [...readPage('widget.html').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(m => !/\bsrc\s*=/.test(m[1]));
  for (const s of widgetScripts) assert.doesNotThrow(() => new Function(s[2]), 'widget 内联脚本语法错误');
});

test('契约: 睡眠与错误态的可视接线齐备（静帧+呼吸+zzz / SSE 分派 / 60s 阈值来源）', () => {
  const pet = readPage('pet.html');
  assert.ok(pet.includes('body.state-sleep #pet'), '睡眠呼吸 CSS');
  assert.ok(pet.includes('content: "zzz"'), 'zzz 角标');
  // 页面把 gen 事件整体交给共享 reducer（phase 分派——含 tool_error——在
  // pet-state.js 内，由 pet-state.test.js 的 A4-1/A4-2 行为测试守护）
  assert.ok(pet.includes('PS.applyGenEvent'), '事件→状态决策走共享 reducer');
  assert.ok(pet.includes('PS.classifyGesture'), '手势不变量判定走共享纯函数');
  // 阈值常量唯一权威在 pet-state.js（行为单测守护其值），页面解构消费
  assert.ok(pet.includes('const { SLEEP_AFTER_MS'), '页面阈值取自共享模块');
  // permission 接线说明随决策逻辑住在 pet-state.js（batch2 C6 接线后原「预留」
  // 注记更新为已接线形态：数据源＝/api/signals/summary 轮询 + permHoldUntil
  // 位次注记；接线行为面由 signals-view.test.js 的 C6-6 用例守护）
  const psSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'pet-state.js'), 'utf8');
  assert.ok(psSrc.includes('已接线'), 'permission 接线说明必须留痕（pet-state.js）');
  assert.ok(psSrc.includes('waiting_permission'), 'waiting_permission 行映射齐备');
  // a11y 面（终审第 1 轮视觉席 minor）：permission 态在 ariaLabel 有分支——
  // 读屏读数与 waiting_permission 动画语义对齐，不落 default「待命中」。
  assert.ok(pet.includes("if (s === 'permission') return 'Token 桌宠：等待授权';"),
    'ariaLabel 含 permission 分支（读屏语义与动画态对齐）');
});
