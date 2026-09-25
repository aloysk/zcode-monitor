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
//     checkpoint 待合并（最近数据在 ZCode 干净退出前有丢失风险）；
//   - freshness（C9-1，2026-09-25）：db/jsonl 双源「数据落后」读数 + ok/warn/err
//     三档——档位判定全在服务端（阈值经 opts 注入，小值可测），前端只渲染
//     格式化。db 源 = 最后 model 行 started_at vs now（rowid = MAX(rowid)
//     标量子查询寻址，latestModelRowid db.js 同款 O(log n) 通道，无行→null）；jsonl 源 = defaultTodayFile() 的 mtime vs now（「名字最新」
//     语义，禁用 todayLogFile——其 UTC 映射在本地 00:00-08:00 指向昨日停写
//     旧文件，freshness 将每天误报 err 档 8 小时，log-tail.js 头注已定性）。
//     档位归属 >=（含等值）：lag 恰等于阈值即入档；无行/无文件 → lag_ms 与
//     level 均 null（诚实空态，不伪造 0）。口径：行在请求完成时才落库，生成中
//     的长请求完成前不计入——lag 偏大属正常，消费面（顶栏 chip hover）与
//     zcode_running 并读呈现。
const fs = require('fs');

const FRESHNESS_WARN_MS = 5 * 60 * 1000;  // 5min 无新数据 → warn（工程缺省，可注入）
const FRESHNESS_ERR_MS  = 30 * 60 * 1000; // 30min 无新数据 → err

function makeHealthRoute({ dbq, runtime, runtimeState, dbPath, logDir,
                           freshnessWarnMs = FRESHNESS_WARN_MS,
                           freshnessErrMs = FRESHNESS_ERR_MS,
                           defaultTodayFile = require('./log-tail').defaultTodayFile }) {
  // lag → 档位（>= 含等值：恰落阈值即入档）；null lag（无行/无文件/不可测）→
  // null 档，不伪造 ok。
  function levelFor(lagMs) {
    if (lagMs == null) return null;
    if (lagMs >= freshnessErrMs) return 'err';
    if (lagMs >= freshnessWarnMs) return 'warn';
    return 'ok';
  }
  function source(lagMs) { return { lag_ms: lagMs, level: levelFor(lagMs) }; }

  // db 源：复用本请求已探活的连接；行 started_at 晚于 now（时钟偏移）钳 0。
  // 任何异常（连接损坏/库不可读）→ null：ok:false 已另行如实上报，lag 无从测。
  // 取行形态用 MAX(rowid) 标量子查询（latestModelRowid db.js 同款通道）：EQP 为
  // SEARCH … INTEGER PRIMARY KEY——`ORDER BY rowid DESC LIMIT 1` 的倒扫截断
  // 实测同快（LIMIT 1 右叶即止），但 EQP 打 SCAN，纳入本仓 EXPLAIN 机检集会被
  // 误判（四席全量审查轮 2026-09-25 改）。
  function dbLagMs(db) {
    try {
      const row = db.prepare(
        'SELECT started_at FROM model_usage WHERE rowid = (SELECT MAX(rowid) FROM model_usage)'
      ).get();
      if (!row || row.started_at == null) return null;
      return Math.max(0, Date.now() - row.started_at);
    } catch { return null; }
  }
  // jsonl 源：defaultTodayFile()（名字最新）+ mtime；文件不存在（含 LOG_DIR
  // 不可读时回退的 UTC 名未落盘）或 stat 瞬时失败 → null。
  function jsonlLagMs() {
    try {
      return Math.max(0, Date.now() - fs.statSync(defaultTodayFile()).mtimeMs);
    } catch { return null; }
  }

  return function healthRoute(_req, res) {
    let ok = false, error = null;
    let db = null;
    try {
      db = dbq.db();
      db.prepare('SELECT 1').get();
      ok = true;
    } catch (e) {
      error = e.message;
      db = null;
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
      freshness: {
        db: source(ok ? dbLagMs(db) : null),
        jsonl: source(jsonlLagMs()),
        // 复用既有字段值：hover 口径须与运行态并读，消费面不必上探顶层
        zcode_running: zcodeRunning,
      },
    });
  };
}

module.exports = { makeHealthRoute };
