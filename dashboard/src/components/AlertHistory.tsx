import { useMemo, useState } from 'react';
import { getAlerts, type Alerta } from '../lib/api';
import { usePolling, useAhora } from '../hooks/usePolling';
import { fmtDuracion, fmtFechaHora, fmtHace, fmtNumero } from '../lib/format';
import { Skeleton } from './ui/Skeleton';

type FiltroNivel = 'TODOS' | 'PRECAUCION' | 'PELIGRO';

function BadgeNivel({ nivel }: { nivel: Alerta['nivel_max'] }) {
  const color = nivel === 'PELIGRO' ? 'var(--clay)' : 'var(--sun)';
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
      style={{ color, border: `1px solid ${color}` }}
    >
      {nivel === 'PELIGRO' ? 'peligro' : 'precaución'}
    </span>
  );
}

export function AlertHistory() {
  const { data: alertas, loading } = usePolling(() => getAlerts(100), 60_000);
  const ahora = useAhora();
  const [filtroNivel, setFiltroNivel] = useState<FiltroNivel>('TODOS');
  const [desde, setDesde] = useState('');

  const filtradas = useMemo(() => {
    let lista = alertas ?? [];
    if (filtroNivel !== 'TODOS') lista = lista.filter((a) => a.nivel_max === filtroNivel);
    if (desde) {
      const d = new Date(desde).getTime();
      lista = lista.filter((a) => new Date(a.inicio_ts).getTime() >= d);
    }
    return lista;
  }, [alertas, filtroNivel, desde]);

  return (
    <section className="flex flex-col rounded-xl border border-edge bg-river-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-medium text-mist sm:text-xl">
          Historial de alertas
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {(['TODOS', 'PRECAUCION', 'PELIGRO'] as FiltroNivel[]).map((f) => (
            <button
              key={f}
              onClick={() => setFiltroNivel(f)}
              aria-pressed={filtroNivel === f}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                filtroNivel === f
                  ? 'border-azulejo text-azulejo'
                  : 'border-edge text-reed hover:text-mist'
              }`}
            >
              {f === 'TODOS' ? 'todas' : f === 'PRECAUCION' ? 'precaución' : 'peligro'}
            </button>
          ))}
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            aria-label="filtrar desde fecha"
            className="rounded-md border border-edge bg-river-deep px-2 py-0.5 font-mono text-xs text-mist"
          />
        </div>
      </div>

      <div className="mt-3 max-h-[480px] space-y-2 overflow-y-auto pr-1">
        {loading ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        ) : filtradas.length === 0 ? (
          <p className="py-8 text-center text-sm text-reed">
            {alertas && alertas.length > 0
              ? 'Ninguna alerta coincide con el filtro.'
              : 'Sin episodios de alerta registrados. Buena señal.'}
          </p>
        ) : (
          filtradas.map((a) => {
            const activa = a.fin_ts === null;
            return (
              <article
                key={a.id}
                className="rounded-lg border border-edge bg-river-deep px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {activa && (
                    <span
                      className="pulse-dot inline-block h-2 w-2 rounded-full"
                      style={{ background: 'var(--clay)' }}
                      aria-label="episodio activo"
                    />
                  )}
                  <BadgeNivel nivel={a.nivel_max} />
                  <span className="text-sm text-mist">{(a.causa ?? '').trim() || '—'}</span>
                  <span className="tabular ml-auto font-mono text-xs text-reed">
                    {activa
                      ? `activa · lleva ${fmtDuracion(a.inicio_ts, a.fin_ts, ahora)}`
                      : `${fmtHace(a.inicio_ts, ahora)} · duró ${fmtDuracion(a.inicio_ts, a.fin_ts, ahora)}`}
                  </span>
                </div>
                <p className="tabular mt-1 font-mono text-xs text-reed">
                  {fmtFechaHora(a.inicio_ts)} → {activa ? 'ahora' : fmtFechaHora(a.fin_ts)}
                </p>
                <p className="tabular mt-1 font-mono text-xs text-reed">
                  {fmtNumero(a.temp, 1)}°C · {fmtNumero(a.hum, 0)}% · CO {fmtNumero(a.co, 1)} ·
                  aire {fmtNumero(a.co2, 0)} · UV {fmtNumero(a.uv, 1)}
                </p>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
