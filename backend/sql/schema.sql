-- Esquema de la Estación Ambiental Iquitos
-- Idempotente: se puede ejecutar varias veces sin efectos secundarios.

-- Tabla principal: una fila por cada mensaje MQTT de lecturas
CREATE TABLE IF NOT EXISTS lecturas (
  id        BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now(),   -- timestamp del servidor
  temp      REAL,
  hum       REAL,
  co        REAL,
  co2       REAL,
  uv        REAL,
  nivel     TEXT,        -- NORMAL / PRECAUCION / PELIGRO
  causa     TEXT,
  cal       BOOLEAN,
  rssi      INTEGER,
  uptime    BIGINT
);

CREATE INDEX IF NOT EXISTS idx_lecturas_ts ON lecturas (ts DESC);

-- Historial de episodios de alerta (un registro por episodio, no por mensaje)
CREATE TABLE IF NOT EXISTS alertas (
  id         BIGSERIAL PRIMARY KEY,
  inicio_ts  TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin_ts     TIMESTAMPTZ,               -- NULL mientras la alerta sigue activa
  nivel_max  TEXT NOT NULL,             -- nivel máximo alcanzado en el episodio
  causa      TEXT,                      -- causa al inicio del episodio
  temp REAL, hum REAL, co REAL, co2 REAL, uv REAL   -- snapshot al inicio
);

CREATE INDEX IF NOT EXISTS idx_alertas_inicio ON alertas (inicio_ts DESC);
