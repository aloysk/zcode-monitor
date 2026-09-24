#!/usr/bin/env node
// scripts/start-detached.js — 服务中断后的手动拉起（detached 接替形态）
//
// 场景：7331 生产实例随会话/机器重启消失（接替进程是被外部终止的，不写
// 崩溃日志），需要一条命令恢复。形态对齐 server/restart-route.js 的接替
// 进程（detached、stderr 追加 logs/restart-child.log、stdio 不接 stdout、
// OPEN_BROWSER=0），并按 AGENTS 红线另加 windowsHide:true（本脚本可能出自
// 无控制台环境；restart-route 经服务进程拉起、未带该选项）。与接替进程的
// 有意差异：不设 ZCODE_WIDGET_CHILD——手动恢复的实例无 5 分钟空闲自清、
// 不随壳退出（长驻即恢复的期望形态；换代走桌宠右键「重启面板」）。
//
// 流程：/api/health 三态探活（活着就不动；有占口但非健康 → 不 spawn 竞速
// 者、如实报因——六视角终审 SF-2：把「拒连/占口不应答/非健康」折叠成同
// 一个 false 会对卡死端口双拉起必败竞速者）→ spawn → 轮询健康 START_
// TIMEOUT_MS（默认 15000ms，末次检查可略越线）→ 报 PID。退出码：0 已在
// 跑或拉起成功；1 失败（详见 stderr 与 logs/restart-child.log）。

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'server', 'index.js');
const STDERR_LOG = path.join(ROOT, 'logs', 'restart-child.log');
const PORT = Number(process.env.PORT || 7331);
const BASE = `http://127.0.0.1:${PORT}`;

// 三态探测：'ok' = 健康面板（200 且 body.ok===true——/api/health 在 DB 不可
// 读时仍回 200，只认状态码会把坏实例当健康）；'refused' = 无监听者（唯一
// 可安全 spawn 的状态）；'blocked' = 有监听但不应答（事件循环卡死的典型
// 形态）；'answered:N' = 应答了但非健康（别的应用/坏实例占口）。
function probeHealth(timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/api/health`, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        resolve(res.statusCode === 200 && body.includes('"ok":true') ? 'ok' : `answered:${res.statusCode}`);
      });
      res.on('error', () => resolve('blocked'));
    });
    req.on('timeout', () => req.destroy()); // destroy → error(ECONNRESET) → blocked
    req.on('error', (e) => resolve(e && e.code === 'ECONNREFUSED' ? 'refused' : 'blocked'));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// NaN/<=0 兜底回退默认：deadline 为 NaN 会让轮询条件恒假——零次探测就对
// 存活子进程下「未变绿」断言（六视角终审 SF-10 抓出的配置错误伪装形态）
const timeoutMs = Number(process.env.START_TIMEOUT_MS);
const START_TIMEOUT = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000;

async function main() {
  // 初始探活给足 5s：冷启动中的健康实例首答可能略慢，误报 blocked 会把
  // 用户引向「卡死」的错误诊断（HttpLong 15s 预算的同款理由，CLI 取 5s）
  const initial = await probeHealth(5000);
  if (initial === 'ok') {
    console.log(`[start-detached] ${BASE} 已有健康实例，不重复拉起`);
    return 0;
  }
  if (initial !== 'refused') {
    console.error(initial === 'blocked'
      ? `[start-detached] ${BASE} 被占用但无响应——很可能是面板事件循环卡死：右键桌宠「重启面板」（观察后强杀 node 重建），或手动结束 node 进程后重跑`
      : `[start-detached] ${BASE} 应答了但不是健康面板（${initial}）——端口被其他应用/坏实例占用，处理后重跑`);
    return 1;
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
  fs.closeSync(errFd); // 子进程持继承副本——父侧即关（restart-route 同款规范）

  // spawn 的真实失败（ENOENT/EPERM）走 error 事件、部署秒崩走 exit 事件，
  // 都是异步到达——轮询循环里检查，避免白等一整个超时窗
  let childGone = null;
  child.once('error', (e) => { childGone = `spawn error: ${e.message}`; });
  child.once('exit', (code) => { childGone = `子进程提前退出 code=${code}`; });

  const deadline = Date.now() + START_TIMEOUT;
  while (Date.now() < deadline) {
    await sleep(300);
    if (childGone) {
      console.error(`[start-detached] 拉起失败（${childGone}），详见 logs/restart-child.log`);
      return 1;
    }
    if (await probeHealth(1000) === 'ok') {
      console.log(`[start-detached] 已拉起 pid=${child.pid} → ${BASE}（健康检查通过）`);
      return 0;
    }
  }
  console.error(`[start-detached] 健康检查未在期限内变绿（子进程仍存活，pid=${child.pid}），详见 logs/restart-child.log`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error('[start-detached] 脚本异常:', e); process.exit(1); });
