import { useEffect, useMemo, useState } from 'react';
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getReadings, type Lectura } from '../lib/api';
import { METRICAS, UMBRALES, type MetricKey } from '../config';
import { fmtFechaHora, fmtHora, fmtNumero } from '../lib/format';
import { Skeleton } from './ui/Skeleton';

/** Colores de serie (categóricos, no semánticos; legibles en ambos temas) */
const COLOR_SERIE: Record<MetricKey, string> = {
  temp: '#e0755a',
  hum: '#3a9bd8',
  co: '#a47de0',
  co2: '#3fb98b',
  uv: '#d6a73c',
};

type Rango =
  | { tipo: 'horas'; horas: number }
  | { tipo: 'custom'; desde: string; hasta: string };

const CHIPS: { etiqueta: string; horas: number }[] = [
  { etiqueta: '1h', horas: 1 },
  { etiqueta: '6h', horas: 6 },
  { etiqueta: '24h', horas: 24 },
  { etiqueta: '7d', horas: 168 },
];

interface Punto {
  t: number;
  temp: number | null;
  hum: number | null;
  co: number | null;
  co2: number | null;
  uv: number | null;
}

function TooltipPanel({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number | string }[];
  label?: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-edge bg-river-panel px-3 py-2 text-sm shadow-lg">
      <p className="tabular mb-1 font-mono text-xs text-reed">
        {fmtFechaHora(label ? new Date(label).toISOString() : null)}
      </p>
      {payload.map((p) => {
        const m = METRICAS.find((x) => x.key === p.dataKey);
        if (!m) return null;
        return (
          <p key={String(p.dataKey)} className="tabular font-mono">
            <span style={{ color: COLOR_SERIE[m.key] }}>● </span>
            <span className="text-reed">{m.nombre}: </span>
            <span className="text-mist">
              {fmtNumero(typeof p.value === 'number' ? p.value : null, m.decimales)} {m.unidad}
            </span>
          </p>
        );
      })}
    </div>
  );
}

export function TimeSeriesPanel() {
  const [rango, setRango] = useState<Rango>({ tipo: 'horas', horas: 24 });
  const [visibles, setVisibles] = useState<Set<MetricKey>>(
    () => new Set<MetricKey>(['temp', 'hum', 'co2'])
  );
  const [datos, setDatos] = useState<Lectura[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [desdeInput, setDesdeInput] = useState('');
  const [hastaInput, setHastaInput] = useState('');

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    const params =
      rango.tipo === 'horas'
        ? { hours: rango.horas }
        : {
            from: new Date(rango.desde).toISOString(),
            to: new Date(rango.hasta).toISOString(),
          };
    getReadings(params)
      .then((r) => {
        if (vivo) setDatos(r);
      })
      .catch(() => {
        if (vivo) setError('No se pudo cargar la serie. Reintentando…');
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [rango]);

  // Reintento automático ante error de red
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setRango((r) => ({ ...r })), 15000);
    return () => clearTimeout(id);
  }, [error]);

  const puntos: Punto[] = useMemo(
    () =>
      (datos ?? []).map((l) => ({
        t: new Date(l.ts).getTime(),
        temp: l.temp,
        hum: l.hum,
        co: l.co,
        co2: l.co2,
        uv: l.uv,
      })),
    [datos]
  );

  function toggleSensor(k: MetricKey) {
    setVisibles((prev) => {
      const s = new Set(prev);
      if (s.has(k)) {
        if (s.size > 1) s.delete(k); // siempre al menos una serie visible
      } else {
        s.add(k);
      }
      return s;
    });
  }

  const unicaVisible = visibles.size === 1 ? [...visibles][0] : null;
  const co2Visible = visibles.has('co2');
  const otrasVisibles = [...visibles].filter((k) => k !== 'co2');

  // Formato de tick según la amplitud del rango: con más de 48 h las horas
  // solas son ambiguas, se muestra día+hora
  const spanMs = puntos.length > 1 ? puntos[puntos.length - 1].t - puntos[0].t : 0;
  const fmtTick = (t: number) => {
    const d = new Date(t);
    if (spanMs > 48 * 3600 * 1000) {
      return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
    }
    return fmtHora(d.toISOString());
  };

  function aplicarCustom() {
    if (!desdeInput || !hastaInput) return;
    setRango({ tipo: 'custom', desde: desdeInput, hasta: hastaInput });
  }

  return (
    <section className="rounded-xl border border-edge bg-river-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-medium text-mist sm:text-xl">
          Serie temporal
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {CHIPS.map((c) => {
            const activo = rango.tipo === 'horas' && rango.horas === c.horas;
            return (
              <button
                key={c.etiqueta}
                onClick={() => setRango({ tipo: 'horas', horas: c.horas })}
                aria-pressed={activo}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  activo
                    ? 'border-azulejo text-azulejo'
                    : 'border-edge text-reed hover:text-mist'
                }`}
              >
                {c.etiqueta}
              </button>
            );
          })}
        </div>
      </div>

      {/* Rango personalizado */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="text-reed">
          desde{' '}
          <input
            type="datetime-local"
            value={desdeInput}
            onChange={(e) => setDesdeInput(e.target.value)}
            className="rounded-md border border-edge bg-river-deep px-2 py-1 font-mono text-mist"
          />
        </label>
        <label className="text-reed">
          hasta{' '}
          <input
            type="datetime-local"
            value={hastaInput}
            onChange={(e) => setHastaInput(e.target.value)}
            className="rounded-md border border-edge bg-river-deep px-2 py-1 font-mono text-mist"
          />
        </label>
        <button
          onClick={aplicarCustom}
          disabled={!desdeInput || !hastaInput}
          className="rounded-full border border-azulejo px-3 py-1 text-azulejo disabled:opacity-40"
        >
          Aplicar
        </button>
        {rango.tipo === 'custom' && (
          <span className="text-reed">
            mostrando rango personalizado ·{' '}
            <button
              onClick={() => setRango({ tipo: 'horas', horas: 24 })}
              className="text-azulejo underline"
            >
              volver a 24h
            </button>
          </span>
        )}
      </div>

      {/* Toggles de sensores */}
      <div className="mt-3 flex flex-wrap gap-2">
        {METRICAS.map((m) => {
          const activo = visibles.has(m.key);
          return (
            <button
              key={m.key}
              onClick={() => toggleSensor(m.key)}
              aria-pressed={activo}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                activo ? 'border-edge text-mist' : 'border-edge text-reed opacity-50'
              }`}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 9999,
                  background: COLOR_SERIE[m.key],
                  display: 'inline-block',
                }}
              />
              {m.nombre}
            </button>
          );
        })}
      </div>

      <div className="mt-4 h-[320px]">
        {cargando ? (
          <Skeleton className="h-full w-full" />
        ) : error ? (
          <div className="flex h-full items-center justify-center text-reed">{error}</div>
        ) : puntos.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-reed">
            No hay lecturas en este rango. Prueba con un periodo más amplio.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={puntos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--edge)" strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                domain={['dataMin', 'dataMax']}
                scale="time"
                tickFormatter={fmtTick}
                stroke="var(--reed)"
                tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                minTickGap={64}
                tickMargin={8}
                interval="preserveStartEnd"
              />
              {otrasVisibles.length > 0 && (
                <YAxis
                  yAxisId="izq"
                  stroke="var(--reed)"
                  tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                  width={44}
                />
              )}
              {co2Visible && (
                <YAxis
                  yAxisId="co2"
                  orientation="right"
                  stroke={COLOR_SERIE.co2}
                  tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                  width={48}
                />
              )}
              <Tooltip content={<TooltipPanel />} />
              {METRICAS.filter((m) => visibles.has(m.key)).map((m) => (
                <Line
                  key={m.key}
                  yAxisId={m.key === 'co2' ? 'co2' : 'izq'}
                  type="monotone"
                  dataKey={m.key}
                  stroke={COLOR_SERIE[m.key]}
                  strokeWidth={1.8}
                  dot={false}
                  activeDot={{ r: 3 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
              {/* Líneas de umbral: solo con una serie visible (legibilidad) */}
              {unicaVisible &&
                UMBRALES[unicaVisible].lineas.map((u) => (
                  <ReferenceLine
                    key={u.etiqueta}
                    yAxisId={unicaVisible === 'co2' ? 'co2' : 'izq'}
                    y={u.valor}
                    stroke={u.nivel === 'PELIGRO' ? 'var(--clay)' : 'var(--sun)'}
                    strokeDasharray="6 4"
                    label={{
                      value: u.etiqueta,
                      position: 'insideTopRight',
                      fill: u.nivel === 'PELIGRO' ? 'var(--clay)' : 'var(--sun)',
                      fontSize: 11,
                    }}
                  />
                ))}
              <Brush
                dataKey="t"
                height={26}
                travellerWidth={10}
                stroke="var(--azulejo)"
                fill="var(--river-deep)"
                tickFormatter={fmtTick}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      {unicaVisible === null && (
        <p className="mt-2 text-xs text-reed">
          Las líneas de umbral se muestran al dejar visible un solo sensor.
        </p>
      )}
    </section>
  );
}
