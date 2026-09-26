'use strict';
// routes/sessions.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dbq = require('../db');
const modelsMeta = require('../models-meta');
const { idleSignal, SIGNALS_WINDOW_MS } = require('../signals');
const { clampLimit, firstParam } = require('../http-hardening');

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
  const sessions = dbq.sessionList({
    // limit/max 双侧钳界（R5 修-high）：旧形态 Math.min(+q || 默认, 上限) 对
    // ?limit=-1 产出 -1 = SQLite 无上限 LIMIT（真实库 1.77万会话实测 6.4s
    // 同步冻结）。helper 语义见 http-hardening.js。
    limit: clampLimit(req.query.limit, 100, 500),
    offset: +req.query.offset || 0, // SQLite 负 OFFSET 语义即 0，无横面风险
    // firstParam 归一（四席全量审查轮）：?q=a&q=b 的数组形态此前直透 LIKE
    // 绑定抛错落 500，与 usage 族同修（既有行为的加固，非口径变更）。
    q: firstParam(req.query.q) || '',
    taskType: firstParam(req.query.task_type) || '',
  });
  // C2：每会话最新 model 行的窗口值经 models-meta resolve 附带——窗口值唯一
  // 通路（前端不持有、不复制模型窗口表）；未知模型 → null（不猜窗口，
  // models-meta 头注 (d)）。db 层已置 null 补全三字段形状，此处覆写。
  for (const s of sessions) {
    const meta = s.latest_model.model_id != null
      ? modelsMeta.resolve(s.latest_model.model_id) : null;
    s.latest_model.context_tokens = meta ? meta.context_tokens : null;
  }
  // C6：signal 字段合并（additive——sessionList 返回形状不动）。分类域＝页内
  // ids（场景 (a)）；无近窗活动的会话 idle（字段存在值为 idle，缺省形状与
  // 分类器同源——idleSignal 单一来源）。空页跳过（省两路近窗查询）。
  if (sessions.length) {
    const signals = dbq.sessionsWithSignals({
      sinceMs: Date.now() - SIGNALS_WINDOW_MS,
      sessionIds: sessions.map(s => s.id),
    });
    for (const s of sessions) {
      const sig = signals.get(s.id) || idleSignal();
      s.signal = {
        state: sig.state,
        confidence: sig.confidence,
        waiting_since: sig.waiting_since,
        reason: sig.reason,
      };
    }
  }
  res.json({ sessions });
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

// GET /api/sessions/:id/context-gauge?limit=100 — C2 会话 token 序列（水位种子）
router.get('/:id/context-gauge', (req, res) => {
  const rows = dbq.contextGaugeRows(req.params.id,
    clampLimit(req.query.limit, 100, 500)); // :48 先例同款二元组（负值钳 1、超上限钳 500）
  res.json({
    rows: rows.map(r => {
      // 窗口值唯一通路：路由层经 models-meta resolve 附带，未知模型 → null。
      // 回退分子（input=0 行的 cache_creation+cache_read）在 T7 组件纯函数算，
      // 本层只透传原始三列（db.js Context gauge 区头注口径钉）。
      const meta = r.model_id != null ? modelsMeta.resolve(r.model_id) : null;
      return {
        ...r,
        context_tokens: meta ? meta.context_tokens : null,
        compact_boundary: r.query_source === 'compact',
      };
    }),
  });
});

// GET /api/sessions/:id/conversation?max=400
router.get('/:id/conversation', (req, res) => {
  res.json({
    messages: dbq.sessionConversation(req.params.id, {
      maxMessages: clampLimit(req.query.max, 400, 2000), // R5：负值钳 1，见上
    }),
  });
});

// GET /api/sessions/:id/activity?limit=200
router.get('/:id/activity', (req, res) => {
  res.json({
    activity: dbq.sessionActivity(req.params.id,
      clampLimit(req.query.limit, 200, 1000)),
  });
});

// GET /api/sessions/:id/reasoning?limit=50  — chain-of-thought text
router.get('/:id/reasoning', (req, res) => {
  res.json({
    reasoning: dbq.sessionReasoning(req.params.id,
      clampLimit(req.query.limit, 50, 500)),
  });
});

// GET /api/sessions/:id/children — subagent tree
// enrich 索引缓存（性能席 CRITICAL 修复）：原实现对每个 child 内层重扫整个
// agents/<parent>/ 目录找 metadata.json——O(N²) 次 readFileSync，最重真实
// 会话（298 子代理）单请求 44,619 次读、39-45s 同步阻塞（真库实测 2026-09-27）。
// 单遍建 Map 后降为 O(N)（~299 次读 ≈0.3s）；再按「父目录 mtime + 60s TTL」
// 缓存——mtime 捕获新子目录出现（子代理新派生即父目录变化），TTL 兜住
// 「已有子目录内 metadata.json 被改写不触发父 mtime」的陈旧面（最坏 60s）。
// 会话详情 Agents tab 5s 轮询（前端）叠加下，缓存使命中轮询只付 readdir+stat。
// 缓存有界（CHILD_META_CACHE_MAX 键序逐出，notify 冷却 NOTIFY_COOLDOWN_CAP
// 同款纪律）；本服务对 ~/.zcode 只读，缓存纯内存。
const CHILD_META_CACHE_MAX = 200;
const CHILD_META_TTL_MS = 60_000;
const childMetaCache = new Map();
function childMetaIndex(parentDir) {
  const st = fs.statSync(parentDir);
  const hit = childMetaCache.get(parentDir);
  if (hit && hit.mtimeMs === st.mtimeMs && Date.now() - hit.at < CHILD_META_TTL_MS) {
    return hit.byChild;
  }
  const byChild = new Map();
  for (const sub of fs.readdirSync(parentDir)) {
    let m = null;
    try { m = JSON.parse(fs.readFileSync(path.join(parentDir, sub, 'metadata.json'), 'utf8')); }
    catch { continue; } // 无 metadata.json / 畸形 JSON：跳过该子目录（原形态同义）
    if (m && typeof m.childSessionId === 'string') byChild.set(m.childSessionId, m);
  }
  childMetaCache.set(parentDir, { mtimeMs: st.mtimeMs, at: Date.now(), byChild });
  if (childMetaCache.size > CHILD_META_CACHE_MAX) {
    childMetaCache.delete(childMetaCache.keys().next().value); // Map 插入序＝最旧键
  }
  return byChild;
}
router.get('/:id/children', (req, res) => {
  const parentDir = resolveSubdir(AGENTS_DIR, req.params.id);
  if (!parentDir) {
    return res.status(400).json({ error: 'invalid session id' });
  }
  const children = dbq.sessionChildren(req.params.id);
  // enrich with metadata.json (profile, prompt, spawn tool call)
  const byChild = fs.existsSync(parentDir) ? childMetaIndex(parentDir) : new Map();
  // C6 信号同源合并（用户实锤「20 多个怎么可能」——账号并发上限 15，直觉
  // 读数是「当前在工作的数量」）：逐子代理附四态信号（working/waiting/
  // idle/broken），前端拆「活跃/等待/已结束」。与列表路由同款消费形态；
  // sessionsWithSignals 三路取数与 children 数无关，5s 轮询下成本恒定毫秒级。
  let sigs = null;
  if (children.length) {
    sigs = dbq.sessionsWithSignals({
      sinceMs: Date.now() - SIGNALS_WINDOW_MS,
      sessionIds: children.map(c => c.id),
    });
  }
  const enriched = children.map(c => {
    const meta = byChild.get(c.id) || null;
    const sig = sigs ? (sigs.get(c.id) || idleSignal()) : null;
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
      signal: sig ? {
        state: sig.state,
        confidence: sig.confidence,
        waiting_since: sig.waiting_since,
        reason: sig.reason,
      } : null,
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
