'use strict';
// test/attribution-view.test.js — C5「Token 归因」火焰图视图的源码契约
// （ecosystem-round2-batch1 T5：C5-3 / C5-4 视图侧）。
// 接线点（nav/script 引入、registerView、零图表库、色值通道、hover 载荷、
// 下钻链接、空态出口、30 天口径文案）没有可跑的 DOM 行为面（前端无构建、
// 无 jsdom），用源码形态锁住不回归——frontend-contract.test.js /
// usage-view.test.js 同款 readPublic 形态。API 行为面（两级聚合数值/截断/
// 窗口回退）已由 test/usage-routes.test.js（T3）在 HTTP 层守护，两文件互补
// 不重叠。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const readPublic = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');

// C5-3/C1-5 判据同款具名色名单（单词边界匹配）：red|orange|yellow|lime|green|
// teal|cyan|blue|violet|purple|magenta|pink|brown|gray|grey|silver|white|black|gold
// ——新文件（attribution.js）颜色一律 cssVar(--cat-*/--chart-*) 读取。
const NAMED_COLORS = /\b(red|orange|yellow|lime|green|teal|cyan|blue|violet|purple|magenta|pink|brown|gray|grey|silver|white|black|gold)\b/;

test('C5-3 视图接线: index.html nav 含 data-view="attribution"，views script 块引入 /views/attribution.js', () => {
  const html = readPublic('index.html');
  assert.ok(html.includes('data-view="attribution"'),
    'index.html nav 须含 data-view="attribution" 条目');
  assert.ok(html.includes('<script src="/views/attribution.js">'),
    'index.html 须在 views script 块引入 /views/attribution.js');
  // 衔接位置钉：attribution 行须在 usage 行之后（T4 交付物之后，nav/script 同序）。
  assert.ok(html.indexOf('data-view="attribution"') > html.indexOf('data-view="usage"'),
    'nav 中 attribution 条目须位于 usage 条目之后');
  assert.ok(html.indexOf('/views/attribution.js') > html.indexOf('/views/usage.js'),
    'script 引入中 attribution 须位于 usage 之后');
});

test('C5-3 视图形态: registerView("attribution") + 空态经 ZC.emptyState + 30 天口径文案 + 数据流端点', () => {
  const src = readPublic('views/attribution.js');
  assert.ok(src.includes("registerView('attribution'"),
    "attribution.js 须含 registerView('attribution' 注册（hash 路由接线）");
  // 空态出口钉死：规格 C5-4 显式正则（不留「或等价引用」判定空间）——本批新增
  // 视图空态一律经 C9 共享组件渲染。
  assert.ok(/(window\.)?ZC\.emptyState\(/.test(src),
    'attribution.js 空态须命中 /(window\\.)?ZC\\.emptyState\\(/（共享组件出口）');
  // 30 天保留窗口口径标注义务（C1-7 的 attribution.js 部分——三文件 grep 的
  // 第三文件）。
  assert.ok(src.includes('30 天'),
    'attribution.js 须含「30 天」保留窗口口径文案');
  // 数据流契约：本族端点 + 两级查询形态（默认 session 层；turn 层带 session_id）。
  assert.ok(src.includes('/api/usage/attribution'),
    'attribution.js 须消费 /api/usage/attribution 端点（不自行聚合）');
  assert.ok(/level=turn&session_id=\$\{/.test(src) || src.includes('level=turn&session_id='),
    'attribution.js 须含 level=turn&session_id= 下钻查询形态');
  // 诚实截断：meta.truncated → 「仅前 N 项（被裁）」显式标注，不静默。
  assert.ok(src.includes('仅前') && src.includes('（被裁）'),
    'attribution.js 须含「仅前 N 项（被裁）」截断标注文案');
  // 取数失败兜底锚（I-测-10 钉）：reload/drill 由按钮/容器点击触发、不经
  // route() 的 try/catch——catch 须走 failCard（错误空态卡 + 撤明细区 spinner，
  // 否则取数失败视图永久停在 loading）。emptyState 正则锚由 route() 内既有
  // 调用满足、不判别本分支，故锚 catch→failCard 调用形态本身。
  assert.ok(/function failCard\(/.test(src) && /catch[\s\S]{0,260}failCard\(/.test(src),
    'reload/drill 的 catch 须走 failCard 兜底（防永久 spinner）');
  assert.ok(/function failCard\([\s\S]{0,400}setHtml\('#attr-detail', ''\)/.test(src),
    'failCard 须撤掉 #attr-detail 的 loading spinner（失败不留加载残态）');
});

test('C5-3 零图表库: attribution.js 不含 registerChart / new Chart 调用（火焰图=嵌套 div 宽度布局）', () => {
  const src = readPublic('views/attribution.js');
  assert.ok(!src.includes('registerChart'),
    'attribution.js 不得调用 registerChart（Chart.js 仅 overview 既有使用）');
  assert.ok(!src.includes('new Chart'),
    'attribution.js 不得调用 new Chart（零图表库——火焰图为嵌套 div）');
  // 嵌套宽度布局的机检面：帧层 style width:% 内联（宽度即占比）。
  assert.ok(/style="[^"]*width:\$\{/.test(src),
    'attribution.js 须含 style="width:${…}%" 嵌套 div 宽度布局形态');
});

test('C5-3 色值通道: cssVar("--chart- 读取存在，无硬编码色值（#hex / rgb( / hsl( / 具名色 0 命中）', () => {
  const src = readPublic('views/attribution.js');
  // 色带经 --chart-*/--cat-* 变量由 cssVar 读取（app.js 既有通道）——至少一处
  // --chart- 前缀读取（图例文字色走 --chart-legend，与 Chart.js 图例同源变量）。
  assert.ok(src.includes("cssVar('--chart-") || src.includes('var(--chart-'),
    "attribution.js 须含 cssVar('--chart- 读取（既有图表色通道，禁硬编码）");
  // 帧底色轮转带：--cat-* 变量名（渲染期经 cssVar(FRAME_COLORS[...]) 动态取值，
  // 故钉「变量名字符串存在 + cssVar 调用存在」而非字面 cssVar('--cat- 拼接）。
  assert.ok(src.includes("'--cat-") || src.includes('var(--cat-'),
    'attribution.js 色带须含 --cat- 变量名（帧底色轮转带）');
  assert.ok(src.includes('cssVar('),
    'attribution.js 须经 cssVar( 通道取色（app.js 既有通道）');
  assert.ok(!/#[0-9a-f]{3,6}/.test(src),
    'attribution.js 不得含 #[0-9a-f]{3,6} 色值字面量');
  assert.ok(!/rgba?\(/.test(src),
    'attribution.js 不得含 rgb(/rgba( 函数记法色值');
  assert.ok(!/hsla?\(/.test(src),
    'attribution.js 不得含 hsl(/hsla( 函数记法色值');
  assert.ok(!NAMED_COLORS.test(src),
    'attribution.js 不得含 CSS 具名色单词（red/green/…/gold 名单）');
});

test('C5-4 hover 载荷: title 与 data-* 属性承载 token/耗时/占比三值', () => {
  const src = readPublic('views/attribution.js');
  assert.ok(/title="\$\{escapeHtml\(/.test(src),
    'hover 载荷须经 title 属性（escapeHtml 转义后拼接）');
  for (const attr of ['data-tokens', 'data-dur-ms', 'data-share']) {
    assert.ok(src.includes(attr),
      `attribution.js hover 载荷须含 ${attr} 属性（token/耗时/占比三值的 data-* 面）`);
  }
});

test('C5-4 下钻链接: session 层帧 → #sessions/<id>，turn 层帧 → #sessions/<id>/turns', () => {
  const src = readPublic('views/attribution.js');
  // session 层：帧内 ↗ 直链 + 明细表「打开 →」（sessions.js 子代理表同款 hash 形态）。
  assert.ok(/href="#sessions\/\$\{encodeURIComponent\(/.test(src),
    'session 层须含 href="#sessions/${encodeURIComponent(<id>)}" 直链形态');
  // turn 层：帧整体为锚 + 明细表直链，指向会话详情 Turns 标签。
  assert.ok(/#sessions\/\$\{encodeURIComponent\([^)]*\)\}\/turns/.test(src),
    'turn 层须含 #sessions/${encodeURIComponent(<id>)}/turns 直链形态');
});

test('F-码-1 回归: 空窗明细区隐藏而非删除——有行时恢复（空窗→切窗→明细表复现）', () => {
  const src = readPublic('views/attribution.js');
  // 旧形态（setHtml('#attr-detail-sec', '')）把明细区整段删除，而 reload()/
  // render() 从不重建——「空→非空」后明细表永久消失。钉死删除形态不得回归。
  assert.ok(!src.includes("setHtml('#attr-detail-sec', ''"),
    '空窗不得删除明细区整段（reload/render 不重建，删后明细表永久消失）');
  // 隐藏/恢复对偶：renderFlame 空窗 hidden=true，renderTable 有行 hidden=false。
  assert.ok(/\$\('#attr-detail-sec'\)[\s\S]{0,120}hidden = true/.test(src),
    'renderFlame 空窗须以 hidden 属性隐藏明细区（保留 DOM 可恢复）');
  assert.ok(/\$\('#attr-detail-sec'\)[\s\S]{0,120}hidden = false/.test(src),
    'renderTable 有行时须取消隐藏（空窗→切窗→明细表复现的恢复点）');
});

test('C5-3 主题重绘: zc-theme-changed 事件监听（色带渲染期 cssVar 读值，翻转后纯重渲）', () => {
  const src = readPublic('views/attribution.js');
  assert.ok(src.includes("addEventListener('zc-theme-changed'"),
    'attribution.js 须监听 zc-theme-changed 事件重绘（rethemeCharts 派发的既有形态）');
  // 再入防叠加：overview 先例——视图重入时先摘旧监听。
  assert.ok(src.includes("removeEventListener('zc-theme-changed'"),
    'attribution.js 重入时须摘除旧主题监听（防 handler 叠加）');
});
