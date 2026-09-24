'use strict';
// test/usage-view.test.js — C1「回合与工具」视图与文档增补的源码契约
// （ecosystem-round2-batch1 T4：C1-5 视图侧 / C1-8 / C1-7 的 how.js 部分）。
// 接线点（nav/script 引入、registerView、空态出口、色值禁令、口径文案锚）没有
// 可跑的 DOM 行为面（前端无构建、无 jsdom），用源码形态锁住不回归——
// frontend-contract.test.js 同款 readPublic 形态。API 行为面（totals 数值/
// 分布截断/时间线形状）已由 test/usage-routes.test.js（T3）在 HTTP 层守护，
// 两文件互补不重叠。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const readPublic = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const readDocs = (name) => fs.readFileSync(path.join(__dirname, '..', 'docs', name), 'utf8');

// C1-5/C5-3 判据同款具名色名单（单词边界匹配）：red|orange|yellow|lime|green|
// teal|cyan|blue|violet|purple|magenta|pink|brown|gray|grey|silver|white|black|gold
// ——新文件（usage.js）颜色一律 var(--*)，badge/value 着色类也不得含名单词。
const NAMED_COLORS = /\b(red|orange|yellow|lime|green|teal|cyan|blue|violet|purple|magenta|pink|brown|gray|grey|silver|white|black|gold)\b/;

test('C1-5 视图接线: index.html nav 含 data-view="usage"，views script 块引入 /views/usage.js', () => {
  const html = readPublic('index.html');
  assert.ok(html.includes('data-view="usage"'),
    'index.html nav 须含 data-view="usage" 条目');
  assert.ok(html.includes('<script src="/views/usage.js">'),
    'index.html 须在 views script 块引入 /views/usage.js');
});

test('C1-5 视图形态: registerView("usage") + 空态经 ZC.emptyState + 30 天口径文案 + 禁「pending/待批」', () => {
  const src = readPublic('views/usage.js');
  assert.ok(src.includes("registerView('usage'"),
    "usage.js 须含 registerView('usage' 注册（hash 路由接线）");
  // 空态出口钉死：规格 C1-5 显式正则（不留「或等价引用」判定空间）——本批新增
  // 视图空态一律经 C9 共享组件渲染。
  assert.ok(/(window\.)?ZC\.emptyState\(/.test(src),
    'usage.js 空态须命中 /(window\\.)?ZC\\.emptyState\\(/（共享组件出口）');
  // 30 天保留窗口口径标注义务（C1-7 的 usage.js 部分）。
  assert.ok(src.includes('30 天'),
    'usage.js 须含「30 天」保留窗口口径文案');
  // approval 列只呈现终态值域分布——「pending/待批」语义禁令（C1 需求 2 的
  // UI 层钉：时间启发式属后续批次 C6，本批不碰）。
  assert.ok(!src.includes('pending'), 'usage.js 不得出现「pending」字样');
  assert.ok(!src.includes('待批'), 'usage.js 不得出现「待批」字样');
});

test('C1-5 色值禁令: usage.js 无硬编码色值（#hex / rgb( / hsl( / 具名色 0 命中）', () => {
  const src = readPublic('views/usage.js');
  assert.ok(!/#[0-9a-f]{3,6}/.test(src),
    'usage.js 不得含 #[0-9a-f]{3,6} 色值字面量（颜色一律 var(--*)）');
  assert.ok(!/rgba?\(/.test(src),
    'usage.js 不得含 rgb(/rgba( 函数记法色值');
  assert.ok(!/hsla?\(/.test(src),
    'usage.js 不得含 hsl(/hsla( 函数记法色值');
  assert.ok(!NAMED_COLORS.test(src),
    'usage.js 不得含 CSS 具名色单词（red/green/…/gold 名单）');
});

test('C1-8 文档口径: usage-accounting.md 含「queryTaskUsage 增量口径（C1 增补）」小节；how.js 含 queryTaskUsage 指引', () => {
  const doc = readDocs('usage-accounting.md');
  assert.ok(doc.includes('queryTaskUsage 增量口径（C1 增补）'),
    'docs/usage-accounting.md 须含新小节标题「queryTaskUsage 增量口径（C1 增补）」');
  const how = readPublic('views/how.js');
  assert.ok(how.includes('queryTaskUsage'),
    'public/views/how.js 须含 queryTaskUsage 口径指引');
});

test('C1-7（how.js 部分）: how.js 声明段含「30 天」保留窗口口径', () => {
  const how = readPublic('views/how.js');
  assert.ok(how.includes('30 天'),
    'public/views/how.js 须含「30 天」保留窗口声明（usage.js 部分已由 C1-5 用例覆盖；attribution.js 属 T5）');
});
