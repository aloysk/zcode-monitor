'use strict';
// restart-route.js — POST /api/restart 的可挂载路由：面板服务自重启
// （壳右键菜单「重启面板」的落地端点，加载新代码后无需手动找进程杀起）。
//
// 语义（时序是本模块的核心不变量）：
//   1. 首部闸：缺 X-Zcode-Monitor-Restart: 1 一律 403（跨源简单 POST 带不了
//      自定义首部，镜像 /api/pets/import 的 X-Zcode-Monitor-Import 机制；
//      Host 闸与安全头由 server/index.js 的全局中间件负责）。
//   2. 先 spawn 接替进程，成功后才回 200 并安排退出——三种失败形态旧进程都
//      不退出（绝不出现「答应了重启却谁都没起来」的下线事故）：同步抛错
//      如实 500；异步 'error'（ENOENT/EPERM/EMFILE 真实失败形态）撤销退出
//      定时器并回退受理闩；child 早夭 'exit'（部署秒崩新代码，旧进程退出
//      定时器 250ms < 接替 listen 600ms，撤销必然安全）同款撤销。接替进程
//      stderr 落盘 logs/restart-child.log（stdout 是每请求 logger，太吵；
//      崩溃栈与监听失败都在 stderr）。
//   3. 端口交接：接替进程带 ZCODE_RESTART_BOOT_DELAY_MS 延迟 listen（见
//      server/index.js 尾部），旧进程在响应发出 exitDelayMs 后退出；两次
//      延迟之和大于端口释放耗时，接替进程不至于 EADDRINUSE 即死。
//   4. 接替进程继承环境（PORT/ZCODE_WIDGET_CHILD 等随之保留：companion
//      模式的孤儿自清、壳 Job 的随主退出契约都不变），仅强制
//      OPEN_BROWSER=0——重启不该再弹一个浏览器标签。
//   5. 幂等：已受理的重启再 POST 直接回 already，不二次 spawn。
// spawn/exit 全部依赖注入（checkpoint-route.js 先例），测试挂记录器即可
// 覆盖全分支，不必真杀测试进程。

const path = require('path');
const fs = require('fs');

const RESTART_HEADER = 'X-Zcode-Monitor-Restart';
const ENTRY = path.join(__dirname, 'index.js');
// 接替进程的 listen 延迟（旧进程退出需要 exitDelayMs；再留余量）。
const CHILD_BOOT_DELAY_MS = 600;
// 接替进程 stderr 的落盘位置（仓内，绝不碰 ~/.zcode）：stdout 是每请求 logger
// 太吵且无界，只收 stderr——崩溃栈/[db] 警告/监听失败都在这，R-17 场景从
// 「零观测」变「一次 grep」。健康服务 stderr 基本为空，增长可忽略。
const CHILD_STDERR_LOG = path.join(__dirname, '..', 'logs', 'restart-child.log');

function makeRestartRoute({
  spawn,        // (execPath, argv, opts) => child；生产直通 child_process.spawn
                //（位置参数同形——7399 实机冒烟曾用单对象形态栽在 spawn 的
                //  "file" argument must be a string 上，单测的记录器没照出这点）
  exit = (code) => process.exit(code),
  exitDelayMs = 250,
  bootDelayMs = CHILD_BOOT_DELAY_MS,
  stderrPath = CHILD_STDERR_LOG,
} = {}) {
  let scheduled = false; // 幂等闩：一次生命周期只安排一次退出
  let exitTimer = null;  // 已武装的退出定时器句柄——child 异步 error 必须撤销它，
                         // 否则「回退闩可重试」是空话：旧进程 250ms 后照死（首轮
                         // 四席评审独立实锤的 CRITICAL）
  return function restartRoute(req, res) {
    if (req.get(RESTART_HEADER) !== '1') {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        message: '缺少 X-Zcode-Monitor-Restart 首部：重启只接受面板自身发起的请求（防跨站触发）。',
      });
    }
    if (scheduled) {
      return res.json({ ok: true, already: true, message: '重启已受理，接替进程在途。' });
    }
    // 旧进程侧的失败诊断双写：console.error 在壳自有（companion）模式下随
    // NUL 消失——「关于丢日志的日志被丢」。appendFileSync 按路径重开写同一份
    // restart-child.log，用户唯一会 grep 的地方（二轮失败席 F2）。
    const noteFailure = (msg, e) => {
      console.error('[restart]', msg, e && e.message ? e.message : e);
      try { fs.appendFileSync(stderrPath, `[restart] ${msg} ${e && e.message ? e.message : e}\n`); } catch {} // 日志盘也坏时只剩 console
    };
    // 接替进程 stderr → 仓内日志（打开失败不阻断重启，回退全忽略——重启本身
    // 比日志落盘更重要）。>1MB 时改 'w' 截断重开：append 永续 + body-parser
    // 栈（安全席实测：任意网页可向非 /api 路径跨站 POST 垃圾 JSON 触发 stderr
    // 栈）构成无界增长面，重启时机即轮转时机（SEC-005）。
    let errFd = 'ignore';
    let opened = false;
    try {
      fs.mkdirSync(path.dirname(stderrPath), { recursive: true });
      const trunc = fs.existsSync(stderrPath) && fs.statSync(stderrPath).size > 1024 * 1024;
      errFd = fs.openSync(stderrPath, trunc ? 'w' : 'a');
      opened = true;
    } catch (e) {
      noteFailure('stderr 日志打开失败（回退忽略）:', e);
    }
    let child;
    try {
      child = spawn(process.execPath, [ENTRY], {
        detached: true,   // 脱离父进程组：父退出后独立存活（Windows 下仍落入
                          // 壳的 Job 对象——随壳退出的既有契约由 Job 保证，不受影响）
        stdio: ['ignore', 'ignore', errFd],
        env: {
          ...process.env,
          OPEN_BROWSER: '0',
          ZCODE_RESTART_BOOT_DELAY_MS: String(bootDelayMs),
        },
      });
    } catch (e) {
      if (opened) try { fs.closeSync(errFd); } catch {}
      return res.status(500).json({
        ok: false,
        error: 'spawn_failed',
        message: `接替进程启动失败，本进程不退出：${e && e.message ? e.message : e}`,
      });
    }
    if (opened) try { fs.closeSync(errFd); } catch {} // 子进程持有继承副本，父侧即关
    scheduled = true;
    let currentChild = child; // 跨代防护：error/exit 只对「本次受理的那只」生效，
                              // 迟到的上一代事件不得撤销下一代的退出（纯加固）
    if (child && typeof child.unref === 'function') child.unref();
    // spawn 的真实失败（ENOENT/EPERM/EMFILE）经 child 'error' 事件异步到达，
    // 不设防会以未捕获异常杀掉旧进程；即使已回 200，也必须撤销退出定时器、
    // 回退受理闩——旧进程继续服务，下一次点击可重试。
    if (child && typeof child.on === 'function') {
      child.on('error', (e) => {
        if (child !== currentChild) return; // 上一代的迟到事件
        scheduled = false;
        if (exitTimer) { clearTimeout(exitTimer); exitTimer = null; }
        noteFailure('接替进程启动失败（已撤销退出、旧进程继续服务，可重试）:', e);
      });
      // child 早夭（spawn 成功但秒崩——部署了秒崩的新代码正是本功能主用例）
      // 发的是 'exit' 而非 'error'：旧进程能观察到的任何 child 退出必然早于
      // 自身退出定时器（250ms）与接替 listen（+600ms），撤销总是安全。头注
      // 「绝不出现答应了却谁都没起来」由此对三种失败形态全部成立（二轮失败席 F1）。
      child.on('exit', () => {
        if (child !== currentChild) return;
        if (!exitTimer) return; // 已交棒（本不该发生：250ms < 600ms）或已撤销
        scheduled = false;
        clearTimeout(exitTimer);
        exitTimer = null;
        noteFailure('接替进程早夭（已撤销退出、旧进程继续服务，可重试；崩溃栈见本日志）', new Error('child exited before handoff'));
      });
    }
    try {
      res.json({
        ok: true,
        message: '重启已受理：接替进程起来后自动恢复（约 1-2 秒）。',
      });
    } catch (e) {
      // 响应半途断链（socket 销毁）：请求者已不在，重启失去意义——撤销并回退
      // 闩，避免「闩已置、退出未武装」的搁浅态（二轮失败席 F6）
      scheduled = false;
      if (exitTimer) { clearTimeout(exitTimer); exitTimer = null; }
      currentChild = null;
      noteFailure('响应写出失败（请求方已断开），重启已撤销:', e);
      return;
    }
    // 响应先走（连接排空），旧进程随后让出端口
    exitTimer = setTimeout(() => exit(0), exitDelayMs);
    exitTimer.unref();
  };
}

module.exports = { makeRestartRoute, RESTART_HEADER, CHILD_BOOT_DELAY_MS };
