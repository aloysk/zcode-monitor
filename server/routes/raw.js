'use strict';
// routes/raw.js — raw table viewer for debugging.
// GET /api/raw/:table?limit=&offset=&order=started_at&desc=1&where=
// where 是受限文法（见 parseWhere）：仅允许「字段 比较符 值」以 AND 连接，
// 值一律绑定参数——既保持页面自由输入 where 条件的用法（public/views/raw.js
// 输入框的形态：status='error'、started_at>=123 等），又封死把任意 SQL 片段拼进
// 语句的注入面（`1=1 UNION SELECT …` 在分号/注释过滤下是合法单语句，可越出表
// 白名单读任意表）。字段名再按表的实际列白名单复核（PRAGMA table_info）。
const express = require('express');
const dbq = require('../db');

const router = express.Router();

// allowlist of tables safe to expose
const ALLOWED = new Set([
  'session', 'message', 'part', 'model_usage', 'tool_usage', 'turn_usage',
  'session_entry', 'session_target', 'session_input', 'session_task_link',
  'input_history', 'local_setting', 'todo', 'permission', 'schema_migration',
  'workflow_definition', 'workflow_run', 'workflow_activity', 'workflow_event',
]);

const ALLOWED_ORDER = new Set([
  'started_at', 'time_created', 'time_updated', 'id', 'sequence', 'position',
]);

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
      toks.push({ t: 'op', v: c }); i++; continue;
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
        conds.push({ sql: `${f.v} IS ${notIdx ? 'NOT ' : ''}NULL`, params: [] });
        k += notIdx ? 3 : 2;
      } else if (n1 && n1.t === 'op') {
        if (!OPS.has(n1.v)) return null;
        const val = toks[k + 2];
        if (!val || (val.t !== 'str' && val.t !== 'num')) return null;
        conds.push({ sql: `${f.v} ${n1.v} ?`, params: [val.v] });
        k += 2;
      } else if (isLike || isNotLike) {
        const skip = isNotLike ? 2 : 1;
        const val = toks[k + 1 + skip];
        if (!val || (val.t !== 'str' && val.t !== 'num')) return null;
        conds.push({ sql: `${f.v} ${isNotLike ? 'NOT LIKE' : 'LIKE'} ?`, params: [val.v] });
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

router.get('/:table', (req, res) => {
  const { table } = req.params;
  if (!ALLOWED.has(table)) {
    return res.status(400).json({ error: `table '${table}' not allowed` });
  }
  const limit = Math.min(+req.query.limit || 100, 1000);
  const offset = +req.query.offset || 0;
  const order = ALLOWED_ORDER.has(req.query.order) ? req.query.order : null;
  const desc = req.query.desc === '1' ? 'DESC' : 'ASC';
  // where 受限文法：字段标识符 + 表列白名单复核 + 值绑定参数
  let whereSql = '';
  const params = [];
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
    const columns = new Set(dbq.db().prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const c of conds) {
      const field = c.sql.split(' ')[0]; // 装配时首位必为字段标识符
      if (!columns.has(field)) {
        return res.status(400).json({ error: `unknown column '${field}' for table '${table}'` });
      }
    }
    whereSql = 'WHERE ' + conds.map(c => `(${c.sql})`).join(' AND ');
    for (const c of conds) params.push(...c.params);
  }
  const orderSql = order ? `ORDER BY ${order} ${desc}` : '';
  const rows = dbq.db().prepare(
    `SELECT * FROM ${table} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  const count = dbq.db().prepare(
    `SELECT COUNT(*) AS n FROM ${table} ${whereSql}`
  ).get(...params).n;
  res.json({ table, count, limit, offset, rows });
});

module.exports = router;
