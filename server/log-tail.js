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
// 单次 pump 设同步读上限（MAX_PUMP_BYTES）：大块增量（挂起恢复/长滞后）分片
// 追平，片间 setImmediate 让出事件循环，偏移守恒不变。
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

// 单次 pump 的同步读上限：进程挂起恢复/事件循环长停滞后，一次性读入的增量可达
// 数百 MB（真实日志 ~295MB/日）——整段 Buffer.alloc + 同步 split/parse 正是
// livegen.js 注释里定义为红线的事件循环冻结形态。设上限后单次只同步处理一小块，
// 未追平的部分经 setImmediate 让出事件循环后继续追平（偏移守恒不变：不丢不重）。
const MAX_PUMP_BYTES = 8 * 1024 * 1024;
// 残行字节上限：超过它只可能是损坏/超长行（正常 JSONL 行远小于此），丢弃并告警，
// 防止无 \n 的异常流让 remainder 无界增长。（独立于可注入的 maxBytesPerPump，
// 测试用小上限时不会误伤比它长的正常行。）
const REMAINDER_MAX_BYTES = 16 * 1024 * 1024;

function createLogWatcher({ onEvents, reconcileMs = 5000, pollMs = 1000,
                            todayFile = defaultTodayFile,
                            maxBytesPerPump = MAX_PUMP_BYTES } = {}) {
  if (typeof onEvents !== 'function') throw new TypeError('onEvents required');
  let curFile = null, offset = 0, remainder = Buffer.alloc(0);
  let watcher = null, reconcileTimer = 0, pollTimer = 0, stopped = false;
  let pending = 0;
  let degradedWarned = false;
  // 首文件尾部锚定完成标记：锚定失败（readdir 已见文件、紧随的 stat 抛错的窄窗）
  // 时若直接进入增量读，会从偏移 0 整文件回放历史（真实日志 ~295MB/日）——
  // 违反「起点对账不回放历史」。未锚定前每次 pump 先补做尾部锚定。
  // 日切换（换名）到的新文件无历史，从 0 起读即视为已锚定。
  let anchoredToTail = false;

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
      curFile = file; offset = 0; remainder = Buffer.alloc(0); // 日切换（换名）→ 新文件从偏移 0 起读
      if (isFirst) { // 起点对账：已存在的当日文件从尾部开始，不回放历史
        try {
          offset = fs.statSync(curFile).size;
        } catch (e) {
          if ((e && e.code) !== 'ENOENT') return; // 文件在但 stat 瞬时失败（EPERM/EBUSY）：
                                                  // 历史未知、保持未锚定，下次 pump 先补锚定，
                                                  // 绝不从 0 整文件回放
          // ENOENT = 启动时文件还不存在 = 启动前无历史 → 从 0 增量读即安全
          // （不能等下次"补锚定"：那会锚掉启动后已写入的新行、直接丢事件）
        }
        anchoredToTail = true;
        return;
      }
      anchoredToTail = true; // 日切换的新文件无历史可回放，从 0 增量读即安全
    }
    if (!anchoredToTail) { // 首次非 ENOENT 失败过的补锚定（再失败则继续等）
      try {
        offset = fs.statSync(curFile).size;
        anchoredToTail = true;
      } catch { return; }
      return;
    }
    let stat;
    try { stat = fs.statSync(curFile); }
    catch { return; } // 当日文件尚不存在：等下次事件/对账
    if (stat.size < offset) { offset = 0; remainder = Buffer.alloc(0); } // 截断/回绕：按新文件从 0 重读
                                                                         // （对账定时器调的就是本 pump，走同一
                                                                         //  分支兜不了底；offset 不重置会让此后
                                                                         //  追加在 size 追回 offset 前全部不可见）
    if (stat.size === offset) return; // 无新字节
    const readSize = Math.min(stat.size - offset, maxBytesPerPump);
    const buf = Buffer.alloc(readSize);
    let fd;
    try {
      fd = fs.openSync(curFile, 'r');
      fs.readSync(fd, buf, 0, readSize, offset);
    } catch { return; }
    finally { try { if (fd != null) fs.closeSync(fd); } catch { /* ignore */ } }
    offset += readSize;
    // 残行按原始字节保存，只在完整行（以 \n 收尾的前缀）上做 utf8 解码：若某次
    // 读取落在多字节 UTF-8 序列中间，两段各自解码会产生 U+FFFD，该行 JSON 解析
    // 失败被静默丢弃且 offset 已前移、无法补读。\n 是 ASCII 字节、不出现在任何
    // UTF-8 多字节序列内部，故 [0, nl] 前缀必为完整字节序列。
    const chunk = remainder.length ? Buffer.concat([remainder, buf]) : buf;
    const nl = chunk.lastIndexOf(0x0A);
    if (nl === -1) {
      remainder = chunk;
      if (remainder.length > REMAINDER_MAX_BYTES) {
        console.warn(`[log-tail] 丢弃 ${remainder.length} 字节残行（超残行上限，疑似损坏流）`);
        remainder = Buffer.alloc(0);
      }
    } else {
      remainder = chunk.subarray(nl + 1);
      const lines = chunk.toString('utf8', 0, nl + 1).split('\n');
      lines.pop(); // 最后一个 \n 之后的空串
      const events = lines.map(parseLine).filter(Boolean);
      if (events.length) onEvents(events);
    }
    if (offset < stat.size && !stopped) setImmediate(pump); // 未追平：让出事件循环后继续
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
