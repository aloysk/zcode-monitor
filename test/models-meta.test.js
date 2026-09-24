'use strict';
// test/models-meta.test.js — C2-1：静态模型元数据模块（纯数据模块，node:test
// 直接 require，无 IO、无 fixture）。
// 覆盖面：
//   1) 已知 model_id（模块导出表首个键——自洽，不硬编码 id）→ 返回
//      {context_tokens, max_output_tokens} 数值对象（不带内部标注字段）；
//   2) 未知 id → null（不猜窗口）；精确匹配钉（前缀/后缀/大小写变形不命中）；
//   3) 源码头注纪律：「非官方权威」声明 + zcode-api 许可证纪律（只取数值不
//      复制文本）+ 权威核对路径（zai-org/ZCode 源码常量）；
//   4) 每条数值带出处标注（已核对官方源码常量含出处文件，或 unverified）；
//   5) 关键档位数值钉（对官方常量的静态回归守护，防表被误改）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const modelsMeta = require('../server/models-meta');

test('C2-1: 已知 model_id（表首个键，自洽）→ 数值对象 {context_tokens, max_output_tokens}', () => {
  const keys = Object.keys(modelsMeta.table);
  assert.ok(keys.length > 0, '元数据表不得为空');
  const known = keys[0];
  const m = modelsMeta.resolve(known);
  assert.ok(m != null, '已知 id 不得返回 null');
  assert.equal(typeof m.context_tokens, 'number');
  assert.equal(typeof m.max_output_tokens, 'number');
  assert.ok(m.context_tokens > 0 && m.max_output_tokens > 0, '窗口/输出上限须为正数');
  // resolve 返回形状钉：不夹带 source 等内部标注字段（API 面形状）
  assert.deepStrictEqual(Object.keys(m).sort(), ['context_tokens', 'max_output_tokens']);
});

test('C2-1: 未知 model_id → null；精确匹配钉（无前缀/后缀/大小写模糊）', () => {
  assert.strictEqual(modelsMeta.resolve('nonexistent-model-x'), null);
  const known = Object.keys(modelsMeta.table)[0];
  // 「不猜窗口」：已知键的变形形态一律不命中（v1 不做 variant/模糊键）
  assert.strictEqual(modelsMeta.resolve(known.toLowerCase()), null, '大小写变形不得模糊命中');
  assert.strictEqual(modelsMeta.resolve(known + '-x'), null, '后缀变形不得模糊命中');
  assert.strictEqual(modelsMeta.resolve(known.slice(0, -1)), null, '前缀截断不得模糊命中');
  // 健壮性：非字符串入参 → null（DB 列可为 NULL）
  assert.strictEqual(modelsMeta.resolve(null), null);
  assert.strictEqual(modelsMeta.resolve(undefined), null);
});

test('C2-1: 源码头注纪律——「非官方权威」声明与 zcode-api 许可证纪律注释', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'server', 'models-meta.js'), 'utf8');
  assert.ok(src.includes('非官方权威'), '头注须含「非官方权威」声明（UI 恒标注义务的数据面声明）');
  assert.ok(src.includes('zcode-api'), '头注须点名 zcode-api（许可证纪律对象）');
  assert.ok(/只取其.*数值|只取数值/.test(src), '许可证纪律注释（只取数值）');
  assert.ok(/不复制其?整理文本|不复制文本/.test(src), '许可证纪律注释（不复制整理文本）');
  // 权威核对路径声明（分析 §9-8 销账路径）
  assert.ok(src.includes('zai-org/ZCode'), '头注须声明权威核对路径（zai-org/ZCode 源码常量）');
});

test('C2-1: 每条数值带出处标注（已核对官方源码常量含出处文件，或 unverified）', () => {
  const entries = Object.entries(modelsMeta.table);
  assert.ok(entries.length > 0);
  for (const [id, m] of entries) {
    assert.equal(typeof m.context_tokens, 'number', `${id}: context_tokens 须为数值`);
    assert.equal(typeof m.max_output_tokens, 'number', `${id}: max_output_tokens 须为数值`);
    assert.ok(typeof m.source === 'string' && m.source.length > 0, `${id}: 缺 source 出处标注`);
    const verified = /已核对官方源码常量/.test(m.source);
    assert.ok(verified || /unverified/.test(m.source),
      `${id}: 出处标注须为「已核对官方源码常量」或「unverified」之一`);
    if (verified) {
      assert.ok(/zcode-builtin\.json/.test(m.source),
        `${id}: 已核对标注须含出处文件（zcode-builtin.json）`);
    }
  }
});

test('C2-1: 关键档位数值钉（官方常量的静态回归守护——zcode-builtin.json r30）', () => {
  // 按官方规则族 overlay 终值（2026-09-25 核对，models-meta 头注 (c)）：
  //   glm-5.3*（含 -Flash/-FlashX 后缀组）→ 1M / 128000
  //   GLM-5.2 → 1M / 128000；GLM-5.1 / GLM-5 / GLM-5-Turbo → 200K / 64000
  //   GLM-5V-Turbo / GLM-4.7* / GLM-4.6 → 200K / 131072；GLM-4.5* → 131072 / 98304
  assert.deepStrictEqual(modelsMeta.resolve('GLM-5.3'),
    { context_tokens: 1000000, max_output_tokens: 128000 });
  assert.deepStrictEqual(modelsMeta.resolve('GLM-5.3-FlashX'),
    { context_tokens: 1000000, max_output_tokens: 128000 });
  assert.deepStrictEqual(modelsMeta.resolve('GLM-5.2'),
    { context_tokens: 1000000, max_output_tokens: 128000 });
  assert.deepStrictEqual(modelsMeta.resolve('GLM-5.1'),
    { context_tokens: 200000, max_output_tokens: 64000 });
  assert.deepStrictEqual(modelsMeta.resolve('GLM-4.7'),
    { context_tokens: 200000, max_output_tokens: 131072 });
  assert.deepStrictEqual(modelsMeta.resolve('GLM-4.5'),
    { context_tokens: 131072, max_output_tokens: 98304 });
});
