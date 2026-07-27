'use strict';
// routes/agents.js — subagent relationship tree
const express = require('express');
const dbq = require('../db');

const router = express.Router();

// GET /api/agents/tree?project_id=
router.get('/tree', (req, res) => {
  res.json(dbq.agentsForest({ projectId: req.query.project_id || null }));
});

module.exports = router;
