'use strict';
// routes/signals.js — GET /api/signals/summary（C6 面板最显眼信号的数据面，
// ecosystem-round2-batch2 §2.1 需求 5）。固定四字段
// {waiting_count, broken_count, oldest_waiting_ms, generated_at}：无行数参数、
// 无钳界面（聚合面固定）；空库/空窗全零不抛错。会话域＝全库近窗活跃域
//（sessionsWithSignals 的 sessionIds=null 场景 (b)，与任何分页参数无关——
// waiting 计数再经分类器 task_type 过滤（拍板 2）、broken 计数含全部会话）；
// oldest_waiting_ms＝max(now−waiting_since)（waiting_since 为 null 的会话不
// 参与聚合——NaN 防护；无 waiting 会话时 0）。消费方：顶栏 waiting chip
//（30s 轮询，T3）+ pet 轮询（5s，T3）；C8 notify 的 waiting_timeout 规则
// 直接调 db 层（无 HTTP 自环）。工厂形态与 usage/recap 路由同族（本路由无
// 参数——retentionDays 先例不适用）。
const express = require('express');
const dbq = require('../db');
const { SIGNALS_WINDOW_MS } = require('../signals');

function makeSignalsRouter() {
  const router = express.Router();

  router.get('/summary', (_req, res) => {
    const now = Date.now();
    const signals = dbq.sessionsWithSignals({ sinceMs: now - SIGNALS_WINDOW_MS });
    let waitingCount = 0;
    let brokenCount = 0;
    let oldestWaitingMs = 0;
    for (const sig of signals.values()) {
      if (sig.state === 'waiting') {
        waitingCount++;
        if (sig.waiting_since != null) {
          oldestWaitingMs = Math.max(oldestWaitingMs, now - sig.waiting_since);
        }
      } else if (sig.state === 'broken') {
        brokenCount++;
      }
    }
    res.json({
      waiting_count: waitingCount,
      broken_count: brokenCount,
      oldest_waiting_ms: oldestWaitingMs,
      generated_at: new Date(now).toISOString(),
    });
  });

  return router;
}

module.exports = { makeSignalsRouter };
