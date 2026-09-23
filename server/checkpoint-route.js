'use strict';
// checkpoint-route.js — /api/checkpoint 的可挂载路由（自 server/index.js 抽出，
// 依赖全部注入，供测试直接 mount 覆盖三分支）。
//
// 四道闸（顺序即优先级）：
// 0) force 首部闸：?force=1 要求自定义首部 X-Zcode-Monitor-Checkpoint（见下方
//    CHECKPOINT_FORCE_HEADER 处注释）；
// 1) walIdleMs 即时否决：runtimeState.running 最多 ~37s 陈旧（探测节流 30s +
//    tasklist 单次 4-7s），而 -wal 近期有写入即真实 writer 在场的直接证据——
//    force 也不越过这道闸（「绝不与真实 writer 抢锁」是本模块的不变量）。
// 2) running 状态否决（?force=1 可越过——仅当 wal 已静默，见上）。
// 3) checkpointNow 的 busy_timeout 是短等待（800ms，见 zcode-runtime.checkpointNow）：
//    抢不到锁 busy=1 如实上报 503 可重试，绝不同步阻塞事件循环长等。
// force 跨站触发闸（R4 修-medium）：/api/checkpoint 是唯一写端点且为普通 GET
// ——公网页可用 <img src="http://127.0.0.1:7331/api/checkpoint?force=1"> 过 Host
// 闸后在 ZCode 运行中触发 checkpoint 抢锁（跨源子资源请求带不了自定义首部，
// 镜像导入端点 X-Zcode-Monitor-Import 的机制，首部名经 http-hardening.js 导出
// 常量对齐）。非 force 分支保留简单 GET：无 force 时受 running 否决约束、不越
// wal_active 闸，无抢锁增量。前端调用面（public/app.js 的「立即合并」按钮）已
// 同步携带首部。
const CHECKPOINT_FORCE_HEADER = 'X-Zcode-Monitor-Checkpoint';

function makeCheckpointRoute({ dbPath, runtime, runtimeState, activeWindowMs, onSuccess }) {
  return function checkpointRoute(req, res) {
    if (req.query.force && req.get(CHECKPOINT_FORCE_HEADER) !== '1') {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        message: '缺少 X-Zcode-Monitor-Checkpoint 首部：?force=1 只接受面板自身发起的请求（防跨站触发）。',
      });
    }
    const idle = runtime.walIdleMs(dbPath);
    if (idle != null && idle < activeWindowMs) {
      return res.status(409).json({
        ok: false,
        error: 'wal_active',
        message: `WAL 最近 ${Math.round(idle / 1000)}s 内有写入（真实 writer 在场），拒绝 checkpoint。请待写入静默后再试。`,
      });
    }
    if (runtimeState.running && !req.query.force) {
      return res.status(409).json({
        ok: false,
        error: 'zcode_running',
        message: 'ZCode 正在运行，无法安全 checkpoint。请先关闭 ZCode，或加 ?force=1 强制（可能短暂抢锁）。',
      });
    }
    const before = runtime.walStatus(dbPath);
    const result = runtime.checkpointNow(dbPath);
    if (result.ok && result.busy === 1) {
      return res.status(503).json({
        ok: false,
        error: 'checkpoint_busy',
        message: '数据库锁被占用，checkpoint 未完成。请稍后重试。',
        retryable: true,
      });
    }
    if (result.ok) {
      runtimeState.lastCheckpoint = {
        at: new Date().toISOString(), ok: true,
        walBefore: before ? before.walBytes : null,
        walAfter: result.after ? result.after.walBytes : null,
      };
      if (typeof onSuccess === 'function') onSuccess(); // 例：丢弃只读连接缓存，让下次读到折叠后的库
    }
    res.json(result);
  };
}

module.exports = { makeCheckpointRoute, CHECKPOINT_FORCE_HEADER };
