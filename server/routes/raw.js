'use strict';
// routes/raw.js — raw table viewer for debugging.
// GET /api/raw/:table?limit=&offset=&order=started_at&desc=1&where=
// where 是受限文法（见 parseWhere）：仅允许「字段 比较符 值」以 AND 连接，
// 值一律绑定参数——既保持页面自由输入 where 条件的用法（public/views/raw.js
// 输入框的形态：status='error'、started_at>=123 等），又封死把任意 SQL 片段拼进
// 语句的注入面（`1=1 UNION SELECT …` 在分号/注释过滤下是合法单语句，可越出表
// 白名单读任意表）。字段名再按表的实际列白名单复核（PRAGMA table_info）。
//
// ── 性能红线（R3 必修-2，2026-09-23 真实库 readonly 实测留痕）──────────────
// 真实库体量：part 293.7万行 / message 72.4万 / tool_usage 52.3万 /
// model_usage 38.6万 / session_entry 11.7万 / session 1.77万（其余 ≤4万）。
// 三类同步阻塞形态（better-sqlite3 同步查询=事件循环冻结）：
//   1) ORDER BY 无索引背书的列：SELECT * 整行过 TEMP B-TREE 全表排序——
//      message ORDER BY time_created 实测 2.2s（评审首轮 21.2s，冷态更差）；
//      rowid 排序走隐式 rowid 的 INTEGER PRIMARY KEY 尾界寻址 0.5-1.5ms。
//   2) LIKE：SQLite 默认大小写不敏感 LIKE 用不上 BINARY 排序索引
//      （EXPLAIN: SCAN message），前导通配与「后缀无命中」都全表扫——
//      part `data LIKE 'zzz%'`（无命中前缀）实测 61.7s 冷 / 8.9s 热；
//      等值/范围谓词才走 SEARCH（EXPLAIN 实测）。故巨表 LIKE 一律 400，
//      非巨大表拦前导通配（'%…' 任何索引都用不上）。
//   3) COUNT(*)：无索引全扫 part 267ms / message 54ms——巨表改 MAX(rowid)
//      近似（append-only 表 rowid 单调递增，近似即行数；part 实测 2.3ms）。
// 目标与验证：任一 UI 可达组合 ≤300ms——收紧后真实库 readonly 计时，13 表 ×
// 下拉 5 order 值 × desc 全 130 组合实测最慢 71ms（session_input time_created）、
// 零超限；收紧前 message?order=time_created 同库实测 2.2s（评审首轮 21.2s）。
// 非 UI 的自由 where 残余面（非巨表无命中前缀 LIKE 0.2-0.7s 等）登记
// residuals R-13。
const express = require('express');
const dbq = require('../db');
const { clampLimit, clampAtLeast } = require('../http-hardening');

const router = express.Router();

// allowlist of tables safe to expose
const ALLOWED = new Set([
  'session', 'message', 'part', 'model_usage', 'tool_usage', 'turn_usage',
  'session_entry', 'session_target', 'session_input', 'session_task_link',
  'input_history', 'local_setting', 'todo', 'permission', 'schema_migration',
  'workflow_definition', 'workflow_run', 'workflow_activity', 'workflow_event',
  // dwf_* 是动态工作流的真身运行册（2026-09-23 实测：workflow_run/
  // workflow_activity 全空；dwf_* 行数 COUNT(*)：run≈53 / actor≈0.8k /
  // node≈2.9k / event≈1.7万——落在「≤1.8万行」小表量级带内，排序/where
  // 维持小表默认策略；event 因 payload_json 行宽较宽，ORDER BY 实测
  // ~140ms（亚百毫秒~百毫秒级，仍远低于文件头 ≤300ms 目标），增长绊线
  // 登记 residuals R-16）。
  'dwf_run', 'dwf_actor', 'dwf_node', 'dwf_event',
]);

const ALLOWED_ORDER = new Set([
  'started_at', 'time_created', 'time_updated', 'id', 'sequence', 'position',
]);

// ── order 按表收紧：白名单 = 「有索引背书的列」（真实库 sqlite_master 实测
// 2026-09-23 的最左索引列 ∩ 旧全局白名单）。message/part 体量最大且无任何
// 可用的白名单排序列（message 的时间列只在 session_id 复合索引第二列、part 无
// 时间索引）→ ROWID_ONLY；有 started_at/time_created 最左索引的大表只放行该列
//（'id' 是 TEXT 主键非 rowid 别名，排序仍是全表扫，不放行）；不在两处的表
// 行数 ≤1.8万，全表扫+排序毫秒级（session 实测 43ms），维持旧白名单行为。
const ROWID_ONLY_ORDER = new Set(['message', 'part']);
const TABLE_ORDER_INDEXED = {
  model_usage: new Set(['started_at']),   // model_usage_started_model_idx(started_at,…)
  tool_usage: new Set(['started_at']),    // tool_usage_started_tool_idx(started_at,…)
  turn_usage: new Set(['started_at']),    // turn_usage_started_idx(started_at)
  session_entry: new Set(['time_created']), // session_entry_time_created_idx(time_created)
  input_history: new Set(['time_created']), // input_history_time_idx(time_created desc, id desc)
};

// ── where 字段白名单（巨表）：巨表上无索引谓词 = 多秒全表扫（part 实测
// LIKE 9-62s；等值无命中同量级），只放行可索引寻址的列（TEXT 主键 autoindex
// + 最左索引列）。其余表不设限（亚秒级，残余面登记 residuals R-13）。
const GIANT_TABLES = ROWID_ONLY_ORDER; // message / part
const TABLE_WHERE_INDEXED = {
  message: new Set(['id', 'session_id']),        // autoindex(id) + session 复合索引最左
  part: new Set(['id', 'message_id', 'session_id']),
};

// ── COUNT 近似：巨表无 where 时用 MAX(rowid)（O(log n)）；带 where 时行集被
// 过滤，近似不可用，回落精确 COUNT（行查询本身走同一扫描，成本同量级）。
const APPROX_COUNT_TABLES = new Set(['message', 'part', 'tool_usage', 'model_usage']);

// 大表（拦前导通配 LIKE 的范围）：>10万行的五张表。
const BIG_TABLES = new Set(['message', 'part', 'model_usage', 'tool_usage', 'session_entry']);

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPS = new Set(['=', '!=', '<>', '<', '<=', '>', '>=', 'like', 'not like']);

// 受限文法解析：cond := ident (op value | IS [NOT] NULL)；where := cond (AND cond)*
// 值为单引号字符串（'' 转义）或十进制数字；任何越出文法的输入返回 null（400）。
function parseWhere(w) {
  const toks = [];
  let i = 0;
  while (i < w.length) {
    const c = w[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") { // 字符串字面量：'' 为转义引号
      let s = '', j = i + 1;
      for (;;) {
        if (j >= w.length) return null; // 未闭合
        if (w[j] === "'") {
          if (w[j + 1] === "'") { s += "'"; j += 2; continue; }
          break;
        }
        s += w[j++];
      }
      toks.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    if (/[-0-9]/.test(c)) { // 数字（容忍前导负号）
      const m = /^-?\d+(?:\.\d+)?/.exec(w.slice(i));
      if (!m) return null;
      toks.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(w.slice(i));
      toks.push({ t: 'id', v: m[0] }); i += m[0].length; continue;
    }
    const two = w.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '!=' || two === '<>') {
      toks.push({ t: 'op', v: two }); i += 2; continue;
    }
    if (c === '=' || c === '<' || c === '>') {
      toks.push({ t: 'op', v: c }); i += 1; continue;
    }
    return null; // 文法外字符（含 ; -- /* 括号与 UNION 等关键字）一律拒绝
  }
  const conds = [];
  let expectCond = true;
  for (let k = 0; k < toks.length; k++) {
    if (expectCond) {
      const f = toks[k];
      if (!f || f.t !== 'id' || !IDENT_RE.test(f.v)) return null;
      const n1 = toks[k + 1];
      const isLike = n1 && n1.t === 'id' && n1.v.toLowerCase() === 'like';
      const isNotLike = n1 && n1.t === 'id' && n1.v.toLowerCase() === 'not'
        && toks[k + 2] && toks[k + 2].t === 'id' && toks[k + 2].v.toLowerCase() === 'like';
      const isIs = n1 && n1.t === 'id' && n1.v.toLowerCase() === 'is';
      if (isIs) {
        const notIdx = toks[k + 2] && toks[k + 2].t === 'id' && toks[k + 2].v.toLowerCase() === 'not' ? 2 : 0;
        const nul = toks[k + (notIdx ? 3 : 2)];
        if (!nul || nul.t !== 'id' || nul.v.toLowerCase() !== 'null') return null;
        conds.push({ sql: `${f.v} IS ${notIdx ? 'NOT ' : ''}NULL`, params: [], op: 'isnull', field: f.v });
        k += notIdx ? 3 : 2;
      } else if (n1 && n1.t === 'op') {
        if (!OPS.has(n1.v)) return null;
        const val = toks[k + 2];
        if (!val || (val.t !== 'str' && val.t !== 'num')) return null;
        conds.push({ sql: `${f.v} ${n1.v} ?`, params: [val.v], op: n1.v, field: f.v, value: val.v });
        k += 2;
      } else if (isLike || isNotLike) {
        const skip = isNotLike ? 2 : 1;
        const val = toks[k + 1 + skip];
        if (!val || (val.t !== 'str' && val.t !== 'num')) return null;
        conds.push({ sql: `${f.v} ${isNotLike ? 'NOT LIKE' : 'LIKE'} ?`, params: [val.v],
                     op: isNotLike ? 'not like' : 'like', field: f.v, value: val.v });
        k += 1 + skip;
      } else {
        return null; // 缺比较符/值，或文法外关键字（OR/UNION/SELECT…走不进任何分支）
      }
      expectCond = false;
    } else {
      const a = toks[k];
      if (!a || a.t !== 'id' || a.v.toLowerCase() !== 'and') return null; // 仅 AND 连接
      expectCond = true;
    }
  }
  if (expectCond || !conds.length) return null; // 空串由调用方前置排除；悬空 AND 拒绝
  return conds;
}

// order 解析（按表收紧）。返回 { orderSql, meta }：orderSql 为可直接内插的安全
// 片段；meta 在回落时非空（响应注明）。规则：
//   - order 缺省/空（UI「不排序」）：无 ORDER BY——首 N 行扫描无红线，语义保留；
//   - 巨表（message/part）：任何显式 order 一律 rowid DESC（UI 语义等价「最新
//     在前」，隐式 rowid 随写入单调递增）；desc 参数不再改变方向；
//   - 索引大表：仅白名单索引列放行（带方向），其余回落 rowid DESC；
//   - 小表：白名单列且真实存在（大小写不敏感）即放行（带方向），其余回落。
function resolveOrder(table, orderRaw, descRaw, columnsLower) {
  if (!orderRaw) return { orderSql: '', meta: null };
  const fallback = () => ({
    orderSql: 'ORDER BY rowid DESC',
    meta: {
      order_requested: orderRaw,
      order_effective: 'rowid DESC',
      note: `order '${orderRaw}' 在表 ${table} 上无索引背书，已回落 rowid DESC（按写入序最新在前）`,
    },
  });
  if (GIANT_TABLES.has(table)) return fallback();
  const indexed = TABLE_ORDER_INDEXED[table];
  if (indexed) {
    return (ALLOWED_ORDER.has(orderRaw) && indexed.has(orderRaw) && columnsLower.has(orderRaw))
      ? { orderSql: `ORDER BY ${orderRaw} ${descRaw}`, meta: null }
      : fallback();
  }
  return (ALLOWED_ORDER.has(orderRaw) && columnsLower.has(orderRaw))
    ? { orderSql: `ORDER BY ${orderRaw} ${descRaw}`, meta: null }
    : fallback();
}

router.get('/:table', (req, res) => {
  const { table } = req.params;
  if (!ALLOWED.has(table)) {
    return res.status(400).json({ error: `table '${table}' not allowed` });
  }
  // limit/offset 双侧钳界（R4 修-high，R5 起走 http-hardening 共用 helper）：
  // `Math.min(+q.limit || 100, 1000)` 对 ?limit=-1 产出 -1，SQLite 的负
  // LIMIT = 无上限 → SELECT * 整表同步物化（message 72万行实测事件循环冻结）。
  // 下界钳 1/0 后：负值与 NaN（?limit=abc）都回落缺省或安全值，上限 1000 不变。
  const limit = clampLimit(req.query.limit, 100, 1000);
  const offset = clampAtLeast(req.query.offset, 0);
  const desc = req.query.desc === '1' ? 'DESC' : 'ASC';
  // 列白名单大小写不敏感（R3 修-low）：PRAGMA 的列名与用户输入两侧都取小写比对，
  // SQL 引用仍用输入原大小写（SQLite 标识符本就大小写不敏感）
  const columnsLower = new Set(
    dbq.db().prepare(`PRAGMA table_info(${table})`).all().map(c => String(c.name).toLowerCase()));

  // where 受限文法：字段标识符 + 表列白名单复核 + 值绑定参数；巨表再过
  // 「可索引列」白名单与 LIKE 禁令（见文件头性能红线）
  let whereSql = '';
  const params = [];
  const meta = {};
  let hasWhere = false;
  if (typeof req.query.where === 'string' && req.query.where.trim().length) {
    if (req.query.where.length >= 500) {
      return res.status(400).json({ error: 'invalid where clause (too long)' });
    }
    const conds = parseWhere(req.query.where);
    if (!conds) {
      return res.status(400).json({
        error: "invalid where clause：仅支持「字段 比较符 值」以 AND 连接（如 status='error'、started_at>=123、field IS NULL；值自动参数化）",
      });
    }
    for (const c of conds) {
      const fieldLower = c.field.toLowerCase();
      if (!columnsLower.has(fieldLower)) {
        return res.status(400).json({ error: `unknown column '${c.field}' for table '${table}'` });
      }
      if (GIANT_TABLES.has(table)) {
        const allowedFields = TABLE_WHERE_INDEXED[table];
        if (!allowedFields.has(fieldLower)) {
          return res.status(400).json({
            error: `表 ${table} 体量过大（百万行级），where 仅支持可索引寻址的列：`
              + `[${[...allowedFields].join(', ')}]（等值/范围）；其余列的过滤会全表扫描秒级阻塞面板`,
          });
        }
        if (c.op === 'like' || c.op === 'not like') {
          return res.status(400).json({
            error: `表 ${table} 不支持 LIKE：大小写不敏感 LIKE 用不上任何索引（全表扫描，`
              + `实测无命中前缀 LIKE 最高 61.7s）。请改用 ${[...allowedFields].join('/')} 的等值或范围条件`,
          });
        }
      } else if ((c.op === 'like' || c.op === 'not like') && BIG_TABLES.has(table)
                 && typeof c.value === 'string' && c.value.startsWith('%')) {
        return res.status(400).json({
          error: `表 ${table} 不支持前导通配 LIKE（'%…' 用不上任何索引，全表扫描）。`
            + "请改用前缀形态（如 status LIKE 'xxx%'）或等值/范围条件",
        });
      }
    }
    whereSql = 'WHERE ' + conds.map(c => `(${c.sql})`).join(' AND ');
    for (const c of conds) params.push(...c.params);
    hasWhere = true;
  }

  const { orderSql, meta: orderMeta } = resolveOrder(table, req.query.order, desc, columnsLower);
  if (orderMeta) meta.order = orderMeta;

  const rows = dbq.db().prepare(
    `SELECT * FROM ${table} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  // COUNT：巨表无 where 用 MAX(rowid) 近似（append-only 单调递增 ⇒ ≈ 行数）；
  // 其余（含巨表带 where）精确 COUNT。meta.count_approx 供 UI 标注
  let count;
  if (APPROX_COUNT_TABLES.has(table) && !hasWhere) {
    count = dbq.db().prepare(`SELECT MAX(rowid) AS n FROM ${table}`).get().n || 0;
    meta.count_approx = true;
  } else {
    count = dbq.db().prepare(
      `SELECT COUNT(*) AS n FROM ${table} ${whereSql}`
    ).get(...params).n;
  }
  res.json({ table, count, limit, offset, rows, meta });
});

module.exports = router;
