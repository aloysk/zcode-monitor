'use strict';
// test/log-tail-behavior.test.js — A0-5：listLogFiles / tailLog / parseLine /
// eventsForTrace 的行为测试（计划 T1 Step 9 的兑现）。此前这些读路径只有
// typeof 导出面冒烟，构造行比对、坏行静默跳过、尾读截断、跨日双文件扫描
// 全部零覆盖。fixture 全部在 os.tmpdir() 下构造，绝不触碰真实 ~/.zcode。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// R8 守护：先注入 tmpdir 再 require（db.js 连接惰性，require 只解析路径）
const fxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-ltb-'));
const fxLogDir = path.join(fxRoot, 'log');
fs.mkdirSync(fxLogDir, { recursive: true });
process.env.ZCODE_LOG_DIR = fxLogDir;
const log = require(path.join(__dirname, '..', 'server', 'log-tail.js'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(cond, deadlineMs, stepMs = 50) {
  const deadline = Date.now() + deadlineMs;
  while (!cond() && Date.now() < deadline) await sleep(stepMs);
  return cond();
}

test.after(() => {
  fs.rmSync(fxRoot, { recursive: true, force: true });
  // A0-7 守护断言：运行中记录的临时路径在钩子内已不存在
  assert.equal(fs.existsSync(fxRoot), false, 'fixture 根目录必须已清理');
});

function utcName(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return `zcode-${d.toISOString().slice(0, 10)}.jsonl`;
}

test('A0-5 parseLine: 合法行解析为对象；坏行/空行返回 null（静默跳过语义）', () => {
  const line = JSON.stringify({ timestamp: '2026-09-23T01:02:03.000Z', traceId: 'tr1', k: 1 });
  const o = log.parseLine(line);
  assert.equal(o.traceId, 'tr1');
  assert.equal(o.k, 1);
  assert.equal(log.parseLine('{broken json'), null, '坏行返回 null');
  assert.equal(log.parseLine(''), null, '空行返回 null');
  assert.equal(log.parseLine(null), null, 'null 输入返回 null');
});

test('A0-5 listLogFiles: 仅匹配日志命名、按日逆序、携带 name/path/size/mtime', () => {
  const d1 = path.join(fxLogDir, utcName(-1));
  const d2 = path.join(fxLogDir, utcName(0));
  fs.writeFileSync(d1, '{"a":1}\n');
  fs.writeFileSync(d2, '{"a":1}\n{"b":2}\n');
  fs.writeFileSync(path.join(fxLogDir, 'zcode-not-a-date.txt'), 'x'); // 命名不匹配
  fs.writeFileSync(path.join(fxLogDir, 'other.jsonl'), 'x');
  const files = log.listLogFiles();
  const names = files.map(f => f.name);
  assert.deepEqual(names, [utcName(0), utcName(-1)], '只含两份日志文件且新日在前');
  for (const f of files) {
    assert.equal(f.path, path.join(fxLogDir, f.name));
    assert.equal(typeof f.size, 'number', 'size 为数值');
    assert.equal(typeof f.mtime, 'number', 'mtime（mtimeMs 数值）为数值');
    assert.equal(f.size, fs.statSync(f.path).size);
  }
});

test('A0-5 tailLog: 返回值与构造行一致、坏行静默跳过、lines 截断取最新', async () => {
  const file = path.join(fxLogDir, utcName(0));
  const rows = [];
  for (let i = 1; i <= 8; i++) rows.push({ i, timestamp: `2026-09-23T00:00:0${i}.000Z` });
  fs.writeFileSync(file,
    rows.map(r => JSON.stringify(r)).join('\n') + '\n'
    + '{"i":9,"broken' + '\n'          // 坏行夹在中间
    + '{"i":10,"timestamp":"2026-09-23T00:00:10.000Z"}\n');
  const got = await log.tailLog({ lines: 200 });
  // 坏行被静默跳过，其余 9 行按文件序返回
  assert.deepEqual(got.map(r => r.i), [1, 2, 3, 4, 5, 6, 7, 8, 10]);
  // lines 截断：取最新的 N 条完整行
  const tail3 = await log.tailLog({ lines: 3 });
  assert.deepEqual(tail3.map(r => r.i), [7, 8, 10], '截断保留最新的行');
});

test('A0-5 tailLog: >1MB 文件尾读丢弃被截断的首残行（不产生半行对象）', async () => {
  const file = path.join(fxLogDir, utcName(0));
  // 尾读窗口 1MB：先写 >1MB 的填充行，使读取起点落在大行中间
  const pad = { pad: 'x'.repeat(600 * 1024) };
  const first = { i: 'first-complete', timestamp: '2026-09-23T00:00:00.000Z' };
  const last = { i: 'last-complete', timestamp: '2026-09-23T00:00:01.000Z' };
  fs.writeFileSync(file,
    JSON.stringify(first) + '\n'
    + JSON.stringify(pad) + '\n' + JSON.stringify(pad) + '\n'
    + JSON.stringify(last) + '\n');
  assert.ok(fs.statSync(file).size > 1024 * 1024, '文件须超过 1MB 尾读窗口');
  const got = await log.tailLog({ lines: 200 });
  // 尾读起点落在 pad 大行中间：起点截断的残行被 shift 丢弃（1MB 窗口外的
  // first-complete 行按「只看尾部」语义本就不返回），窗口内的行全部完整解析
  assert.equal(got.length, 2, '恰为窗口内的两个完整行');
  assert.equal(got[0].pad, pad.pad, '半截的残行不产生任何返回行');
  assert.equal(got[got.length - 1].i, 'last-complete', '末行完整');
  for (const r of got) assert.ok(r.i !== undefined || r.pad !== undefined, '无半行对象');
});

test('A0-5 eventsForTrace: 今昨双文件都扫描、按 timestamp 排序、坏行静默跳过', async () => {
  const mk = (name, rows) =>
    fs.writeFileSync(path.join(fxLogDir, name),
      rows.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
  mk(utcName(0), [
    { traceId: 'trX', timestamp: '2026-09-23T10:00:00.000Z', seq: 2 },
    { traceId: 'trX', timestamp: '2026-09-23T09:00:00.000Z', seq: 1 }, // 同日乱序写入
    { traceId: 'trY', timestamp: '2026-09-23T11:00:00.000Z' },         // 不相关 trace
    '{"traceId":"trX","broken',
  ]);
  mk(utcName(-1), [
    { traceId: 'trX', timestamp: '2026-09-22T23:00:00.000Z', seq: 0 }, // 昨日事件
  ]);
  const got = await log.eventsForTrace('trX');
  assert.deepEqual(got.map(e => e.seq), [0, 1, 2], '双文件命中且按 timestamp 升序');
  assert.equal(got.length, 3, '无关 trace 与坏行不计入');
  assert.deepEqual(await log.eventsForTrace(''), [], '空 traceId 返回空');
});

test('A3-watch 锚定: 首次 stat 非 ENOENT 失败（EPERM）→ 不回放历史；补锚定后追加持续可见', async () => {
  // 覆盖 createLogWatcher 的尾部锚定分支（2026-09-23 修订引入）：启动时文件在但
  // stat 瞬时失败（EPERM/EBUSY 形态）必须保持未锚定、绝不从偏移 0 整文件回放
  // （真实日志 ~295MB/日，回放即事件循环冻结级事故）。statFile 是测试 seam
  // （createLogWatcher 注入点，缺省 fs.statSync）。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-anchor-'));
  const logDir = path.join(root, 'log');
  fs.mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, 'zcode-2026-09-23.jsonl');
  for (let i = 1; i <= 3; i++) { // 启动前已存在的历史
    fs.appendFileSync(file, JSON.stringify({ i }) + '\n');
  }
  const got = [];
  let allowStat = false; // 保持 EPERM 直到测试放行，消除补锚定时序的不确定性
  const eperm = () => Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
  const w = log.createLogWatcher({
    todayFile: () => file,
    statFile: (p) => { if (!allowStat) throw eperm(); return fs.statSync(p); },
    reconcileMs: 50, // 快速对账驱动 pump，缩短等待
    onEvents: evs => got.push(...evs),
  });
  try {
    await sleep(300); // 期间多次 pump 全部 EPERM：锚定保持未完成
    assert.equal(got.length, 0, '非 ENOENT 锚定失败不得回放启动前历史（3 行）');
    fs.appendFileSync(file, JSON.stringify({ i: 4 }) + '\n'); // 未锚定窗口内写入
    fs.appendFileSync(file, JSON.stringify({ i: 5 }) + '\n');
    allowStat = true;
    // 放行后第一次 pump 即补锚定（reconcileMs=50 → 该窗口内必然完成）：锚到当时的
    // size。锚定窗口内已写入的 4/5 行落在「启动对账错过、又不该回放」的模糊带，
    // 实现选择按窄窗取舍锚掉（不丢历史、不回放）——先等补锚定完成，再写 line6
    // 验证续读正确性。
    await sleep(400);
    fs.appendFileSync(file, JSON.stringify({ i: 6 }) + '\n');
    const saw6 = await waitFor(() => got.some(e => e.i === 6), 5000);
    assert.ok(saw6, '补锚定完成后的追加必须可见');
    fs.appendFileSync(file, JSON.stringify({ i: 7 }) + '\n');
    await waitFor(() => got.some(e => e.i === 7), 5000);
    assert.ok(!got.some(e => e.i <= 3), '历史 3 行任何时刻都不得回放');
    assert.ok(!got.some(e => e.i === 4 || e.i === 5), '锚定窗口内写入的行不回读（窄窗取舍，见注）');
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, 'A0-7: 临时目录已清理'); // 守护断言
  }
});

test('A0-5 todayLogFile: UTC 日命名映射（zcode-YYYY-MM-DD.jsonl，落在注入的 LOG_DIR）', () => {
  const d = new Date(Date.UTC(2026, 8, 23, 10, 30, 0)); // 2026-09-23T10:30Z
  assert.equal(log.todayLogFile(d), path.join(fxLogDir, 'zcode-2026-09-23.jsonl'));
  const d2 = new Date(Date.UTC(2026, 11, 31, 23, 59, 0));
  assert.equal(log.todayLogFile(d2), path.join(fxLogDir, 'zcode-2026-12-31.jsonl'));
  // 缺省取当前 UTC 日且真实落在本 fixture（不触碰真实 ~/.zcode）
  assert.ok(log.todayLogFile().startsWith(fxLogDir + path.sep));
});
