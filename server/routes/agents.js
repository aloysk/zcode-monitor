'use strict';
// routes/agents.js — subagent relationship tree
const express = require('express');
const dbq = require('../db');
const { firstParam } = require('../http-hardening');

const router = express.Router();

// GET /api/agents/tree?project_id=
// firstParam 归一（四席全量审查第 2 轮）：?project_id=a&project_id=b 的数组
// 形态此前直透 SQL 绑定抛错落 500（实测）——与 usage/sessions 族同修。
router.get('/tree', (req, res) => {
  res.json(dbq.agentsForest({ projectId: firstParam(req.query.project_id) || null }));
});

module.exports = router;
