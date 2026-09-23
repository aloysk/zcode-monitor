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

test('依赖冻结：dependencies 恰为 better-sqlite3 + express（deepEqual 等值）', () => {
  const pkg = require(path.join('..', 'server', '..', 'package.json'));
  assert.deepStrictEqual(
    Object.keys(pkg.dependencies).sort(),
    ['better-sqlite3', 'express'],
    'dependencies 变化须过 A0-6 评审：新能力优先 Node 内置模块');
});
