'use strict';
// routes/live.js — Server-Sent Events stream of newly observed model/tool rows.
// Polls the SQLite DB every second for rows newer than the last-seen rowid,
// and forwards them to connected clients.
// Each connection owns its watermark: a module-level shared one made
// concurrent clients split the stream (each poll consumed rows the other
// never saw), and initializing it must use MAX(rowid) — an ASC/LIMIT-1 lookup
// seeded the oldest row and replayed the entire table (~269k rows, ~1h at the
// 100-rows/1.5s poll cap) after every server boot.
// 水位是 rowid 而非 started_at（R4 修-low，三视角交叉印证）：started_at 单键
// 水位与 livegen.js:28-34 定性修复的同款盲区——boot 取 MAX(started_at) 后，
// 启动前开始、启动后才落库的行永不发射；同毫秒批量新行超过单次 LIMIT 100 时
// 截断点之后的同毫秒行被永久跳过。rowid 水位（recentModelRowsAfterRowid/
// recentToolRowsAfterRowid，隐式 rowid 的 O(log n) 尾界寻址，性能红线允许的
// 查询形态）与 livegen 共享同一不变量：>LIMIT 的余量下个 poll 续扫、晚落库的
// 旧行 rowid 更大照常发射。行载荷携带 rid 供水位推进。
const express = require('express');
const dbq = require('../db');
const log = require('../log-tail');
const { sharedNotifyBus } = require('../notify');

const router = express.Router();

// track last log size so we can tail forward
let lastLogSize = 0;
let currentLogFile = log.todayLogFile();

router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  // per-connection rowid watermarks, starting at the newest observed row so
  // only traffic after THIS connect streams
  let lastModelRowid = dbq.latestModelRowid();
  let lastToolRowid = dbq.latestToolRowid();

  const heartbeat = setInterval(() => res.write(': hb\n\n'), 25000);

  // poll DB
  const poll = setInterval(() => {
    try {
      const models = dbq.recentModelRowsAfterRowid(lastModelRowid, 100);
      for (const m of models) {
        lastModelRowid = m.rid;
        res.write(`event: model\ndata: ${JSON.stringify(m)}\n\n`);
      }
      const tools = dbq.recentToolRowsAfterRowid(lastToolRowid, 100);
      for (const t of tools) {
        lastToolRowid = t.rid;
        res.write(`event: tool\ndata: ${JSON.stringify(t)}\n\n`);
      }
    } catch (e) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
    }
  }, 1500);

  // C8 notify 转发：订阅 process 级共享 bus，规则引擎（server/notify.js 的
  // 自有 tick，非本路由 poll——评估调用点不在 live.js）触发的提醒以
  // `event: notify` 帧推给本连接。具名 listener 引用是裸 EventEmitter 的退订
  // 前提（.on 返回 emitter 本身、非退订闭包——index.js /api/gen/events 的
  // livegen onEvent()→off() 是不同形态，仅语义同源）。notify 即发即失、不
  // 回放（R-30）：本连接建立前触发的提醒不补发，兜底＝waiting chip 轮询。
  const onNotify = (payload) =>
    res.write(`event: notify\ndata: ${JSON.stringify(payload)}\n\n`);
  sharedNotifyBus().on('notify', onNotify);

  req.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(poll);
    sharedNotifyBus().off('notify', onNotify);
  });
});

module.exports = router;
