'use strict';
// routes/export.js — GET /api/export/:dataset?format=json|csv（C12 导出夹带，
// ecosystem-round2-batch2 §2.4）。dataset 白名单 overview|usage|recap（路径参数
// 形态，?dataset= query 不参与路由判定）；format 白名单 json|csv（缺省 json）；
// 白名单外一律 400 可读错误码、不静默回退（§2.0 拍板 7 机器可读面从严——与
// 窗口参数「未知回退」先例有意不同，差异在消费方是人还是脚本）。
// 同源钉（零新 SQL）：直接消费源端点相同的查询/装配函数——overview＝/api/
// overview 装配面同清单（overviewKpis/timeseries/breakdownByModel/
// breakdownByTool/overviewSpeed/recentSpeed）、usage＝/api/usage/turns 响应
// 原形（usage 数据集固定绑定 turns；tools/attribution 不导出，覆盖面裁剪登记
// residuals）、recap＝buildRecapPayload（T6 交付的模块级装配函数，本文件
// require 消费不改其文件）。usage 值域（24h|7d|30d）窗口解析唯一落点在
// usage-window.js；overview 值域（24h|7d|today）以 overview.js:13-22 内联解析
// 为同语义锚——值域两套系规格钉的授权例外，本文件内的映射仅 overviewWindow
// 一处（注释含源锚点引用）。
// JSON 包络（EXPORT_SCHEMA_VERSION=1）：顶层 {schema_version, generated_at,
// dataset, format, meta, data}，data＝源端点载荷原形；meta：usage/recap 继承
// 源端点 meta（retention_days/scope/truncated 等），overview 例外补装
// {retention_days, window, since}（源端点无 meta；保留期是库级事实，usage 族
// head 的 meta.retention_days 先例）。
// CSV（RFC 4180）：每数据集固定一张矩形主表——usage＝turn 时间线（列同 C1
// timeline 行字段）、recap＝日桶六列、overview＝section 长表三列
// （section,key,value：kpis/speed/recent_speed 逐叶子标量展开、series/by_model/
// by_tool 每行一行 value＝行对象 JSON 序列化——脚本侧 parse value 列即得结构
// 化值）。转义钉：含 , " \r \n 的字段双引号包裹、内部 " 加倍；行尾 \r\n；首行
// 列名；UTF-8 无 BOM；公式注入防护——以 = + - @ 或 TAB/CR/LF 开头的字段
// 前置 '（Excel/Sheets 把 CSV 单元格按公式求值的注入面；字符集＝OWASP CSV
// Injection 建议集，终审第 1 轮安全席 note 补齐；导入约束见 How 页）。
// 响应头：Content-Disposition 附件下载 + X-Zcode-Monitor-Export-Schema-Version
// （JSON/CSV 双形态均带，JSON 侧是包络体的双保险）；装配在 /api 路由区（Host
// 闸/securityHeaders 之后自动带全局头——C12-5 装配契约）。
const express = require('express');
const dbq = require('../db');
const { clampLimit, firstParam } = require('../http-hardening');
const { resolveWindow } = require('./usage-window');
const { buildRecapPayload } = require('./recap');

const EXPORT_SCHEMA_VERSION = 1;
const DATASETS = new Set(['overview', 'usage', 'recap']);

// usage 主表列＝C1 timeline 行字段（usageTurnTimeline 输出形状，usage-routes
// 的时间线行形状钉同清单）；recap 主表列＝日桶六列（§2.4 需求 4 字面清单——
// days[].errors 不入表）。
const USAGE_COLS = ['turn_id', 'session_id', 'started_at', 'duration_ms',
  'time_to_first_token_ms', 'status', 'model_retry_count', 'tool_error_count',
  'error_type', 'context_exceeded', 'computed_total_tokens'];
const RECAP_COLS = ['date', 'tokens', 'calls', 'sessions', 'active_minutes', 'parallel_max'];

// ── 数据装配（同源钉：与源端点相同的查询/装配函数，本文件零新 SQL）──

// overview 值域窗口映射——与 overview.js:13-22 的内联解析同语义：today＝本地
// 日界（startOfDayMs）、7d 桶数 24*7、缺省/未知值按 24h 档但 window 回显原值
// （源端点语义：不回退回显）。
function overviewWindow(q) {
  const w = firstParam(q && q.window) || '24h';
  if (w === 'today') return { window: w, sinceMs: dbq.startOfDayMs(), buckets: 24 };
  if (w === '7d') return { window: w, sinceMs: Date.now() - 7 * 86400_000, buckets: 24 * 7 };
  return { window: w, sinceMs: Date.now() - 24 * 3600_000, buckets: 24 };
}

function buildOverviewDataset(q, retentionDays) {
  const { window, sinceMs, buckets } = overviewWindow(q);
  const kpis = dbq.overviewKpis(sinceMs);
  const data = {
    window,
    since: kpis.since,
    kpis,
    series: dbq.timeseries(buckets),
    by_model: dbq.breakdownByModel(sinceMs),
    by_tool: dbq.breakdownByTool(sinceMs),
    speed: dbq.overviewSpeed(sinceMs),
    recent_speed: dbq.recentSpeed(sinceMs, 50),
  };
  // overview 例外补装（§2.4 需求 3）：/api/overview 响应无 meta——保留期是
  // 库级事实，补装进导出包络（源端点零改动）。
  return { data, meta: { retention_days: retentionDays, window, since: kpis.since }, tag: window };
}

function buildUsageDataset(q, retentionDays) {
  const { sinceMs, window, head } = resolveWindow(q, retentionDays);
  const s = dbq.usageTurnsSummary(sinceMs);
  // data＝/api/usage/turns 响应原形（含 F-码-5 的顶层过渡字段——两端口径逐字段
  // 一致，清理随 R-25 一并）；timeline 行数钳界 100/500（源端点同款二元组）。
  const data = {
    ...head,
    meta: { ...head.meta, truncated: s.by_error_type_truncated },
    totals: s.totals,
    by_error_type: s.by_error_type,
    by_error_type_truncated: s.by_error_type_truncated,
    timeline: dbq.usageTurnTimeline(sinceMs, clampLimit(q && q.limit, 100, 500)),
  };
  return { data, meta: data.meta, tag: window };
}

function buildRecapDataset(q, retentionDays) {
  // buildRecapPayload 自带 period 白名单/回退（缺省 week、未知回退 week 且回显
  // 'week'——人读消费面回退先例）与 meta 装配（三元 max 覆盖披露）。
  const data = buildRecapPayload({ period: firstParam(q && q.period), retentionDays });
  return { data, meta: data.meta, tag: data.period };
}

// ── CSV 序列化（RFC 4180 + 公式注入防护）──

// 单元格转义：公式注入防护先行（= + - @ 与 TAB/CR/LF 开头前置 '——顺序敏感：
// 前置后首字符不再是公式触发符；'-12.3 在 Excel 中按文本显示为 -12.3）；再按
// RFC 4180 对含 , " \r \n 的字段双引号包裹、内部 " 加倍。null/undefined →
// 空串（recap year 档 tokens=null 等未知值不伪造）。
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvText(rows) {
  let out = '';
  for (const r of rows) out += r.map(csvCell).join(',') + '\r\n';
  return out;
}

// 逐叶子标量展开（点路径；数组段为下标，如 recent_speed.0.tps——kpis/speed/
// recent_speed 共用，§2.4 需求 4 的映射规则）。非对象值（含 null）即叶子。
function flattenLeaves(prefix, v, out) {
  if (v === null || typeof v !== 'object') { out.push([prefix, v]); return; }
  for (const [k, val] of Object.entries(v)) {
    flattenLeaves(prefix ? `${prefix}.${k}` : k, val, out);
  }
}

// overview 长表（section,key,value）：kpis/speed/recent_speed 逐叶子；series 每
// 桶一行（key＝桶时间戳）；by_model/by_tool 每行一行（key＝行标识）——value 列
// 为行对象 JSON 序列化。
function overviewCsvRows(data) {
  const rows = [['section', 'key', 'value']];
  for (const [section, obj] of [['kpis', data.kpis], ['speed', data.speed], ['recent_speed', data.recent_speed]]) {
    const leaves = [];
    flattenLeaves(section, obj, leaves);
    for (const [k, v] of leaves) rows.push([section, k, v]);
  }
  for (const b of data.series) rows.push(['series', b.bucket, JSON.stringify(b)]);
  for (const m of data.by_model) {
    rows.push(['by_model', `${m.provider_id}/${m.model_id || ''}${m.variant ? ':' + m.variant : ''}/${m.query_source || ''}`, JSON.stringify(m)]);
  }
  for (const t of data.by_tool) rows.push(['by_tool', t.tool_name, JSON.stringify(t)]);
  return rows;
}

function datasetCsvRows(dataset, data) {
  if (dataset === 'overview') return overviewCsvRows(data);
  if (dataset === 'usage') {
    return [USAGE_COLS, ...data.timeline.map(r => USAGE_COLS.map(c => r[c]))];
  }
  return [RECAP_COLS, ...data.days.map(d => RECAP_COLS.map(c => d[c]))];
}

function makeExportRouter({ retentionDays = 30 } = {}) {
  const router = express.Router();

  router.get('/:dataset', (req, res) => {
    const dataset = req.params.dataset;
    if (!DATASETS.has(dataset)) {
      return res.status(400).json({
        error: 'unknown_dataset',
        message: `未知数据集 '${dataset}'。可用：overview / usage / recap。`,
      });
    }
    const format = firstParam(req.query.format) || 'json';
    if (format !== 'json' && format !== 'csv') {
      return res.status(400).json({
        error: 'unknown_format',
        message: `未知格式 '${format}'。可用：json / csv（缺省 json）。`,
      });
    }

    let built;
    if (dataset === 'overview') built = buildOverviewDataset(req.query, retentionDays);
    else if (dataset === 'usage') built = buildUsageDataset(req.query, retentionDays);
    else built = buildRecapDataset(req.query, retentionDays);

    // filename 的窗口/档位段经白名单字符消毒：overview 的 window 回显值来自
    // 自由 query（源端点语义不回退），URL 参数直入响应头是注入面（ERR_INVALID_
    // CHAR/头拆分），此段只保留头值与文件系统安全字符。
    const safeTag = String(built.tag).replace(/[^A-Za-z0-9_-]/g, '') || 'default';
    const stamp = new Date().toISOString().replace(/[-:.]/g, '');
    res.set('Content-Disposition',
      `attachment; filename="zcode-monitor-${dataset}-${safeTag}-${stamp}.${format}"`);
    res.set('X-Zcode-Monitor-Export-Schema-Version', String(EXPORT_SCHEMA_VERSION));
    if (format === 'json') {
      return res.json({
        schema_version: EXPORT_SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        dataset, format,
        meta: built.meta,
        data: built.data,
      });
    }
    // UTF-8 无 BOM（机器可读出口优先；Excel 导入约束见 How 页）。
    res.set('Content-Type', 'text/csv; charset=utf-8');
    return res.send(Buffer.from(csvText(datasetCsvRows(dataset, built.data)), 'utf8'));
  });

  return router;
}

module.exports = { makeExportRouter };
