/**
 * Cliente de la API REST (rutas relativas: mismo origen que el backend).
 */

export interface Lectura {
  id: string;
  ts: string;
  temp: number | null;
  hum: number | null;
  co: number | null;
  co2: number | null;
  uv: number | null;
  nivel: string | null;
  causa: string | null;
  cal: boolean | null;
  rssi: number | null;
  uptime: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface Alerta {
  id: string;
  inicio_ts: string;
  fin_ts: string | null;
  nivel_max: 'PRECAUCION' | 'PELIGRO';
  causa: string | null;
  temp: number | null;
  hum: number | null;
  co: number | null;
  co2: number | null;
  uv: number | null;
}

export interface Estado {
  online: boolean;
  ultimaLectura: string | null;
  ultimoEstado: string | null;
  ultimoEstadoTs: string | null;
  mqttConectado: boolean;
  ultimoResultadoComando: { cmd?: string; estado?: string; raw?: string } | null;
  ultimoResultadoComandoTs: string | null;
  posicion: { lat: number; lon: number; ts: string } | null;
}

export interface PuntoTrack {
  ts: string;
  lat: number;
  lon: number;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const getLatest = () => getJson<Lectura | null>('/api/latest');
export const getStatus = () => getJson<Estado>('/api/status');
export const getAlerts = (limit = 100) => getJson<Alerta[]>(`/api/alerts?limit=${limit}`);
export const getTrack = (hours = 24) => getJson<PuntoTrack[]>(`/api/track?hours=${hours}`);

export function getReadings(params: { hours?: number; from?: string; to?: string }) {
  const q = new URLSearchParams();
  if (params.hours !== undefined) q.set('hours', String(params.hours));
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  return getJson<Lectura[]>(`/api/readings?${q.toString()}`);
}

export type Comando = 'recalibrate' | 'wifi-portal' | 'set-wifi';

/** POST de comando. Devuelve ok o lanza Error con mensaje legible. */
export async function postCommand(
  cmd: Comando,
  token: string,
  body?: Record<string, string>
): Promise<void> {
  const res = await fetch(`/api/command/${cmd}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error('token inválido');
  if (res.status === 503) throw new Error('el servidor no pudo publicar el comando');
  if (!res.ok) throw new Error(`error HTTP ${res.status}`);
}
