'use strict';
// test/frontend-contract.test.js — 前端源码契约守护（R5 测试质量补测 T5，
// pet-page.test.js 同款源码断言形态）：这些接线点没有可跑的 DOM 行为面，
// 用源码形态锁住不回归——
// 1) public/app.js：getJSON 透传自定义首部 + checkpoint 按钮调用点带
//    X-Zcode-Monitor-Checkpoint（与 server/checkpoint-route.js 的 force 首部闸
//    配套——首部丢了按钮会恒 403）；
// 2) public/views/sessions.js：tool stdout/stderr 渲染点在 escapeHtml( 内
//   （exec 目录日志是不可信文本，直插即存储型 XSS 面）；
// 3) R-8 零外联字体：widget/pet 无远程字体 @import、CSP 无字体域白名单。
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

// 3) R-8 已决：系统字体为最终形态，页面零外联——widget/pet 两页与 styles.css
//    不得再引入远程字体 @import，CSP 不得再放行 fonts.googleapis/gstatic 域（曾是被
//    「CSP 仅存外联域」钉住的状态，重新引入即回归）。styles.css 的 Geist/
//    JetBrains Mono 与两页的 Source Sans 3/Noto Sans SC 家族名保留为本地
//    可选（本机装了就用、没装走系统栈），属预期形态不算外联。
test('契约: 零外联字体——widget/pet 无远程 @import，CSP 无字体域白名单（R-8）', () => {
  for (const page of ['widget.html', 'pet.html']) {
    const src = readPublic(page);
    assert.ok(!/@import\s+url\(/.test(src), `${page} 不得有 @import url(（R-8：系统字体为最终形态）`);
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(src), `${page} 不得引用 Google Fonts 域`);
  }
  const styles = readPublic('styles.css');
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(styles), 'styles.css 不得引用 Google Fonts 域');
  // T1 补钉：styles.css 此前只钉 Google Fonts 域，未钉 @import 形态本身——
  // 不得再出现任何外联 @import。本地 `@import "foo.css"` 形态本仓不存在，
  // 若未来引入本地拆分文件则需同步修此断言。
  assert.ok(!/@import\s+url\(/i.test(styles), 'styles.css 不得有 @import url(（外联样式零引入）');
  const csp = fs.readFileSync(path.join(__dirname, '..', 'server', 'http-hardening.js'), 'utf8');
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(csp),
    'CSP 常量不得再放行字体域（style-src/font-src 均应只含 self + unsafe-inline）');
});

// 4) R8-2（batch2 终审第 1 轮补钉）：batch2 新增/新改前端文件零外联资源——
//    views/recap.js 是本批唯一全新前端视图、views/sessions.js 与 app.js/
//    views/overview.js 携带 notify/waiting 新增段；app.js/overview.js 的
//    http 外链面由 notify-view.test.js 的 C8-6 断言覆盖，本钉补齐 recap/
//    sessions 两文件并把四文件的外联样式/字体形态一并钉死（CSP default-src
//    'self' 是运行时兜底，本钉防源码层回归先于 CSP 拦截）。
test('契约: batch2 前端文件零外联资源（R8-2——recap/sessions 并入零外联守护面）', () => {
  for (const f of ['views/recap.js', 'views/sessions.js', 'app.js', 'views/overview.js']) {
    const src = readPublic(f);
    assert.ok(!/@import\s+url\(/i.test(src), `${f} 不得有外联 @import url(`);
    assert.ok(!/url\(\s*['"]?https?:/i.test(src), `${f} 不得引用远程 url() 资源`);
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(src), `${f} 不得引用 Google Fonts 域`);
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(src), `${f} 不得含非回环 http(s) 链接`);
  }
});

// 5) R-40（五席审查第 1 轮修复）：syncThemeIcon 的 SVG 显隐必须走 content
//    attribute 翻转——hidden IDL 属性仅在 HTMLElement 反射，SVGElement 上
//    裸赋值只写 expando，CSS [hidden] 永不命中（月亮双主题常显事故形态）。
//    源码契约钉四分支 attribute 形态 + 禁 IDL 赋值。
test('契约: app.js syncThemeIcon 用 content attribute 翻转 SVG 显隐（R-40）', () => {
  const src = readPublic('app.js');
  const m = /function syncThemeIcon\(theme\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(m !== null, 'syncThemeIcon 函数须在案');
  const body = m[0];
  assert.ok(body.includes("moon.removeAttribute('hidden')"), '月亮显示分支须 removeAttribute');
  assert.ok(body.includes("moon.setAttribute('hidden', '')"), '月亮隐藏分支须 setAttribute');
  assert.ok(body.includes("sun.setAttribute('hidden', '')"), '太阳隐藏分支须 setAttribute');
  assert.ok(body.includes("sun.removeAttribute('hidden')"), '太阳显示分支须 removeAttribute');
  assert.ok(!/\.hidden\s*=/.test(body), 'SVG 显隐禁用 IDL 赋值（SVGElement 上不反射 content attribute，R-40 事故形态）');
});

// 6) R-40 同族（五席第 2 轮代码席 F-1）：checkpoint 按钮 busy 态的 iconSvg
//    是 SVGElement，显隐同样必须 attribute 翻转；busy 是 span（HTMLElement）
//    不受限。
test('契约: app.js checkpoint busy 态 SVG 显隐走 attribute（R-40 同族）', () => {
  const src = readPublic('app.js');
  assert.ok(src.includes("iconSvg.setAttribute('hidden', '')"), 'busy 进入分支须 setAttribute');
  assert.ok(src.includes("iconSvg.removeAttribute('hidden')"), 'busy 退出分支须 removeAttribute');
  assert.ok(!/iconSvg\.hidden\s*=/.test(src), 'iconSvg（SVG）禁用 IDL 赋值（R-40 同族事故形态）');
});
