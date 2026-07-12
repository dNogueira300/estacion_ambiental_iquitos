# Estación Ambiental Inteligente — Iquitos

Sistema de monitoreo ambiental en tiempo real para Iquitos (Loreto, Perú) basado en ESP32.
Mide **CO (MQ-7), calidad del aire (MQ-135), radiación UV (ML8511), temperatura y humedad (DHT22)**,
muestra los datos en un LCD local, genera alertas visuales/sonoras y publica por MQTT a un
servidor propio en Oracle Cloud.

## Arquitectura

```
ESP32 (Iquitos) ──MQTT──▶ Mosquitto (:1883) ──▶ Backend Node.js ──▶ PostgreSQL
                              ▲                      │
                              │ comandos             ▼ API REST (:3000)
                              └──────────── Dashboard web (fase siguiente)
                                            Bot de Telegram (fase siguiente)
```

- **VM:** Oracle Cloud siempre-gratis (`VM.Standard.E2.1.Micro`, Ubuntu 22.04, São Paulo), IP `163.176.139.242`.
- **Topics MQTT:** `estacion/iquitos/lecturas` (datos, cada 60 s), `estacion/iquitos/estado`
  (online/offline/config, retenido + LWT), `estacion/iquitos/comandos` (hacia el ESP32) y
  `estacion/iquitos/comandos/resultado` (ACK del ESP32).

## Estructura del repositorio

| Carpeta      | Contenido                                                                        |
| ------------ | -------------------------------------------------------------------------------- |
| `firmware/`  | Sketches de Arduino para el ESP32 (v2.4 y v2.5)                                  |
| `backend/`   | Servicio Node.js: ingesta MQTT → PostgreSQL + API REST (ver `backend/README.md`) |
| `dashboard/` | Dashboard web — fase siguiente, aún vacío                                        |

## Firmware

- **v2.4:** calibración corregida (MQ-7, MQ-135, ADC por eFuse) + publicación MQTT cada 60 s.
- **v2.5 (actual):** v2.4 + comandos remotos por MQTT (recalibrar, portal WiFi, set_wifi)
  - WiFiManager (portal cautivo `Estacion-Iquitos-Setup` para cambiar de red sin reflashear)
  - botón BOOT: pulsación corta = recalibrar, larga (≥3 s) = portal WiFi.

## Estado del proyecto

| Fase | Descripción                                           | Estado                               |
| ---- | ----------------------------------------------------- | ------------------------------------ |
| 1–10 | Hardware, sensores, alertas locales, cloud + MQTT     | ✅ Completo                          |
| 11   | Firmware con calibración corregida + MQTT (v2.4/v2.5) | ✅ Completo                          |
| 12   | PostgreSQL + backend Node.js + API REST               | ✅ Código listo — desplegar en la VM |
| 13   | Dashboard web (valores, gráficas, historial, mapa)    | ⏳ Pendiente                         |
| 14   | Bot de Telegram                                       | ⏳ Pendiente                         |

El despliegue del backend en la VM está documentado paso a paso en [`backend/README.md`](backend/README.md).
