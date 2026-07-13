import { useMemo } from 'react';
import type { Lectura } from '../lib/api';
import { fmtNumero } from '../lib/format';
import { colorNivel, etiquetaNivel, nivelDe } from '../lib/levels';
import type { MetricKey } from '../config';
import { Skeleton } from './ui/Skeleton';

interface Props {
  metric: MetricKey;
  nombre: string;
  unidad: string;
  decimales: number;
  latest: Lectura | null;
  historia: Lectura[]; // última hora, para el sparkline
  cargando: boolean;
  atenuada: boolean; // estación sin datos recientes
}

/** Sparkline SVG puro (sin librería): línea de la última hora. */
function Sparkline({ valores, color }: { valores: number[]; color: string }) {
  const d = useMemo(() => {
    if (valores.length < 2) return '';
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const rango = max - min || 1;
    const W = 120;
    const H = 28;
    const pad = 2;
    return valores
      .map((v, i) => {
        const x = pad + (i / (valores.length - 1)) * (W - 2 * pad);
        const y = H - pad - ((v - min) / rango) * (H - 2 * pad);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [valores]);

  if (!d) return <div className="h-7" aria-hidden="true" />;
  return (
    <svg
      width="120"
      height="28"
      viewBox="0 0 120 28"
      className="block"
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" opacity="0.85" />
    </svg>
  );
}

/** Tarjeta "azulejo" de valor actual (signature, plan §5.2). */
export function MetricTile({
  metric,
  nombre,
  unidad,
  decimales,
  latest,
  historia,
  cargando,
  atenuada,
}: Props) {
  const valor = latest?.[metric] ?? null;
  const nivel = nivelDe(metric, valor);
  const acento = colorNivel(nivel);
  const serie = historia
    .map((l) => l[metric])
    .filter((v): v is number => v !== null && Number.isFinite(v));

  if (cargando) {
    return (
      <div className="azulejo-tile rounded-xl border border-edge bg-river-panel p-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-12 w-28" />
        <Skeleton className="mt-3 h-7 w-full" />
      </div>
    );
  }

  return (
    <div
      className={`azulejo-tile rounded-xl border bg-river-panel p-4 transition-transform hover:-translate-y-0.5 ${atenuada ? 'opacity-60' : ''}`}
      style={{ borderColor: nivel === 'NORMAL' ? 'var(--edge)' : acento }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-reed">
          {nombre}
        </span>
        {nivel !== 'NORMAL' && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: acento, border: `1px solid ${acento}` }}
          >
            {etiquetaNivel(nivel)}
          </span>
        )}
      </div>

      <div className="tabular mt-2 font-mono text-mist" style={{ fontSize: 44, lineHeight: 1.1 }}>
        {fmtNumero(valor, decimales)}
        {unidad && (
          <span className="ml-1 text-base text-reed" style={{ fontSize: 16 }}>
            {unidad}
          </span>
        )}
      </div>

      <div className="mt-2">
        <Sparkline valores={serie} color={acento} />
        <span className="text-[10px] uppercase tracking-wider text-reed">última hora</span>
      </div>
    </div>
  );
}
