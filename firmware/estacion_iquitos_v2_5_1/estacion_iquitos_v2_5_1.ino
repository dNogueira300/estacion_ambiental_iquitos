/*
 * ============================================================
 * Estación Ambiental Automatizada - Iquitos v2.5.1
 * v2.5 (comandos remotos + WiFiManager) con dos ajustes:
 *   1. Umbral de PRECAUCION de calidad de aire: 1000 -> 1200 ppm
 *      (línea base local elevada cerca de la calle).
 *   2. Compensación climática del MQ-135 (modelo de G. Krocker):
 *      la resistencia Rs se normaliza por temperatura y humedad
 *      usando el DHT22, tanto al calibrar como al medir. Clave en
 *      Iquitos (80-95 % HR vs. 33 % HR de la hoja de datos).
 *
 * ⚠ IMPORTANTE: tras flashear esta versión hay que RECALIBRAR
 *   (el R0 guardado por versiones anteriores no es comparable,
 *   porque ahora R0 se guarda ya normalizado por clima).
 *   Recalibrar en aire limpio y VENTILADO (exterior o ventana
 *   abierta, lejos de calle/cocina), con 20+ min de warmup.
 * ============================================================
 */

#include <WiFi.h>
#include <WiFiManager.h>      // tzapu/WiFiManager
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>
#include <Preferences.h>
#include <math.h>

// ╔══════════════════════════════════════════════════════════╗
// ║  CONFIGURACIÓN — EDITAR ANTES DE COMPILAR                ║
// ╚══════════════════════════════════════════════════════════╝

// --- Portal cautivo de configuración WiFi (WiFiManager) ---
const char* AP_NAME = "Estacion-Iquitos-Setup";
const char* AP_PASS = "iquitos2026";     // clave del AP de configuración (mín. 8 chars)
#define PORTAL_TIMEOUT_S   180            // el portal se cierra solo tras 3 min sin config

// --- Broker MQTT (Oracle Cloud, São Paulo) ---
const char*    MQTT_HOST      = "163.176.139.242";
const uint16_t MQTT_PORT      = 1883;
const char*    MQTT_USER      = "estacion";
// ⚠ SEGURIDAD: usa la contraseña ROTADA. Debe coincidir con la del broker y el backend.
const char*    MQTT_PASS      = "CAMBIAR_POR_LA_CLAVE_ROTADA";
const char*    MQTT_CLIENT_ID = "estacion-iquitos-01";

// --- Topics ---
const char* TOPIC_DATOS     = "estacion/iquitos/lecturas";
const char* TOPIC_ESTADO    = "estacion/iquitos/estado";     // online/offline/config (retenido, LWT)
const char* TOPIC_COMANDOS  = "estacion/iquitos/comandos";   // comandos hacia el ESP32
const char* TOPIC_RESULTADO = "estacion/iquitos/comandos/resultado"; // ACK opcional

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

#define LONG_PRESS_MS  3000   // umbral de pulsación larga (portal WiFi)

// ── Configuración eléctrica y compensación de divisor ──
#define VCC_SENSOR    5.0
#define RL_MQ7_NOM    10.0
#define RL_MQ135_NOM  10.0

#define COMPENSAR_DIVISOR true
#define R_SERIE_DIV       1.0
#define R_GND_DIV         2.0

// ── Curvas de gas ──
#define MQ7_CLEAN_AIR_RATIO   27.5
#define MQ7_CURVE_A           99.042
#define MQ7_CURVE_B          -1.518

#define MQ135_CLEAN_AIR_RATIO  0.628
#define MQ135_CURVE_A          116.6020682
#define MQ135_CURVE_B         -2.769034857

// ── Compensación climática del MQ-135 (G. Krocker / librería MQ135) ──
// Normaliza Rs al punto de referencia de la hoja de datos (20 °C, 33 % HR):
// factor = CORA·t² − CORB·t + CORC − (h − 33)·CORD ; Rs_norm = Rs / factor
#define MQ135_CORA   0.00035
#define MQ135_CORB   0.02718
#define MQ135_CORC   1.39538
#define MQ135_CORD   0.0018

// ── Tiempos ──
#define WARMUP_MS        (20UL * 60UL * 1000UL)
#define STABILIZE_MS     (5UL  * 60UL * 1000UL)
#define CAL_SAMPLES      100
#define CAL_INTERVAL_MS  100

// ── Umbrales ──
#define CO_PRECAUCION    9.0
#define CO_PELIGRO       26.0
#define AIRE_PRECAUCION  1200.0   // v2.5.1: antes 1000; línea base local elevada
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
WiFiManager  wm;

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
const unsigned long RECONNECT_COOLDOWN_MS = 5000;

// ── Banderas de comando (puestas por el callback MQTT o el botón, ejecutadas en loop) ──
bool solicitudCalibracion = false;
bool solicitudPortal      = false;
bool solicitudSetWifi     = false;
String nuevoSSID = "";
String nuevoPass = "";

// Declaraciones adelantadas
const char* nombreNivel(NivelAlerta n);
void calibrarSensores();
void entrarPortalConfig();
void aplicarNuevoWifi(const String& ssid, const String& pass);

// ────────────────────────────────────────────────
// Funciones de procesamiento de señal
// ────────────────────────────────────────────────

float mapFloat(float x, float in_min, float in_max, float out_min, float out_max) {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

float leerVoltajeCalibrado(int pin, int muestras = 30) {
  uint32_t acumuladoMv = 0;
  for (int i = 0; i < muestras; i++) {
    acumuladoMv += analogReadMilliVolts(pin);
    delay(2);
  }
  return ((float)acumuladoMv / muestras) / 1000.0;
}

float decodificarVoltajeModulo(float v_medido) {
  if (COMPENSAR_DIVISOR) {
    return v_medido * ((R_SERIE_DIV + R_GND_DIV) / R_GND_DIV);
  }
  return v_medido;
}

float obtenerRLEfectiva(float RL_nominal) {
  if (COMPENSAR_DIVISOR) {
    float R_divisor = R_SERIE_DIV + R_GND_DIV;
    return (RL_nominal * R_divisor) / (RL_nominal + R_divisor);
  }
  return RL_nominal;
}

float calcularRs(float v_modulo, float RL_efectiva) {
  if (v_modulo <= 0.05) return 999999.0;
  if (v_modulo >= (VCC_SENSOR - 0.05)) return 0.01;
  return RL_efectiva * (VCC_SENSOR - v_modulo) / v_modulo;
}

float rsRatioAppm(float rsRatio, float a, float b) {
  if (rsRatio <= 0.0) return 0.0;
  return a * pow(rsRatio, b);
}

/*
 * Factor de corrección climática del MQ-135 (G. Krocker).
 * Rs_normalizado = Rs_medido / factor. Devuelve 1.0 si el DHT22 no
 * entregó datos válidos, y se limita a un rango sano por seguridad.
 */
float factorClimaMQ135(float t, float h) {
  if (t <= 0.0 || h <= 0.0) return 1.0;   // DHT sin lectura válida
  float f = MQ135_CORA * t * t - MQ135_CORB * t + MQ135_CORC - (h - 33.0) * MQ135_CORD;
  if (f < 0.3) f = 0.3;
  if (f > 3.0) f = 3.0;
  return f;
}

// ────────────────────────────────────────────────
// Red: WiFiManager + MQTT + comandos
// ────────────────────────────────────────────────

// Muestra info del portal en el LCD cuando WiFiManager abre el AP
void alEntrarPortal(WiFiManager* w) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Config WiFi:");
  lcd.setCursor(0, 1);
  lcd.print(AP_NAME);
  Serial.println("[wifi] Portal abierto. Conectate al AP para configurar la red.");
}

// Callback de mensajes MQTT entrantes. DEBE ser rápido: solo levanta banderas.
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.print("[cmd] JSON invalido: ");
    Serial.println(err.c_str());
    return;
  }
  const char* cmd = doc["cmd"];
  if (cmd == nullptr) return;

  Serial.print("[cmd] Recibido: ");
  Serial.println(cmd);

  if (strcmp(cmd, "calibrar") == 0) {
    solicitudCalibracion = true;
  } else if (strcmp(cmd, "wifi_portal") == 0) {
    solicitudPortal = true;
  } else if (strcmp(cmd, "set_wifi") == 0) {
    const char* s = doc["ssid"];
    const char* p = doc["pass"];
    if (s != nullptr && p != nullptr && strlen(s) > 0) {
      nuevoSSID = String(s);
      nuevoPass = String(p);
      solicitudSetWifi = true;
    } else {
      Serial.println("[cmd] set_wifi sin ssid/pass validos");
    }
  } else {
    Serial.println("[cmd] Comando desconocido");
  }
}

bool conectarMQTT() {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (mqtt.connected()) return true;

  Serial.print("[MQTT] Conectando al broker... ");
  bool ok = mqtt.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS,
                         TOPIC_ESTADO, 1, true, "offline");
  if (ok) {
    Serial.println("conectado.");
    mqtt.publish(TOPIC_ESTADO, "online", true);   // retenido
    mqtt.subscribe(TOPIC_COMANDOS);                // escuchar comandos
    Serial.print("[MQTT] suscrito a ");
    Serial.println(TOPIC_COMANDOS);
  } else {
    Serial.print("fallo, rc=");
    Serial.print(mqtt.state());
    Serial.println("  (revisa IP/puerto/credenciales/firewall)");
  }
  return ok;
}

// Mantiene la red viva sin bloquear el loop
void mantenerRed() {
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - ultimoIntentoRed >= RECONNECT_COOLDOWN_MS) {
      ultimoIntentoRed = millis();
      Serial.println("[WiFi] Desconectado, reintentando con la red guardada...");
      WiFi.reconnect();
    }
  } else if (!mqtt.connected()) {
    if (millis() - ultimoIntentoRed >= RECONNECT_COOLDOWN_MS) {
      ultimoIntentoRed = millis();
      conectarMQTT();
    }
  }
  mqtt.loop();
}

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

// Abre el portal cautivo (BLOQUEANTE hasta configurar o timeout)
void entrarPortalConfig() {
  Serial.println("[wifi] Entrando al portal de configuracion...");
  if (mqtt.connected()) {
    mqtt.publish(TOPIC_ESTADO, "config", true);
    mqtt.publish(TOPIC_RESULTADO, "{\"cmd\":\"wifi_portal\",\"estado\":\"abierto\"}");
    mqtt.loop();
  }
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Config WiFi");
  lcd.setCursor(0, 1); lcd.print(AP_NAME);

  wm.setConfigPortalTimeout(PORTAL_TIMEOUT_S);
  bool ok = wm.startConfigPortal(AP_NAME, AP_PASS);
  Serial.println(ok ? "[wifi] Nueva red configurada."
                    : "[wifi] Portal cerrado sin cambios (timeout).");

  lcd.clear();
  // Al volver, mantenerRed() reconectará MQTT en el loop normal.
  // No se reinicia el warmup: los sensores siguieron calientes.
}

// Cambia de red estando (idealmente) aún online. Fallback: portal por botón largo.
void aplicarNuevoWifi(const String& ssid, const String& pass) {
  Serial.print("[wifi] Cambiando a red: ");
  Serial.println(ssid);
  if (mqtt.connected()) {
    mqtt.publish(TOPIC_RESULTADO, "{\"cmd\":\"set_wifi\",\"estado\":\"aplicando\"}");
    mqtt.loop();
  }
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Cambiando WiFi");
  lcd.setCursor(0, 1); lcd.print(ssid.substring(0, 16));

  WiFi.persistent(true);                 // guarda credenciales en NVS del WiFi
  WiFi.disconnect(false, false);
  delay(200);
  WiFi.begin(ssid.c_str(), pass.c_str());

  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(400);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(" OK. Nueva IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(" fallo. Usa el boton (pulsacion larga) para abrir el portal.");
  }
  lcd.clear();
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

  // v2.5.1: el R0 del MQ-135 se guarda normalizado por clima, para que
  // la calibración y las mediciones sean comparables aunque cambien T/H.
  float tCal = dht.readTemperature();
  float hCal = dht.readHumidity();
  if (isnan(tCal)) tCal = 0;
  if (isnan(hCal)) hCal = 0;
  float fClimaCal = factorClimaMQ135(tCal, hCal);
  Serial.print("Factor climatico MQ-135 en calibracion: ");
  Serial.print(fClimaCal, 3);
  Serial.print("  (T="); Serial.print(tCal, 1);
  Serial.print("C, H="); Serial.print(hCal, 0); Serial.println("%)");

  for (int i = 0; i < CAL_SAMPLES; i++) {
    float v_pin7   = leerVoltajeCalibrado(MQ7_PIN,   10);
    float v_pin135 = leerVoltajeCalibrado(MQ135_PIN, 10);

    float v_mod7   = decodificarVoltajeModulo(v_pin7);
    float v_mod135 = decodificarVoltajeModulo(v_pin135);

    sumaRs_MQ7   += calcularRs(v_mod7,   RL_MQ7_eff);
    sumaRs_MQ135 += calcularRs(v_mod135, RL_MQ135_eff) / fClimaCal;

    lcd.setCursor(0, 1);
    lcd.print("Muestra ");
    lcd.print(i + 1);
    lcd.print("/");
    lcd.print(CAL_SAMPLES);
    lcd.print("   ");

    mqtt.loop();               // mantener MQTT vivo durante la calibración
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
      tiempoInicio = millis() - STABILIZE_MS - 1;
      Serial.println("[cmd] Estabilizacion forzada a completada");
    } else if (c == 'm' || c == 'M') {
      Serial.print("[net] WiFi: ");
      Serial.print(WiFi.status() == WL_CONNECTED ? "conectado" : "desconectado");
      if (WiFi.status() == WL_CONNECTED) {
        Serial.print(" SSID="); Serial.print(WiFi.SSID());
        Serial.print(" IP=");   Serial.print(WiFi.localIP());
        Serial.print(" RSSI="); Serial.print(WiFi.RSSI());
      }
      Serial.print(" | MQTT: ");
      Serial.println(mqtt.connected() ? "conectado" : "desconectado");
    } else if (c == 'w' || c == 'W') {
      Serial.println("[cmd] Abriendo portal de configuracion WiFi por serial...");
      solicitudPortal = true;
    }
  }
}

// Devuelve: 0 = nada, 1 = pulsación corta, 2 = pulsación larga (>= LONG_PRESS_MS)
int leerBoton() {
  static bool presionado = false;
  static unsigned long tInicio = 0;
  bool abajo = (digitalRead(BOTON_CAL) == LOW);

  if (abajo && !presionado) {
    presionado = true;
    tInicio = millis();
  }
  if (!abajo && presionado) {
    presionado = false;
    unsigned long dur = millis() - tInicio;
    if (dur >= LONG_PRESS_MS) return 2;   // larga -> portal WiFi
    if (dur >= 50)            return 1;   // corta -> recalibrar (debounce 50 ms)
  }
  return 0;
}

// ────────────────────────────────────────────────
// Setup
// ────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("=== Estacion Ambiental Iquitos v2.5.1 (umbral aire 1200 + correccion climatica MQ-135) ===");
  Serial.println("Comandos serial:");
  Serial.println("  c = calibrar    r = borrar cal.   i = ver R0");
  Serial.println("  s = fin estab.  m = estado red    w = portal WiFi");
  Serial.println("Boton BOOT: corto = recalibrar | largo (>=3s) = portal WiFi");
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
  lcd.print("Estacion v2.5.1");
  lcd.setCursor(0, 1);
  lcd.print("Conectando red..");

  // --- WiFi vía WiFiManager ---
  // Intenta la red guardada; si no hay o falla, abre el portal cautivo.
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  wm.setAPCallback(alEntrarPortal);
  wm.setConfigPortalTimeout(PORTAL_TIMEOUT_S);
  bool conectado = wm.autoConnect(AP_NAME, AP_PASS);
  if (conectado) {
    Serial.print("[WiFi] Conectado. SSID=");
    Serial.print(WiFi.SSID());
    Serial.print(" IP=");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[WiFi] Sin conexion (timeout del portal). Sigue funcionando local.");
  }

  // --- MQTT ---
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setKeepAlive(30);
  mqtt.setBufferSize(384);
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
  mantenerRed();

  unsigned long transcurrido = millis() - tiempoInicio;
  bool warmupCompleto = transcurrido >= WARMUP_MS;
  bool estabilizado   = transcurrido >= STABILIZE_MS;

  // ── Ejecución de comandos pendientes (fuera del callback/ISR) ──
  if (solicitudCalibracion) {
    solicitudCalibracion = false;
    if (warmupCompleto) {
      Serial.println("[cmd] Recalibracion remota (MQTT)");
      calibrarSensores();
      if (mqtt.connected())
        mqtt.publish(TOPIC_RESULTADO, "{\"cmd\":\"calibrar\",\"estado\":\"ok\"}");
    } else {
      Serial.println("[cmd] Recalibracion ignorada: aun en warmup");
      if (mqtt.connected())
        mqtt.publish(TOPIC_RESULTADO, "{\"cmd\":\"calibrar\",\"estado\":\"warmup\"}");
    }
    tiempoInicio = millis();  // reinicia estabilización tras recalibrar
  }
  if (solicitudPortal) {
    solicitudPortal = false;
    entrarPortalConfig();
  }
  if (solicitudSetWifi) {
    solicitudSetWifi = false;
    aplicarNuevoWifi(nuevoSSID, nuevoPass);
  }

  // Autocalibración cuando termina el warmup por primera vez
  if (!calibrado && warmupCompleto) {
    Serial.println("Precalentamiento completo. Iniciando autocalibracion...");
    calibrarSensores();
    tiempoInicio = millis();
  }

  // ── Botón BOOT: corto = recalibrar | largo = portal WiFi ──
  int b = leerBoton();
  if (b == 1) {
    if (warmupCompleto) {
      Serial.println("[boton] Pulsacion corta -> recalibracion manual");
      calibrarSensores();
    } else {
      Serial.println("[boton] Recalibracion ignorada: aun en warmup");
    }
  } else if (b == 2) {
    Serial.println("[boton] Pulsacion larga -> portal de config WiFi");
    entrarPortalConfig();
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

  // v2.5.1: normalizar la Rs del MQ-135 por temperatura y humedad (DHT22)
  float fClima = factorClimaMQ135(temperatura, humedad);
  float rs_mq135_norm = rs_mq135 / fClima;

  float ratio_mq7   = rs_mq7        / R0_MQ7;
  float ratio_mq135 = rs_mq135_norm / R0_MQ135;

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
      actualizarAlertas(nivel);
    } else {
      digitalWrite(BUZZER_PIN, LOW);
      digitalWrite(LED_VERDE, LOW);
      digitalWrite(LED_ROJO, LOW);
      digitalWrite(LED_AMARILLO, (millis() / 500) % 2);
      if (nivel != NORMAL) {
        causaAlerta = "ESTABILIZANDO";
      }
    }
  } else {
    nivel = NORMAL;
    causaAlerta = "PRECALENTANDO";
    digitalWrite(LED_VERDE, (millis() / 500) % 2);
    digitalWrite(LED_AMARILLO, LOW);
    digitalWrite(LED_ROJO, LOW);
    digitalWrite(BUZZER_PIN, LOW);
  }

  // ── Publicación MQTT cada 60 s ──
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
  Serial.print(" fClima:"); Serial.print(fClima, 2);
  Serial.print(" Ratio135:");Serial.print(ratio_mq135, 2);
  Serial.print(" CO2:");     Serial.print(aire_ppm, 0);
  Serial.print(" UV:");      Serial.print(uv_index, 1);
  Serial.print(" -> ");      Serial.print(nombreNivel(nivel));
  Serial.print(" [");        Serial.print(causaAlerta);
  Serial.print("]");
  if (!calibrado) {
    unsigned long restante = (WARMUP_MS - transcurrido) / 1000;
    Serial.print(" (warmup "); Serial.print(restante); Serial.print("s)");
  } else if (!estabilizado) {
    unsigned long restante = (STABILIZE_MS - transcurrido) / 1000;
    Serial.print(" (estab "); Serial.print(restante); Serial.print("s)");
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
    case 0:
      lcd.setCursor(0, 0);
      lcd.print("Temp: "); lcd.print(temperatura, 1); lcd.write(byte(0)); lcd.print("C   ");
      lcd.setCursor(0, 1);
      lcd.print("Hum:  "); lcd.print(humedad, 1); lcd.print(" %   ");
      break;

    case 1:
      lcd.setCursor(0, 0);
      lcd.print("Monox. Carbono");
      lcd.setCursor(0, 1);
      lcd.print("CO: "); lcd.print(co_ppm, 1); lcd.print(" ppm    ");
      break;

    case 2:
      lcd.setCursor(0, 0);
      lcd.print("Calidad Aire");
      lcd.setCursor(0, 1);
      lcd.print("CO2:"); lcd.print(aire_ppm, 0); lcd.print(" ppm  ");
      break;

    case 3:
      lcd.setCursor(0, 0);
      lcd.print("Radiacion UV");
      lcd.setCursor(0, 1);
      lcd.print("Indice: "); lcd.print(uv_index, 1); lcd.print("    ");
      break;

    case 4: {
      lcd.setCursor(0, 0);
      if (!calibrado) {
        unsigned long restanteMin = (WARMUP_MS - transcurrido) / 60000;
        lcd.print("Warmup:"); lcd.print(restanteMin); lcd.print("m rest ");
      } else if (!estabilizado) {
        unsigned long restanteSeg = (STABILIZE_MS - transcurrido) / 1000;
        lcd.print("Estabiliza:"); lcd.print(restanteSeg); lcd.print("s  ");
      } else {
        lcd.print("Estado:"); lcd.print(nombreNivel(nivel)); lcd.print("     ");
      }
      lcd.setCursor(0, 1);
      String causaCorta = causaAlerta;
      if (causaCorta.length() > 13) causaCorta = causaCorta.substring(0, 13);
      lcd.print(causaCorta);
      for (int i = causaCorta.length(); i < 13; i++) lcd.print(" ");
      lcd.print(WiFi.status() == WL_CONNECTED ? "W" : "-");
      lcd.print(mqtt.connected() ? "M" : "-");
      lcd.print(" ");
      break;
    }
  }

  delay(200);
}
