#!/usr/bin/env node
// log-latency-probe.js — 观测「JSONL 行生成 → 行可见」延迟（真实环境，A3-5）。
// 只读：对日志目录只 stat/read，绝不写入（样本由 ZCode 自身的追加产生）。
//   --mode watch  用 createLogWatcher（强化后）
//   --mode poll   每 5s stat + 只读 mini-tail，模拟现行 5s 纯轮询基线
//   --samples N   收集 N 个样本后退出（默认 5，计划要求 ≥5）
//   --logdir DIR  覆盖 LOG_DIR（默认走 db.js 注入链，即真实日志目录）
//
// 测量基准：每行自带 "timestamp"（ISO，毫秒精度，ZCode 生成事件的真实时刻），
// 延迟 = 可见时刻 − 行内 timestamp。watch 模式逐行计（onEvents 每行一个样本）；
// poll 模式在每个 5s tick 记「最新新行」的年龄（lastSeenTs 去重，boot 先空采一次
// 排除存量行）。
//
// 相对计划稿的偏差（均有实测依据，详见 docs/acceptance/T6-latency-samples.md）：
// 1) 延迟基准从「文件 mtime + 200ms tick 握手」改为行内 timestamp——前者实测有
//    1.7s 级伪影：onEvents 在 tGrow 为 null 的窗口内到达会丢弃该批，下一批又配到
//    旧 tGrow，watch 样本被抬高（实测 36/52/1681/1716/594ms）。
// 2) poll 模式可见性确认用本文件内的只读 mini-tail（跟随 defaultTodayFile）——
//    现行 tailLog 内部走 todayLogFile() 的 UTC 日映射，2026-09-23 实测 ZCode 按
//    本地日命名轮转（00:00+0800 整点切新文件），午夜后 UTC 映射指向已停写的
//    旧文件，tailLog 将永远读不到新行；那是既有 tailLog 的缺陷（本任务不改其
//    行为），不能让它在基线里掩盖轮询机制本身的真实延迟。
'use strict';
const fs = require('fs');
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
if (opt('logdir')) process.env.ZCODE_LOG_DIR = opt('logdir');
const log = require('../server/log-tail');
const mode = opt('mode') || 'watch';
const want = +(opt('samples') || 5);

const samples = [];
function record(latencyMs) {
  samples.push(latencyMs);
  console.log(`sample ${samples.length}: ${latencyMs}ms`);
  if (samples.length >= want) {
    const sorted = [...samples].sort((a, b) => a - b);
    console.log(`median: ${sorted[Math.floor(sorted.length / 2)]}ms samples=${JSON.stringify(samples)}`);
    process.exit(0);
  }
}

function lineAgeMs(e, now) {
  const t = e && e.timestamp ? Date.parse(e.timestamp) : NaN;
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

// 只读 mini-tail：读目标文件末 64KB 取末 n 行，按时间正序（与 tailLog 同手法，
// 但跟随注入文件——见头部偏差 2)
function tailLines(file, n = 5) {
  const stat = fs.statSync(file);
  const chunkSize = Math.min(stat.size, 64 * 1024);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(chunkSize);
  fs.readSync(fd, buf, 0, chunkSize, stat.size - chunkSize);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').split('\n');
  if (stat.size > chunkSize) lines.shift(); // 首行大概率被截断，丢弃
  return lines.map(log.parseLine).filter(Boolean).slice(-n);
}

if (mode === 'watch') {
  const w = log.createLogWatcher({
    reconcileMs: 5000,
    onEvents: evs => {
      const now = Date.now();
      for (const e of evs) {
        const age = lineAgeMs(e, now);
        if (age != null) record(age); // 逐行计：每行「生成 → 送达」延迟
      }
    },
  });
  console.log(`probing (watch): waiting for ${want} appends…`);
} else {
  // boot 先空采一次：把存量最新行记为 lastSeenTs，避免把旧行年龄计为样本
  let lastSeenTs = '';
  try {
    const pre = tailLines(log.defaultTodayFile(), 1);
    if (pre.length && pre[pre.length - 1].timestamp) lastSeenTs = pre[pre.length - 1].timestamp;
  } catch { /* 文件尚未生成 */ }
  setInterval(() => {
    try {
      const events = tailLines(log.defaultTodayFile(), 5);
      if (!events.length) return;
      const newest = events[events.length - 1];
      const ts = newest.timestamp || '';
      if (!ts || ts <= lastSeenTs) return; // 没有比上次更新的行
      lastSeenTs = ts;
      record(Math.max(0, Date.now() - Date.parse(ts)));
    } catch { /* ignore */ }
  }, 5000).unref();
  console.log(`probing (poll 5s baseline): waiting for ${want} appends…`);
}
setInterval(() => {}, 60000); // keep alive
