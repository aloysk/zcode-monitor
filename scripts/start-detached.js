#!/usr/bin/env node
// scripts/start-detached.js — 服务中断后的手动拉起（detached 接替形态）
//
// 场景：7331 生产实例随会话/机器重启消失（接替进程是被外部终止的，不写
// 崩溃日志），需要一条命令恢复。形态与 server/restart-route.js 的接替
// 进程完全一致：detached + windowsHide:true（无控制台形态下不弹 Windows
// Terminal，AGENTS 硬红线）、stderr 追加 logs/restart-child.log（与接替
// 进程同一落点，grep 一处看全）、stdio 不接 stdout（每请求 logger 太吵
// ——restart-route 同款取舍）、OPEN_BROWSER 默认 0（手动恢复刷新原标签
// 即可，--open 显式开）。
//
// 流程：/api/health 探活（活着就不动，幂等）→ spawn → 轮询健康至多
// START_TIMEOUT_MS（默认 15000ms）→ 报 PID。退出码：0 已在跑或拉起成功；
// 1 失败（详见 logs/restart-child.log）。

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'server', 'index.js');
const STDERR_LOG = path.join(ROOT, 'logs', 'restart-child.log');
const PORT = Number(process.env.PORT || 7331);

function checkHealth(timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/health`, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const base = `http://127.0.0.1:${PORT}`;
  if (await checkHealth(1500)) {
    console.log(`[start-detached] ${base} 已有健康实例，不重复拉起`);
    return 0;
  }

  fs.mkdirSync(path.dirname(STDERR_LOG), { recursive: true });
  const errFd = fs.openSync(STDERR_LOG, 'a');
  fs.writeSync(errFd, `\n[start-detached ${new Date().toISOString()}] 手动拉起 detached 接替进程\n`);

  const child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'ignore', errFd],
    env: { ...process.env, OPEN_BROWSER: process.argv.includes('--open') ? '1' : '0' },
  });
  child.unref();

  // spawn 的真实失败（ENOENT/EPERM）走 error 事件、部署秒崩走 exit 事件，
  // 都是异步到达——轮询循环里检查，避免白等一整个超时窗
  let childGone = null;
  child.once('error', (e) => { childGone = `spawn error: ${e.message}`; });
  child.once('exit', (code) => { childGone = `子进程提前退出 code=${code}`; });

  const deadline = Date.now() + Number(process.env.START_TIMEOUT_MS || 15000);
  while (Date.now() < deadline) {
    await sleep(300);
    if (childGone) {
      console.error(`[start-detached] 拉起失败（${childGone}），详见 logs/restart-child.log`);
      return 1;
    }
    if (await checkHealth(1000)) {
      console.log(`[start-detached] 已拉起 pid=${child.pid} → ${base}（健康检查通过）`);
      return 0;
    }
  }
  console.error(`[start-detached] 健康检查未在期限内变绿（子进程仍存活，pid=${child.pid}），详见 logs/restart-child.log`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error('[start-detached] 脚本异常:', e); process.exit(1); });
