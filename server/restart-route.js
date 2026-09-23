'use strict';
// restart-route.js — POST /api/restart 的可挂载路由：面板服务自重启
// （壳右键菜单「重启面板」的落地端点，加载新代码后无需手动找进程杀起）。
//
// 语义（时序是本模块的核心不变量）：
//   1. 首部闸：缺 X-Zcode-Monitor-Restart: 1 一律 403（跨源简单 POST 带不了
//      自定义首部，镜像 /api/pets/import 的 X-Zcode-Monitor-Import 机制；
//      Host 闸与安全头由 server/index.js 的全局中间件负责）。
//   2. 先 spawn 接替进程，成功后才回 200 并安排退出——spawn 失败如实 500，
//      绝不出现「答应了重启却谁都没起来」的下线事故。
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

const RESTART_HEADER = 'X-Zcode-Monitor-Restart';
const ENTRY = path.join(__dirname, 'index.js');
// 接替进程的 listen 延迟（旧进程退出需要 exitDelayMs；再留余量）。
const CHILD_BOOT_DELAY_MS = 600;

function makeRestartRoute({
  spawn,        // (execPath, argv, opts) => child；生产直通 child_process.spawn
                //（位置参数同形——7399 实机冒烟曾用单对象形态栽在 spawn 的
                //  "file" argument must be a string 上，单测的记录器没照出这点）
  exit = (code) => process.exit(code),
  exitDelayMs = 250,
  bootDelayMs = CHILD_BOOT_DELAY_MS,
} = {}) {
  let scheduled = false; // 幂等闩：一次生命周期只安排一次退出
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
    let child;
    try {
      child = spawn(process.execPath, [ENTRY], {
        detached: true,   // 脱离父进程组：父退出后独立存活（Windows 下仍落入
                          // 壳的 Job 对象——随壳退出的既有契约由 Job 保证，不受影响）
        stdio: 'ignore',
        env: {
          ...process.env,
          OPEN_BROWSER: '0',
          ZCODE_RESTART_BOOT_DELAY_MS: String(bootDelayMs),
        },
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: 'spawn_failed',
        message: `接替进程启动失败，本进程不退出：${e && e.message ? e.message : e}`,
      });
    }
    scheduled = true;
    if (child && typeof child.unref === 'function') child.unref();
    // spawn 的真实失败（ENOENT/EPERM）经 child 'error' 事件异步到达，不设防会
    // 以未捕获异常杀掉旧进程——「答应了重启却谁都没起来」正是本模块头注承诺
    // 不发生的事故。记日志、回退受理闩（旧进程继续服务，下一次点击可重试）。
    if (child && typeof child.on === 'function') {
      child.on('error', (e) => {
        scheduled = false;
        console.error('[restart] 接替进程启动失败（旧进程继续服务，可重试）:',
          e && e.message ? e.message : e);
      });
    }
    res.json({
      ok: true,
      message: '重启已受理：接替进程起来后自动恢复（约 1-2 秒）。',
    });
    // 响应先走（连接排空），旧进程随后让出端口
    setTimeout(() => exit(0), exitDelayMs).unref();
  };
}

module.exports = { makeRestartRoute, RESTART_HEADER, CHILD_BOOT_DELAY_MS };
