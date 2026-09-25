'use strict';
// test/recap-view.test.js — C7「回顾」视图与文档增补的源码契约
// （ecosystem-round2-batch2 T7：C7-6 视图侧 / C7-8 的两 grep 锚）。
// 接线点（nav/script 引入、registerView、空态出口、色值禁令、口径文案锚）没有
// 可跑的 DOM 行为面（前端无构建、无 jsdom），用源码形态锁住不回归——
// usage-view.test.js 同款 readPublic 形态（frontend-contract 家族）。API 行为面
//（查询族/口径/路由/EQP）已由 test/recap.test.js（T6）守护，两文件互补不重叠。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const readPublic = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const readDocs = (name) => fs.readFileSync(path.join(__dirname, '..', 'docs', name), 'utf8');

// C7-6/C5-3 判据同款具名色名单（单词边界匹配）：red|orange|yellow|lime|green|
// teal|cyan|blue|violet|purple|magenta|pink|brown|gray|grey|silver|white|black|gold
// ——新文件（recap.js）颜色一律 var(--*)，徽标/数值着色类也不得含名单词。
const NAMED_COLORS = /\b(red|orange|yellow|lime|green|teal|cyan|blue|violet|purple|magenta|pink|brown|gray|grey|silver|white|black|gold)\b/;

test('C7-6 视图接线: index.html nav 含 data-view="recap"，views script 块引入 /views/recap.js', () => {
  const html = readPublic('index.html');
  assert.ok(html.includes('data-view="recap"'),
    'index.html nav 须含 data-view="recap" 条目');
  assert.ok(html.includes('<script src="/views/recap.js">'),
    'index.html 须在 views script 块引入 /views/recap.js');
});

test('C7-6 视图形态: registerView("recap") + 空态经 ZC.emptyState + 「30 天」覆盖披露 + /api/recap 数据面', () => {
  const src = readPublic('views/recap.js');
  assert.ok(src.includes("registerView('recap'"),
    "recap.js 须含 registerView('recap' 注册（hash 路由接线）");
  // 空态出口钉死：规格 C7-6 显式正则——本批新增视图空态一律经 C9 共享组件渲染。
  assert.ok(/(window\.)?ZC\.emptyState\(/.test(src),
    'recap.js 空态须命中 /(window\\.)?ZC\\.emptyState\\(/（共享组件出口）');
  // 30d/cap 披露口径义务（规格 §2.3 需求 3：覆盖披露卡常驻）。
  assert.ok(src.includes('30 天'),
    'recap.js 须含「30 天」保留窗口覆盖披露文案');
  // 数据面契约（F-测-1 同族钉法）：fetch URL 漂移时页面永久 loading 而全套仍绿。
  assert.ok(src.includes('/api/recap?period='),
    'recap.js 须消费 /api/recap?period= 端点（period 三档经 query 透传）');
  // 主题联动重绘：色值是渲染期 cssVar 读值，须挂 zc-theme-changed 重渲
  //（attribution.js C5 先例——不挂则主题翻转后柱色停留在旧主题取值）。
  assert.ok(src.includes('zc-theme-changed'),
    'recap.js 须监听 zc-theme-changed 主题切换重绘');
});

test('C7-6 sparkline 色值契约: 经 cssVar(\'--chart-\') 读取，无硬编码色值（#hex / rgb( / hsl( / 具名色 0 命中）', () => {
  const src = readPublic('views/recap.js');
  assert.ok(src.includes("cssVar('--chart-"),
    "recap.js sparkline 色值须经 cssVar('--chart-*) 通道读取（C7-6 判据原文）");
  assert.ok(!/#[0-9a-f]{3,6}/.test(src),
    'recap.js 不得含 #[0-9a-f]{3,6} 色值字面量（颜色一律 var(--*)）');
  assert.ok(!/rgba?\(/.test(src),
    'recap.js 不得含 rgb(/rgba( 函数记法色值');
  assert.ok(!/hsla?\(/.test(src),
    'recap.js 不得含 hsl(/hsla( 函数记法色值');
  assert.ok(!NAMED_COLORS.test(src),
    'recap.js 不得含 CSS 具名色单词（red/green/…/gold 名单）');
});

test('C7-6 year 档降级契约: token 类 null 不伪造——「token 峰值日」要点不渲染、Top focus 注明不适用', () => {
  const src = readPublic('views/recap.js');
  // 要点降级：year 档不进「token 峰值日」候选（tok 计算带 period 守卫）。
  assert.ok(src.includes("data.period !== 'year' && (d.tokens || 0) > 0"),
    '「token 峰值日」要点候选须带 period !== \'year\' 守卫（year 档 token null，不渲染不占位）');
  // Top focus null（year 档）→ 注明不适用，不渲染空表头也不静默消失。
  assert.ok(src.includes('data.top_focus === null'),
    'recap.js 须分支处理 top_focus === null（year 档该面不适用）');
  assert.ok(src.includes('年档不提供 Top focus'),
    'top_focus null 分支须注明原因（30 天保留外无数据源，不伪造）');
});

test('C7-6 环比档别契约: 仅 week 档渲染环比，month/year 注明原因（前一周期不可保证完整）', () => {
  const src = readPublic('views/recap.js');
  assert.ok(src.includes("data.period !== 'week'"),
    'recap.js 环比渲染须带 period !== \'week\' 档别分支');
  assert.ok(src.includes('前一周期完整数据不可保证'),
    'month/year 档须注明不提供环比的原因（§2.0 拍板 6 诚实原则）');
  assert.ok(src.includes('上一窗无数据，环比不可算'),
    'delta_pct null（空基线）须如实注明不可算，不显示伪造的 0%');
});

test('C7-6 失败兜底契约: load() 包 try/catch 走 failCard，发请求前先置 loading', () => {
  const src = readPublic('views/recap.js');
  // usage.js F-败-1 同款钉法：load 由刷新按钮/期别选择器触发、不经 route() 的
  // try/catch——catch 须走 failCard，否则取数失败成未处理 rejection、旧期别
  // 数据静默挂新期别标签。
  assert.ok(/function failCard\(/.test(src) && /catch[\s\S]{0,300}failCard\(/.test(src),
    'load 的 catch 须走 failCard 兜底（错误卡 + 清空区块/副行）');
  assert.ok(/function failCard\([\s\S]{0,420}setHtml\('#recap-totals', window\.ZC\.emptyState\(/.test(src),
    'failCard 须向 #recap-totals 写 emptyState 错误卡（失败不留 spinner/旧数据）');
  // 先置 loading 再发请求：杜绝「取数在途时旧期别数据挂新期别标签」的静默错配。
  assert.ok(src.includes("for (const sel of ['#recap-totals', '#recap-highlights', '#recap-spark', '#recap-focus', '#recap-compare', '#recap-coverage'])"),
    'load() 发请求前须先对六个区块置 loading');
});

test('C7-8 文档口径锚: usage-accounting.md 含「recap 口径（C7 增补）」小节；how.js 含 active hours 口径段', () => {
  const doc = readDocs('usage-accounting.md');
  assert.ok(doc.includes('recap 口径（C7 增补）'),
    'docs/usage-accounting.md 须含新小节标题「recap 口径（C7 增补）」（编号顺延 §12）');
  const how = readPublic('views/how.js');
  assert.ok(how.includes('active hours'),
    'public/views/how.js 须含 active hours 口径段（grep 锚，基线 0 命中——命中即增量）');
  assert.ok(how.includes('5 分钟桶'),
    'how.js 口径段须含「5 分钟桶」分桶表述');
  assert.ok(how.includes('跨会话去重'),
    'how.js 口径段须含跨会话去重表述（并行会话同桶只计一次）');
  assert.ok(how.includes('上界'),
    'how.js 口径段须含年档区间并集的上界口径表述（含挂机时间）');
  assert.ok(how.includes('token_coverage_from'),
    'how.js 口径段须含覆盖边界指引（meta.token_coverage_from 三元 max 披露）');
});
