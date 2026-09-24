'use strict';
// test/speed-caliber.test.js — 速度口径专项（2026-09-24 分母改生成时长轮）：
// 分母 = duration − time_to_first_token_ms（GLM-5.3 首等实测占总时长 39%，
// 含等待口径读数低四成；社区对照 JuDaXia/claude-speed METRIC v1.2 的
// duration ≈ TTFT + out/TPS 分解，详见 server/db.js Token speed 区头注）。
// 服务端边界在一个 test 内分阶段验证（db.js 模块级缓存 env——同文件多
// require 共享首个 fixture，单 fixture 分段是既有约定，见 db-smoke 头注）：
//   阶段1 空库：weighted_tps/avg_ttft_ms 为 null（SUM 空集稳健）；
//   阶段2 全 NULL ttft：gen 回退全时长，数值与旧含等待口径一致（回退等价）；
//   阶段3 ttft 行 + ttft ≥ duration 脏行：剔除正确 + 1ms 生成下限恒有限；
//   阶段4 SSE 行形状含 time_to_first_token_ms（widget/feed 行级 gen 依赖）。
// 前端源码契约（不可跑 DOM 的接线点，frontend-contract.test.js 同款形态）：
//   widget.html 三消费点（seed gen_ms / SSE duration−ttft / Σ genMs）与
//   overview.js feed spd / 速度表 footer 的 gen 口径接线。
// 主数值口径钉（21.9 / 18.8 / 25.0 / gen_ms 三态）在 test/db-smoke.test.js。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createFixtureDb, buildModelUsage } = require('./helpers/fixture-db');

const now = Date.now();
const mkRow = (over) => Object.assign({
  status: 'completed', started_at: now - 60e3, duration_ms: 5000,
  query_source: 'main_turn', input_tokens: 10, output_tokens: 100,
}, over);

test('速度口径: 生成时长分母——空集稳健 / NULL 回退 / 脏行下限 / SSE 行形状', () => {
  const fx = createFixtureDb();
  process.env.ZCODE_DB = fx.dbPath;
  process.env.ZCODE_LOG_DIR = fx.logDir;
  process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;
  const dbq = require('../server/db');
  try {
    // 阶段1：空库——空窗口聚合不抛、null 语义保持
    let s = dbq.overviewSpeed(now - 3600e3);
    assert.equal(s.weighted_tps, null);
    assert.equal(s.avg_ttft_ms, null);
    assert.equal(s.gen_seconds, 0);
    assert.equal(s.request_count, 0);
    assert.deepEqual(dbq.recentSpeed(now - 3600e3), []);
    assert.deepEqual(dbq.completedSince(now - 60e3), []);

    // 阶段2：全 NULL ttft——gen 回退全时长，读数与旧含等待口径逐值一致
    buildModelUsage(fx.conn, [
      mkRow({ id: 'a', duration_ms: 10000, output_tokens: 200, started_at: now - 300e3 }),
      mkRow({ id: 'b', duration_ms: 8000, output_tokens: 150, started_at: now - 200e3 }),
    ]);
    s = dbq.overviewSpeed(now - 3600e3);
    assert.equal(s.gen_seconds, 18);
    assert.equal(s.gen_seconds, s.total_seconds);
    assert.equal(s.weighted_tps, 19.4); // 350 tok / 18s = 旧口径原值（回退等价）
    assert.equal(s.avg_ttft_ms, null);
    for (const r of dbq.completedSince(now - 3600e3))
      assert.equal(r.gen_ms, r.duration_ms, 'NULL ttft 行 gen_ms 回退全时长');

    // 阶段3：ttft 行 + 脏行（ttft ≥ duration）——剔除与 1ms 下限
    buildModelUsage(fx.conn, [
      mkRow({ id: 'clean', duration_ms: 4000, time_to_first_token_ms: 1000,
              output_tokens: 300, started_at: now - 100e3 }),
      mkRow({ id: 'dirty', duration_ms: 5000, time_to_first_token_ms: 6000,
              output_tokens: 100, started_at: now - 50e3 }),
    ]);
    s = dbq.overviewSpeed(now - 3600e3);
    // gen = 10000 + 8000 + (4000−1000) + MAX(5000−6000,1) = 21001ms
    assert.equal(s.gen_seconds, 21.0);
    assert.ok(Number.isFinite(s.weighted_tps), '脏行下 weighted_tps 必须有限');
    assert.equal(s.weighted_tps, +(750 / 21.001).toFixed(1));
    // avg_ttft_ms 照实聚合（脏行也是数据），不因防御路径失真
    assert.equal(s.avg_ttft_ms, Math.round((1000 + 6000) / 2));
    const rows = dbq.recentSpeed(now - 3600e3);
    const dirty = rows.find(r => r.id === 'dirty');
    assert.equal(dirty.gen_ms, 1, '脏行 gen_ms 下限 1ms');
    assert.ok(Number.isFinite(dirty.tps), '脏行 tps 必须有限');
    const clean = rows.find(r => r.id === 'clean');
    assert.equal(clean.gen_ms, 3000);
    assert.equal(clean.tps, 100.0); // 300 tok / 3s gen

    // 阶段4：SSE model 行携带首等列（可 null）——widget SSE 增量与
    // overview feed 的行级 gen 计算依赖（server/recentModelRowsAfterRowid）
    const sse = dbq.recentModelRowsAfterRowid(0);
    assert.ok(sse.length >= 4);
    for (const r of sse)
      assert.ok('time_to_first_token_ms' in r, 'SSE 行形状必须含首等列');
    assert.equal(sse.find(r => r.id === 'clean').time_to_first_token_ms, 1000);
    assert.equal(sse.find(r => r.id === 'a').time_to_first_token_ms, null);
  } finally {
    try { dbq.db().close(); } catch { /* already closed */ }
    dbq.invalidateDb();
    fx.cleanup();
    assert.equal(fs.existsSync(fx.root), false, 'fixture 目录必须已清理');
  }
});

// ── 前端源码契约（接线点无 DOM 行为面，锁源码形态） ──

const readPublic = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');

test('契约: widget.html 三个消费点走生成时长口径', () => {
  const src = readPublic('widget.html');
  // seed：分母取服务端 gen_ms（duration−ttft），非 duration_ms
  assert.ok(/q\.gen_ms \|\| q\.duration_ms/.test(src),
    'seed 的 pushReq 第 4 参须为 q.gen_ms（回退 duration_ms）');
  // SSE 增量：行级 duration − ttft（1ms 下限），与 server recentSpeed 同式
  assert.ok(/Math\.max\(m\.duration_ms - \(m\.time_to_first_token_ms \|\| 0\), 1\)/.test(src),
    'SSE 分支须计算 gen = duration − ttft（1ms 下限）');
  // 滚动聚合与 sparkline 槽分母均 Σ genMs（不得残留 durMs 消费）
  assert.ok(/for \(const r of buf\) \{ tok \+= r\.tok; ms \+= r\.genMs; \}/.test(src),
    'render 聚合分母须为 Σ genMs');
  assert.ok(/s\.ms \+= r\.genMs;/.test(src), 'sparkline 槽分母须为 genMs');
  assert.ok(!/durMs/.test(src), 'durMs 字段应已全量更名 genMs（防旧口径残留）');
});

test('契约: overview.js feed spd 与速度表 footer 走生成时长口径', () => {
  const src = readPublic('views/overview.js');
  // live feed 行级 spd：duration − ttft（SSE 行字段），1ms 下限
  assert.ok(
    /Math\.max\(r\.duration_ms - \(r\.time_to_first_token_ms \|\| 0\), 1\)/.test(src),
    'feed spd 须用 duration − ttft（1ms 下限）');
  // 速度表 footer 均速分母：Σ gen_ms（回退 duration_ms——旧 payload 兼容）
  assert.ok(/a \+ \(r\.gen_ms \|\| r\.duration_ms \|\| 0\)/.test(src),
    'footer 均速分母须为 Σ gen_ms');
  // TTFT 列接线（表头 + 行渲染），口径提示随列
  assert.ok(/<th class="num">TTFT<\/th>/.test(src), '速度表须有 TTFT 列');
  assert.ok(/r\.ttft_ms != null \? fmtMs\(r\.ttft_ms\)/.test(src), 'TTFT 列渲染 null → —');
});
