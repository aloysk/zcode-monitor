'use strict';
// log-tail.js — read & parse the daily JSONL logs under ~/.zcode/cli/log/.
// Used for (a) the live activity feed and (b) trace/span reconstruction.
// No mutation: we only read existing files.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { LOG_DIR } = require('./db');

function todayLogFile(d = new Date()) {
  // logs are named zcode-YYYY-MM-DD.jsonl (UTC day)
  return path.join(LOG_DIR, `zcode-${d.toISOString().slice(0, 10)}.jsonl`);
}

function listLogFiles() {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter(f => /^zcode-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort()
    .reverse()
    .map(f => ({ name: f, path: path.join(LOG_DIR, f),
                 size: fs.statSync(path.join(LOG_DIR, f)).size,
                 mtime: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }));
}

// Parse one JSONL line defensively. Returns null on bad lines.
function parseLine(line) {
  if (!line) return null;
  try {
    const o = JSON.parse(line);
    return o;
  } catch {
    return null;
  }
}

// Tail the current day's log: read the last N lines efficiently.
async function tailLog({ lines = 200 } = {}) {
  const file = todayLogFile();
  if (!fs.existsSync(file)) return [];
  // Stream from end: read last ~256KB then split lines, take last N.
  const stat = fs.statSync(file);
  const chunkSize = Math.min(stat.size, 1024 * 1024); // up to 1MB
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(chunkSize);
  fs.readSync(fd, buf, 0, chunkSize, stat.size - chunkSize);
  fs.closeSync(fd);
  const text = buf.toString('utf8');
  // The first partial line is likely cut; drop it unless we read from 0.
  const all = text.split('\n');
  if (stat.size > chunkSize) all.shift();
  const parsed = [];
  for (let i = all.length - 1; i >= 0 && parsed.length < lines; i--) {
    const o = parseLine(all[i]);
    if (o) parsed.unshift(o);
  }
  return parsed;
}

// Collect every log event whose traceId matches, scanning today's file
// (and optionally yesterday's too, since UTC day boundaries shift).
async function eventsForTrace(traceId) {
  if (!traceId) return [];
  const files = [todayLogFile()];
  const y = new Date(); y.setUTCDate(y.getUTCDate() - 1);
  files.push(todayLogFile(y));

  const out = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const rl = readline.createInterface({
      input: fs.createReadStream(file), crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const o = parseLine(line);
      if (o && o.traceId === traceId) out.push(o);
    }
  }
  // sort by timestamp
  out.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
  return out;
}

// Build a span tree from a flat list of events. Each event has
// spanId, parentSpanId, event, timestamp, durationMs, context.
// Returns a forest (array of roots). Each node: { event, children:[] }.
function buildSpanForest(events) {
  const bySpan = new Map();
  for (const e of events) {
    const key = e.spanId || ('ev_' + events.indexOf(e));
    if (!bySpan.has(key)) bySpan.set(key, { node: e, children: [] });
  }
  const roots = [];
  for (const e of events) {
    const key = e.spanId || ('ev_' + events.indexOf(e));
    const node = bySpan.get(key);
    if (e.parentSpanId && bySpan.has(e.parentSpanId)) {
      bySpan.get(e.parentSpanId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

module.exports = { todayLogFile, listLogFiles, parseLine, tailLog, eventsForTrace, buildSpanForest };
