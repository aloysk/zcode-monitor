'use strict';
// test/probe-windows-hide.test.js — 回归：win32 探测的 tasklist spawn 必须带
// windowsHide:true。服务常以无控制台形态存活（重启接替进程 detached / 壳隐藏
// 拉起），无控制台父进程起控制台程序时系统会另开新控制台——Win11 宿主是
// Windows Terminal，表现为每探测周期闪一个 tasklist.exe 窗（2026-09-24 实锤：
// 7331 接替进程 65268 每 30s 弹窗，前台终端形态因共享父控制台而从未暴露）。
// 断言落在 spawn 选项而非窗口可见性：CREATE_NO_WINDOW 的生效由 libuv 保证，
// 选项丢失即回归。stub 需在模块加载前生效，故先劫持 child_process.execFile
// 再清缓存重 require（node --test 每文件独立进程，不影响其他测试）。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const cp = require('child_process');

const RUNTIME_PATH = path.join(__dirname, '..', 'server', 'zcode-runtime.js');

test('win32 探测 tasklist 的 execFile 必须带 windowsHide:true（防无控制台形态闪窗）',
  { skip: process.platform !== 'win32' && '仅 win32 分支调用 tasklist' },
  (t, done) => {
    const origExecFile = cp.execFile;
    let captured = null;
    cp.execFile = (cmd, args, opts, cb) => {
      captured = { cmd, args, opts };
      setImmediate(() => cb(null, 'ZCode.exe                    1234 Console                    1      100 K'));
      return { on() {} };
    };
    t.after(() => {
      cp.execFile = origExecFile;
      delete require.cache[require.resolve(RUNTIME_PATH)];
    });
    delete require.cache[require.resolve(RUNTIME_PATH)];
    const { probeZCodeRunning } = require(RUNTIME_PATH);
    probeZCodeRunning((running) => {
      assert.ok(captured, 'execFile 应已被调用');
      assert.strictEqual(captured.cmd, 'tasklist');
      assert.deepStrictEqual(captured.args,
        ['/FI', 'IMAGENAME eq ZCode.exe', '/NH']);
      assert.strictEqual(captured.opts && captured.opts.windowsHide, true,
        'windowsHide:true 丢失——无控制台形态下每探测周期弹 tasklist.exe 窗');
      assert.strictEqual(running, true, '命中 ZCode.exe 行应判 running');
      done();
    });
  });
