/*
 * ============================================================
 * Estación Ambiental Inteligente - Iquitos v2.4
 * Calibración corregida (MQ-7 / MQ-135 / ADC) + MQTT
 * ------------------------------------------------------------
 * Novedades respecto a v2.3:
 *   - Conexión WiFi (STA) no bloqueante.
 *   - Publicación MQTT al broker Mosquitto cada 60 s (JSON).
 *   - Last Will (LWT): estado online/offline retenido.
 *   - Reconexión WiFi/MQTT con cooldown; el sistema local
 *     (LCD, LEDs, buzzer, calibración) sigue operando aunque
 *     la red se caiga.
 * ============================================================
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>
#include <Preferences.h>
#include <math.h>

// ╔══════════════════════════════════════════════════════════╗
// ║  CONFIGURACIÓN — EDITAR ANTES DE COMPILAR                 ║
// ╚══════════════════════════════════════════════════════════╝

// --- WiFi ---
const char* WIFI_SSID = "CAMBIAR_SSID";
const char* WIFI_PASS = "CAMBIAR_CLAVE_WIFI";

// --- Broker MQTT (Oracle Cloud, São Paulo) ---
const char*    MQTT_HOST      = "163.176.139.242";
const uint16_t MQTT_PORT      = 1883;
const char*    MQTT_USER      = "estacion";
const char*    MQTT_PASS      = "CAMBIAR_POR_LA_CLAVE_ROTADA";
const char*    MQTT_CLIENT_ID = "estacion-iquitos-01";

// --- Topics ---
const char* TOPIC_DATOS  = "estacion/iquitos/lecturas";  // JSON con todas las variables
const char* TOPIC_ESTADO = "estacion/iquitos/estado";    // "online" / "offline" (retenido, LWT)

// --- Intervalo de publicación ---
#define PUBLISH_INTERVAL_MS   (60UL * 1000UL)   // 60 s

// ── Pines ──
#define DHTPIN       4
#define DHTTYPE      DHT22
#define MQ7_PIN      34
#define MQ135_PIN    35
#define UV_PIN       32

#define LED_VERDE    25
#define LED_AMARILLO 26
#define LED_ROJO     27
#define BUZZER_PIN   33
#define BOTON_CAL     0    // Botón BOOT del ESP32 (activo LOW)

// ── Configuración eléctrica y compensación de divisor ──
#define VCC_SENSOR    5.0     // Alimentación del módulo MQ
#define RL_MQ7_NOM    10.0    // kΩ, RL en la placa del MQ-7
#define RL_MQ135_NOM  10.0    // kΩ, RL en la placa del MQ-135

// Divisor externo 1kΩ / 2kΩ para escalar señal de 5V a <3.3V
#define COMPENSAR_DIVISOR true
#define R_SERIE_DIV       1.0   // kΩ (entre AOUT y pin ESP32)
#define R_GND_DIV         2.0   // kΩ (entre pin ESP32 y GND)

// ── Curvas de gas ──
// MQ-7 (CO)
#define MQ7_CLEAN_AIR_RATIO   27.5
#define MQ7_CURVE_A           99.042
#define MQ7_CURVE_B          -1.518

// MQ-135 (CO2) — MQ135_CLEAN_AIR_RATIO = 0.628 consistente con Krocker
#define MQ135_CLEAN_AIR_RATIO  0.628
#define MQ135_CURVE_A          116.6020682
#define MQ135_CURVE_B         -2.769034857

// ── Tiempos ──
#define WARMUP_MS        (20UL * 60UL * 1000UL)  // 20 min (calibración inicial)
#define STABILIZE_MS     (5UL  * 60UL * 1000UL)  // 5 min (post-arranque, buzzer silenciado)
#define CAL_SAMPLES      100
#define CAL_INTERVAL_MS  100

// ── Umbrales ──
#define CO_PRECAUCION    9.0
#define CO_PELIGRO       26.0
#define AIRE_PRECAUCION  1000.0
#define AIRE_PELIGRO     2000.0
#define TEMP_PRECAUCION  33.0
#define TEMP_PELIGRO     36.0
#define HUM_MIN_PREC     70.0
#define HUM_MAX_PREC     95.0
#define HUM_MIN_PEL      60.0
#define HUM_MAX_PEL      98.0
#define UV_PRECAUCION    6.0
#define UV_PELIGRO       8.0

enum NivelAlerta { NORMAL, PRECAUCION, PELIGRO };
DHT dht(DHTPIN, DHTTYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);
Preferences prefs;

// ── Cliente de red ──
WiFiClient   espClient;
PubSubClient mqtt(espClient);

// ── Estado global ──
float R0_MQ7   = 10.0;
float R0_MQ135 = 10.0;
bool  calibrado = false;
unsigned long tiempoInicio = 0;

byte gradoChar[8] = {
  0b00110, 0b01001, 0b01001, 0b00110,
  0b00000, 0b00000, 0b00000, 0b00000
};

unsigned long ultimoCambio = 0;
int pantallaActual = 0;
const unsigned long INTERVALO_PANTALLA = 3000;
const int TOTAL_PANTALLAS = 5;

unsigned long ultimoParpadeo = 0;
bool estadoParpadeo = false;
const unsigned long INTERVALO_PARPADEO = 400;

String causaAlerta = "";

// ── Temporizadores de red ──
unsigned long ultimaPublicacion = 0;
unsigned long ultimoIntentoRed  = 0;
const unsigned long RECONNECT_COOLDOWN_MS = 5000;  // reintenta cada 5 s como máximo

// Declaración adelantada (se usa dentro de publicarDatos)
const char* nombreNivel(NivelAlerta n);

// ────────────────────────────────────────────────
// Funciones de procesamiento de señal
// ────────────────────────────────────────────────

float mapFloat(float x, float in_min, float in_max, float out_min, float out_max) {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

// Lectura calibrada por eFuse en voltios
float leerVoltajeCalibrado(int pin, int muestras = 30) {
  uint32_t acumuladoMv = 0;
  for (int i = 0; i < muestras; i++) {
    acumuladoMv += analogReadMilliVolts(pin);
    delay(2);
  }
  return ((float)acumuladoMv / muestras) / 1000.0;
}

// Reconstruye voltaje real del módulo antes del divisor
float decodificarVoltajeModulo(float v_medido) {
  if (COMPENSAR_DIVISOR) {
    return v_medido * ((R_SERIE_DIV + R_GND_DIV) / R_GND_DIV);
  }
  return v_medido;
}

// RL efectiva considerando el divisor en paralelo
float obtenerRLEfectiva(float RL_nominal) {
  if (COMPENSAR_DIVISOR) {
    float R_divisor = R_SERIE_DIV + R_GND_DIV;
    return (RL_nominal * R_divisor) / (RL_nominal + R_divisor);
  }
  return RL_nominal;
}

// Rs del sensor MQ
float calcularRs(float v_modulo, float RL_efectiva) {
  if (v_modulo <= 0.05) return 999999.0;
  if (v_modulo >= (VCC_SENSOR - 0.05)) return 0.01;
  return RL_efectiva * (VCC_SENSOR - v_modulo) / v_modulo;
}

// Curva log-log: ppm = A * (Rs/R0)^B
float rsRatioAppm(float rsRatio, float a, float b) {
  if (rsRatio <= 0.0) return 0.0;
  return a * pow(rsRatio, b);
}

// ────────────────────────────────────────────────
// Red: WiFi + MQTT (no bloqueante)
// ────────────────────────────────────────────────

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("[WiFi] Conectando a ");
  Serial.print(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(400);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(" OK. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(" FALLO (se reintentara). La estacion sigue midiendo localmente.");
  }
}

bool conectarMQTT() {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (mqtt.connected()) return true;

  Serial.print("[MQTT] Conectando al broker... ");
  // LWT: si la estacion se desconecta sin avisar, el broker publica "offline" (retenido)
  bool ok = mqtt.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS,
                         TOPIC_ESTADO, 1, true, "offline");
  if (ok) {
    Serial.println("conectado.");
    mqtt.publish(TOPIC_ESTADO, "online", true);  // retenido: el dashboard lo ve al suscribirse
  } else {
    Serial.print("fallo, rc=");
    Serial.print(mqtt.state());
    Serial.println("  (revisa IP/puerto/credenciales/firewall)");
  }
  return ok;
}

// Mantiene la red viva sin bloquear el loop
void mantenerRed() {
  if (WiFi.status() != WL_CONNECTED || !mqtt.connected()) {
    if (millis() - ultimoIntentoRed >= RECONNECT_COOLDOWN_MS) {
      ultimoIntentoRed = millis();
      conectarWiFi();
      conectarMQTT();
    }
  }
  mqtt.loop();  // procesa keepalive y mensajes entrantes
}

// Publica un JSON con todas las variables. El backend pondrá el timestamp al insertar.
void publicarDatos(float temp, float hum, float co, float aire, float uv,
                   NivelAlerta nivel, const String& causa) {
  if (!mqtt.connected()) return;

  char payload[256];
  snprintf(payload, sizeof(payload),
    "{\"temp\":%.1f,\"hum\":%.1f,\"co\":%.1f,\"co2\":%.0f,\"uv\":%.1f,"
    "\"nivel\":\"%s\",\"causa\":\"%s\",\"cal\":%s,\"rssi\":%d,\"uptime\":%lu}",
    temp, hum, co, aire, uv,
    nombreNivel(nivel), causa.c_str(),
    calibrado ? "true" : "false",
    WiFi.RSSI(), millis() / 1000UL);

  bool ok = mqtt.publish(TOPIC_DATOS, payload);
  Serial.print("[MQTT] ");
  Serial.print(ok ? "publicado -> " : "fallo publish -> ");
  Serial.println(payload);
}

// ────────────────────────────────────────────────
// Calibración
// ────────────────────────────────────────────────

void calibrarSensores() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Calibrando...");
  lcd.setCursor(0, 1);
  lcd.print("Aire limpio!");

  Serial.println();
  Serial.println("=== INICIANDO CALIBRACION ===");
  Serial.println("Coloque el sensor en aire limpio (exterior, lejos de humo/cocina).");
  Serial.println("Tomando muestras...");
  delay(3000);

  float sumaRs_MQ7   = 0;
  float sumaRs_MQ135 = 0;
  float RL_MQ7_eff   = obtenerRLEfectiva(RL_MQ7_NOM);
  float RL_MQ135_eff = obtenerRLEfectiva(RL_MQ135_NOM);

  for (int i = 0; i < CAL_SAMPLES; i++) {
    float v_pin7   = leerVoltajeCalibrado(MQ7_PIN,   10);
    float v_pin135 = leerVoltajeCalibrado(MQ135_PIN, 10);

    float v_mod7   = decodificarVoltajeModulo(v_pin7);
    float v_mod135 = decodificarVoltajeModulo(v_pin135);

    sumaRs_MQ7   += calcularRs(v_mod7,   RL_MQ7_eff);
    sumaRs_MQ135 += calcularRs(v_mod135, RL_MQ135_eff);

    lcd.setCursor(0, 1);
    lcd.print("Muestra ");
    lcd.print(i + 1);
    lcd.print("/");
    lcd.print(CAL_SAMPLES);
    lcd.print("   ");

    // Mantener MQTT vivo durante los 10 s de calibración
    mqtt.loop();
    delay(CAL_INTERVAL_MS);
  }

  float Rs_MQ7_medio   = sumaRs_MQ7   / CAL_SAMPLES;
  float Rs_MQ135_medio = sumaRs_MQ135 / CAL_SAMPLES;

  R0_MQ7   = Rs_MQ7_medio   / MQ7_CLEAN_AIR_RATIO;
  R0_MQ135 = Rs_MQ135_medio / MQ135_CLEAN_AIR_RATIO;

  prefs.begin("estacion", false);
  prefs.putFloat("R0_MQ7",   R0_MQ7);
  prefs.putFloat("R0_MQ135", R0_MQ135);
  prefs.putBool ("calOK",    true);
  prefs.end();

  calibrado = true;

  Serial.print("Rs medio MQ-7   = "); Serial.print(Rs_MQ7_medio, 2);   Serial.println(" kOhm");
  Serial.print("Rs medio MQ-135 = "); Serial.print(Rs_MQ135_medio, 2); Serial.println(" kOhm");
  Serial.print("R0 MQ-7   = ");       Serial.print(R0_MQ7, 3);         Serial.println(" kOhm");
  Serial.print("R0 MQ-135 = ");       Serial.print(R0_MQ135, 3);       Serial.println(" kOhm");
  Serial.println("=== CALIBRACION COMPLETADA ===");
  Serial.println();

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Cal. OK!");
  lcd.setCursor(0, 1);
  lcd.print("R0 en NVS");
  delay(2500);
  lcd.clear();
}

void cargarCalibracion() {
  prefs.begin("estacion", true);
  bool ok = prefs.getBool("calOK", false);
  if (ok) {
    R0_MQ7   = prefs.getFloat("R0_MQ7",   10.0);
    R0_MQ135 = prefs.getFloat("R0_MQ135", 10.0);
    calibrado = true;
    Serial.println("Calibracion previa cargada de NVS:");
    Serial.print("  R0 MQ-7   = "); Serial.print(R0_MQ7,   3); Serial.println(" kOhm");
    Serial.print("  R0 MQ-135 = "); Serial.print(R0_MQ135, 3); Serial.println(" kOhm");
  } else {
    Serial.println("Sin calibracion previa. Se calibrara al terminar el warmup.");
  }
  prefs.end();
}

// ────────────────────────────────────────────────
// Evaluación de alertas
// ────────────────────────────────────────────────

NivelAlerta evaluarNivel(float temp, float hum, float co, float aire, float uv) {
  causaAlerta = "";
  NivelAlerta nivel = NORMAL;

  if (co > CO_PELIGRO)         { causaAlerta += "CO! ";   nivel = PELIGRO; }
  else if (co > CO_PRECAUCION) { causaAlerta += "CO ";    if (nivel == NORMAL) nivel = PRECAUCION; }

  if (aire > AIRE_PELIGRO)         { causaAlerta += "Aire! "; nivel = PELIGRO; }
  else if (aire > AIRE_PRECAUCION) { causaAlerta += "Aire ";  if (nivel == NORMAL) nivel = PRECAUCION; }

  if (temp > TEMP_PELIGRO)         { causaAlerta += "Temp! "; nivel = PELIGRO; }
  else if (temp > TEMP_PRECAUCION) { causaAlerta += "Temp ";  if (nivel == NORMAL) nivel = PRECAUCION; }

  if (hum < HUM_MIN_PEL || hum > HUM_MAX_PEL) {
    causaAlerta += "Hum! "; nivel = PELIGRO;
  } else if (hum < HUM_MIN_PREC || hum > HUM_MAX_PREC) {
    causaAlerta += "Hum ";  if (nivel == NORMAL) nivel = PRECAUCION;
  }

  if (uv > UV_PELIGRO)         { causaAlerta += "UV! "; nivel = PELIGRO; }
  else if (uv > UV_PRECAUCION) { causaAlerta += "UV ";  if (nivel == NORMAL) nivel = PRECAUCION; }

  if (causaAlerta == "") causaAlerta = "OK";
  return nivel;
}

void actualizarAlertas(NivelAlerta nivel) {
  switch (nivel) {
    case NORMAL:
      digitalWrite(LED_VERDE, HIGH);
      digitalWrite(LED_AMARILLO, LOW);
      digitalWrite(LED_ROJO, LOW);
      digitalWrite(BUZZER_PIN, LOW);
      break;
    case PRECAUCION:
      digitalWrite(LED_VERDE, LOW);
      digitalWrite(LED_AMARILLO, HIGH);
      digitalWrite(LED_ROJO, LOW);
      digitalWrite(BUZZER_PIN, LOW);
      break;
    case PELIGRO:
      if (millis() - ultimoParpadeo >= INTERVALO_PARPADEO) {
        ultimoParpadeo = millis();
        estadoParpadeo = !estadoParpadeo;
        digitalWrite(LED_ROJO, estadoParpadeo);
        digitalWrite(BUZZER_PIN, estadoParpadeo);
      }
      digitalWrite(LED_VERDE, LOW);
      digitalWrite(LED_AMARILLO, LOW);
      break;
  }
}

const char* nombreNivel(NivelAlerta n) {
  switch (n) {
    case NORMAL:     return "NORMAL";
    case PRECAUCION: return "PRECAUCION";
    case PELIGRO:    return "PELIGRO";
  }
  return "?";
}

// ────────────────────────────────────────────────
// Interfaz por serial y botón
// ────────────────────────────────────────────────

void verificarComandoSerial() {
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'c' || c == 'C') {
      Serial.println("[cmd] Recalibracion solicitada por serial");
      calibrarSensores();
    } else if (c == 'r' || c == 'R') {
      Serial.println("[cmd] Borrando calibracion de NVS...");
      prefs.begin("estacion", false);
      prefs.clear();
      prefs.end();
      Serial.println("NVS limpiado. Reinicie el equipo.");
    } else if (c == 'i' || c == 'I') {
      Serial.print("R0 MQ-7   = "); Serial.print(R0_MQ7,   3); Serial.println(" kOhm");
      Serial.print("R0 MQ-135 = "); Serial.print(R0_MQ135, 3); Serial.println(" kOhm");
      Serial.print("Calibrado: "); Serial.println(calibrado ? "SI" : "NO");
    } else if (c == 's' || c == 'S') {
      // Forzar fin de estabilización
      tiempoInicio = millis() - STABILIZE_MS - 1;
      Serial.println("[cmd] Estabilizacion forzada a completada");
    } else if (c == 'm' || c == 'M') {
      // Estado de la red
      Serial.print("[net] WiFi: ");
      Serial.print(WiFi.status() == WL_CONNECTED ? "conectado" : "desconectado");
      if (WiFi.status() == WL_CONNECTED) {
        Serial.print(" IP="); Serial.print(WiFi.localIP());
        Serial.print(" RSSI="); Serial.print(WiFi.RSSI());
      }
      Serial.print(" | MQTT: ");
      Serial.println(mqtt.connected() ? "conectado" : "desconectado");
    }
  }
}

bool botonPresionado() {
  static unsigned long ultimoPresion = 0;
  if (digitalRead(BOTON_CAL) == LOW) {
    if (millis() - ultimoPresion > 800) {
      ultimoPresion = millis();
      return true;
    }
  }
  return false;
}

// ────────────────────────────────────────────────
// Setup
// ────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("=== Estacion Ambiental Iquitos (calibracion + MQTT) ===");
  Serial.println("Comandos serial:");
  Serial.println("  c = calibrar en aire limpio");
  Serial.println("  r = borrar calibracion (requiere reinicio)");
  Serial.println("  i = mostrar R0 actual");
  Serial.println("  s = forzar fin de estabilizacion");
  Serial.println("  m = estado de red (WiFi/MQTT)");
  Serial.println();

  dht.begin();
  Wire.begin();
  lcd.init();
  lcd.backlight();
  lcd.createChar(0, gradoChar);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  pinMode(LED_VERDE, OUTPUT);
  pinMode(LED_AMARILLO, OUTPUT);
  pinMode(LED_ROJO, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BOTON_CAL, INPUT_PULLUP);

  // Autotest de LEDs y buzzer
  digitalWrite(LED_VERDE, HIGH);    delay(200);
  digitalWrite(LED_AMARILLO, HIGH); delay(200);
  digitalWrite(LED_ROJO, HIGH);     delay(200);
  digitalWrite(BUZZER_PIN, HIGH);   delay(150);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_VERDE, LOW);
  digitalWrite(LED_AMARILLO, LOW);
  digitalWrite(LED_ROJO, LOW);

  lcd.setCursor(0, 0);
  lcd.print("Estacion v2.4");
  lcd.setCursor(0, 1);
  lcd.print("Conectando red..");

  // --- Red ---
  conectarWiFi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setKeepAlive(30);
  mqtt.setBufferSize(384);   // el JSON + topic caben holgados (requiere PubSubClient >= 2.8)
  conectarMQTT();

  lcd.setCursor(0, 1);
  lcd.print("Precalentando.. ");

  cargarCalibracion();
  if (calibrado) {
    Serial.println("Estabilizacion post-arranque en curso (5 min)...");
  } else {
    Serial.println("Precalentamiento en curso (min. 20 min)...");
  }
  tiempoInicio = millis();
}

// ────────────────────────────────────────────────
// Loop
// ────────────────────────────────────────────────

void loop() {
  verificarComandoSerial();
  mantenerRed();   // WiFi + MQTT no bloqueante

  unsigned long transcurrido = millis() - tiempoInicio;
  bool warmupCompleto = transcurrido >= WARMUP_MS;
  bool estabilizado   = transcurrido >= STABILIZE_MS;

  // Autocalibración cuando termina el warmup por primera vez
  if (!calibrado && warmupCompleto) {
    Serial.println("Precalentamiento completo. Iniciando autocalibracion...");
    calibrarSensores();
    tiempoInicio = millis();
  }

  // Recalibración manual con botón BOOT (solo después del warmup)
  if (botonPresionado() && warmupCompleto) {
    Serial.println("[boton] Recalibracion manual solicitada");
    calibrarSensores();
  }

  // ── Lecturas ──
  float temperatura = dht.readTemperature();
  float humedad     = dht.readHumidity();
  if (isnan(temperatura)) temperatura = 0;
  if (isnan(humedad))     humedad = 0;

  float RL_MQ7_eff   = obtenerRLEfectiva(RL_MQ7_NOM);
  float RL_MQ135_eff = obtenerRLEfectiva(RL_MQ135_NOM);

  float v_pin7   = leerVoltajeCalibrado(MQ7_PIN,   15);
  float v_pin135 = leerVoltajeCalibrado(MQ135_PIN, 15);
  float v_mod7   = decodificarVoltajeModulo(v_pin7);
  float v_mod135 = decodificarVoltajeModulo(v_pin135);

  float rs_mq7   = calcularRs(v_mod7,   RL_MQ7_eff);
  float rs_mq135 = calcularRs(v_mod135, RL_MQ135_eff);
  float ratio_mq7   = rs_mq7   / R0_MQ7;
  float ratio_mq135 = rs_mq135 / R0_MQ135;

  float co_ppm   = rsRatioAppm(ratio_mq7,   MQ7_CURVE_A,   MQ7_CURVE_B);
  float aire_ppm = rsRatioAppm(ratio_mq135, MQ135_CURVE_A, MQ135_CURVE_B);

  int   uv_raw   = analogRead(UV_PIN);
  float uv_v     = (uv_raw / 4095.0) * 3.3;
  float uv_index = mapFloat(uv_v, 0.99, 2.8, 0.0, 15.0);
  if (uv_index < 0) uv_index = 0;

  // ── Alertas ──
  NivelAlerta nivel;
  if (calibrado) {
    nivel = evaluarNivel(temperatura, humedad, co_ppm, aire_ppm, uv_index);

    if (estabilizado) {
      // Comportamiento normal
      actualizarAlertas(nivel);
    } else {
      // Estabilización post-arranque: buzzer silenciado, LED amarillo parpadeando
      digitalWrite(BUZZER_PIN, LOW);
      digitalWrite(LED_VERDE, LOW);
      digitalWrite(LED_ROJO, LOW);
      digitalWrite(LED_AMARILLO, (millis() / 500) % 2);
      if (nivel != NORMAL) {
        causaAlerta = "ESTABILIZANDO";
      }
    }
  } else {
    // Precalentamiento inicial (sin calibración previa)
    nivel = NORMAL;
    causaAlerta = "PRECALENTANDO";
    digitalWrite(LED_VERDE, (millis() / 500) % 2);
    digitalWrite(LED_AMARILLO, LOW);
    digitalWrite(LED_ROJO, LOW);
    digitalWrite(BUZZER_PIN, LOW);
  }

  // ── Publicación MQTT cada 60 s ──
  // Se publica siempre (incluso en warmup): el campo "cal" indica si los
  // valores de gases ya son válidos, y el dashboard puede mostrar el estado.
  if (millis() - ultimaPublicacion >= PUBLISH_INTERVAL_MS) {
    ultimaPublicacion = millis();
    publicarDatos(temperatura, humedad, co_ppm, aire_ppm, uv_index, nivel, causaAlerta);
  }

  // ── Debug serial ──
  Serial.print("T:");        Serial.print(temperatura, 1);
  Serial.print(" H:");       Serial.print(humedad, 1);
  Serial.print(" V7_real:"); Serial.print(v_mod7, 2);
  Serial.print(" Rs7:");     Serial.print(rs_mq7, 1);
  Serial.print(" Ratio7:");  Serial.print(ratio_mq7, 2);
  Serial.print(" CO:");      Serial.print(co_ppm, 1);
  Serial.print(" Ratio135:");Serial.print(ratio_mq135, 2);
  Serial.print(" CO2:");     Serial.print(aire_ppm, 0);
  Serial.print(" UV:");      Serial.print(uv_index, 1);
  Serial.print(" -> ");      Serial.print(nombreNivel(nivel));
  Serial.print(" [");        Serial.print(causaAlerta);
  Serial.print("]");
  if (!calibrado) {
    unsigned long restante = (WARMUP_MS - transcurrido) / 1000;
    Serial.print(" (warmup ");
    Serial.print(restante);
    Serial.print("s)");
  } else if (!estabilizado) {
    unsigned long restante = (STABILIZE_MS - transcurrido) / 1000;
    Serial.print(" (estab ");
    Serial.print(restante);
    Serial.print("s)");
  }
  Serial.print("  net:");
  Serial.print(WiFi.status() == WL_CONNECTED ? "W" : "-");
  Serial.print(mqtt.connected() ? "M" : "-");
  Serial.println();

  // ── Rotación de pantallas LCD ──
  if (millis() - ultimoCambio >= INTERVALO_PANTALLA) {
    ultimoCambio = millis();
    pantallaActual = (pantallaActual + 1) % TOTAL_PANTALLAS;
    lcd.clear();
  }

  switch (pantallaActual) {
    case 0: // Temp/Hum
      lcd.setCursor(0, 0);
      lcd.print("Temp: ");
      lcd.print(temperatura, 1);
      lcd.write(byte(0));
      lcd.print("C   ");
      lcd.setCursor(0, 1);
      lcd.print("Hum:  ");
      lcd.print(humedad, 1);
      lcd.print(" %   ");
      break;

    case 1: // CO
      lcd.setCursor(0, 0);
      lcd.print("Monox. Carbono");
      lcd.setCursor(0, 1);
      lcd.print("CO: ");
      lcd.print(co_ppm, 1);
      lcd.print(" ppm    ");
      break;

    case 2: // CO2
      lcd.setCursor(0, 0);
      lcd.print("Calidad Aire");
      lcd.setCursor(0, 1);
      lcd.print("CO2:");
      lcd.print(aire_ppm, 0);
      lcd.print(" ppm  ");
      break;

    case 3: // UV
      lcd.setCursor(0, 0);
      lcd.print("Radiacion UV");
      lcd.setCursor(0, 1);
      lcd.print("Indice: ");
      lcd.print(uv_index, 1);
      lcd.print("    ");
      break;

    case 4: { // Estado
      lcd.setCursor(0, 0);
      if (!calibrado) {
        unsigned long restanteMin = (WARMUP_MS - transcurrido) / 60000;
        lcd.print("Warmup:");
        lcd.print(restanteMin);
        lcd.print("m rest ");
      } else if (!estabilizado) {
        unsigned long restanteSeg = (STABILIZE_MS - transcurrido) / 1000;
        lcd.print("Estabiliza:");
        lcd.print(restanteSeg);
        lcd.print("s  ");
      } else {
        lcd.print("Estado:");
        lcd.print(nombreNivel(nivel));
        lcd.print("     ");
      }
      lcd.setCursor(0, 1);
      // Indicador de red al final de la línea de causa
      String causaCorta = causaAlerta;
      if (causaCorta.length() > 13) causaCorta = causaCorta.substring(0, 13);
      lcd.print(causaCorta);
      for (int i = causaCorta.length(); i < 13; i++) lcd.print(" ");
      // 3 chars finales: estado de red  [W][M] o guiones
      lcd.print(WiFi.status() == WL_CONNECTED ? "W" : "-");
      lcd.print(mqtt.connected() ? "M" : "-");
      lcd.print(" ");
      break;
    }
  }

  delay(200);
}
