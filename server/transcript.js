'use strict';
// transcript.js — parse a subagent's transcript.jsonl + metadata.json.
// transcript.jsonl is the canonical per-session event stream (turn_started,
// model_request, model_network_status, model_streaming, model_complete,
// streaming_tool_ledger_updated, turn_complete, ...). One JSON object per line.

const fs = require('fs');
const path = require('path');
const os = require('os');

// AGENTS_DIR 可经 ZCODE_AGENTS_DIR 注入（R3 修-low）：与 ZCODE_DB/ZCODE_LOG_DIR
// 同法（require 前注入），测试指向 tmpdir fixture，绝不触碰真实 ~/.zcode。
const AGENTS_DIR = process.env.ZCODE_AGENTS_DIR
  || path.join(os.homedir(), '.zcode', 'cli', 'agents');

// Extract the agent uuid from a child session id like
// `sess_subagent_agent_<uuid>`. We anchor on the *trailing* agent_ segment
// (the uuid), not the leading subagent_ one.
function agentUuidFromChild(childSessionId) {
  if (!childSessionId) return null;
  const m = /agent_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(childSessionId);
  return m ? m[1] : null;
}

// Find the agent dir for a given child session id (sess_subagent_agent_<uuid>).
// Returns { parentSessionId, agentId, dir, meta } or null.
function locateAgent(childSessionId) {
  const uuid = agentUuidFromChild(childSessionId);
  if (!uuid) return null;
  const agentDirName = 'agent_' + uuid;
  if (!fs.existsSync(AGENTS_DIR)) return null;
  for (const parentSess of fs.readdirSync(AGENTS_DIR)) {
    const candidate = path.join(AGENTS_DIR, parentSess, agentDirName);
    const metaPath = path.join(candidate, 'metadata.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        return { parentSessionId: parentSess, agentId: agentDirName, dir: candidate, meta };
      } catch {}
    }
  }
  return null;
}

// Read metadata.json for a child session.
function readMetadata(childSessionId) {
  const loc = locateAgent(childSessionId);
  return loc ? loc.meta : null;
}

// Read & parse every line of a transcript. Returns { events, meta }.
// events: array of { sequenceNumber, type, timestamp, turnId, traceId, payload, sessionId }
function readTranscript(childSessionId, { limit = null, types = null } = {}) {
  const loc = locateAgent(childSessionId);
  if (!loc) return { events: [], meta: null, found: false };
  const tfile = path.join(loc.dir, 'transcript.jsonl');
  const out = [];
  if (fs.existsSync(tfile)) {
    const text = fs.readFileSync(tfile, 'utf8');
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (types && !types.includes(o.type)) continue;
      out.push({
        sequenceNumber: o.sequenceNumber,
        type: o.type,
        timestamp: o.timestamp,
        turnId: o.turnId,
        traceId: o.traceId,
        sessionId: o.sessionId,
        payload: o.payload || {},
      });
    }
  }
  // R5：以 null/非 null 区分「不限」与「取前 0 条」——旧的 truthiness 判断把
  // limit=0 当作不限，且 route 传入负值时会 slice(0,-1) 静默丢最后一行（路由层
  // 已钳非负，这里的 Math.max 是直调调用方的兜底）。
  const events = limit != null ? out.slice(0, Math.max(0, limit)) : out;
  return { events, meta: loc.meta, found: true, count: out.length };
}

// Map transcript event types → wire-style display categories, matching the
// reference page taxonomy (prompt / llm→ / network / usage / tool.call / tool.result / lifecycle).
function categorize(ev) {
  const t = ev.type;
  const p = ev.payload || {};
  switch (t) {
    case 'turn_started':        return { cat: 'prompt',    label: 'prompt',  icon: '▸' };
    case 'turn_complete':       return { cat: 'usage',     label: 'turn.end',icon: '◾' };
    case 'model_request':       return { cat: 'llm',       label: 'llm→',    icon: '↗' };
    case 'model_complete':      return { cat: 'usage',     label: 'usage',   icon: '◼' };
    case 'model_network_status':return { cat: 'network',   label: 'network', icon: '⇄' };
    case 'model_streaming':     return { cat: 'llm',       label: 'stream',  icon: '~' };
    case 'streaming_tool_ledger_updated': {
      // status field discriminates tool.call vs tool.result
      const status = p.status || '';
      if (status === 'tool_result_committed') return { cat: 'tool', label: 'tool.result', icon: '↓' };
      return { cat: 'tool', label: 'tool.call', icon: '↑' };
    }
    case 'tool_call_scheduled': return { cat: 'tool',      label: 'tool.sched', icon: '⋔' };
    case 'tool_batch_complete': return { cat: 'tool',      label: 'tool.batch', icon: '◇' };
    case 'stream_recovery_anchor_created': return { cat: 'lifecycle', label: 'recovery', icon: '⟲' };
    case 'checkpoint_created':  return { cat: 'lifecycle', label: 'checkpoint', icon: '⎘' };
    default:                    return { cat: 'other',     label: t,          icon: '·' };
  }
}

// Build a compact summary string for each event (shown in the timeline row).
function summarize(ev) {
  const t = ev.type;
  const p = ev.payload || {};
  switch (t) {
    case 'turn_started':
      return truncate(p.input, 90);
    case 'turn_complete':
      return `result=${p.resultType} · tokens=${fmtNum(p.tokenCount)} · tools=${p.toolCallCount} · ${fmtMs(p.duration)}`;
    case 'model_request':
      return `${p.model || '?'} · ${p.toolCount ?? '?'} tools · iter ${p.iteration ?? 0}`;
    case 'model_complete':
      return `${p.stopReason} · in=${fmtNum(p.usage?.inputTokens)} out=${fmtNum(p.usage?.outputTokens)} cache=${fmtNum(p.usage?.cacheReadTokens)} · ${p.toolCallCount} tools`;
    case 'model_network_status': {
      const inner = p.type === 'model_request_started' ? 'started' : 'completed';
      return `${inner} · ${p.transport} · attempt ${p.attempt} · ${truncate(p.baseURL, 50)}`;
    }
    case 'model_streaming': {
      const k = p.kind || '';
      if (k === 'text_delta')    return `text +${(p.delta||'').length}`;
      if (k === 'reasoning_delta')return `think +${(p.delta||'').length}`;
      if (k === 'tool_input_delta')return `tool-input +${(p.delta||'').length}`;
      return k || 'stream';
    }
    case 'streaming_tool_ledger_updated': {
      const flags = [];
      if (p.readOnly) flags.push('RO');
      if (p.destructive) flags.push('DESTRUCT');
      return `${p.toolName} · ${p.status}${flags.length ? ' · ' + flags.join('/') : ''}`;
    }
    case 'tool_call_scheduled':
      return `${p.toolName} · parallel=${p.canRunParallel ? 'yes' : 'no'}`;
    case 'tool_batch_complete':
      return `ok=${p.successCount} err=${p.errorCount}`;
    case 'checkpoint_created':
      return `scope=${p.scope} · files=${p.fileCount}`;
    case 'stream_recovery_anchor_created':
      return `${p.toolName} · ${p.kind}`;
    default:
      return '';
  }
}

function truncate(s, n) {
  if (!s) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function fmtNum(n) { return n == null ? '?' : (n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n)); }
function fmtMs(ms) { if (ms == null) return '?'; return ms < 1000 ? Math.round(ms)+'ms' : (ms/1000).toFixed(1)+'s'; }

// Aggregate: counts per event type, tools used, total tokens.
function aggregate(events) {
  const byType = {};
  const tools = {};
  let tokens = { input: 0, output: 0, cache: 0 };
  for (const ev of events) {
    byType[ev.type] = (byType[ev.type] || 0) + 1;
    if (ev.type === 'streaming_tool_ledger_updated') {
      const name = ev.payload?.toolName;
      if (name) tools[name] = (tools[name] || 0) + 1;
    }
    if (ev.type === 'model_complete' && ev.payload?.usage) {
      const u = ev.payload.usage;
      tokens.input += u.inputTokens || 0;
      tokens.output += u.outputTokens || 0;
      tokens.cache += u.cacheReadTokens || 0;
    }
  }
  return { byType, tools, tokens };
}

module.exports = {
  AGENTS_DIR, agentUuidFromChild, locateAgent, readMetadata, readTranscript,
  categorize, summarize, aggregate,
};
