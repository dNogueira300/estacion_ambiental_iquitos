/**
 * Endpoints de lecturas (solo lectura):
 *   GET /api/latest                    — última lectura o null
 *   GET /api/readings?hours=24         — lecturas de las últimas N horas
 *   GET /api/readings?from=ISO&to=ISO  — rango explícito (alternativa)
 * Siempre con límite máximo de filas para no saturar la VM.
 */
const express = require('express');
const db = require('../db');
const config = require('../config');

const router = express.Router();

router.get('/latest', async (req, res, next) => {
  try {
    const r = await db.query('SELECT * FROM lecturas ORDER BY ts DESC LIMIT 1');
    res.json(r.rows[0] || null);
  } catch (err) {
    next(err);
  }
});

router.get('/readings', async (req, res, next) => {
  try {
    const limite = Math.min(
      parseInt(req.query.limit, 10) || config.api.maxRows,
      config.api.maxRows
    );

    let r;
    if (req.query.from || req.query.to) {
      const desde = req.query.from ? new Date(req.query.from) : new Date(0);
      const hasta = req.query.to ? new Date(req.query.to) : new Date();
      if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) {
        return res.status(400).json({ error: 'Parámetros from/to inválidos (usar ISO 8601)' });
      }
      r = await db.query(
        'SELECT * FROM lecturas WHERE ts >= $1 AND ts <= $2 ORDER BY ts ASC LIMIT $3',
        [desde.toISOString(), hasta.toISOString(), limite]
      );
    } else {
      const horas = parseFloat(req.query.hours) || 24;
      if (!(horas > 0)) {
        return res.status(400).json({ error: 'Parámetro hours inválido' });
      }
      r = await db.query(
        "SELECT * FROM lecturas WHERE ts >= now() - ($1 * INTERVAL '1 hour') ORDER BY ts ASC LIMIT $2",
        [horas, limite]
      );
    }
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

// Trayectoria de la estación móvil: puntos con coordenadas en la ventana dada
router.get('/track', async (req, res, next) => {
  try {
    const horas = parseFloat(req.query.hours) || 24;
    if (!(horas > 0)) {
      return res.status(400).json({ error: 'Parámetro hours inválido' });
    }
    const r = await db.query(
      `SELECT ts, lat, lon FROM lecturas
       WHERE lat IS NOT NULL AND lon IS NOT NULL
         AND ts >= now() - ($1 * INTERVAL '1 hour')
       ORDER BY ts ASC LIMIT $2`,
      [horas, config.api.maxRows]
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
