'use strict';
// routes/transcript.js — per-session event timeline from transcript.jsonl.
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const tr = require('../transcript');
const { clampAtLeast } = require('../http-hardening');

const router = express.Router();

// GET /api/transcript/:sessionId?limit=&types=
// Returns the event stream for a (subagent) session, mapped to wire categories.
// Note: a main interactive session has NO transcript.jsonl — that's a normal
// condition (not an error), so we return 200 with found:false rather than 404.
router.get('/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const types = req.query.types ? req.query.types.split(',') : null;
  // limit 钳非负（R5 修-high）：旧形态 `+q.limit` 直传，?limit=-1 会变成
  // out.slice(0,-1) 静默丢最后一行。null（缺省）= 不限；显式 0 = 取前 0 条
  //（readTranscript 以 null/非 null 区分二者）；负值/NaN 钳 0。
  const limit = req.query.limit != null && req.query.limit !== ''
    ? clampAtLeast(req.query.limit, 0)
    : null;
  const { events, meta, found, count } = tr.readTranscript(sessionId, {
    limit,
    types,
  });
  if (!found) {
    // 200, not 404 — "no transcript for this kind of session" is expected.
    return res.json({
      found: false,
      message: '该会话没有 transcript.jsonl（主交互会话只有 message/part 表，没有事件流；切到 Context 看完整对话）。',
    });
  }
  const mapped = events.map(ev => {
    const c = tr.categorize(ev);
    return {
      sequenceNumber: ev.sequenceNumber,
      type: ev.type,
      timestamp: ev.timestamp,
      turnId: ev.turnId,
      category: c.cat,
      label: c.label,
      icon: c.icon,
      summary: tr.summarize(ev),
      payload: ev.payload,
    };
  });
  res.json({
    found: true,
    sessionId,
    meta: meta ? {
      agentId: meta.agentId,
      profileId: meta.profileId,
      childSessionId: meta.childSessionId,
      parentSessionId: meta.parentSessionId,
      parentToolUseId: meta.parentToolUseId,
      cwd: meta.cwd,
      description: meta.description,
      status: meta.status,
      createdAt: meta.createdAt,
      completedAt: meta.completedAt,
      totalDurationMs: meta.totalDurationMs,
      totalTokens: meta.totalTokens,
      totalToolUseCount: meta.totalToolUseCount,
      usage: meta.usage,
    } : null,
    count,
    events: mapped,
    aggregate: tr.aggregate(events),
  });
});

module.exports = router;
