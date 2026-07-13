/**
 * Carga .env, valida las variables obligatorias y exporta la configuración.
 * Si falta una variable crítica, aborta con un mensaje claro.
 */
require('dotenv').config();

const OBLIGATORIAS = [
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'MQTT_URL',
  'MQTT_USER',
  'MQTT_PASSWORD',
  'COMMAND_TOKEN',
];

const faltantes = OBLIGATORIAS.filter(
  (nombre) => !process.env[nombre] || process.env[nombre].trim() === ''
);

if (faltantes.length > 0) {
  console.error(
    `[config] Faltan variables de entorno obligatorias: ${faltantes.join(', ')}\n` +
      '[config] Copia backend/.env.example a backend/.env y rellena los valores reales.'
  );
  process.exit(1);
}

const config = {
  db: {
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT, 10),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    // VM con 1 GB de RAM: pool pequeño es suficiente para el ingestor + API
    max: 5,
  },
  mqtt: {
    url: process.env.MQTT_URL,
    user: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
    topicData: process.env.MQTT_TOPIC_DATA || 'estacion/iquitos/lecturas',
    topicStatus: process.env.MQTT_TOPIC_STATUS || 'estacion/iquitos/estado',
    topicCommand: process.env.MQTT_TOPIC_COMMAND || 'estacion/iquitos/comandos',
    topicCommandResult:
      process.env.MQTT_TOPIC_COMMAND_RESULT || 'estacion/iquitos/comandos/resultado',
  },
  api: {
    port: parseInt(process.env.PORT || '3000', 10),
    commandToken: process.env.COMMAND_TOKEN,
    // Límite duro de filas por consulta para no saturar la VM
    maxRows: 5000,
  },
  // Bot de Telegram (opcional: sin token/chat, el bot queda desactivado
  // y el backend funciona igual — por eso NO entra en OBLIGATORIAS)
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '', // canal: '@nombre_canal' o '-100...'
    notificarPrecaucion: process.env.TELEGRAM_NOTIFICAR_PRECAUCION !== 'false',
    dashboardUrl: process.env.DASHBOARD_URL || 'https://estacion-ambiental-iquitos.duckdns.org/',
    // Horas de los reportes diarios, en hora de Perú (America/Lima)
    horasReporte: (process.env.TELEGRAM_HORAS_REPORTE || '07:00,18:00')
      .split(',')
      .map((h) => h.trim())
      .sort(),
    habilitado: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  },
};

module.exports = config;
