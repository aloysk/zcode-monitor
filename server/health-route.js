'use strict';
// health-route.js — /api/health 的可挂载路由（R5 自 server/index.js 内联逻辑抽出，
// 行为不变；照 checkpoint-route.js / makeErrorTranslator 先例，依赖全部注入，
// 供测试直接 mount）。
// 语义要点：
//   - 探测活连接而非 boot 快照——瞬时锁竞争如实上报当前态，不因启动时 DB 忙
//     就永久判死；
//   - dbq.db() 抛错 → ok:false + error 透传，并 invalidateDb 丢弃缓存连接，
//     下次请求（含本端点的下一次探测）重开自愈；
//   - 附带 ZCode 运行态（runtimeState.running）与 WAL 尺寸，供 UI 判断是否有
//     checkpoint 待合并（最近数据在 ZCode 干净退出前有丢失风险）。
function makeHealthRoute({ dbq, runtime, runtimeState, dbPath, logDir }) {
  return function healthRoute(_req, res) {
    let ok = false, error = null;
    try {
      dbq.db().prepare('SELECT 1').get();
      ok = true;
    } catch (e) {
      error = e.message;
      // drop a damaged connection so the next request reopens cleanly
      dbq.invalidateDb();
    }
    const zcodeRunning = runtimeState.running;
    const wal = runtime.walStatus(dbPath);
    res.json({
      ok, error,
      db: dbPath, log_dir: logDir,
      zcode_running: zcodeRunning,
      wal_bytes: wal ? wal.walBytes : null,
      wal_pending_checkpoint: wal ? wal.walBytes > 0 : false,
      last_checkpoint: runtimeState.lastCheckpoint,
    });
  };
}

module.exports = { makeHealthRoute };
