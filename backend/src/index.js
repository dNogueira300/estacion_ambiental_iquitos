/**
 * Punto de entrada del backend:
 *   1. Verifica el esquema de la base de datos.
 *   2. Levanta la API Express en PORT.
 *   3. Arranca el ingestor MQTT.
 *   4. Cierre ordenado ante SIGINT/SIGTERM.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const db = require('./db');
const ingestor = require('./mqttIngestor');
const telegramBot = require('./telegramBot');
const readingsRouter = require('./routes/readings');
const alertsRouter = require('./routes/alerts');
const statusRouter = require('./routes/status');
const commandsRouter = require('./routes/commands');

async function main() {
  await db.asegurarEsquema();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api', statusRouter);
  app.use('/api', readingsRouter);
  app.use('/api', alertsRouter);
  app.use('/api', commandsRouter);

  // 404 JSON para rutas de API desconocidas
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
  });

  // Dashboard (build de Vite) servido en el mismo origen que la API:
  // sin CORS, sin contenido mixto, rutas relativas /api/... desde el frontend.
  const distDir = path.join(__dirname, '..', '..', 'dashboard', 'dist');
  const indexHtml = path.join(distDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(distDir));
    // Fallback SPA: cualquier GET no-API devuelve index.html
    app.get('*', (req, res) => {
      res.sendFile(indexHtml);
    });
    console.log('[api] Dashboard servido desde dashboard/dist');
  } else {
    console.log('[api] dashboard/dist no existe; solo API. (npm run build en dashboard/)');
    app.use((req, res) => {
      res.status(404).json({ error: 'Ruta no encontrada' });
    });
  }

  // Manejador de errores: nunca exponer detalles internos
  app.use((err, req, res, next) => {
    console.error('[api] Error:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  const servidor = app.listen(config.api.port, () => {
    console.log(`[api] Escuchando en el puerto ${config.api.port}`);
  });

  await ingestor.iniciar();
  telegramBot.iniciar();

  // ── Cierre ordenado ──
  let cerrando = false;
  async function cerrarTodo(senal) {
    if (cerrando) return;
    cerrando = true;
    console.log(`\n[main] Recibido ${senal}, cerrando...`);
    servidor.close();
    telegramBot.cerrar();
    await ingestor.cerrar();
    await db.cerrar();
    process.exit(0);
  }
  process.on('SIGINT', () => cerrarTodo('SIGINT'));
  process.on('SIGTERM', () => cerrarTodo('SIGTERM'));
}

main().catch((err) => {
  console.error('[main] Error fatal al arrancar:', err.message);
  process.exit(1);
});
