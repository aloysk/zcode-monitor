'use strict';
// test/snapshot-watch.test.js — 快照绊线（server/snapshot-watch.js）。
// 实现轮：纯函数 + tmpdir 集成 + 路由 + 源码契约。
// 加固轮（实现后五视角对抗评审）：FSWatcher error 监听、EPERM 分级+零点
// 重锚、modified 集成路径、明细截断/排序/_sig 剥离、封顶三条、真实 fs.watch。
// 终审轮（pr-review-toolkit 六视角全量审查）：子目录级读失败 partial 分级
// （读失败不得折叠成签名变化——防假告警/防吞活动）、截断的 boot 扫描不得
// 锚零点、`__proto__` 目录名、slice 截断置位 truncated、parent 降级分支与
// filename 过滤、armWatch 部分成功回收、stop() 语义、挂载序契约、组合 diff。
// （轮次措辞刻意不用 R1/R2 编号——与 docs/acceptance/residuals.md 的加固
// 轮次编号撞车易混。）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const {
  createSnapshotWatcher, makeSnapshotRoute,
  parseStateSummary, validHashName, scanDir, fingerprintOf, diffScans, classify,
  LIMITS,
} = require('../server/snapshot-watch');
const fsPromises = require('fs').promises;

function tmpRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/// 轮询等待条件成立（集成用例的确定性助手）
async function until(cond, { timeoutMs = 5000, stepMs = 25 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return cond();
}

function makeWs(root, hash, { stateJson, encBytes = 1024 } = {}) {
  const ws = path.join(root, hash);
  fs.mkdirSync(path.join(ws, 'pending'), { recursive: true });
  if (stateJson != null) fs.writeFileSync(path.join(ws, 'state.json'), stateJson);
  if (encBytes > 0) {
    fs.writeFileSync(path.join(ws, 'pending', 'm.1.tar.gz.enc'), Buffer.alloc(encBytes, 7));
  }
  return ws;
}

const stateOf = (p, fail) => JSON.stringify({ workspacePath: p, failureCount: fail });
/// 可翻转 EPERM 的 fsapi 包装（默认透传真实 fs.promises）——顶层 readdir 整目录不可读
function flakyFs(real, flag) {
  return {
    readdir: (...a) => flag.on
      ? Promise.reject(Object.assign(new Error('EPERM: operation not permitted, readdir'), { code: 'EPERM' }))
      : real.readdir(...a),
    stat: (...a) => real.stat(...a),
    readFile: (...a) => real.readFile(...a),
  };
}
/// 可翻转 EPERM 的 fsapi 包装——仅 pending/ 子目录读失败（子目录级部分不可读）
function partialFs(real, flag) {
  return {
    readdir: (p, ...rest) => (flag.on && String(p).endsWith('pending')
      ? Promise.reject(Object.assign(new Error('EPERM: operation not permitted, readdir'), { code: 'EPERM' }))
      : real.readdir(p, ...rest)),
    stat: (...a) => real.stat(...a),
    readFile: (...a) => real.readFile(...a),
  };
}
const watchStubUnavailable = () => { throw new Error('watch unavailable in test'); };

// ── 纯函数 ───────────────────────────────────────────────────────────
test('parseStateSummary: 完整/缺字段/损坏 JSON/非对象/路径截断', () => {
  const full = parseStateSummary(JSON.stringify({
    workspacePath: 'F:\\project\\X',
    failureCount: 3,
    lastCompressedSize: { encryptedSizeBytes: 100, recordedAt: 1783142785314 },
  }));
  assert.deepEqual(full, { path: 'F:\\project\\X', failureCount: 3, recordedAtMs: 1783142785314 });

  // failureCount / lastCompressedSize 缺失：0 与 null（上游同款容错）
  assert.deepEqual(
    parseStateSummary('{"workspacePath":"x"}'),
    { path: 'x', failureCount: 0, recordedAtMs: null });
  // workspacePath 非字符串 → null 字段；截断到 260
  const long = 'P'.repeat(400);
  const t = parseStateSummary(`{"workspacePath":"${long}","failureCount":1}`);
  assert.equal(t.path.length, 260);
  assert.equal(parseStateSummary('{"failureCount":1}').path, null);

  // 损坏 JSON / 非对象（数组、数字）→ null
  assert.equal(parseStateSummary('{oops'), null);
  assert.equal(parseStateSummary('[1,2]'), null);
  assert.equal(parseStateSummary('42'), null);
  assert.equal(parseStateSummary('null'), null);
});

test('validHashName: 哈希形态放行；路径穿越/隐藏名/空格/超长一律拒绝', () => {
  for (const ok of ['ab12cd34', 'A-b_C9', 'x'.repeat(128)]) assert.equal(validHashName(ok), true, ok);
  for (const bad of ['', '..', 'a/b', 'a\\b', '/etc', '.hidden', 'a b', '哈希', 'x'.repeat(129), null, undefined, 42]) {
    assert.equal(validHashName(bad), false, String(bad));
  }
});

test('diffScans: 新增/移除/签名变化 → changed；完全一致 → 不变', () => {
  const sig = (m, s, c, b) => ({ m, s, c, b });
  const base = { ws: { a: sig(1, 10, 1, 100), b: sig(2, 20, 2, 200) }, totals: { workspaces: 2, artifacts: 3, bytes: 300 } };

  const same = diffScans(base, { ws: { a: sig(1, 10, 1, 100), b: sig(2, 20, 2, 200) }, totals: base.totals });
  assert.equal(same.changed, false);

  const added = diffScans(base, { ws: { a: sig(1, 10, 1, 100), b: sig(2, 20, 2, 200), c: sig(3, 30, 0, 0) }, totals: { workspaces: 3, artifacts: 3, bytes: 300 } });
  assert.equal(added.changed, true);
  assert.deepEqual(added.added, ['c']);
  assert.equal(added.bytesDelta, 0);

  const removed = diffScans(base, { ws: { a: sig(1, 10, 1, 100) }, totals: { workspaces: 1, artifacts: 1, bytes: 100 } });
  assert.equal(removed.changed, true);
  assert.deepEqual(removed.removed, ['b']);

  // 上传重试失败计数/工件增长 = state.json 或 pending 变化 → 活动
  const grown = diffScans(base, { ws: { a: sig(1, 10, 1, 100), b: sig(3, 25, 3, 450) }, totals: { workspaces: 2, artifacts: 4, bytes: 550 } });
  assert.equal(grown.changed, true);
  assert.deepEqual(grown.modified, ['b']);
  assert.equal(grown.bytesDelta, 250);
});

test('diffScans totals 语义钉住: 逐 hash 签名全同 → 不判活动（totals 仅供 bytesDelta）', () => {
  const sig = (m, s, c, b) => ({ m, s, c, b });
  const ws = { a: sig(1, 10, 1, 100) };
  // totals 与签名数学上同源；构造「签名相同而 totals 不同」的畸形输入只为
  // 钉住 changed 只看 ws 签名——后来人不应把 totals 加进判定（fingerprintOf
  // 头注的历史注释曾宣称此防线存在，实现并无，按实现收口）
  const r = diffScans({ ws, totals: { workspaces: 1, artifacts: 1, bytes: 100 } },
                      { ws, totals: { workspaces: 9, artifacts: 9, bytes: 900 } });
  assert.equal(r.changed, false);
  assert.equal(r.bytesDelta, 800);
});

test('diffScans 组合迁移: 一次 diff 同时 added+removed+modified', () => {
  const sig = (m, s, c, b) => ({ m, s, c, b });
  const base = { ws: { a: sig(1, 10, 1, 100), b: sig(2, 20, 2, 200), c: sig(3, 30, 3, 300) },
                 totals: { workspaces: 3, artifacts: 6, bytes: 600 } };
  const cur = { ws: { a: sig(9, 99, 9, 900), c: sig(3, 30, 3, 300), d: sig(4, 40, 4, 400) },
                totals: { workspaces: 3, artifacts: 16, bytes: 1600 } };
  const r = diffScans(base, cur);
  assert.equal(r.changed, true);
  assert.deepEqual(r.modified, ['a']);
  assert.deepEqual(r.removed, ['b']);
  assert.deepEqual(r.added, ['d']);
  assert.equal(r.bytesDelta, 1000); // +900(a) -200(b) +400(d) 净值
});

test('fingerprintOf: `__proto__` 目录名不 Invisible（null 原型键容器）', () => {
  // validHashName 放行 `__proto__` 形态名；普通对象下它会改写原型而非建
  // 自有键（Object.keys 不可见 → 该目录对绊线隐形）。null 原型容器修复。
  const scan = { exists: true, unreadable: false, partial: false, truncated: false, readError: null,
                 totals: { workspaces: 2, artifacts: 0, bytes: 0 }, lastWriteMs: 1,
                 workspaces: [
                   { hash: '__proto__', path: null, failureCount: 0, recordedAtMs: null, encCount: 0, encBytes: 0, lastWriteMs: 1, _sig: { m: 5, s: 5, c: 0, b: 0 } },
                   { hash: 'aa', path: null, failureCount: 0, recordedAtMs: null, encCount: 0, encBytes: 0, lastWriteMs: 1, _sig: { m: 5, s: 5, c: 0, b: 0 } },
                 ] };
  const fp = fingerprintOf(scan);
  assert.deepEqual(Object.keys(fp.ws).sort(), ['__proto__', 'aa'], '__proto__ 目录须是可见自有键');
});

test('classify: 闩锁恒 active；不可读单列 unreadable；无内容 clear；有内容 static', () => {
  const totals0 = { workspaces: 0, artifacts: 0, bytes: 0 };
  const totalsN = { workspaces: 3, artifacts: 5, bytes: 1000 };
  assert.equal(classify({ exists: false, unreadable: false, totals: totalsN, latched: false }), 'clear');
  assert.equal(classify({ exists: true, unreadable: false, totals: totals0, latched: false }), 'clear');
  assert.equal(classify({ exists: true, unreadable: false, totals: totalsN, latched: false }), 'static');
  // 不可读绝不折叠成 clear（ACL 锁定后属预期态，绊线失明必须显性可见）
  assert.equal(classify({ exists: true, unreadable: true, totals: totals0, latched: false }), 'unreadable');
  // 闩锁优先：上传后 ZCode 清空目录（回落为空）也保持告警
  assert.equal(classify({ exists: true, unreadable: false, totals: totals0, latched: true }), 'active');
  assert.equal(classify({ exists: false, unreadable: false, totals: totals0, latched: true }), 'active');
});

// ── scanDir（真实 fs）────────────────────────────────────────────────
test('scanDir: 完整工作区字段解析；损坏 state.json 容错；非法名忽略；目录缺失', async () => {
  const root = tmpRoot('zcmon-snap-scan-');
  try {
    makeWs(root, 'aa11', {
      stateJson: JSON.stringify({
        workspacePath: 'F:\\project\\ZhuiZhu',
        failureCount: 3,
        lastCompressedSize: { encryptedSizeBytes: 138158, recordedAt: 1783142785314 },
      }),
      encBytes: 4096,
    });
    makeWs(root, 'bb22', { stateJson: '{oops', encBytes: 100 }); // 损坏 state
    makeWs(root, '.hidden', { stateJson: '{}', encBytes: 1 });   // 非法名：忽略
    fs.mkdirSync(path.join(root, 'cc33'));                        // 空工作区目录（无 pending/state）

    const s = await scanDir(fsPromises, root);
    assert.equal(s.exists, true);
    assert.equal(s.unreadable, false);
    assert.equal(s.totals.workspaces, 3, '非法名不计，空目录计');
    assert.equal(s.totals.artifacts, 2);
    assert.equal(s.totals.bytes, 4096 + 100);

    const a = s.workspaces.find((w) => w.hash === 'aa11');
    assert.equal(a.path, 'F:\\project\\ZhuiZhu');
    assert.equal(a.failureCount, 3);
    assert.equal(a.recordedAtMs, 1783142785314);
    assert.equal(a.encCount, 1);
    assert.equal(a.encBytes, 4096);
    assert.ok(a.lastWriteMs > 0, 'state.json/工件 mtime 进 lastWriteMs');

    const b = s.workspaces.find((w) => w.hash === 'bb22');
    assert.equal(b.path, null, '损坏 state.json：字段留空、目录照常计入');
    assert.equal(b.encBytes, 100);

    // 目录缺失（ENOENT）→ exists:false 空摘要（不抛）
    const miss = await scanDir(fsPromises, path.join(root, 'no-such-dir'));
    assert.equal(miss.exists, false);
    assert.equal(miss.unreadable, false);
    assert.equal(miss.totals.workspaces, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scanDir: readdir 错误码分级——ENOENT=缺失、EPERM=不可读（绝不折叠成无内容）', async () => {
  const mkErr = (code) => (Object.assign(new Error(code + ': op not permitted'), { code }));
  const stub = (code) => ({
    readdir: () => Promise.reject(mkErr(code)),
    stat: () => Promise.reject(mkErr(code)),
    readFile: () => Promise.reject(mkErr(code)),
  });
  const enoent = await scanDir(stub('ENOENT'), 'X:/nope');
  assert.equal(enoent.exists, false);
  assert.equal(enoent.unreadable, false);

  const eperm = await scanDir(stub('EPERM'), 'X:/locked');
  assert.equal(eperm.exists, true, '权限被拒说明目录在');
  assert.equal(eperm.unreadable, true);
  assert.equal(eperm.readError, 'EPERM');
  assert.equal(eperm.totals.workspaces, 0);
});

test('scanDir: 工作区数封顶（异常大的目录不得变长任务）且如实置 truncated', async () => {
  const root = tmpRoot('zcmon-snap-cap-');
  try {
    for (let i = 0; i < LIMITS.MAX_WORKSPACES + 3; i++) {
      fs.mkdirSync(path.join(root, 'w' + String(i).padStart(4, '0')));
    }
    const s = await scanDir(fsPromises, root);
    assert.equal(s.totals.workspaces, LIMITS.MAX_WORKSPACES);
    assert.equal(s.truncated, true, 'slice 截断须置位 truncated（截断如实标注，调用方据此豁免差异判定）');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scanDir: 单区工件数封顶（桩 fsapi：2003 个 .enc 只 stat 2000）', async () => {
  const dirents = Array.from({ length: LIMITS.MAX_ENC_PER_WS + 3 }, (_, i) => ({
    name: 'e' + i + '.tar.gz.enc', isFile: () => true, isDirectory: () => false,
  }));
  let pendingCalls = 0;
  const stub = {
    // 第一次 readdir = checkpoints 根（1 个工作区目录），其后 = pending/
    readdir: async (p) => {
      pendingCalls++;
      if (pendingCalls === 1) return [{ name: 'aa11', isDirectory: () => true, isFile: () => false }];
      return dirents;
    },
    stat: async () => ({ size: 10, mtimeMs: 123 }),
    readFile: async () => { throw new Error('not read'); },
  };
  const s = await scanDir(stub, 'X:/ck');
  const ws = s.workspaces[0];
  assert.equal(ws.encCount, LIMITS.MAX_ENC_PER_WS);
  assert.equal(ws.encBytes, LIMITS.MAX_ENC_PER_WS * 10);
  assert.equal(s.truncated, true, '单区工件 slice 截断须置位 truncated（截断如实标注）');
});

test('scanDir: state.json 超 64KB 不读（字段空），但 stat 仍进签名（变化检测不失效）', async () => {
  const root = tmpRoot('zcmon-snap-bigstate-');
  try {
    const ws = path.join(root, 'aa11');
    fs.mkdirSync(ws);
    fs.writeFileSync(path.join(ws, 'state.json'), Buffer.alloc(LIMITS.STATE_JSON_MAX_BYTES + 1, 0x20));
    const s = await scanDir(fsPromises, root);
    assert.equal(s.totals.workspaces, 1);
    assert.equal(s.workspaces[0].path, null, '超大 state.json 不读');
    assert.ok(s.workspaces[0]._sig.m > 0, 'stat(mtime) 仍取到——重写超大文件依旧触发活动');
    assert.equal(s.workspaces[0]._sig.s, LIMITS.STATE_JSON_MAX_BYTES + 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── createSnapshotWatcher（绊线语义，watch 桩强制纯轮询换确定性）──────
test('绊线: boot 空目录 clear → 落盘新快照 active（闩锁：清空后仍 active）', async () => {
  const root = tmpRoot('zcmon-snap-trip-');
  const ckpt = path.join(root, 'checkpoints');
  fs.mkdirSync(ckpt);
  const w = createSnapshotWatcher({ dir: ckpt, pollMs: 120, watch: watchStubUnavailable });
  try {
    assert.ok(await until(() => w.state().status === 'clear'), 'boot 空目录应进 clear');
    assert.equal(w.state().watchMode, 'poll', 'watch 桩抛错 → 降级纯轮询');
    assert.ok(w.state().watchError, '降级原因如实上报');

    // 模拟机制复活：新工作区快照落盘
    const ENC = 2 * 1024 * 1024 + 123;
    makeWs(ckpt, 'ff99', { stateJson: stateOf('F:\\project\\victim', 0), encBytes: ENC });
    assert.ok(await until(() => w.state().status === 'active'), '新增快照应触发 active');
    const s1 = w.state();
    assert.ok(s1.firstActivityAt, '首判时刻落位');
    assert.deepEqual(s1.activityDetail.added, ['ff99']);
    assert.equal(s1.activityDetail.bytesDelta, ENC);
    assert.equal(s1.current.workspaces, 1);
    assert.equal(s1.workspaces[0].path, 'F:\\project\\victim');

    // 闩锁：ZCode 上传成功后清理目录 → 扫描回落为空，告警保持
    fs.rmSync(path.join(ckpt, 'ff99'), { recursive: true, force: true });
    assert.ok(await until(() => w.state().current.workspaces === 0), '清理后目录回落为空');
    await new Promise((r) => setTimeout(r, 250)); // 再等一拍确认不回落
    assert.equal(w.state().status, 'active', '闩锁语义：目录清空后保持 active');
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('绊线: 既有工作区 state.json 变化（重试计数增长）→ active（modified 路径）', async () => {
  const root = tmpRoot('zcmon-snap-mod-');
  const ckpt = path.join(root, 'checkpoints');
  makeWs(ckpt, 'ab12', { stateJson: stateOf('F:\\project\\x', 9), encBytes: 4096 });
  const w = createSnapshotWatcher({ dir: ckpt, pollMs: 120, watch: watchStubUnavailable });
  try {
    assert.ok(await until(() => w.state().status === 'static'), '遗留内容起步 static');
    // 模拟上传失败计数 9→11：state.json 被重写（mtime/size 变化）
    fs.writeFileSync(path.join(ckpt, 'ab12', 'state.json'), stateOf('F:\\project\\x', 11));
    assert.ok(await until(() => w.state().status === 'active'), 'state.json 变化应触发 active');
    assert.deepEqual(w.state().activityDetail.modified, ['ab12']);
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('绊线: 目录缺失起步 → 建目录落内容同样告警；boot 已有内容判 static 不误报', async () => {
  const root = tmpRoot('zcmon-snap-miss-');
  const ckpt = path.join(root, 'checkpoints'); // 起步不存在
  const w = createSnapshotWatcher({ dir: ckpt, pollMs: 120, watch: watchStubUnavailable });
  try {
    assert.ok(await until(() => w.state().exists === false && w.state().status === 'clear'), '缺失目录 = clear');

    makeWs(ckpt, 'abcd', { stateJson: stateOf('F:\\p', 1), encBytes: 5 });
    assert.ok(await until(() => w.state().status === 'active'), '目录出现+落内容 → 告警');
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }

  // boot 时目录已有遗留内容：零点 = 现状 → static（不误报），新增才 active
  const root2 = tmpRoot('zcmon-snap-static-');
  const ckpt2 = path.join(root2, 'checkpoints');
  makeWs(ckpt2, 'legacy1', { stateJson: stateOf('F:\\old', 9), encBytes: 4096 });
  const w2 = createSnapshotWatcher({ dir: ckpt2, pollMs: 120, watch: watchStubUnavailable });
  try {
    assert.ok(await until(() => w2.state().status === 'static'), '遗留内容 → static');
    makeWs(ckpt2, 'new1', { stateJson: null, encBytes: 8 });
    assert.ok(await until(() => w2.state().status === 'active'), '零点后新增 → active');
  } finally {
    w2.stop();
    fs.rmSync(root2, { recursive: true, force: true });
  }
});

test('绊线×部分不可读: 子目录读失败置 partial、此拍不判差异（防假告警/防吞活动）', async () => {
  // 方向 A（防假告警）：基线可读含 pending 工件，运行中 pending/ 变 EPERM——
  // 若读失败被折叠成「签名为零」，下一拍 diff 判 modified → 假报机制复活
  const root = tmpRoot('zcmon-snap-partialA-');
  const ckpt = path.join(root, 'checkpoints');
  makeWs(ckpt, 'aa11', { stateJson: stateOf('F:\\p', 1), encBytes: 4096 });
  const flag = { on: false };
  const w = createSnapshotWatcher({ dir: ckpt, pollMs: 120, watch: watchStubUnavailable, fsapi: partialFs(fsPromises, flag) });
  try {
    assert.ok(await until(() => w.state().status === 'static'), '可读基线 → static');
    flag.on = true; // pending/ 读被拒
    assert.ok(await until(() => w.state().partial === true), '子目录读失败 → partial 标记');
    assert.equal(w.state().readError, 'EPERM');
    await new Promise((r) => setTimeout(r, 350)); // 再等几拍确认不闩锁假告警
    assert.equal(w.state().status, 'static', '读失败绝不折叠成签名变化（无假 active）');
    assert.equal(w.state().firstActivityAt, null);
    flag.on = false; // 恢复：内容未变 → 仍 static
    assert.ok(await until(() => w.state().partial === false), '恢复后 partial 清除');
    assert.equal(w.state().status, 'static');
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }

  // 方向 B（防吞活动）：boot 起 pending/ 持续不可读 → partial 扫描不锚零点；
  // 恢复可读后的首个完整扫描重锚（期间出现的既有内容吸收进零点，不假报），
  // 重锚后的真实新增仍然设防
  const root2 = tmpRoot('zcmon-snap-partialB-');
  const ckpt2 = path.join(root2, 'checkpoints');
  makeWs(ckpt2, 'bb22', { stateJson: stateOf('F:\\q', 2), encBytes: 8192 });
  const flag2 = { on: true };
  const w2 = createSnapshotWatcher({ dir: ckpt2, pollMs: 120, watch: watchStubUnavailable, fsapi: partialFs(fsPromises, flag2) });
  try {
    assert.ok(await until(() => w2.state().partial === true), 'boot 即部分不可读');
    assert.equal(w2.state().baseline, null, 'partial 扫描不得锚零点');
    flag2.on = false; // 恢复（期间内容未再变化）
    assert.ok(await until(() => w2.state().partial === false && w2.state().baseline !== null), '完整扫描重锚零点');
    assert.equal(w2.state().status, 'static', '既有内容吸收进零点，不假报 active');
    makeWs(ckpt2, 'cc33', { stateJson: stateOf('F:\\r', 0), encBytes: 64 });
    assert.ok(await until(() => w2.state().status === 'active'), '重锚后真实新增 → active');
  } finally {
    w2.stop();
    fs.rmSync(root2, { recursive: true, force: true });
  }
});

test('绊线×截断: boot 扫描被截断 → 不得锚零点（缩量后不假报 active）', async () => {
  // 桩 fsapi：先返回超 MAX_WORKSPACES 的大目录（截断），再切回预算内子集。
  // 若截断扫描被锚成零点，后续完整扫描会把截断外的工作区判 removed → 假红。
  const mkDirents = (n) => Array.from({ length: n }, (_, i) => ({
    name: 'w' + String(i).padStart(4, '0'), isDirectory: () => true, isFile: () => false,
  }));
  const mode = { n: LIMITS.MAX_WORKSPACES + 40 };
  const stub = {
    readdir: async () => mkDirents(mode.n),
    stat: () => Promise.reject(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })),
    readFile: () => Promise.reject(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })),
  };
  const w = createSnapshotWatcher({ dir: 'X:/trunc', pollMs: 120, watch: watchStubUnavailable, fsapi: stub });
  try {
    assert.ok(await until(() => w.state().truncated === true), 'boot 大目录扫描被截断');
    assert.equal(w.state().baseline, null, '截断扫描不得锚零点');
    mode.n = 100; // 目录缩量到预算内（扫描不再截断）
    assert.ok(await until(() => w.state().truncated === false && w.state().baseline !== null), '完整扫描重锚零点');
    assert.equal(w.state().status, 'static', '缩量不假报 active（无 removed 闩锁）');
    assert.equal(w.state().firstActivityAt, null);
  } finally {
    w.stop();
  }
});

test('绊线×parent 降级: 递归 watch 抛错 → 父目录监视；filename 过滤只认 checkpoints 条目', async () => {
  const root = tmpRoot('zcmon-snap-parent-');
  const ckpt = path.join(root, 'checkpoints');
  fs.mkdirSync(ckpt);
  // 桩序列：第 1 次（递归 watch checkpoints）抛错；第 2 次（父目录）成功并捕获事件回调
  const calls = [];
  let parentCb = null;
  const watchStub = (_dir, _opt, cb) => {
    calls.push(_dir);
    if (calls.length === 1) throw new Error('ENOENT: recursive unavailable');
    parentCb = cb;
    const stub = { close() {}, on() { return stub; } };
    return stub;
  };
  const w = createSnapshotWatcher({ dir: ckpt, pollMs: 500, watch: watchStub });
  try {
    assert.equal(w.state().watchMode, 'parent', '递归失败 → parent 降级');
    assert.ok(parentCb, '父目录事件回调已接线');
    // 父目录（~/.zcode/v2 同级）高频活动：非 checkpoints 条目不得触发重扫
    parentCb('rename', 'db');
    parentCb('change', 'log.txt');
    assert.equal(w.state().lastWatchEventAt, null, '无关条目被 filename 过滤');
    // checkpoints 条目本身的事件（目录被创建/更名）= 快路径触发
    parentCb('rename', 'checkpoints');
    assert.ok(w.state().lastWatchEventAt, 'checkpoints 条目事件触发');
    // 无 filename 的事件（形态保守起见）同样触发
    w.state(); // no-op，确保读取路径无异常
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('绊线×armWatch 部分成功: dir watcher 建成后 parent 抛错 → 已建成者必须被 close 回收', async () => {
  const root = tmpRoot('zcmon-snap-leak-');
  const ckpt = path.join(root, 'checkpoints');
  fs.mkdirSync(ckpt);
  // 桩序列：递归 watch 成功(A) → parent 抛错 → 重试 parent 成功(C)。
  // A 若只置 null 不 close，句柄脱管且事件持续触发——泄漏防护回归锁。
  const mkStub = () => { const s = { closed: false, close() { s.closed = true; }, on() { return s; } }; return s; };
  const plan = ['ok', 'throw', 'ok'];
  let i = 0;
  const watchers = [];
  const watchStub = () => {
    const step = plan[i++];
    if (step === 'throw') throw new Error('EPERM: parent unavailable');
    const s = mkStub(); watchers.push(s); return s;
  };
  const w = createSnapshotWatcher({ dir: ckpt, pollMs: 500, watch: watchStub });
  try {
    assert.equal(w.state().watchMode, 'parent');
    assert.equal(watchers[0].closed, true, '部分成功的 dir watcher 必须被 close（不脱管）');
    assert.equal(watchers[1].closed, false, '最终存活的 parent watcher 未被误关');
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('绊线×stop: 停机后不再扫描、watch 事件/error 回调静默无害', async () => {
  const root = tmpRoot('zcmon-snap-stop-');
  const ckpt = path.join(root, 'checkpoints');
  fs.mkdirSync(ckpt);
  let scans = 0;
  const countingFs = {
    readdir: async (...a) => { scans++; return fsPromises.readdir(...a); },
    stat: (...a) => fsPromises.stat(...a),
    readFile: (...a) => fsPromises.readFile(...a),
  };
  const errorSinks = [];
  const eventCbs = [];
  const watchStub = () => {
    const s = { close() {}, on(evt, cb) { if (evt === 'error') errorSinks.push(cb); return s; } };
    return s;
  };
  const w = createSnapshotWatcher({ dir: ckpt, pollMs: 100, watch: watchStub, fsapi: countingFs });
  try {
    assert.ok(await until(() => scans >= 2), 'boot + 至少一拍轮询');
    w.stop();
    const scansAt = scans;
    const stateAt = JSON.stringify(w.state());
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(scans, scansAt, '停机后不再扫描');
    // 停机后迟到的回调（error 事件/文件事件）不得抛、不得改状态
    for (const sink of errorSinks) assert.doesNotThrow(() => sink(new Error('late EPERM')));
    assert.equal(JSON.stringify(w.state()), stateAt, '迟到回调不改变状态');
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('绊线×不可读: 运行中锁定不假报活动（unreadable 态）；解锁恢复 static；boot 已锁→解锁重锚零点', async () => {
  // 场景 1：基线含遗留内容，运行中目录变不可读 → 绝不判 removed/active
  // （若走 diff 会把全部工作区判 removed，在用户刚锁目录那一刻假报「复活」）
  const root = tmpRoot('zcmon-snap-lock-');
  const ckpt = path.join(root, 'checkpoints');
  makeWs(ckpt, 'aa11', { stateJson: stateOf('F:\\p', 1), encBytes: 4096 });
  const flag = { on: false };
  const w = createSnapshotWatcher({ dir: ckpt, pollMs: 120, watch: watchStubUnavailable, fsapi: flakyFs(fsPromises, flag) });
  try {
    assert.ok(await until(() => w.state().status === 'static'), '可读基线 → static');
    flag.on = true; // 模拟 icacls 锁定后的 EPERM
    assert.ok(await until(() => w.state().status === 'unreadable'), '锁定 → unreadable（不折叠成 clear）');
    assert.equal(w.state().readError, 'EPERM');
    flag.on = false; // 解锁：内容未变 → 回 static，绝不假报 active
    assert.ok(await until(() => w.state().status === 'static'), '解锁后恢复 static（无假活动）');
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }

  // 场景 2（重锚）：boot 时目录已锁（零点建立在不可读扫描上），解锁后既有内容不判新增
  const root2 = tmpRoot('zcmon-snap-bootlock-');
  const ckpt2 = path.join(root2, 'checkpoints');
  makeWs(ckpt2, 'bb22', { stateJson: stateOf('F:\\q', 2), encBytes: 8192 });
  const flag2 = { on: true };
  const w2 = createSnapshotWatcher({ dir: ckpt2, pollMs: 120, watch: watchStubUnavailable, fsapi: flakyFs(fsPromises, flag2) });
  try {
    assert.ok(await until(() => w2.state().status === 'unreadable'), 'boot 已锁 → unreadable');
    flag2.on = false;
    assert.ok(await until(() => w2.state().status === 'static'), '解锁后重锚零点 → static（既有内容不算新增）');
    // 重锚后的零点对真实新增仍然设防
    makeWs(ckpt2, 'cc33', { stateJson: stateOf('F:\\r', 0), encBytes: 16 });
    assert.ok(await until(() => w2.state().status === 'active'), '重锚后新增 → active');
  } finally {
    w2.stop();
    fs.rmSync(root2, { recursive: true, force: true });
  }
});

test('绊线×watch error: FSWatcher 异步 error 事件被接住——降级轮询、不崩、检测照常', async () => {
  const root = tmpRoot('zcmon-snap-werr-');
  const ckpt = path.join(root, 'checkpoints');
  fs.mkdirSync(ckpt);
  // 桩 watch：返回带 close/on 的假 watcher，捕获 error 监听回调后手动发射
  const errorSinks = [];
  const watchStub = () => {
    const stub = {
      close() {},
      on(evt, cb) { if (evt === 'error') errorSinks.push(cb); return stub; },
    };
    return stub;
  };
  const w = createSnapshotWatcher({ dir: ckpt, pollMs: 120, watch: watchStub });
  try {
    assert.ok(await until(() => w.state().status === 'clear'), 'boot clear');
    assert.equal(w.state().watchMode, 'watch', '桩 watch 两个都建成功 → watch 态');
    assert.ok(errorSinks.length >= 2, '两个 watcher 都挂了 error 监听');
    // 发射异步 error（无监听即未捕获异常崩进程——本用例的存在本身就是回归锁）
    errorSinks[0](Object.assign(new Error('EPERM: watch died'), { code: 'EPERM' }));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(w.state().watchMode, 'poll', 'error → 降级 poll');
    assert.ok(String(w.state().watchError).includes('EPERM'), '错误原因如实上报');
    // 降级后轮询照常工作：落盘新快照仍被检出
    makeWs(ckpt, 'dd44', { stateJson: stateOf('F:\\z', 0), encBytes: 512 });
    assert.ok(await until(() => w.state().status === 'active'), '降级轮询下检测照常');
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('绊线: state() 明细截断 50、按最近活动倒序、_sig 不外泄', async () => {
  const root = tmpRoot('zcmon-snap-listcap-');
  const ckpt = path.join(root, 'checkpoints');
  fs.mkdirSync(ckpt);
  // 55 个工作区，lastWriteMs 依创建次序递增（文件系统 mtime 分辨率足够时）；
  // 显式等待 3ms 间隔拉开 mtime
  for (let i = 0; i < LIMITS.API_WS_LIST_CAP + 5; i++) {
    makeWs(ckpt, 'w' + String(i).padStart(3, '0'), { stateJson: stateOf('F:\\p' + i, i), encBytes: 0 });
    await new Promise((r) => setTimeout(r, 3));
  }
  const w = createSnapshotWatcher({ dir: ckpt, pollMs: 60_000, watch: watchStubUnavailable });
  try {
    // boot 首扫异步：等它完成（static = 零点已建立在 55 个工作区上）。
    // 不手动 rescan()——首扫 in-flight 时会被 scanning 标志静默跳过。
    assert.ok(await until(() => w.state().status === 'static'), '首扫完成，遗留内容 → static');
    const s = w.state();
    assert.equal(s.workspaces.length, LIMITS.API_WS_LIST_CAP, '明细截断在 50');
    assert.equal(s.current.workspaces, LIMITS.API_WS_LIST_CAP + 5, '总量计数不截断');
    const times = s.workspaces.map((x) => x.lastWriteMs);
    for (let i = 1; i < times.length; i++) assert.ok(times[i - 1] >= times[i], '按 lastWriteMs 倒序');
    for (const x of s.workspaces) assert.ok(!('_sig' in x), '_sig 不得外泄');
    assert.equal(s.status, 'static', '零点=现状 → static');
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// 真实 fs.watch 快路径（win32 门禁平台；非 win32 跳过——递归 watch 行为差异）
test('绊线: 真实 fs.watch 快路径——落盘后数秒内 active（win32）', { skip: process.platform !== 'win32' }, async () => {
  const root = tmpRoot('zcmon-snap-realwatch-');
  const ckpt = path.join(root, 'checkpoints');
  fs.mkdirSync(ckpt);
  const w = createSnapshotWatcher({ dir: ckpt, pollMs: 6000 }); // 真实 fs 与 watch
  try {
    assert.ok(await until(() => w.state().status === 'clear', { timeoutMs: 8000 }));
    assert.equal(w.state().watchMode, 'watch', '真实递归 watch 建立成功');
    makeWs(ckpt, 'ee55', { stateJson: stateOf('F:\\real', 0), encBytes: 256 });
    // 快路径 = watch 去抖 3s + 扫描；轮询 6s 只作兜底。12s 预算覆盖两跳
    assert.ok(await until(() => w.state().status === 'active', { timeoutMs: 12000 }), 'watch 快路径应在数秒内检出');
    assert.ok(w.state().lastWatchEventAt, 'watch 事件时间戳落位');
  } finally {
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('makeSnapshotRoute: 200 + 契约字段形态', async () => {
  const root = tmpRoot('zcmon-snap-route-');
  const ckpt = path.join(root, 'checkpoints');
  fs.mkdirSync(ckpt);
  const w = createSnapshotWatcher({ dir: ckpt, pollMs: 120, watch: watchStubUnavailable });
  const app = express();
  app.get('/api/snapshot', makeSnapshotRoute({ watcher: w }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((r) => server.on('listening', r));
    // boot 首扫异步：先等状态脱离 pending 再断言（慢盘上 readdir 可能晚于 HTTP 往返）
    assert.ok(await until(() => w.state().status !== 'pending'), '首扫完成');
    const body = await new Promise((resolve, reject) => {
      const http = require('http');
      http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/snapshot' },
        (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve(b)); })
        .on('error', reject);
    });
    const j = JSON.parse(body);
    for (const k of ['dir', 'exists', 'unreadable', 'partial', 'readError', 'truncated', 'scanStuck', 'status',
                     'baseline', 'current', 'firstActivityAt', 'lastWatchEventAt',
                     'watchMode', 'watchError', 'scanError', 'scannedAt', 'workspaces']) {
      assert.ok(k in j, `响应须含 ${k}`);
    }
    assert.equal(j.dir, ckpt);
    assert.equal(j.status, 'clear');
    assert.deepEqual(j.workspaces, []);
  } finally {
    server.close();
    w.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 源码契约（渲染消毒与告警接线，frontend-contract 同款形态）─────────
const readPublic = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');

test('契约: 绊线卡不可信文本渲染点全过 escapeHtml（path/hash/dir/scanError/readError/watchError）', () => {
  const src = readPublic('views/overview.js');
  assert.ok(/escapeHtml\(w\.path\)/.test(src), 'workspacePath 须过 escapeHtml');
  assert.ok(/escapeHtml\(shortHash\(w\.hash\)\)/.test(src), 'hash 须过 escapeHtml');
  assert.ok(/escapeHtml\(s\.dir\)/.test(src), '目录路径须过 escapeHtml');
  assert.ok(/escapeHtml\(s\.scanError\)/.test(src), 'scanError 须过 escapeHtml');
  assert.ok(/escapeHtml\(s\.readError\)/.test(src), 'readError 须过 escapeHtml');
  assert.ok(/escapeHtml\(s\.watchError\)/.test(src), 'watchError 消息体须过 escapeHtml');
  // 反向守护：不得存在未消毒直插
  for (const bad of [/\$\{w\.path\}/, /\$\{w\.hash\}/, /\$\{s\.dir\}/]) {
    assert.ok(!bad.test(src), `不得以 ${bad} 直插模板`);
  }
});

test('契约: /api/snapshot 挂载先于 companion tracker（30s 轮询不给孤儿服务续命）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const routeAt = src.indexOf("app.get('/api/snapshot'");
  const trackerAt = src.indexOf('ZCODE_WIDGET_CHILD');
  assert.ok(routeAt > 0 && trackerAt > 0, '两处接线都在');
  assert.ok(routeAt < trackerAt, '快照路由须挂在 companion tracker 之前（注册顺序即 lastSeen 语义）');
});

test('契约: 顶栏告警 chip 默认隐藏 + CSS [hidden] 兜底；仅 active 显示；接口失败不告警且留痕', () => {
  const html = readPublic('index.html');
  const appSrc = readPublic('app.js');
  const css = readPublic('styles.css');
  // index.html：chip 带 hidden 初始态（fail-safe：默认不可见）
  assert.ok(/id="snapshot-alert"[^>]*hidden/.test(html), 'chip 须默认 hidden');
  // CSS 兜底锁：.badge 的 display:inline-block 会盖过 UA 的 [hidden] 规则，
  // 必须有 .snap-alert[hidden] 显式兜底（仓库 .privacy-notice[hidden] 同款教训）
  assert.ok(/\.snap-alert\[hidden\]\s*\{\s*display:\s*none/.test(css),
    'styles.css 须含 .snap-alert[hidden] display:none 兜底');
  // app.js：只在 status==='active' 时亮（\s* 放宽空白，只锁语义形态）
  assert.ok(/chip\.hidden\s*=\s*!\(\s*s\s*&&\s*s\.status\s*===\s*'active'\s*\)/.test(appSrc),
    'chip 仅 active 显示');
  // 轮询失败不无声：连续失败留痕（fail-safe 不亮告警，但 DevTools 可归因）
  assert.ok(/snapFailStreak\s*===\s*3[^\n]*console\.warn/.test(appSrc),
    '连续 3 次失败须 console.warn 留痕');
});

test('契约: 隐私横幅措辞已升级（本机实证+冻结时间线），旧措辞退场', () => {
  const html = readPublic('index.html');
  assert.ok(!html.includes('未经我们验证'), '旧措辞「未经我们验证」须移除');
  assert.ok(html.includes('2026-09-18 13:32'), '冻结时间线须落位');
  assert.ok(html.includes('快照绊线卡'), '须指向绊线卡');
});
