'use strict';
// checkpoint-route.js — /api/checkpoint 的可挂载路由（自 server/index.js 抽出，
// 依赖全部注入，供测试直接 mount 覆盖三分支）。
//
// 三道闸（顺序即优先级）：
// 1) walIdleMs 即时否决：runtimeState.running 最多 ~37s 陈旧（探测节流 30s +
//    tasklist 单次 4-7s），而 -wal 近期有写入即真实 writer 在场的直接证据——
//    force 也不越过这道闸（「绝不与真实 writer 抢锁」是本模块的不变量）。
// 2) running 状态否决（?force=1 可越过——仅当 wal 已静默，见上）。
// 3) checkpointNow 的 busy_timeout 是短等待（800ms，见 zcode-runtime.checkpointNow）：
//    抢不到锁 busy=1 如实上报 503 可重试，绝不同步阻塞事件循环长等。
function makeCheckpointRoute({ dbPath, runtime, runtimeState, activeWindowMs, onSuccess }) {
  return function checkpointRoute(req, res) {
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

module.exports = { makeCheckpointRoute };
