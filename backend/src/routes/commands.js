/**
 * Endpoints de comando (autenticados con X-Auth-Token):
 *   POST /api/command/recalibrate — publica {"cmd":"calibrar"}
 *   POST /api/command/wifi-portal — publica {"cmd":"wifi_portal"}
 *   POST /api/command/set-wifi    — publica {"cmd":"set_wifi","ssid":...,"pass":...}
 *
 * NO escriben en la base de datos: solo publican en el topic de comandos.
 * El efecto se observa en la siguiente lectura o en /api/status
 * (campo ultimoResultadoComando, ACK del ESP32).
 */
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { publicarComando } = require('../mqttIngestor');

const router = express.Router();

// Middleware de autenticación por token (comparación en tiempo constante)
function requiereToken(req, res, next) {
  const token = req.get('X-Auth-Token') || '';
  const esperado = config.api.commandToken;
  const a = Buffer.from(token);
  const b = Buffer.from(esperado);
  const valido = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valido) {
    return res.status(401).json({ error: 'Token inválido o ausente (cabecera X-Auth-Token)' });
  }
  next();
}

router.use('/command', requiereToken);

async function publicarYResponder(res, comando) {
  try {
    await publicarComando(comando);
    res.json({ ok: true, publicado: config.mqtt.topicCommand });
  } catch (err) {
    res.status(503).json({ ok: false, error: `No se pudo publicar: ${err.message}` });
  }
}

router.post('/command/recalibrate', (req, res) => {
  // El dashboard debe advertir: el sensor debe estar en aire limpio antes de confirmar.
  publicarYResponder(res, { cmd: 'calibrar' });
});

router.post('/command/wifi-portal', (req, res) => {
  publicarYResponder(res, { cmd: 'wifi_portal' });
});

router.post('/command/set-wifi', (req, res) => {
  const { ssid, pass } = req.body || {};
  if (typeof ssid !== 'string' || ssid.length === 0 || typeof pass !== 'string') {
    return res.status(400).json({ error: 'Body requerido: {"ssid":"...","pass":"..."}' });
  }
  // Caveat: viaja en texto plano por MQTT sin TLS. Preferir el portal cautivo.
  publicarYResponder(res, { cmd: 'set_wifi', ssid, pass });
});

module.exports = router;
