/**
 * Ingestor MQTT:
 *  - Se suscribe a lecturas, estado y resultado de comandos.
 *  - Inserta una fila en `lecturas` por cada mensaje válido (timestamp del servidor).
 *  - Mantiene la lógica de episodios de alerta (tabla `alertas`).
 *  - Mensajes malformados se registran y se descartan SIN tumbar el proceso.
 *  - Expone publicarComando() para el router de comandos (reutiliza el mismo cliente).
 */
const mqtt = require('mqtt');
const config = require('./config');
const db = require('./db');

// ── Estado en memoria (consultado por /api/status) ──
const estado = {
  mqttConectado: false,
  ultimoEstado: null, // 'online' | 'offline' | 'config' (topic retenido)
  ultimoEstadoTs: null,
  ultimaLecturaTs: null,
  ultimoResultadoComando: null, // último ACK publicado por el ESP32
  ultimoResultadoComandoTs: null,
};

// ── Estado del episodio de alerta activo ──
let nivelAnterior = 'NORMAL';
let alertaActivaId = null;

const NIVELES_ALERTA = new Set(['PRECAUCION', 'PELIGRO']);

let cliente = null;

/**
 * Si el proceso se reinició con una alerta abierta (fin_ts IS NULL),
 * la retoma para no duplicar episodios ni dejarla sin cerrar.
 */
async function retomarAlertaAbierta() {
  const res = await db.query(
    'SELECT id, nivel_max FROM alertas WHERE fin_ts IS NULL ORDER BY inicio_ts DESC LIMIT 1'
  );
  if (res.rows.length > 0) {
    alertaActivaId = res.rows[0].id;
    nivelAnterior = res.rows[0].nivel_max;
    console.log(`[alertas] Retomada alerta abierta id=${alertaActivaId} nivel=${nivelAnterior}`);
  }
}

/** Valida y normaliza el JSON de una lectura. Devuelve null si es inválido. */
function validarLectura(datos) {
  const numeros = ['temp', 'hum', 'co', 'co2', 'uv'];
  for (const campo of numeros) {
    if (typeof datos[campo] !== 'number' || !Number.isFinite(datos[campo])) {
      return null;
    }
  }
  if (typeof datos.nivel !== 'string' || typeof datos.causa !== 'string') {
    return null;
  }
  return {
    temp: datos.temp,
    hum: datos.hum,
    co: datos.co,
    co2: datos.co2,
    uv: datos.uv,
    nivel: datos.nivel,
    causa: datos.causa,
    cal: typeof datos.cal === 'boolean' ? datos.cal : null,
    rssi: Number.isInteger(datos.rssi) ? datos.rssi : null,
    uptime: Number.isFinite(datos.uptime) ? Math.trunc(datos.uptime) : null,
    // Posición opcional (estación móvil, firmware v2.6+). Sin validación de
    // rango: una coordenada rara es dato, no error.
    lat: Number.isFinite(datos.lat) ? datos.lat : null,
    lon: Number.isFinite(datos.lon) ? datos.lon : null,
  };
}

/**
 * Lógica de episodios de alerta:
 *  - NORMAL → PRECAUCION/PELIGRO: abre episodio (INSERT).
 *  - PRECAUCION → PELIGRO dentro del episodio: escala nivel_max.
 *  - → NORMAL con alerta activa: cierra episodio (fin_ts = now()).
 */
async function procesarAlerta(lectura) {
  const nivel = lectura.nivel;

  if (NIVELES_ALERTA.has(nivel) && alertaActivaId === null) {
    const res = await db.query(
      `INSERT INTO alertas (nivel_max, causa, temp, hum, co, co2, uv)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [nivel, lectura.causa, lectura.temp, lectura.hum, lectura.co, lectura.co2, lectura.uv]
    );
    alertaActivaId = res.rows[0].id;
    console.log(`[alertas] Episodio iniciado id=${alertaActivaId} nivel=${nivel} causa=${lectura.causa}`);
  } else if (nivel === 'PELIGRO' && alertaActivaId !== null && nivelAnterior === 'PRECAUCION') {
    await db.query('UPDATE alertas SET nivel_max = $1 WHERE id = $2', [nivel, alertaActivaId]);
    console.log(`[alertas] Episodio id=${alertaActivaId} escalado a PELIGRO`);
  } else if (nivel === 'NORMAL' && alertaActivaId !== null) {
    await db.query('UPDATE alertas SET fin_ts = now() WHERE id = $1', [alertaActivaId]);
    console.log(`[alertas] Episodio id=${alertaActivaId} cerrado`);
    alertaActivaId = null;
  }

  nivelAnterior = nivel;
}

async function procesarLectura(payload) {
  let datos;
  try {
    datos = JSON.parse(payload.toString());
  } catch (err) {
    console.warn(`[ingestor] JSON malformado, descartado: ${payload.toString().slice(0, 120)}`);
    return;
  }

  const lectura = validarLectura(datos);
  if (lectura === null) {
    console.warn(`[ingestor] Lectura con campos inválidos, descartada: ${payload.toString().slice(0, 120)}`);
    return;
  }

  try {
    await db.query(
      `INSERT INTO lecturas (temp, hum, co, co2, uv, nivel, causa, cal, rssi, uptime, lat, lon)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [lectura.temp, lectura.hum, lectura.co, lectura.co2, lectura.uv,
       lectura.nivel, lectura.causa, lectura.cal, lectura.rssi, lectura.uptime,
       lectura.lat, lectura.lon]
    );
    estado.ultimaLecturaTs = new Date();
    console.log(
      `[ingestor] Insertada: temp=${lectura.temp} hum=${lectura.hum} co=${lectura.co} ` +
        `co2=${lectura.co2} uv=${lectura.uv} nivel=${lectura.nivel}`
    );
    await procesarAlerta(lectura);
  } catch (err) {
    console.error('[ingestor] Error al insertar en la base de datos:', err.message);
  }
}

function procesarEstado(payload) {
  const valor = payload.toString().trim();
  estado.ultimoEstado = valor;
  estado.ultimoEstadoTs = new Date();
  console.log(`[ingestor] Estado de la estación: ${valor}`);
}

function procesarResultadoComando(payload) {
  const texto = payload.toString();
  try {
    estado.ultimoResultadoComando = JSON.parse(texto);
  } catch {
    estado.ultimoResultadoComando = { raw: texto };
  }
  estado.ultimoResultadoComandoTs = new Date();
  console.log(`[ingestor] Resultado de comando: ${texto}`);
}

async function iniciar() {
  await retomarAlertaAbierta();

  cliente = mqtt.connect(config.mqtt.url, {
    username: config.mqtt.user,
    password: config.mqtt.password,
    clientId: 'estacion-backend',
    reconnectPeriod: 5000,
  });

  cliente.on('connect', () => {
    estado.mqttConectado = true;
    console.log(`[mqtt] Conectado a ${config.mqtt.url}`);
    const topics = [config.mqtt.topicData, config.mqtt.topicStatus, config.mqtt.topicCommandResult];
    cliente.subscribe(topics, (err) => {
      if (err) {
        console.error('[mqtt] Error al suscribirse:', err.message);
      } else {
        console.log(`[mqtt] Suscrito a: ${topics.join(', ')}`);
      }
    });
  });

  cliente.on('close', () => {
    if (estado.mqttConectado) {
      estado.mqttConectado = false;
      console.warn('[mqtt] Conexión cerrada. Reintentando...');
    }
  });

  cliente.on('error', (err) => {
    console.error('[mqtt] Error:', err.message);
  });

  cliente.on('message', (topic, payload) => {
    if (topic === config.mqtt.topicData) {
      // async, pero los errores ya se capturan dentro
      procesarLectura(payload);
    } else if (topic === config.mqtt.topicStatus) {
      procesarEstado(payload);
    } else if (topic === config.mqtt.topicCommandResult) {
      procesarResultadoComando(payload);
    }
  });
}

/**
 * Publica un comando en el topic de comandos. Usado por routes/commands.js.
 * NO registra el contenido si es set_wifi (contiene la clave de la red).
 */
function publicarComando(objeto) {
  return new Promise((resolve, reject) => {
    if (!cliente || !cliente.connected) {
      return reject(new Error('Cliente MQTT no conectado'));
    }
    cliente.publish(config.mqtt.topicCommand, JSON.stringify(objeto), { qos: 1 }, (err) => {
      if (err) return reject(err);
      const log = objeto.cmd === 'set_wifi' ? '{"cmd":"set_wifi", ...}' : JSON.stringify(objeto);
      console.log(`[mqtt] Comando publicado en ${config.mqtt.topicCommand}: ${log}`);
      resolve();
    });
  });
}

function cerrar() {
  return new Promise((resolve) => {
    if (!cliente) return resolve();
    cliente.end(false, {}, () => {
      console.log('[mqtt] Cliente MQTT cerrado.');
      resolve();
    });
  });
}

module.exports = { iniciar, cerrar, publicarComando, estado };
