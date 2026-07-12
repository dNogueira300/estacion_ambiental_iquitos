/**
 * Endpoints de estado (solo lectura):
 *   GET /api/health — salud del servicio
 *   GET /api/status — estado de la estación (online, última lectura, último estado MQTT)
 *
 * `online` = hubo lectura hace menos de 3 minutos (3× el intervalo de publicación)
 * Y el último mensaje retenido del topic de estado no es "offline".
 */
const express = require('express');
const { estado } = require('../mqttIngestor');

const router = express.Router();

const UMBRAL_ONLINE_MS = 3 * 60 * 1000;

router.get('/health', (req, res) => {
  res.json({ ok: true });
});

router.get('/status', (req, res) => {
  const ahora = Date.now();
  const lecturaReciente =
    estado.ultimaLecturaTs !== null &&
    ahora - estado.ultimaLecturaTs.getTime() < UMBRAL_ONLINE_MS;
  const online = lecturaReciente && estado.ultimoEstado !== 'offline';

  res.json({
    online,
    ultimaLectura: estado.ultimaLecturaTs,
    ultimoEstado: estado.ultimoEstado,
    ultimoEstadoTs: estado.ultimoEstadoTs,
    mqttConectado: estado.mqttConectado,
    ultimoResultadoComando: estado.ultimoResultadoComando,
    ultimoResultadoComandoTs: estado.ultimoResultadoComandoTs,
  });
});

module.exports = router;
