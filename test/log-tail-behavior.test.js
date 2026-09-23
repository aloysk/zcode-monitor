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

// 用例名在测试开始时取一次并贯穿全程：若各用例现场重算 utcName()，套件跨
// UTC 午夜运行时前后用例会指向不同文件名（午夜翻转竞态假红）。
const TODAY = utcName(0);
const YESTERDAY = utcName(-1);

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
  const d1 = path.join(fxLogDir, YESTERDAY);
  const d2 = path.join(fxLogDir, TODAY);
  fs.writeFileSync(d1, '{"a":1}\n');
  fs.writeFileSync(d2, '{"a":1}\n{"b":2}\n');
  fs.writeFileSync(path.join(fxLogDir, 'zcode-not-a-date.txt'), 'x'); // 命名不匹配
  fs.writeFileSync(path.join(fxLogDir, 'other.jsonl'), 'x');
  const files = log.listLogFiles();
  const names = files.map(f => f.name);
  assert.deepEqual(names, [TODAY, YESTERDAY], '只含两份日志文件且新日在前');
  for (const f of files) {
    assert.equal(f.path, path.join(fxLogDir, f.name));
    assert.equal(typeof f.size, 'number', 'size 为数值');
    assert.equal(typeof f.mtime, 'number', 'mtime（mtimeMs 数值）为数值');
    assert.equal(f.size, fs.statSync(f.path).size);
  }
});

test('A0-5 tailLog: 返回值与构造行一致、坏行静默跳过、lines 截断取最新', async () => {
  const file = path.join(fxLogDir, TODAY);
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
  const file = path.join(fxLogDir, TODAY);
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
  mk(TODAY, [
    { traceId: 'trX', timestamp: '2026-09-23T10:00:00.000Z', seq: 2 },
    { traceId: 'trX', timestamp: '2026-09-23T09:00:00.000Z', seq: 1 }, // 同日乱序写入
    { traceId: 'trY', timestamp: '2026-09-23T11:00:00.000Z' },         // 不相关 trace
    '{"traceId":"trX","broken',
  ]);
  mk(YESTERDAY, [
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
    // 锚定窗口内写入的 4/5 行属「启动对账错过、又不该回放」的模糊带：现行实现按
    // 窄窗取舍锚掉。不固化为硬契约（未来改为补投递不算回归），只照录投递形态。
    console.log(`[A3-watch] 锚定窗口内写入行(4/5)投递形态: ${
      got.filter(e => e.i === 4 || e.i === 5).map(e => e.i).join(',') || '未投递'}`);
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

test('A0-5 defaultTodayFile: 取目录内字典序最新的匹配名（非日期名干扰项不参与）', () => {
  // 幂等自备所需文件（低-k）：不依赖前序用例的落盘顺序，缺席才补写——
  // 已存在的内容（前序用例写入的事件行）原样保留，不覆写。
  for (const n of [TODAY, YESTERDAY]) {
    if (!fs.existsSync(path.join(fxLogDir, n))) fs.writeFileSync(path.join(fxLogDir, n), '{"a":1}\n');
  }
  if (!fs.existsSync(path.join(fxLogDir, 'zcode-not-a-date.txt'))) {
    fs.writeFileSync(path.join(fxLogDir, 'zcode-not-a-date.txt'), 'x');
  }
  // 名字最新的匹配文件是 TODAY，干扰项不构成候选。
  assert.equal(log.defaultTodayFile(), path.join(fxLogDir, TODAY));
  // 再放一个名字更大的匹配文件后立即切换（本地日命名下"最新名"同理）
  const later = 'zcode-2999-12-31.jsonl';
  fs.writeFileSync(path.join(fxLogDir, later), '{"x":1}\n');
  try {
    assert.equal(log.defaultTodayFile(), path.join(fxLogDir, later));
  } finally {
    fs.rmSync(path.join(fxLogDir, later));
  }
});

test('A0-5 defaultTodayFile: LOG_DIR 不可读（readdir 抛错）→ 回退 todayLogFile() 的 UTC 日映射', async () => {
  // LOG_DIR 在 require 时捕获，主进程无法换注入：用子进程指向一个普通文件
  //（readdirSync 对非目录抛 ENOTDIR）验证回退路径。
  const { execFile } = require('child_process');
  const notDir = path.join(fxRoot, 'not-a-dir.txt');
  fs.writeFileSync(notDir, 'x');
  const script = 'const l = require(' + JSON.stringify(path.join(__dirname, '..', 'server', 'log-tail.js')) + ');'
    + 'process.stdout.write(l.defaultTodayFile() === l.todayLogFile() ? "SAME" : "DIFF:" + l.defaultTodayFile());';
  const out = await new Promise((resolve) => {
    execFile(process.execPath, ['-e', script],
      { env: Object.assign({}, process.env, { ZCODE_LOG_DIR: notDir }) },
      (err, stdout) => resolve(err ? 'ERR:' + err.message : String(stdout)));
  });
  assert.equal(out, 'SAME', 'readdir 失败时回退 UTC 日映射: ' + out);
});

test('A0-5 tailLog/eventsForTrace 跟随名字最新文件（本地日命名跨本地午夜也可见）', async () => {  // ZCode 实测按本地日命名轮转（docs/acceptance/T6-latency-samples.md §4）：本地
  // 00:00-08:00 期间 UTC 名（todayLogFile）是"昨天"，只有名字最新语义能追上真实
  // 活跃文件。用本地日 +2 天构造必然大于 UTC 今日名的文件名（任何时区下本地日期
  // ≥ UTC 日期 − 1，+2 后必严格更大）。
  const d = new Date();
  d.setDate(d.getDate() + 2);
  const localLater = `zcode-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.jsonl`;
  fs.writeFileSync(path.join(fxLogDir, localLater),
    JSON.stringify({ traceId: 'trLocal', timestamp: '2026-09-24T00:05:00.000Z', seq: 1 }) + '\n'
    + JSON.stringify({ traceId: 'trLocal', timestamp: '2026-09-24T00:06:00.000Z', seq: 2 }) + '\n');
  try {
    const got = await log.tailLog({ lines: 10 });
    assert.deepEqual(got.slice(-2).map(e => e.seq), [1, 2], '读的是最新名文件而非 UTC 名旧文件');
    // eventsForTrace 扫描"最新+次新"两个名字：最新名文件命中；第三新（YESTERDAY，
    // trX 在彼处只有 1 行）被挤出窗口——trX 只余 TODAY 的 2 行（窗口=两文件的
    // 既有语义在名字序下同样成立）
    const evs = await log.eventsForTrace('trLocal');
    assert.deepEqual(evs.map(e => e.seq), [1, 2]);
    assert.equal((await log.eventsForTrace('trX')).length, 2, '窗口恰为最新两个名字');
  } finally {
    fs.rmSync(path.join(fxLogDir, localLater));
  }
});

// 高-B 回归（R2）：watcher 已在最新名文件上锚定后，名字回归到旧文件、而该
// 文件在 readdir→stat 窗口内被删除——ENOENT seenBefore 分支必须复位锚定态，
// 复活后按 size 补锚定；若沿用旧文件的已锚定标记（R1 缺陷），复活文件会从
// offset=0 整文件回放（评审复现投递 [3,0,1,2,3,4]）。缺省解析走 defaultTodayFile
//（seenFiles 即 readdir 证据），todayFile 包装器做名字回归，statFile seam 在
// readdir→stat 窗口删文件。
test('A3-watch 复活: 回归锚定窗内文件被删 → 复活后按 size 补锚定，仅新增行可见', async () => {
  const A = 'zcode-2099-12-30.jsonl';
  const B = 'zcode-2099-12-31.jsonl';
  const aPath = path.join(fxLogDir, A);
  const bPath = path.join(fxLogDir, B);
  fs.writeFileSync(aPath, [0, 1, 2].map(i => JSON.stringify({ i })).join('\n') + '\n'); // 旧名文件（回归目标）
  fs.writeFileSync(bPath, '{"i":0}\n');                                                // 最新名文件（启动锚定）
  const got = [];
  let phase = 0; // 0=缺省（最新名 B）；1=名字回归（A）
  let killA = true;
  // 生产形态的 todayFile 就是 defaultTodayFile 本身（seenFiles 是 readdir 证据的
  // 载体）；包装器须透传该证据，否则被测分支读不到 seenBefore。
  const todayWrapper = () => (phase === 1 ? aPath : log.defaultTodayFile());
  todayWrapper.seenFiles = log.defaultTodayFile.seenFiles;
  const w = log.createLogWatcher({
    reconcileMs: 100,
    todayFile: todayWrapper,
    statFile: (p) => {
      // A 首次被 stat 时删除它：此前 pump 的 readdir 已把 A 记入 seenFiles，
      // 回归换名的锚定 stat 落在删除之后 → ENOENT + seenBefore
      if (killA && p === aPath) { killA = false; fs.rmSync(aPath); }
      return fs.statSync(p);
    },
    onEvents: evs => got.push(...evs),
  });
  try {
    await sleep(300); // 锚定 B（预置行不投递）
    fs.appendFileSync(bPath, JSON.stringify({ i: 3 }) + '\n');
    assert.ok(await waitFor(() => got.some(e => e.i === 3), 5000), 'B 上已锚定并续读');
    phase = 1; // 名字回归到 A：A 在锚定 stat 窗口内被删（ENOENT + seenBefore）
    await sleep(350);
    assert.ok(!got.some(e => e.i === 0 || e.i === 1 || e.i === 2), '被删文件不产生任何投递');
    fs.writeFileSync(aPath, [0, 1, 2].map(i => JSON.stringify({ i })).join('\n') + '\n'); // 同名复活（旧内容形态）
    await sleep(350); // 复活后按当刻 size 补锚定（R1 缺陷形态：从 0 回放 [0,1,2]）
    fs.appendFileSync(aPath, JSON.stringify({ i: 4 }) + '\n');
    assert.ok(await waitFor(() => got.some(e => e.i === 4), 5000), '补锚定后的新增行可见');
    assert.deepEqual(got.map(e => e.i), [3, 4], '复活文件仅新增行可见，旧内容不回放');
  } finally {
    w.stop();
    fs.rmSync(aPath, { force: true });
    fs.rmSync(bPath, { force: true });
  }
});
