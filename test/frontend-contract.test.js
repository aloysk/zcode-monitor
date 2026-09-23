'use strict';
// test/frontend-contract.test.js — 前端源码契约守护（R5 测试质量补测 T5，
// pet-page.test.js 同款源码断言形态）：这些接线点没有可跑的 DOM 行为面，
// 用源码形态锁住不回归——
// 1) public/app.js：getJSON 透传自定义首部 + checkpoint 按钮调用点带
//    X-Zcode-Monitor-Checkpoint（与 server/checkpoint-route.js 的 force 首部闸
//    配套——首部丢了按钮会恒 403）；
// 2) public/views/sessions.js：tool stdout/stderr 渲染点在 escapeHtml( 内
//   （exec 目录日志是不可信文本，直插即存储型 XSS 面）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const readPublic = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');

test('契约: app.js 的 getJSON 透传 headers，checkpoint 按钮调用点带头部', () => {
  const src = readPublic('app.js');
  // getJSON 须把 opts.headers 递给 fetch——任何调用方的自定义首部都经此路径
  assert.ok(/fetch\(url,\s*\{\s*headers:\s*opts\.headers\s*\|\|\s*\{\}\s*\}\s*\)/.test(src),
    'getJSON 的 fetch 须透传 opts.headers（首部透传形态）');
  // 首部字面量 + 按钮调用点须经 getJSON 的 headers 形态携带（两处断言分开：
  // 字面量可能在别处出现，调用点形态才是接线证据）
  assert.ok(src.includes("'X-Zcode-Monitor-Checkpoint': '1'"),
    'app.js 须含 X-Zcode-Monitor-Checkpoint 字面量');
  assert.ok(
    /getJSON\(\s*'\/api\/checkpoint\?force=1[\s\S]{0,120}headers:\s*\{\s*'X-Zcode-Monitor-Checkpoint'/.test(src),
    'checkpoint 按钮调用点须带 force 首部（丢失即恒 403）');
});

test('契约: sessions.js 的 stdout/stderr 渲染点在 escapeHtml( 内', () => {
  const src = readPublic('views/sessions.js');
  assert.ok(/escapeHtml\(out\.stdout\)/.test(src), 'stdout 渲染点须过 escapeHtml');
  assert.ok(/escapeHtml\(out\.stderr\)/.test(src), 'stderr 渲染点须过 escapeHtml');
  // 反向守护：不得存在未消毒的直插形态
  assert.ok(!/<pre>\$\{out\.(stdout|stderr)\}<\/pre>/.test(src),
    'exec 输出不得以 ${out.stdout}/${out.stderr} 直插 <pre>');
});
