# Backend — Estación Ambiental Iquitos

Servicio Node.js (un solo proceso, ligero para la VM de 1 GB) que:

1. Se suscribe al broker MQTT local (Mosquitto) y guarda **una fila por lectura** en PostgreSQL con timestamp del servidor.
2. Registra **episodios de alerta** (una fila por episodio, con inicio, fin y nivel máximo).
3. Expone una **API REST** en el puerto 3000: datos de solo lectura + comandos autenticados hacia el ESP32.

```
ESP32 ──MQTT──▶ Mosquitto (:1883, localhost)
                     │
                     ▼
         Backend Node.js (este servicio)
         ┌───────────────────────────────┐
         │  Ingestor MQTT  → inserta     │──▶ PostgreSQL (lecturas + alertas)
         │  API REST (Express, :3000)    │◀── dashboard (fase siguiente)
         └───────────────────────────────┘
```

## Estructura

```
backend/
├── src/
│   ├── index.js          # arranque: esquema + API + ingestor + cierre ordenado
│   ├── config.js         # carga y valida variables de entorno
│   ├── db.js             # pool de PostgreSQL (pg)
│   ├── mqttIngestor.js   # suscribe, valida, inserta lecturas y alertas
│   └── routes/
│       ├── readings.js   # /api/latest, /api/readings
│       ├── alerts.js     # /api/alerts
│       ├── status.js     # /api/status, /api/health
│       └── commands.js   # /api/command/* (autenticados) → publica en MQTT
├── sql/schema.sql        # esquema idempotente (se aplica solo al arrancar)
├── deploy/estacion-backend.service   # unidad systemd
├── .env.example          # plantilla de configuración (copiar a .env)
└── package.json
```

## API REST

Prefijo `/api`. Todas las respuestas en JSON.

### Datos (solo lectura, sin autenticación)

| Método | Ruta                     | Descripción                                                          |
| ------ | ------------------------ | -------------------------------------------------------------------- |
| GET    | `/api/health`            | Salud del servicio → `{ "ok": true }`                                |
| GET    | `/api/latest`            | Última lectura (objeto) o `null`                                     |
| GET    | `/api/readings?hours=24` | Lecturas de las últimas N horas, orden ascendente por `ts`           |
| GET    | `/api/readings?from=ISO&to=ISO&limit=N` | Rango explícito (alternativa)                         |
| GET    | `/api/alerts?limit=50`   | Historial de episodios de alerta                                     |
| GET    | `/api/status`            | `{ online, ultimaLectura, ultimoEstado, mqttConectado, ultimoResultadoComando, ... }` |

- `online` = hubo lectura hace menos de 3 min **y** el último estado retenido no es `offline`.
- `/api/readings` tiene un límite duro de **5000 filas**.
- `ultimoResultadoComando` es el último ACK que el ESP32 publicó en `estacion/iquitos/comandos/resultado` (firmware v2.5).

### Comandos (requieren cabecera `X-Auth-Token`)

No tocan la base de datos: publican en `estacion/iquitos/comandos`. Sin token válido → `401`.

| Método | Ruta                       | Body                          | Publica                                    |
| ------ | -------------------------- | ----------------------------- | ------------------------------------------ |
| POST   | `/api/command/recalibrate` | —                             | `{"cmd":"calibrar"}`                       |
| POST   | `/api/command/wifi-portal` | —                             | `{"cmd":"wifi_portal"}`                    |
| POST   | `/api/command/set-wifi`    | `{"ssid":"...","pass":"..."}` | `{"cmd":"set_wifi","ssid":...,"pass":...}` |

Respuesta: `{ "ok": true, "publicado": "estacion/iquitos/comandos" }`.

> ⚠️ **Recalibrar:** el dashboard debe advertir al usuario que el sensor esté en **aire limpio** antes de confirmar. El sistema no puede verificarlo por software.
>
> ⚠️ **set-wifi:** la clave viaja en texto plano por MQTT sin TLS. Preferir el portal cautivo (`wifi-portal` o pulsación larga del botón BOOT). El backend no registra el contenido de `set_wifi` en logs.

## Despliegue en la VM de Oracle Cloud (Ubuntu 22.04)

Ejecutar por SSH en la VM (`163.176.139.242`).

### 1. PostgreSQL

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib

# Crear base de datos y usuario de aplicación
sudo -u postgres psql <<'SQL'
CREATE DATABASE estacion;
CREATE USER estacion_app WITH PASSWORD 'CAMBIAR_ESTA_CLAVE';
GRANT ALL PRIVILEGES ON DATABASE estacion TO estacion_app;
SQL

# Cargar el esquema (desde /tmp: el usuario postgres no puede leer /home/ubuntu)
cp ~/estacion_ambiental_iquitos/backend/sql/schema.sql /tmp/schema.sql
cd /tmp && sudo -u postgres psql -d estacion -f /tmp/schema.sql && rm /tmp/schema.sql

# Transferir la propiedad de tablas y secuencias al usuario de la app.
# (GRANT no basta: el backend ejecuta CREATE INDEX IF NOT EXISTS al arrancar,
#  y eso exige ser dueño de la tabla aunque el índice ya exista.)
sudo -u postgres psql -d estacion <<'SQL'
ALTER TABLE lecturas OWNER TO estacion_app;
ALTER TABLE alertas  OWNER TO estacion_app;
ALTER SEQUENCE lecturas_id_seq OWNER TO estacion_app;
ALTER SEQUENCE alertas_id_seq  OWNER TO estacion_app;
SQL
```

> **Gotcha de autenticación:** el backend se conecta por TCP a `localhost`, así que en
> `/etc/postgresql/14/main/pg_hba.conf` la línea de conexiones locales IPv4
> (`host all all 127.0.0.1/32 ...`) debe permitir `scram-sha-256` (o `md5`).
> Tras editar: `sudo systemctl restart postgresql`.
>
> PostgreSQL **no** necesita puerto abierto al exterior: solo lo usa el backend local.
> **No abrir el 5432** en iptables ni en la Security List de Oracle.

### 2. Node.js LTS 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # verificar v20.x
```

### 3. Código y configuración

```bash
cd ~
git clone https://github.com/dNogueira300/estacion_ambiental_iquitos.git
cd estacion_ambiental_iquitos/backend
npm install
cp .env.example .env
nano .env          # rellenar claves reales (DB y MQTT rotada)
# Generar el token de comandos:
openssl rand -hex 32
node src/index.js  # prueba en primer plano (Ctrl+C para salir)
```

### 4. Servicio systemd

```bash
sudo cp deploy/estacion-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now estacion-backend
sudo systemctl status estacion-backend
journalctl -u estacion-backend -f   # logs en vivo
```

## Pruebas de aceptación

1. **Ingesta** — filas nuevas cada 60 s:

   ```bash
   sudo -u postgres psql -d estacion -c "SELECT ts, temp, co2, nivel FROM lecturas ORDER BY ts DESC LIMIT 5;"
   ```

2. **API local:**

   ```bash
   curl localhost:3000/api/health     # {"ok":true}
   curl localhost:3000/api/latest
   curl "localhost:3000/api/readings?hours=1"
   curl localhost:3000/api/status
   ```

3. **API externa** (desde el PC, puerto 3000 abierto):

   ```bash
   curl http://163.176.139.242:3000/api/latest
   ```

4. **Alertas** — simular un episodio publicando a mano:

   ```bash
   mosquitto_pub -h localhost -u estacion -P '<clave>' -t estacion/iquitos/lecturas \
     -m '{"temp":30,"hum":80,"co":30.5,"co2":500,"uv":1,"nivel":"PELIGRO","causa":"CO! ","cal":true,"rssi":-50,"uptime":100}'
   # → una fila nueva en alertas con fin_ts NULL
   mosquitto_pub -h localhost -u estacion -P '<clave>' -t estacion/iquitos/lecturas \
     -m '{"temp":30,"hum":80,"co":0.5,"co2":450,"uv":1,"nivel":"NORMAL","causa":"OK","cal":true,"rssi":-50,"uptime":160}'
   # → la misma fila se cierra con fin_ts
   sudo -u postgres psql -d estacion -c "SELECT * FROM alertas ORDER BY inicio_ts DESC LIMIT 3;"
   ```

5. **Robustez** — mensaje malformado se descarta sin tumbar el servicio:

   ```bash
   mosquitto_pub -h localhost -u estacion -P '<clave>' -t estacion/iquitos/lecturas -m 'esto no es json'
   journalctl -u estacion-backend -n 5   # muestra "JSON malformado, descartado"
   ```

6. **Persistencia:**

   ```bash
   sudo systemctl restart estacion-backend   # vuelve solo y sigue insertando
   ```

7. **Comandos** (requiere firmware v2.5 en el ESP32):

   ```bash
   # Sin token → 401
   curl -X POST http://163.176.139.242:3000/api/command/recalibrate

   # Con token → publica; el ESP32 recalibra (LCD "Cal. OK!", siguiente lectura cal:true)
   curl -X POST http://163.176.139.242:3000/api/command/recalibrate \
        -H "X-Auth-Token: <COMMAND_TOKEN>"

   # Verificar que el comando llega al topic:
   mosquitto_sub -h localhost -u estacion -P '<clave>' -t 'estacion/iquitos/comandos' -v
   ```

## Seguridad

- `.env` y `node_modules/` están en `.gitignore`. **Nunca** commitear credenciales.
- **Rotar la contraseña MQTT** en el broker, luego actualizar `MQTT_PASSWORD` en `.env` y `MQTT_PASS` en el firmware (reflashear).
- Endpoints de datos: abiertos deliberadamente (datos ambientales públicos, solo lectura).
- Endpoints de comando: protegidos con `COMMAND_TOKEN` (generar con `openssl rand -hex 32`).
- Contraseña de PostgreSQL distinta de la de MQTT y distinta del `COMMAND_TOKEN`.
