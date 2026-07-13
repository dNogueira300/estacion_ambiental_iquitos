/**
 * Bot de Telegram (@EstacionIquitosBot) — fase 14.
 *
 *  - Publica en el canal: aperturas/escaladas/cierres de episodios de alerta,
 *    desconexión/reconexión de la estación y reportes diarios (07:00 y 18:00,
 *    hora de Perú). Todos los mensajes llevan el enlace al dashboard.
 *  - Responde comandos (/estado, /alertas, /umbrales, /ayuda) por chat privado
 *    vía long polling de getUpdates.
 *  - Idempotente ante reinicios: el estado "ya notificado" vive en la BD
 *    (columnas notif_* de `alertas` y tabla `bot_reportes`).
 *  - Sin dependencias nuevas: fetch global de Node 20.
 *  - Si falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID, queda desactivado y el
 *    backend funciona igual. Un fallo del bot jamás tumba la ingesta.
 */
const config = require('./config');
const db = require('./db');

const VIGILANTE_MS = 20_000;
const GRACIA_ARRANQUE_MS = 2 * 60 * 1000;
// Umbral de desconexión (minutos). Sobreescribible para pruebas.
const OFFLINE_MS = parseInt(process.env.TELEGRAM_OFFLINE_MIN || '5', 10) * 60 * 1000;
const ZONA = 'America/Lima'; // la VM corre en UTC; Perú es UTC-5 sin horario de verano

let vigilanteTimer = null;
let corriendo = false;
let offsetUpdates = 0;
let arranqueTs = 0;
let estadoConexion = null; // null = sin línea base aún; luego 'online' | 'offline'

// ── Utilidades ──────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pieDashboard() {
  return `\n\n📊 Dashboard: ${config.telegram.dashboardUrl}`;
}

function emojiNivel(nivel) {
  return nivel === 'PELIGRO' ? '🔴' : nivel === 'PRECAUCION' ? '🟡' : '🟢';
}

function num(v, dec = 1) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('es-PE', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function fmtValores(l) {
  return (
    `🌡 ${num(l.temp)} °C · 💧 ${num(l.hum, 0)} % · CO ${num(l.co)} ppm · ` +
    `aire ${num(l.co2, 0)} ppm · UV ${num(l.uv)}`
  );
}

function fmtFecha(tsIso) {
  return new Date(tsIso).toLocaleString('es-PE', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDuracion(inicioIso, finIso) {
  const min = Math.max(0, Math.round((new Date(finIso) - new Date(inicioIso)) / 60000));
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem > 0 ? `${h} h ${rem} min` : `${h} h`;
}

/** Fecha y hora actuales en Lima: { fecha: 'AAAA-MM-DD', hhmm: 'HH:MM' } */
function horaLima() {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  // 'sv-SE' produce 'AAAA-MM-DD HH:MM'
  const [fecha, hhmm] = s.split(' ');
  return { fecha, hhmm };
}

// ── API de Telegram ─────────────────────────────────────────────

async function api(metodo, params) {
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.token}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!json.ok) {
    // Nunca incluir la URL en el error: contiene el token
    throw new Error(`${metodo}: ${json.description || `HTTP ${res.status}`}`);
  }
  return json.result;
}

async function enviar(texto, chatId = config.telegram.chatId) {
  const r = await api('sendMessage', {
    chat_id: chatId,
    text: texto + pieDashboard(),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
  console.log('[telegram] sendMessage ok');
  return r;
}

// ── Alertas: apertura / escalada / cierre ───────────────────────

/**
 * Al primer arranque, los episodios históricos YA CERRADOS se marcan como
 * notificados sin enviar (evita una ráfaga de mensajes viejos). Los episodios
 * abiertos sí se notifican: una alerta activa es información vigente.
 */
async function marcarHistoricoComoNotificado() {
  const r = await db.query(
    `UPDATE alertas SET notif_inicio_ts = now(), notif_fin_ts = now(), notif_nivel = nivel_max
     WHERE notif_inicio_ts IS NULL AND fin_ts IS NOT NULL`
  );
  if (r.rowCount > 0) {
    console.log(`[telegram] ${r.rowCount} episodios históricos marcados sin notificar`);
  }
}

async function procesarAperturas() {
  const r = await db.query(
    'SELECT * FROM alertas WHERE notif_inicio_ts IS NULL ORDER BY inicio_ts ASC'
  );
  for (const a of r.rows) {
    const silenciar = a.nivel_max === 'PRECAUCION' && !config.telegram.notificarPrecaucion;
    if (!silenciar) {
      await enviar(
        `${emojiNivel(a.nivel_max)} <b>ALERTA: ${esc(a.nivel_max)}</b>\n` +
          `Causa: ${esc((a.causa || '').trim() || '—')}\n` +
          `Iniciada: ${fmtFecha(a.inicio_ts)}\n\n` +
          fmtValores(a)
      );
    }
    await db.query('UPDATE alertas SET notif_inicio_ts = now(), notif_nivel = $1 WHERE id = $2', [
      a.nivel_max,
      a.id,
    ]);
  }
}

async function procesarEscaladas() {
  const r = await db.query(
    `SELECT * FROM alertas
     WHERE notif_inicio_ts IS NOT NULL AND fin_ts IS NULL
       AND notif_nivel IS DISTINCT FROM nivel_max`
  );
  for (const a of r.rows) {
    // Si la apertura en PRECAUCION fue silenciada, este es el primer aviso:
    // usar el formato de apertura completo.
    const aperturaSilenciada =
      a.notif_nivel === 'PRECAUCION' && !config.telegram.notificarPrecaucion;
    if (aperturaSilenciada) {
      await enviar(
        `${emojiNivel(a.nivel_max)} <b>ALERTA: ${esc(a.nivel_max)}</b>\n` +
          `Causa: ${esc((a.causa || '').trim() || '—')}\n` +
          `Iniciada: ${fmtFecha(a.inicio_ts)}\n\n` +
          fmtValores(a)
      );
    } else {
      await enviar(
        `🔴 <b>La alerta escaló a ${esc(a.nivel_max)}</b>\n` +
          `Causa: ${esc((a.causa || '').trim() || '—')}\n` +
          `Activa desde: ${fmtFecha(a.inicio_ts)}`
      );
    }
    await db.query('UPDATE alertas SET notif_nivel = $1 WHERE id = $2', [a.nivel_max, a.id]);
  }
}

async function procesarCierres() {
  const r = await db.query(
    `SELECT * FROM alertas
     WHERE fin_ts IS NOT NULL AND notif_fin_ts IS NULL AND notif_inicio_ts IS NOT NULL`
  );
  for (const a of r.rows) {
    // Episodio que nunca se anunció (PRECAUCION silenciada, sin escalar):
    // cerrar también en silencio.
    const nuncaAnunciado =
      a.nivel_max === 'PRECAUCION' && !config.telegram.notificarPrecaucion;
    if (!nuncaAnunciado) {
      await enviar(
        `✅ <b>Alerta finalizada</b> (era ${esc(a.nivel_max)} · ${esc((a.causa || '').trim() || '—')})\n` +
          `Duración: ${fmtDuracion(a.inicio_ts, a.fin_ts)}\n` +
          `Los valores volvieron a rango normal.`
      );
    }
    await db.query('UPDATE alertas SET notif_fin_ts = now() WHERE id = $1', [a.id]);
  }
}

// ── Desconexión / reconexión ────────────────────────────────────

async function procesarConexion() {
  if (Date.now() - arranqueTs < GRACIA_ARRANQUE_MS) return;

  const r = await db.query('SELECT max(ts) AS ultima FROM lecturas');
  const ultima = r.rows[0].ultima ? new Date(r.rows[0].ultima).getTime() : 0;
  const actual = Date.now() - ultima > OFFLINE_MS ? 'offline' : 'online';

  if (estadoConexion === null) {
    // Línea base tras el arranque: no notificar (evita avisos falsos en cada deploy)
    estadoConexion = actual;
    return;
  }
  if (actual === estadoConexion) return;

  if (actual === 'offline') {
    await enviar(
      `📡 <b>Estación desconectada</b>\n` +
        `Sin lecturas desde hace ${Math.round((Date.now() - ultima) / 60000)} min. ` +
        `Puede ser corte de energía o de WiFi.`
    );
  } else {
    const l = await db.query('SELECT * FROM lecturas ORDER BY ts DESC LIMIT 1');
    const lec = l.rows[0];
    await enviar(
      `📡 <b>Estación reconectada</b>\n` +
        `Última lectura: ${fmtFecha(lec.ts)} · ${emojiNivel(lec.nivel)} ${esc(
          (lec.nivel || 'NORMAL').toLowerCase()
        )}`
    );
  }
  estadoConexion = actual;
}

// ── Reportes diarios ────────────────────────────────────────────

/** Instante UTC de una hora 'HH:MM' de Lima en una fecha 'AAAA-MM-DD' */
function instanteLima(fecha, hhmm) {
  return new Date(`${fecha}T${hhmm}:00-05:00`);
}

/** Fecha 'AAAA-MM-DD' del día anterior */
function diaAnterior(fecha) {
  const d = new Date(`${fecha}T12:00:00-05:00`);
  d.setUTCDate(d.getUTCDate() - 1);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: ZONA }).format(d);
}

async function enviarReporteDiario(fecha, hora, horaAnterior, fechaAnterior) {
  const desde = instanteLima(fechaAnterior, horaAnterior).toISOString();
  const hh = parseInt(hora.slice(0, 2), 10);
  const emoji = hh < 12 ? '☀️' : '🌆';

  const ult = await db.query('SELECT * FROM lecturas ORDER BY ts DESC LIMIT 1');
  const lec = ult.rows[0] || null;
  const online = lec && Date.now() - new Date(lec.ts).getTime() < OFFLINE_MS;

  const ag = await db.query(
    `SELECT min(temp) tmin, max(temp) tmax, min(hum) hmin, max(hum) hmax,
            max(co) comax, max(co2) co2max, max(uv) uvmax, count(*) n
     FROM lecturas WHERE ts >= $1`,
    [desde]
  );
  const s = ag.rows[0];

  const al = await db.query(
    'SELECT nivel_max, causa FROM alertas WHERE inicio_ts >= $1 ORDER BY inicio_ts',
    [desde]
  );
  const episodios =
    al.rows.length === 0
      ? 'ninguno'
      : `${al.rows.length} (${al.rows
          .map((a) => `${a.nivel_max} · ${(a.causa || '').trim() || '—'}`)
          .join(', ')})`;

  let cuerpo = `${emoji} <b>Reporte de las ${hora} — Estación Ambiental Iquitos</b>\n\n`;
  if (lec) {
    cuerpo += online
      ? `Estado: ${emojiNivel(lec.nivel)} ${esc((lec.nivel || 'NORMAL').toLowerCase())} · en línea\n`
      : `Estado: 📡 desconectada · última lectura ${fmtFecha(lec.ts)}\n`;
    cuerpo += `${fmtValores(lec)}\n\n`;
  } else {
    cuerpo += `Estado: 📡 sin lecturas registradas aún\n\n`;
  }
  cuerpo += `<b>Desde el último reporte (${horaAnterior}${
    fechaAnterior !== fecha ? ' de ayer' : ''
  }):</b>\n`;
  if (Number(s.n) === 0) {
    cuerpo += `Sin lecturas en este periodo.`;
  } else {
    cuerpo +=
      `• Temperatura: mín ${num(s.tmin)} °C · máx ${num(s.tmax)} °C\n` +
      `• Humedad: mín ${num(s.hmin, 0)} % · máx ${num(s.hmax, 0)} %\n` +
      `• CO máx: ${num(s.comax)} ppm · aire máx: ${num(s.co2max, 0)} ppm · UV máx: ${num(s.uvmax)}\n` +
      `• Episodios de alerta: ${esc(episodios)}`;
  }
  await enviar(cuerpo);
}

async function procesarReportes() {
  const { fecha, hhmm } = horaLima();
  const horas = config.telegram.horasReporte; // ordenadas, p. ej. ['07:00','18:00']

  for (let i = 0; i < horas.length; i++) {
    const hora = horas[i];
    if (hhmm < hora) continue; // aún no toca

    const slot = `${fecha}-${hora.slice(0, 2)}`;
    // Ventana de validez: hasta la siguiente hora configurada, o medianoche.
    const finVentana = horas[i + 1] || '24:00';
    const dentroDeVentana = hhmm < finVentana;

    // Registrar el slot (idempotente); si ya existía, no hay nada que hacer
    const ins = await db.query(
      'INSERT INTO bot_reportes (slot) VALUES ($1) ON CONFLICT DO NOTHING RETURNING slot',
      [slot]
    );
    if (ins.rows.length === 0) continue;

    if (!dentroDeVentana) {
      console.log(`[telegram] Reporte ${slot} fuera de ventana; registrado sin enviar`);
      continue;
    }

    // Periodo del resumen: desde la hora configurada anterior (hoy o ayer)
    const horaAnterior = i > 0 ? horas[i - 1] : horas[horas.length - 1];
    const fechaAnterior = i > 0 ? fecha : diaAnterior(fecha);
    try {
      await enviarReporteDiario(fecha, hora, horaAnterior, fechaAnterior);
      console.log(`[telegram] Reporte ${slot} enviado`);
    } catch (err) {
      // Si el envío falló, liberar el slot para reintentar en el siguiente ciclo
      await db.query('DELETE FROM bot_reportes WHERE slot = $1', [slot]);
      throw err;
    }
  }
}

// ── Vigilante ───────────────────────────────────────────────────

async function cicloVigilante() {
  try {
    await procesarAperturas();
    await procesarEscaladas();
    await procesarCierres();
    await procesarConexion();
    await procesarReportes();
  } catch (err) {
    // Nunca tumbar el proceso: se reintenta en el siguiente ciclo
    console.error('[telegram] Vigilante:', err.message);
  }
}

// ── Comandos (chat privado, long polling) ───────────────────────

const TEXTO_UMBRALES =
  `<b>Niveles de referencia</b> (los mismos que usan la estación y el dashboard)\n\n` +
  `🌡 <b>Temperatura</b>: 🟢 hasta 33 °C · 🟡 33–36 °C · 🔴 más de 36 °C\n` +
  `💧 <b>Humedad</b>: 🟢 70–95 % · 🟡 60–70 ó 95–98 % · 🔴 &lt;60 ó &gt;98 %\n` +
  `   (adaptada al clima de Iquitos: 80–95 % es lo normal)\n` +
  `☠️ <b>CO</b>: 🟢 hasta 9 ppm · 🟡 9–26 ppm · 🔴 más de 26 ppm\n` +
  `🌫 <b>Calidad de aire</b>: 🟢 hasta 1000 ppm · 🟡 1000–2000 · 🔴 más de 2000\n` +
  `☀️ <b>Índice UV</b>: 🟢 0–6 · 🟡 6–8 · 🔴 más de 8 (escala OMS)`;

const TEXTO_AYUDA =
  `<b>Estación Ambiental Automatizada — Iquitos</b>\n` +
  `Monitoreo en tiempo real de temperatura, humedad, CO, calidad del aire y ` +
  `radiación UV en Iquitos, Loreto. Datos abiertos para la ciudad.\n\n` +
  `Comandos:\n` +
  `/estado — última lectura y estado de la estación\n` +
  `/alertas — últimos episodios de alerta\n` +
  `/umbrales — niveles de referencia por sensor\n` +
  `/ayuda — este mensaje\n\n` +
  `Canal de avisos: https://t.me/EstacionAmbientalIquitos`;

async function comandoEstado(chatId) {
  const r = await db.query('SELECT * FROM lecturas ORDER BY ts DESC LIMIT 1');
  const lec = r.rows[0];
  if (!lec) return enviar('Aún no hay lecturas registradas.', chatId);
  const haceMin = Math.round((Date.now() - new Date(lec.ts).getTime()) / 60000);
  const online = Date.now() - new Date(lec.ts).getTime() < OFFLINE_MS;
  await enviar(
    `${emojiNivel(lec.nivel)} <b>Estado: ${esc((lec.nivel || 'NORMAL').toLowerCase())}</b> · ` +
      `${online ? 'en línea' : '📡 desconectada'}\n` +
      `Última lectura: ${fmtFecha(lec.ts)} (hace ${haceMin} min)\n\n` +
      fmtValores(lec) +
      (lec.causa && lec.causa.trim() !== 'OK' ? `\nCausa de alerta: ${esc(lec.causa.trim())}` : ''),
    chatId
  );
}

async function comandoAlertas(chatId) {
  const r = await db.query('SELECT * FROM alertas ORDER BY inicio_ts DESC LIMIT 5');
  if (r.rows.length === 0) {
    return enviar('Sin episodios de alerta registrados. Buena señal. 🟢', chatId);
  }
  const lineas = r.rows.map((a) => {
    const dur = a.fin_ts ? fmtDuracion(a.inicio_ts, a.fin_ts) : 'activa ahora';
    return `${emojiNivel(a.nivel_max)} ${esc(a.nivel_max)} · ${esc(
      (a.causa || '').trim() || '—'
    )}\n   ${fmtFecha(a.inicio_ts)} · ${dur}`;
  });
  await enviar(`<b>Últimos episodios de alerta</b>\n\n${lineas.join('\n')}`, chatId);
}

async function responderComando(cmd, chatId) {
  switch (cmd) {
    case '/estado':
      return comandoEstado(chatId);
    case '/alertas':
      return comandoAlertas(chatId);
    case '/umbrales':
      return enviar(TEXTO_UMBRALES, chatId);
    case '/ayuda':
    case '/start':
      return enviar(TEXTO_AYUDA, chatId);
    default:
      return enviar('Comando no reconocido. Prueba /ayuda.', chatId);
  }
}

async function cicloComandos() {
  while (corriendo) {
    try {
      const updates = await api('getUpdates', {
        timeout: 50,
        offset: offsetUpdates,
        allowed_updates: ['message'],
      });
      for (const u of updates) {
        offsetUpdates = u.update_id + 1;
        const msg = u.message;
        if (!msg || typeof msg.text !== 'string' || !msg.text.startsWith('/')) continue;
        const cmd = msg.text.split(/[\s@]/)[0].toLowerCase();
        try {
          await responderComando(cmd, msg.chat.id);
        } catch (err) {
          console.error('[telegram] Comando:', err.message);
        }
      }
    } catch (err) {
      // 409 = otra instancia con el mismo token está haciendo getUpdates
      console.error('[telegram] getUpdates:', err.message);
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
}

// ── Ciclo de vida ───────────────────────────────────────────────

function iniciar() {
  if (!config.telegram.habilitado) {
    console.log('[telegram] Desactivado: falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID');
    return;
  }
  corriendo = true;
  arranqueTs = Date.now();
  marcarHistoricoComoNotificado()
    .then(() => {
      console.log(`[telegram] Bot activo (chat: ${config.telegram.chatId})`);
      vigilanteTimer = setInterval(cicloVigilante, VIGILANTE_MS);
      cicloVigilante();
      cicloComandos();
    })
    .catch((err) => console.error('[telegram] Error al iniciar:', err.message));
}

function cerrar() {
  corriendo = false;
  if (vigilanteTimer) clearInterval(vigilanteTimer);
}

module.exports = { iniciar, cerrar };
