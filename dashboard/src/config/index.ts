/**
 * Configuración central del dashboard.
 * Los umbrales replican EXACTAMENTE el firmware v2.5 (plan §9): el color
 * del dashboard debe decir lo mismo que los LEDs físicos de la estación.
 */

export type MetricKey = 'temp' | 'hum' | 'co' | 'co2' | 'uv';

export interface Threshold {
  /** Devuelve el nivel para un valor dado */
  nivel: (v: number) => 'NORMAL' | 'PRECAUCION' | 'PELIGRO';
  /** Líneas de referencia para la gráfica (etiqueta + valor) */
  lineas: { valor: number; etiqueta: string; nivel: 'PRECAUCION' | 'PELIGRO' }[];
}

export const UMBRALES: Record<MetricKey, Threshold> = {
  co: {
    nivel: (v) => (v > 26.0 ? 'PELIGRO' : v > 9.0 ? 'PRECAUCION' : 'NORMAL'),
    lineas: [
      { valor: 9.0, etiqueta: 'precaución 9', nivel: 'PRECAUCION' },
      { valor: 26.0, etiqueta: 'peligro 26', nivel: 'PELIGRO' },
    ],
  },
  co2: {
    nivel: (v) => (v > 2000 ? 'PELIGRO' : v > 1000 ? 'PRECAUCION' : 'NORMAL'),
    lineas: [
      { valor: 1000, etiqueta: 'precaución 1000', nivel: 'PRECAUCION' },
      { valor: 2000, etiqueta: 'peligro 2000', nivel: 'PELIGRO' },
    ],
  },
  temp: {
    nivel: (v) => (v > 36 ? 'PELIGRO' : v > 33 ? 'PRECAUCION' : 'NORMAL'),
    lineas: [
      { valor: 33, etiqueta: 'precaución 33°', nivel: 'PRECAUCION' },
      { valor: 36, etiqueta: 'peligro 36°', nivel: 'PELIGRO' },
    ],
  },
  // Humedad de Iquitos: umbrales elevados a propósito (clima 80–95 %).
  hum: {
    nivel: (v) =>
      v < 60 || v > 98 ? 'PELIGRO' : v < 70 || v > 95 ? 'PRECAUCION' : 'NORMAL',
    lineas: [
      { valor: 70, etiqueta: 'precaución <70', nivel: 'PRECAUCION' },
      { valor: 95, etiqueta: 'precaución >95', nivel: 'PRECAUCION' },
    ],
  },
  uv: {
    nivel: (v) => (v > 8.0 ? 'PELIGRO' : v > 6.0 ? 'PRECAUCION' : 'NORMAL'),
    lineas: [
      { valor: 6.0, etiqueta: 'precaución 6', nivel: 'PRECAUCION' },
      { valor: 8.0, etiqueta: 'peligro 8', nivel: 'PELIGRO' },
    ],
  },
};

export const METRICAS: {
  key: MetricKey;
  nombre: string;
  unidad: string;
  decimales: number;
}[] = [
  { key: 'temp', nombre: 'Temperatura', unidad: '°C', decimales: 1 },
  { key: 'hum', nombre: 'Humedad', unidad: '%', decimales: 1 },
  { key: 'co', nombre: 'CO', unidad: 'ppm', decimales: 1 },
  { key: 'co2', nombre: 'Calidad de aire', unidad: 'ppm', decimales: 0 },
  { key: 'uv', nombre: 'Índice UV', unidad: '', decimales: 1 },
];

/** Centro de Iquitos: fallback cuando la API aún no reporta posición */
export const DEFAULT_STATION_COORDS: [number, number] = [-3.7491, -73.2538];

/**
 * Mostrar el mapa. Apagado hasta que el firmware v2.6 traiga GPS y la API
 * reporte la posición real (mientras tanto solo mostraría el fallback).
 * Para reactivarlo: SHOW_MAP = true, rebuild y push.
 */
export const SHOW_MAP = false;

/** Estación móvil (GPS, firmware v2.6): activa trayectoria y reencuadre */
export const MOBILE_MODE = true;

/** Sondeo de /api/latest y /api/status (los datos cambian cada 60 s) */
export const POLL_INTERVAL_MS = 25_000;

/** Sin lecturas hace más de esto ⇒ "sin datos recientes" (3× intervalo) */
export const STALE_MS = 3 * 60 * 1000;
