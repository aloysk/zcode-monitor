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
const { checkpointNow, walStatus } = require(path.join(__dirname, '..', 'server', 'zcode-runtime.js'));

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
