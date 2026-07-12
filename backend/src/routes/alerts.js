/**
 * Endpoint de historial de alertas (solo lectura):
 *   GET /api/alerts?limit=50
 */
const express = require('express');
const db = require('../db');

const router = express.Router();

const LIMITE_MAXIMO = 500;

router.get('/alerts', async (req, res, next) => {
  try {
    const limite = Math.min(parseInt(req.query.limit, 10) || 50, LIMITE_MAXIMO);
    const r = await db.query(
      'SELECT * FROM alertas ORDER BY inicio_ts DESC LIMIT $1',
      [limite]
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
