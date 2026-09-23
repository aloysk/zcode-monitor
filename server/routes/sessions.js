'use strict';
// routes/sessions.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dbq = require('../db');

const router = express.Router();

// AGENTS_DIR/EXEC_DIR 可经 ZCODE_AGENTS_DIR/ZCODE_EXEC_DIR 注入（R4 修-medium）：
// 与 ZCODE_DB/ZCODE_LOG_DIR/server/transcript.js 的 ZCODE_AGENTS_DIR 同法
//（require 前注入），测试指向 tmpdir fixture，绝不触碰真实 ~/.zcode。
const AGENTS_DIR = process.env.ZCODE_AGENTS_DIR
  || path.join(os.homedir(), '.zcode', 'cli', 'agents');
const EXEC_DIR = process.env.ZCODE_EXEC_DIR
  || path.join(os.homedir(), '.zcode', 'cli', 'exec');
const ARTIFACTS_DIR = path.join(os.homedir(), '.zcode', 'cli', 'artifacts');

// ── 路径段安全闸（R4 修-medium）───────────────────────────────────────────
// :id / :toolCallId 会被 path.join 进文件系统（children 的 AGENTS_DIR、
// tool-output 的 EXEC_DIR）。Express 对单段路由参数做 decodeURIComponent，
// `..%2F..%2F` 解码后即含分隔符——不带闸的 path.join 可越出目录根（实测）。
// 双重复核与 pet-import.resolveStagingSource 同款：① 严格字符集
// （[A-Za-z0-9._-]，天然排除 / 与 \，覆盖真实会话 id/toolCallId 的形态）+
// 显式拒绝 `.` / `..`；② path.relative 包含性复核兜底。不合规一律 400。
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
function isSafeSegment(segment) {
  return typeof segment === 'string' && SAFE_SEGMENT_RE.test(segment)
    && segment !== '.' && segment !== '..';
}
function resolveSubdir(base, segment) {
  if (!isSafeSegment(segment)) return null;
  const dir = path.join(base, segment);
  const rel = path.relative(base, dir);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return dir;
}

// GET /api/sessions?q=&task_type=&limit=&offset=
router.get('/', (req, res) => {
  res.json({
    sessions: dbq.sessionList({
      limit: Math.min(+req.query.limit || 100, 500),
      offset: +req.query.offset || 0,
      q: req.query.q || '',
      taskType: req.query.task_type || '',
    }),
  });
});

// GET /api/sessions/:id
router.get('/:id', (req, res) => {
  const s = dbq.sessionGet(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  res.json({ session: s });
});

// GET /api/sessions/:id/turns
router.get('/:id/turns', (req, res) => {
  res.json({ turns: dbq.sessionTurns(req.params.id) });
});

// GET /api/sessions/:id/conversation?max=400
router.get('/:id/conversation', (req, res) => {
  res.json({
    messages: dbq.sessionConversation(req.params.id, {
      maxMessages: Math.min(+req.query.max || 400, 2000),
    }),
  });
});

// GET /api/sessions/:id/activity?limit=200
router.get('/:id/activity', (req, res) => {
  res.json({
    activity: dbq.sessionActivity(req.params.id,
      Math.min(+req.query.limit || 200, 1000)),
  });
});

// GET /api/sessions/:id/reasoning?limit=50  — chain-of-thought text
router.get('/:id/reasoning', (req, res) => {
  res.json({
    reasoning: dbq.sessionReasoning(req.params.id,
      Math.min(+req.query.limit || 50, 500)),
  });
});

// GET /api/sessions/:id/children — subagent tree
router.get('/:id/children', (req, res) => {
  const parentDir = resolveSubdir(AGENTS_DIR, req.params.id);
  if (!parentDir) {
    return res.status(400).json({ error: 'invalid session id' });
  }
  const children = dbq.sessionChildren(req.params.id);
  // enrich with metadata.json (profile, prompt, spawn tool call)
  const enriched = children.map(c => {
    let meta = null;
    // find agents/<parentSessionId>/agent_<short>/metadata.json where childSessionId == c.id
    if (fs.existsSync(parentDir)) {
      for (const sub of fs.readdirSync(parentDir)) {
        const metaPath = path.join(parentDir, sub, 'metadata.json');
        if (fs.existsSync(metaPath)) {
          try {
            const m = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (m.childSessionId === c.id) { meta = m; break; }
          } catch {}
        }
      }
    }
    return {
      id: c.id,
      title: c.title,
      task_type: c.task_type,
      total_tokens: c.total_tokens,
      time_created: dbq.ts(c.time_created),
      time_updated: dbq.ts(c.time_updated),
      profile: meta?.profileId || null,
      profileSnapshot: meta?.profileSnapshot || null,
      prompt: meta?.prompt || null,
      parentToolUseId: meta?.parentToolUseId || null,
    };
  });
  res.json({ children: enriched });
});

// GET /api/sessions/:id/tool-output/:toolCallId — fetch Bash stdout/stderr from exec dir
router.get('/:id/tool-output/:toolCallId', (req, res) => {
  const { id, toolCallId } = req.params;
  const sessDir = resolveSubdir(EXEC_DIR, id);
  if (!sessDir || !isSafeSegment(toolCallId)) { // toolCallId 拼进文件名，同款段闸
    return res.status(400).json({ error: 'invalid session id or toolCallId' });
  }
  const out = { stdout: null, stderr: null, truncated: false };
  if (fs.existsSync(sessDir)) {
    const stdoutPath = path.join(sessDir, `${toolCallId}-stdout.log`);
    const stderrPath = path.join(sessDir, `${toolCallId}-stderr.log`);
    if (fs.existsSync(stdoutPath)) {
      const raw = fs.readFileSync(stdoutPath, 'utf8');
      const MAX = 200 * 1024; // 200KB cap per channel in the UI
      out.stdout = raw.length > MAX ? (raw.slice(0, MAX) + `\n…[truncated ${raw.length - MAX} bytes]`) : raw;
      out.truncated = raw.length > MAX;
    }
    if (fs.existsSync(stderrPath)) {
      const raw = fs.readFileSync(stderrPath, 'utf8');
      const MAX = 64 * 1024;
      out.stderr = raw.length > MAX ? (raw.slice(0, MAX) + `\n…[truncated ${raw.length - MAX} bytes]`) : raw;
    }
  }
  res.json(out);
});

module.exports = router;
