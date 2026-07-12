/**
 * Pool de PostgreSQL + helper de consulta.
 * Al arrancar, index.js llama a asegurarEsquema() para ejecutar schema.sql
 * (idempotente gracias a IF NOT EXISTS).
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.db);

pool.on('error', (err) => {
  // Error en un cliente inactivo del pool (p. ej. reinicio de PostgreSQL).
  // No tumbar el proceso: pg reconecta en la siguiente consulta.
  console.error('[db] Error en cliente inactivo del pool:', err.message);
});

function query(text, params) {
  return pool.query(text, params);
}

async function asegurarEsquema() {
  const rutaSchema = path.join(__dirname, '..', 'sql', 'schema.sql');
  const sql = fs.readFileSync(rutaSchema, 'utf8');
  await pool.query(sql);
  console.log('[db] Esquema verificado (schema.sql aplicado).');
}

async function cerrar() {
  await pool.end();
  console.log('[db] Pool de PostgreSQL cerrado.');
}

module.exports = { pool, query, asegurarEsquema, cerrar };
