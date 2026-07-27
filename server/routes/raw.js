'use strict';
// routes/raw.js — raw table viewer for debugging.
// GET /api/raw/:table?limit=&offset=&order=started_at&desc=1&where=
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

router.get('/:table', (req, res) => {
  const { table } = req.params;
  if (!ALLOWED.has(table)) {
    return res.status(400).json({ error: `table '${table}' not allowed` });
  }
  const limit = Math.min(+req.query.limit || 100, 1000);
  const offset = +req.query.offset || 0;
  const order = ALLOWED_ORDER.has(req.query.order) ? req.query.order : null;
  const desc = req.query.desc === '1' ? 'DESC' : 'ASC';
  // where is an optional raw SQL fragment (read-only tool, localhost only)
  let whereSql = '';
  if (typeof req.query.where === 'string' && req.query.where.length < 500) {
    // very basic guard: block obviously destructive tokens
    const w = req.query.where;
    if (/;|--|\/\*|\*\//i.test(w)) {
      return res.status(400).json({ error: 'invalid where clause' });
    }
    whereSql = 'WHERE ' + w;
  }
  const orderSql = order ? `ORDER BY ${order} ${desc}` : '';
  const rows = dbq.db().prepare(
    `SELECT * FROM ${table} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`
  ).all(limit, offset);
  const count = dbq.db().prepare(
    `SELECT COUNT(*) AS n FROM ${table} ${whereSql}`
  ).get().n;
  res.json({ table, count, limit, offset, rows });
});

module.exports = router;
