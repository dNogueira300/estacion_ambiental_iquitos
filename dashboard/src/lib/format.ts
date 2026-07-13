/** Formateo de fechas, duraciones y números (es-PE). */

export function fmtNumero(v: number | null | undefined, decimales = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('es-PE', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

export function fmtFechaHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-PE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "hace 12 s", "hace 3 min", "hace 2 h" */
export function fmtHace(iso: string | null | undefined, ahora: number): string {
  if (!iso) return '—';
  const seg = Math.max(0, Math.floor((ahora - new Date(iso).getTime()) / 1000));
  if (seg < 60) return `hace ${seg} s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

/** Duración entre dos timestamps: "4 min", "1 h 12 min" */
export function fmtDuracion(inicioIso: string, finIso: string | null, ahora: number): string {
  const fin = finIso ? new Date(finIso).getTime() : ahora;
  const min = Math.max(0, Math.round((fin - new Date(inicioIso).getTime()) / 60000));
  if (min < 1) return '<1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem > 0 ? `${h} h ${rem} min` : `${h} h`;
}

/** Coordenada con 4 decimales en mono */
export function fmtCoord(v: number): string {
  return v.toFixed(4);
}
