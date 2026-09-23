'use strict';
// test/log-tail.test.js — log-tail watch 实时化（T6 / WP3-lite，fs.watch + 偏移增量 + 双重兜底）。
// 平台差异容忍协议（任务书 + 终审修订）：偏移守恒（恰 N、无重复、无丢失）是硬判据、
// 一票否决；「短延迟可见」的 1s 目标在慢平台允许退化到对账/短轮询兜底，超标只记
// console.warn 注记、不按 1s 判失败（Windows fs.watch 抖动实测常见）。宽松上界取
// >2× reconcile 兜底（11s / 15s）：高负载机器上兜底定时器漂移一两个周期属正常，
// 上界严于兜底周期会在慢机假红；上界触发即视为 watch+兜底机制严重回归（A3-1 的
// 「3s 复测带注记」协议的可执行化，Spec v1.2 字面的「仍不过则记不通过」由此落进
// 套件——1s 目标本体仍照录 console 供人工判读）。
// 全部用例注入 todayFile 绑定各自 tmpdir 路径：与 cwd 无关、与真实 ~/.zcode 无关；
// 各 finally 清理后断言临时路径已消失（A0-7 守护断言）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// R8 守护：先注入 inert 路径再 require（本文件全部用例走注入的 todayFile，从不读它；
// server/db.js 的连接是惰性的，require 只解析路径、不触碰真实库）
process.env.ZCODE_LOG_DIR = path.join(os.tmpdir(), 'unused-zcode-log-dir');
const log = require(path.join(__dirname, '..', 'server', 'log-tail.js'));

function makeLogRoot(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), name));
  const logDir = path.join(root, 'log');
  fs.mkdirSync(logDir, { recursive: true });
  return { root, logDir };
}

async function waitFor(cond, deadlineMs, stepMs = 50) {
  const deadline = Date.now() + deadlineMs;
  while (!cond() && Date.now() < deadline) await sleep(stepMs);
  return cond();
}

test('契约: 既有导出面不变（行为对外不变），createLogWatcher 为新增且 onEvents 必填', () => {
  for (const k of ['todayLogFile', 'listLogFiles', 'parseLine', 'tailLog', 'eventsForTrace', 'buildSpanForest']) {
    assert.equal(typeof log[k], 'function', k);
  }
  assert.equal(typeof log.createLogWatcher, 'function');
  assert.throws(() => log.createLogWatcher({}), TypeError);
});

test('A3-1: 临时目录追加 10 行 → 恰 10 个事件（偏移守恒硬判据）；短延迟为目标，慢平台退化只注记不判失败', async () => {
  const { root, logDir } = makeLogRoot('zcmon-watch-');
  const file = path.join(logDir, 'zcode-2026-09-23.jsonl');
  const got = [], latencies = [];
  const w = log.createLogWatcher({
    todayFile: () => file,
    onEvents: evs => { for (const e of evs) { got.push(e); latencies.push(Date.now() - e.at); } },
  });
  try {
    for (let i = 0; i < 10; i++) {
      fs.appendFileSync(file, JSON.stringify({ i, at: Date.now() }) + '\n'); // at = 追加时刻
      await sleep(120); // 每行间隔 ≥100ms
    }
    await waitFor(() => got.length >= 10, 15000); // watch 未命中时由 5s 对账兜底补齐
    // ——硬判据：偏移守恒（一票否决）——
    assert.equal(got.length, 10);
    assert.equal(new Set(got.map(e => e.i)).size, 10); // 无重复
    // ——时序目标（容忍协议）：1s 超标只注记；宽松上界为硬断言（防严重回归）——
    // 上界 11s = 2×reconcile(5s)+1：高负载下兜底定时器漂移一两个周期不算回归，
    // 偏移守恒（恰 N、无重复）仍是一票否决项。
    const maxLat = Math.max(...latencies);
    console.log(`[A3-1] latencies(ms): ${latencies.join(',')} max=${maxLat}`);
    if (maxLat > 1000) {
      console.warn(`[A3-1] 慢平台/watch 未命中退化注记: max=${maxLat}ms（经兜底路径送达，按容忍协议不按 1s 判失败）`);
    }
    assert.ok(maxLat < 11000,
      `[A3-1] 宽松上界（>2×reconcile，兜底机制严重回归判定）：max=${maxLat}ms`);
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, 'A0-7: 临时目录已清理'); // 守护断言
  }
});

test('A3-2: watch 失效（删除被监视目录，本机实测静默无 error）后追加仍 ≤10s 全量可见、无重复', async () => {
  const { root, logDir } = makeLogRoot('zcmon-fb-');
  const file = path.join(logDir, 'zcode-2026-09-23.jsonl');
  const got = [];
  const w = log.createLogWatcher({ todayFile: () => file, onEvents: evs => got.push(...evs) });
  try {
    fs.rmSync(logDir, { recursive: true, force: true }); // watch 句柄失效（error 或静默）→ 降级
    await sleep(200);
    fs.mkdirSync(logDir, { recursive: true });
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) {
      fs.appendFileSync(file, JSON.stringify({ i }) + '\n');
      await sleep(50);
    }
    const ok = await waitFor(() => got.length >= 5, 10000); // error→1s 短轮询；静默→5s 对账
    assert.equal(got.length, 5);                      // 轮询兜底继续产出（缺失 = 硬失败）
    assert.equal(new Set(got.map(e => e.i)).size, 5); // 无重复
    // ——时序目标（容忍协议）：waitFor 自身预算之后才从返回时刻起算，避免把
    // 兜底路径的正常耗时错判成时序违规；15s 宽松上界为硬断言（防严重回归）
    const durMs = Date.now() - t0;
    if (!ok || durMs > 10000) {
      console.warn(`[A3-2] 慢平台时序注记: 10s 内全量可见未达（ok=${ok}, ${durMs}ms），按容忍协议不按 10s 判失败`);
    }
    assert.ok(ok && durMs < 15000,
      `[A3-2] 15s 宽松上界（兜底机制严重回归判定）：ok=${ok}, ${durMs}ms`);
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, 'A0-7: 临时目录已清理'); // 守护断言
  }
});

test('A3-2b: fs.watch 同步抛错（目录缺失）→ 退回短轮询 + 告警恰好一次，追加仍可见', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-fb2-'));
  const logDir = path.join(root, 'log'); // 故意先不创建：fs.watch 对不存在目录同步抛 ENOENT
  const file = path.join(logDir, 'zcode-2026-09-23.jsonl');
  const got = [];
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  let w;
  try {
    w = log.createLogWatcher({ todayFile: () => file, onEvents: evs => got.push(...evs) });
    fs.mkdirSync(logDir, { recursive: true });
    for (let i = 0; i < 3; i++) {
      fs.appendFileSync(file, JSON.stringify({ i }) + '\n');
      await sleep(50);
    }
    await waitFor(() => got.length >= 3, 10000); // 1s 短轮询兜底
    assert.equal(got.length, 3);
    assert.equal(new Set(got.map(e => e.i)).size, 3);
    assert.equal(warns.filter(s => s.includes('fs.watch 不可用')).length, 1,
      '降级应告警恰好一次: ' + JSON.stringify(warns));
  } finally {
    console.warn = origWarn; w.stop();
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, 'A0-7: 临时目录已清理'); // 守护断言
  }
});

test('A3-4: 100 行连续追加最终一致（恰 100）+ UTC 日切换（新文件从偏移 0 起读）', async () => {  const { root, logDir } = makeLogRoot('zcmon-pv-');
  const d1 = path.join(logDir, 'zcode-2026-09-22.jsonl');
  const d2 = path.join(logDir, 'zcode-2026-09-23.jsonl');
  const got = [], atFirstSecond = [];
  const bootAt = Date.now();
  let onDay2 = false;
  const w = log.createLogWatcher({
    // 可注入 todayFile：先指到 d1，翻日后指到 d2（模拟 UTC 日切换换名）
    todayFile: () => (onDay2 ? d2 : d1),
    onEvents: evs => {
      for (const e of evs) {
        got.push(e);
        if (Date.now() - bootAt <= 1000) atFirstSecond.push(e);
      }
    },
  });
  try {
    for (let i = 0; i < 100; i++) fs.appendFileSync(d1, JSON.stringify({ day: 1, i }) + '\n');
    await waitFor(() => got.length >= 100, 10000);
    assert.equal(got.length, 100); // 无论 watch 命中率如何，watch+兜底混合必须最终一致
    assert.equal(new Set(got.map(e => e.day + ':' + e.i)).size, 100);
    // watch 命中率照录（降级启用依据）：1s 内到达数 vs 对账补齐数
    console.log(`watch-hit ${atFirstSecond.length}/100 within 1s`);
    onDay2 = true;                 // 换名后的当日文件从偏移 0 起读
    for (let i = 0; i < 10; i++) {
      fs.appendFileSync(d2, JSON.stringify({ day: 2, i }) + '\n');
      await sleep(30);
    }
    await waitFor(() => got.length >= 110, 10000);
    assert.equal(got.length, 110); // 跨日事件仍可见
    assert.ok(got.every(e => e.day === 1 || e.day === 2));
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, 'A0-7: 临时目录已清理'); // 守护断言
  }
});

// 单次读上限（maxBytesPerPump 可注入以便测试）：一次性追加远超上限的大块增量
// 必须分片追平——偏移守恒（恰 N、无重复、无丢失）仍是硬判据。
test('A3-5: 超单次读上限的大块增量分片追平（不丢不重，偏移守恒）', async () => {
  const { root, logDir } = makeLogRoot('zcmon-cap-');
  const file = path.join(logDir, 'zcode-2026-09-23.jsonl');
  const got = [];
  const w = log.createLogWatcher({
    todayFile: () => file,
    maxBytesPerPump: 7, // 故意极小：一次 append 必然跨越几十个分片
    onEvents: evs => got.push(...evs),
  });
  try {
    const N = 60;
    for (let i = 0; i < N; i++) fs.appendFileSync(file, JSON.stringify({ i }) + '\n');
    await waitFor(() => got.length >= N, 15000);
    assert.equal(got.length, N);                      // 恰 N：分片追平不丢
    assert.equal(new Set(got.map(e => e.i)).size, N); // 无重复
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, 'A0-7: 临时目录已清理'); // 守护断言
  }
});

// 残行按原始字节保存、完整行才解码：多字节 UTF-8 序列跨分片切分时不得产生
// U+FFFD 导致该行被静默丢弃（中文内容日志下的真实形态）。
test('A3-6: 多字节 UTF-8 跨分片不产生 U+FFFD（残行字节化，完整行才解码）', async () => {
  const { root, logDir } = makeLogRoot('zcmon-utf8-');
  const file = path.join(logDir, 'zcode-2026-09-23.jsonl');
  const got = [];
  const w = log.createLogWatcher({
    todayFile: () => file,
    maxBytesPerPump: 7, // '中' 是 3 字节：7 字节分片必落在多字节序列中间
    onEvents: evs => got.push(...evs),
  });
  try {
    const text = '中'.repeat(50); // 150 字节纯多字节内容
    fs.appendFileSync(file, JSON.stringify({ text }) + '\n');
    await waitFor(() => got.length >= 1, 15000);
    assert.equal(got.length, 1);
    assert.equal(got[0].text, text, '跨片切分的行必须完整解码（无 U+FFFD 丢行）');
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, 'A0-7: 临时目录已清理'); // 守护断言
  }
});

// pump 截断分支：锚定后文件被改写为更短内容（stat.size < offset）→ 偏移归零按
// 新文件从 0 重读；其后追加的新行必须可见且不产生重复投递。
test('A3-7: 文件截断改写后新行可见、无重复（偏移守恒兜底）', async () => {
  const { root, logDir } = makeLogRoot('zcmon-trunc-');
  const file = path.join(logDir, 'zcode-2026-09-23.jsonl');
  fs.writeFileSync(file,
    Array.from({ length: 8 }, (_, i) => JSON.stringify({ i })).join('\n') + '\n'); // 启动前历史
  const got = [];
  const w = log.createLogWatcher({
    todayFile: () => file,
    reconcileMs: 100, // 快速对账驱动多轮 pump，验证无重复
    onEvents: evs => got.push(...evs),
  });
  try {
    await sleep(300); // 锚定完成窗口（历史 8 行不得投递）
    assert.equal(got.length, 0, '启动前历史不回放');
    fs.writeFileSync(file, '{"i":100}\n'); // 改写为更短内容：size < offset → 归零重读
    fs.appendFileSync(file, JSON.stringify({ i: 101 }) + '\n');
    await waitFor(() => got.some(e => e.i === 101), 10000);
    await sleep(350); // 再过几轮对账 pump：确认不重复投递
    assert.deepEqual(got.map(e => e.i), [100, 101], '截断后按新文件从 0 读：新行可见且无重复');
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, 'A0-7: 临时目录已清理'); // 守护断言
  }
});

// 文件名回退不回放：readdir 失败时 defaultTodayFile 会回退 UTC 名（字典序可能
// 小于本地日名）——名字变小的换名不是日切换，按 size 锚定；名字跳回最新（回归
// 到读过的文件）同样锚定，已投递过的内容不得二次回放。
test('A3-8: 文件名回退/回归不整文件回放（只有名字更新且从未读过才从 0 起读）', async () => {
  const { root, logDir } = makeLogRoot('zcmon-back-');
  const dNew = path.join(logDir, 'zcode-2026-09-23.jsonl');
  const dOld = path.join(logDir, 'zcode-2026-09-22.jsonl');
  fs.writeFileSync(dOld, Array.from({ length: 3 }, (_, i) => JSON.stringify({ i, day: 0 })).join('\n') + '\n');
  fs.writeFileSync(dNew, Array.from({ length: 4 }, (_, i) => JSON.stringify({ i, day: 1 })).join('\n') + '\n');
  let useNew = true;
  const got = [];
  const w = log.createLogWatcher({
    todayFile: () => (useNew ? dNew : dOld), // 先锚定 dNew，再模拟 readdir 回退到 dOld，最后跳回 dNew
    reconcileMs: 100,
    onEvents: evs => got.push(...evs),
  });
  try {
    await sleep(300); // 锚定 dNew（其历史 4 行不得投递）
    assert.equal(got.length, 0, '启动前历史不回放');
    fs.appendFileSync(dNew, JSON.stringify({ i: 10, day: 1 }) + '\n');
    await waitFor(() => got.some(e => e.i === 10), 10000);
    useNew = false; // 名字回退（dOld < dNew）：dOld 的 3 行历史不得投递
    await sleep(400);
    useNew = true;  // 名字跳回 dNew（读过的文件回归）：从 size 锚定，4+10 行历史不得回放
    await sleep(400); // 等 pump 完成回归锚定，再追加验证续读（否则锚定恰好落在追加之后会锚掉该行）
    fs.appendFileSync(dNew, JSON.stringify({ i: 11, day: 1 }) + '\n');
    await waitFor(() => got.some(e => e.i === 11), 10000);
    await sleep(350);
    assert.deepEqual(got.map(e => e.i), [10, 11], '回退/回归期间只投递新增行，无任何回放');
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, 'A0-7: 临时目录已清理'); // 守护断言
  }
});
