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

// ── watch 增量路径（WP3-lite）───────────────────────────────
// fs.watch 监听日志目录（不是单文件句柄）：任一目录事件都按 todayFile() 重新
// 解析当日文件名，日切换（换名）由此覆盖，新文件从偏移 0 起读。追加 →
// 30ms 防抖合并后立即增量读取；watch 报错（ENOENT/EPERM/EMFILE/重命名风暴
// 挤掉句柄）→ 关闭监听、降级 pollMs 短轮询并只告警一次；reconcile 周期对账
// 定时器恒在——偏移读幂等，watch 静默漏事件由它补齐（最终一致）。
// 全程只读：只 stat / open('r')，绝不写入。EMFILE 防护靠"单一目录句柄"
// （永不逐文件建 watch），防抖合并令重命名风暴不会放大为读放大。
//
// 缺省文件解析不用 todayLogFile(new Date()) 的 UTC 日映射：2026-09-23 00:18+0800
// 实测 ZCode 按**本地日**命名并整点轮转（zcode-2026-09-22.jsonl 末写时间
// 23:59:59+0800，活跃文件为 zcode-2026-09-23.jsonl，而彼时 UTC 日仍是 09-22）——
// 按 UTC 映射会在本地午夜后追错文件最长 8 小时。故缺省取 LOG_DIR 内名字最新
// 的匹配文件（对 UTC/本地命名惯例都成立，readdir 免 stat）；解析失败回退
// todayLogFile()。既有导出 todayLogFile 的语义不动（行为对外不变）。
function defaultTodayFile() {
  try {
    const names = fs.readdirSync(LOG_DIR)
      .filter(f => /^zcode-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .sort()
      .reverse();
    if (names.length) return path.join(LOG_DIR, names[0]);
  } catch { /* LOG_DIR 不可读：回退日期映射 */ }
  return todayLogFile(new Date());
}

function createLogWatcher({ onEvents, reconcileMs = 5000, pollMs = 1000,
                            todayFile = defaultTodayFile } = {}) {
  if (typeof onEvents !== 'function') throw new TypeError('onEvents required');
  let curFile = null, offset = 0, remainder = '';
  let watcher = null, reconcileTimer = 0, pollTimer = 0, stopped = false;
  let pending = 0;
  let degradedWarned = false;

  function warnDegraded(why) {
    if (degradedWarned || stopped) return;
    degradedWarned = true;
    console.warn(`[log-tail] fs.watch 不可用（${why}），已退回 ${pollMs}ms 短轮询；事件可见性由短轮询 + 周期对账兜底`);
  }

  function pump() {
    if (stopped) return;
    pending = 0;
    let file;
    try { file = todayFile(); } catch { return; }
    if (file !== curFile) {
      const isFirst = curFile === null;
      curFile = file; offset = 0; remainder = ''; // 日切换（换名）→ 新文件从偏移 0 起读
      if (isFirst) { // 起点对账：已存在的当日文件从尾部开始，不回放历史
        try { offset = fs.statSync(curFile).size; } catch { /* 文件未生成，等下次 */ }
        return;
      }
    }
    let stat;
    try { stat = fs.statSync(curFile); }
    catch { return; } // 当日文件尚不存在：等下次事件/对账
    if (stat.size < offset) { offset = 0; remainder = ''; } // 截断/回绕：按新文件从 0 重读
                                                             // （对账定时器调的就是本 pump，走同一
                                                             //  分支兜不了底；offset 不重置会让此后
                                                             //  追加在 size 追回 offset 前全部不可见）
    if (stat.size === offset) return; // 无新字节
    const chunkSize = stat.size - offset;
    const buf = Buffer.alloc(chunkSize);
    let fd;
    try {
      fd = fs.openSync(curFile, 'r');
      fs.readSync(fd, buf, 0, chunkSize, offset);
    } catch { return; }
    finally { try { if (fd != null) fs.closeSync(fd); } catch { /* ignore */ } }
    offset = stat.size;
    const text = remainder + buf.toString('utf8');
    const lines = text.split('\n');
    remainder = lines.pop() ?? ''; // 尾部残行留到下次拼接
    const events = lines.map(parseLine).filter(Boolean);
    if (events.length) onEvents(events);
  }

  function schedulePump() {
    if (pending || stopped) return;
    pending = setTimeout(pump, 30).unref?.(); // 抖动合并：30ms 内的连续事件合并一次读
  }

  function degradeToPolling(why) {
    warnDegraded(why);
    if (!pollTimer && !stopped) pollTimer = setInterval(pump, pollMs).unref?.();
  }

  function startWatch() {
    try {
      watcher = fs.watch(path.dirname(todayFile()), { persistent: false }, schedulePump);
      watcher.on('error', (e) => { // ENOENT/EPERM/EMFILE…：降级短轮询，不丢事件
        try { watcher.close(); } catch { /* ignore */ }
        watcher = null;
        degradeToPolling((e && e.message) || 'watch error');
      });
    } catch (e) {
      degradeToPolling((e && e.message) || 'watch unavailable');
    }
  }

  pump(); // 起点对账：从当前文件尾开始（不回放历史）
  startWatch();
  reconcileTimer = setInterval(pump, reconcileMs).unref?.();

  return {
    stop() {
      stopped = true;
      try { if (watcher) watcher.close(); } catch { /* ignore */ }
      for (const t of [pending, reconcileTimer, pollTimer]) {
        try { clearTimeout(t); clearInterval(t); } catch { /* ignore */ }
      }
    },
  };
}

module.exports = { todayLogFile, listLogFiles, parseLine, tailLog, eventsForTrace,
                   buildSpanForest, createLogWatcher, defaultTodayFile };
