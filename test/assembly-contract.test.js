'use strict';
// test/assembly-contract.test.js — server/index.js 真实装配序的守护测试（R3
// 修-medium）。index.js 内联了 watcher/SSE/路由等大量运行期逻辑，抽 buildApp()
// 注入化重构的风险大于收益——采用源码序断言：锁三条安全相关的不变量，任何把
// 闸挂晚/挂丢的改写（如把 Host 闸挪到路由之后、或 /pets 收紧 static 被挪到通用
// static 之后导致注册序失效）在本文件报警。另锁依赖冻结（A0-6 的测试化）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

function firstIndexOf(re, label) {
  const m = re.exec(src);
  assert.ok(m, `server/index.js 须包含 ${label}`);
  return m.index;
}

test('装配契约：全站安全头 → /api 回环 Host 闸 → 全部 API 路由（注册序即命中序）', () => {
  const headers = firstIndexOf(/app\.use\(securityHeaders\)/, 'securityHeaders 中间件');
  const gate = firstIndexOf(/app\.use\('\/api', loopbackHostGate\)/, '/api 回环 Host 闸');
  // 首个 API 路由挂载（overview 是 index.js 里第一个 app.use('/api/…')）
  const firstApiRoute = firstIndexOf(/app\.use\('\/api\/overview'/, '/api/overview 路由');
  assert.ok(headers < gate, 'securityHeaders 须先于 /api Host 闸（响应头覆盖全部 /api 响应，含 403）');
  assert.ok(gate < firstApiRoute, '/api Host 闸须先于全部 API 路由——挂晚即 DNS rebinding 读面裸奔');
  // 其余 API 路由也须在闸后（防未来把新路由插到闸前）
  for (const route of ['sessions', 'trace', 'live', 'transcript', 'raw', 'agents']) {
    const pos = firstIndexOf(new RegExp(`app\\.use\\('/api/${route}'`), `/api/${route} 路由`);
    assert.ok(gate < pos, `/api/${route} 须挂在 Host 闸之后`);
  }
  // POST /api/restart（自重启）：rebinding 同源页带自定义首部过首部闸后，Host
  // 闸是唯一防线，且它是破坏力最大的端点——显式钉住（首轮测试席）。
  const restart = firstIndexOf(/app\.post\('\/api\/restart'/, 'POST /api/restart（自重启）');
  assert.ok(gate < restart, '/api/restart 须挂在 Host 闸之后——挂晚则 rebinding 同源页可触发重启');
  // express.json 须在闸后且只挂 /api：闸前解析会让恶意 Host + 畸形 JSON 落
  // body-parser 含栈 400（首轮安全席）；全局挂载则让任意网页向非 /api 路径
  // 跨站 POST 垃圾 JSON 换含栈响应——唯一读 body 的端点是 /api/pets/import
  //（二轮安全席 SEC-004）。
  const jsonParser = firstIndexOf(/app\.use\('\/api', express\.json\(\)\)/, "/api 作用域 express.json");
  assert.ok(gate < jsonParser, 'express.json 须挂在 /api Host 闸之后（闸只读头，先闸后解析）');
  // 终端错误消毒器（4xx/5xx 都不回栈）须晚于错误翻译层：body-parser 等抛出的
  // 含栈错误在此被换成通用 JSON（SEC-004 的最后一道闭合）。
  const sanitizer = firstIndexOf(/app\.use\(\(err, _req, res, _next\) =>/, '终端错误消毒器');
  const translator = firstIndexOf(/app\.use\(makeErrorTranslator\(/, 'makeErrorTranslator 错误翻译中间件');
  assert.ok(translator < sanitizer, '终端错误消毒器须晚于 makeErrorTranslator');
});

test('装配契约：/pets 收紧 static 先于通用 static（注册序即命中序）', () => {
  const petsTight = firstIndexOf(
    /app\.use\('\/pets', express\.static\(PETS_ROOT, petsStaticOptions\(\)\)\)/,
    '/pets 收紧 static（petsStaticOptions）');
  const generic = firstIndexOf(
    /app\.use\(express\.static\(path\.join\(__dirname, '\.\.', 'public'\)\)\)/,
    '通用 express.static');
  assert.ok(petsTight < generic,
    '/pets 收紧 static 须挂在通用 static 之前——挂晚则 /pets/* 由通用 static 以默认 Content-Type 命中，非图片强制下载防线失效');
});

// R5 T3：错误翻译层的挂载位置守护。Express 按注册顺序选中错误处理器——先注册
// 的翻译层罩不住后注册路由抛出的错误（曾致 /api/widget/today、/api/widget/
// recent 出错时 500 而非契约 503）。不变量：makeErrorTranslator 晚于全部 /api
// 路由（六条 app.use('/api/<router>') 与全部内联 app.get/app.post('/api/…')）
// 且早于 SPA fallback 的 app.get(/^\/(?!api)/。
test('装配契约：makeErrorTranslator 晚于全部 /api 路由、早于 SPA fallback', () => {
  const translator = firstIndexOf(/app\.use\(makeErrorTranslator\(/, 'makeErrorTranslator 错误翻译中间件');

  // 全部 app.use('/api/<router>')：挂晚即罩不住该路由抛出的 SQLITE_BUSY。
  // 下界断言防「路由被删后守护空转」——R5 时点 7 条（overview/sessions/trace/
  // live/transcript/raw/agents）。
  const uses = [...src.matchAll(/app\.use\('\/api\/[a-z]+',/g)].map(m => m.index);
  assert.ok(uses.length >= 6, `app.use('/api/<router>') 须 ≥6 条（实测 ${uses.length}）`);
  for (const pos of uses) {
    assert.ok(pos < translator, `app.use('/api/<router>')@${pos} 须在错误翻译层之前`);
  }

  // 全部内联 /api 端点（checkpoint/health/gen/widget/pets 等，含 POST 形态）
  const gets = [...src.matchAll(/app\.(get|post|put|delete|all)\('\/api\/[^']+',/g)].map(m => m.index);
  assert.ok(gets.length >= 4, `内联 /api 端点须 ≥4 条（实测 ${gets.length}）`);
  for (const pos of gets) {
    assert.ok(pos < translator, `内联 /api 端点@${pos} 须在错误翻译层之前`);
  }

  // SPA fallback（非 /api 路径回 index.html）：翻译层必须在其之前
  const spa = firstIndexOf(/app\.get\(\s*\/\^\\\/\(\?!api\)/, 'SPA fallback');
  assert.ok(translator < spa,
    'makeErrorTranslator 须早于 SPA fallback——挂晚则兜底路由的错误不再被翻译成 503 契约形态');
});

test('依赖冻结：dependencies 恰为 better-sqlite3 + express（deepEqual 等值）', () => {
  const pkg = require(path.join('..', 'server', '..', 'package.json'));
  assert.deepStrictEqual(
    Object.keys(pkg.dependencies).sort(),
    ['better-sqlite3', 'express'],
    'dependencies 变化须过 A0-6 评审：新能力优先 Node 内置模块');
});
