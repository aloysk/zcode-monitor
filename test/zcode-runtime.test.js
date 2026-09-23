'use strict';
// test/zcode-runtime.test.js — checkpointNow 的真实（不 mock）WAL 行为测试（R3 必修-1）。
// 修前缺陷：better-sqlite3 的 wal_checkpoint(TRUNCATE) 返回行对象数组
// [{busy,log,checkpointed}]，代码按裸值数组解读（result[0] 当 busy 数值、
// result[2] 当 checkpointed）→ busy===1 恒假、busy 竞争误报成功。本文件在
// tmpdir 的真实 WAL 库上复核两种形态：写连接持读锁 → busy=1 必须如实传播；
// 正常路径 → -wal 折叠为 0 且返回载荷数值正确。绝不触碰真实 ~/.zcode。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { checkpointNow, walStatus, makeRuntimeProbeHandler } = require(path.join(__dirname, '..', 'server', 'zcode-runtime.js'));

function makeWalDb(root, name) {
  const dbPath = path.join(root, name);
  const conn = new Database(dbPath);
  conn.pragma('journal_mode = WAL');
  conn.exec('CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER)');
  return { dbPath, conn };
}

// Windows 收尾：连接 close 后立即删除 tmpdir 偶发 EPERM（-wal/-shm 句柄释放
// 滞后），rmSync 的内建重试不足时补同步退避（Atomics.wait 在 node:test 子进程
// 可用），重试耗尽仍失败才如实抛出
function rmRoot(root) {
  // 先退避再删：better-sqlite3 全部连接 close 后，-wal/-shm 的目录句柄在
  // Windows 上仍有 ~200ms 释放滞后（node --test 运行器下实测），立刻 rm 必 EPERM
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  for (let i = 0; i < 4; i++) {
    try { fs.rmSync(root, { recursive: true, force: true }); return; }
    catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

test.after(() => {
  // 各用例自清理；此处只守护根目录已删（A0-7 同法）
});

test('checkpointNow 正常路径：busy=0、-wal 折叠为 0、checkpointed 为数值帧数', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-ckpt-ok-'));
  try {
    const { dbPath, conn } = makeWalDb(root, 'ok.sqlite');
    // 写入若干行让 -wal 有帧（写连接保持打开：close 会触发 SQLite 自身的
    // 退出 checkpoint 并清掉 -wal，测不到折叠路径）
    const ins = conn.prepare('INSERT INTO t VALUES (?, ?)');
    for (let i = 0; i < 50; i++) ins.run('r' + i, i);
    const before = walStatus(dbPath);
    assert.ok(before.walBytes > 0, '前置：-wal 非空才有折叠可验证');

    const r = checkpointNow(dbPath);
    assert.equal(r.ok, true);
    assert.equal(r.busy, 0, '无锁竞争时 busy 必须是数值 0（而非行对象）');
    // 帧数下界不做断言：checkpoint 连接打开时的被动恢复可能已把帧折进主库
    //（log=0 也可后随 TRUNCATE 清空文件），折叠语义由下面的 after.walBytes===0
    // 与新只读连接可见性承载
    assert.equal(typeof r.checkpointed, 'number', 'checkpointed 必须是数值帧数');
    assert.equal(r.after.walBytes, 0, 'TRUNCATE 后 -wal 折叠为 0');
    // 折叠后新开只读连接能看到全部数据（本模块的存在意义）
    const ro = new Database(dbPath, { readonly: true });
    assert.equal(ro.prepare('SELECT COUNT(*) c FROM t').get().c, 50);
    ro.close();
    conn.close();
  } finally {
    rmRoot(root);
    assert.equal(fs.existsSync(root), false, 'A0-7: fixture 目录已清理');
  }
});

test('checkpointNow busy 路径：另一连接持读锁 → busy=1 如实传播（不误报成功）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-ckpt-busy-'));
  try {
    const { dbPath, conn } = makeWalDb(root, 'busy.sqlite');
    const ins = conn.prepare('INSERT INTO t VALUES (?, ?)');
    for (let i = 0; i < 50; i++) ins.run('r' + i, i);

    // 读者持未决读事务：TRUNCATE 无法完成（无法重置 WAL）→ busy=1。
    // 这是修前「result[0] 当 busy」恒假漏掉的真实形态。
    const reader = new Database(dbPath);
    reader.exec('BEGIN');
    reader.prepare('SELECT COUNT(*) c FROM t').get();

    const r = checkpointNow(dbPath);
    assert.equal(r.ok, true);
    assert.equal(r.busy, 1, '读锁被占时 busy=1 必须如实传播（修前恒为行对象≠1）');
    assert.equal(typeof r.checkpointed, 'number', 'busy 形态下 checkpointed 也是数值');

    // 释放读锁后重试：回到正常路径（index.js 的 checkpointRetryPending 语义）
    reader.exec('COMMIT');
    reader.close();
    const r2 = checkpointNow(dbPath);
    assert.equal(r2.busy, 0);
    assert.equal(r2.after.walBytes, 0);
    conn.close();
  } finally {
    rmRoot(root);
    assert.equal(fs.existsSync(root), false, 'A0-7: fixture 目录已清理');
  }
});

test('checkpointNow 失败路径：路径不可达 → ok:false 带错误信息', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-ckpt-miss-'));
  try {
    // 用不存在的父目录：better-sqlite3 可写打开会创建库文件，只有目录不可达才失败
    const r = checkpointNow(path.join(root, 'no-such-dir', 'nope.sqlite'));
    assert.equal(r.ok, false);
    assert.ok(typeof r.error === 'string' && r.error.length > 0);
  } finally {
    rmRoot(root);
  }
});

// ── R4 修-medium：makeRuntimeProbeHandler 的首探测播种语义（b66842f 回归守护）──
// runtime 依赖全部注入 stub；probe 回调直接调用（index.js 只保留节流/定时器）。
function stubRuntime({ idleMs = null, busy = 0, fail = false } = {}) {
  return {
    walIdleMs: () => idleMs,
    walStatus: () => ({ walBytes: 10, shmBytes: 0, mainBytes: 100 }),
    checkpointNow: () => ({ ok: !fail, busy, error: fail ? 'boom' : undefined,
      after: { walBytes: 2, shmBytes: 0, mainBytes: 108 } }),
  };
}

test('makeRuntimeProbeHandler: 首探测只播种 running——boot 前 ZCode 已退出不触发 checkpoint', () => {
  const rt = stubRuntime();
  const calls = [];
  rt.checkpointNow = () => { calls.push(1); return { ok: true, busy: 0, after: { walBytes: 0 } }; };
  const state = { running: true, lastCheckpoint: null };
  let invalidated = 0;
  const h = makeRuntimeProbeHandler({
    dbPath: 'unused', runtimeState: state, activeWindowMs: 60 * 1000,
    invalidateDb: () => { invalidated++; }, runtime: rt,
  });

  // 回归形态：乐观 running=true + 首探测 false（ZCode 启动前已退出、-wal 静默）
  //——修前 wasRunning&&!running 在 boot 即同步 checkpoint；修后只播种。
  h(false);
  assert.equal(state.running, false, '首探测播种探测结果');
  assert.equal(calls.length, 0, '首探测不得触发 checkpoint（don\'t checkpoint at boot）');
  assert.equal(state.lastCheckpoint, null);
  assert.equal(invalidated, 0);

  // 后续探测无转移（false→false）：仍不 checkpoint
  h(false);
  assert.equal(calls.length, 0);
});

test('makeRuntimeProbeHandler: 真实转移（running→stopped）触发 checkpoint；busy 置重试、下周期仍停时重试', () => {
  const state = { running: true, lastCheckpoint: null };
  let invalidated = 0;
  let busyNow = 0;
  const results = [];
  const rt = {
    walIdleMs: () => null,
    walStatus: () => ({ walBytes: 10, shmBytes: 0, mainBytes: 100 }),
    checkpointNow: () => { results.push(busyNow); return {
      ok: true, busy: busyNow, after: { walBytes: 2, shmBytes: 0, mainBytes: 108 } }; },
  };
  const h = makeRuntimeProbeHandler({
    dbPath: 'unused', runtimeState: state, activeWindowMs: 60 * 1000,
    invalidateDb: () => { invalidated++; }, runtime: rt,
  });

  h(true);                       // 播种：running
  assert.equal(results.length, 0);
  h(true);                       // running→running：无转移
  assert.equal(results.length, 0);

  busyNow = 0;
  h(false);                      // 真实转移 → checkpoint 成功
  assert.equal(results.length, 1);
  assert.equal(state.lastCheckpoint.ok, true);
  assert.equal(state.lastCheckpoint.walBefore, 10);
  assert.equal(state.lastCheckpoint.walAfter, 2);
  assert.equal(invalidated, 1);

  h(true);                       // 回到 running（播种后正常转移判断）
  busyNow = 1;
  h(false);                      // 转移 → checkpoint busy=1 → 记录失败 + 置重试
  assert.equal(results.length, 2);
  assert.equal(state.lastCheckpoint.ok, false);
  assert.equal(state.lastCheckpoint.error, 'checkpoint_busy');
  h(false);                      // 仍停止 → busy 重试一次
  assert.equal(results.length, 3);

  // R5（测试质量补测 T4）：busy 重试成功后 pending 清零——下个无转移周期不再
  // checkpoint（results 计数稳定），lastCheckpoint 停留在成功形态。
  busyNow = 0;
  h(false);                      // pending → 重试成功一次
  assert.equal(results.length, 4, 'busy 后的下个周期恰好重试一次');
  assert.equal(state.lastCheckpoint.ok, true);
  h(false);                      // 无转移 + pending 已清零 → 不再 checkpoint
  assert.equal(results.length, 4, '重试成功后不得继续 checkpoint（计数稳定）');
  assert.equal(state.lastCheckpoint.ok, true, 'lastCheckpoint 保持在成功形态');
});

test('makeRuntimeProbeHandler: 进程探测误报被 -wal 活跃否决（不与真实 writer 抢锁）', () => {
  const rt = stubRuntime({ idleMs: 1000 }); // -wal 1s 前有写入 < 60s 窗口
  const calls = [];
  rt.checkpointNow = () => { calls.push(1); return { ok: true, busy: 0, after: { walBytes: 0 } }; };
  const state = { running: true, lastCheckpoint: null };
  const h = makeRuntimeProbeHandler({
    dbPath: 'unused', runtimeState: state, activeWindowMs: 60 * 1000,
    invalidateDb: () => {}, runtime: rt,
  });

  h(false); // 首探测播种：误报否决后播种 true
  assert.equal(state.running, true);
  h(false); // 后续：running→running（否决后仍 true），无转移
  assert.equal(calls.length, 0, '-wal 活跃时绝不 checkpoint');
});
