/** Nivel de alerta por métrica y global, con sus clases de color. */
import { UMBRALES, type MetricKey } from '../config';

export type Nivel = 'NORMAL' | 'PRECAUCION' | 'PELIGRO';

export function nivelDe(metric: MetricKey, valor: number | null | undefined): Nivel {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return 'NORMAL';
  return UMBRALES[metric].nivel(valor);
}

/** Color de acento del nivel (token CSS) */
export function colorNivel(nivel: Nivel): string {
  switch (nivel) {
    case 'PELIGRO':
      return 'var(--clay)';
    case 'PRECAUCION':
      return 'var(--sun)';
    default:
      return 'var(--canopy)';
  }
}

export function etiquetaNivel(nivel: Nivel): string {
  switch (nivel) {
    case 'PELIGRO':
      return 'peligro';
    case 'PRECAUCION':
      return 'precaución';
    default:
      return 'normal';
  }
}
