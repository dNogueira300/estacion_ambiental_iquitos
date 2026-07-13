import { METRICAS, RANGOS } from '../config';

/**
 * Panel de referencia: qué significa cada nivel por sensor.
 * Misma fuente de umbrales que las tarjetas y el firmware (config §UMBRALES).
 */

function Fila({
  color,
  etiqueta,
  texto,
}: {
  color: string;
  etiqueta: string;
  texto: string;
}) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 shrink-0 translate-y-[-1px] rounded-full"
        style={{ background: color }}
      />
      <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wider" style={{ color }}>
        {etiqueta}
      </span>
      <span className="tabular font-mono text-xs text-mist">{texto}</span>
    </div>
  );
}

export function ThresholdsPanel() {
  return (
    <section className="flex min-h-[380px] flex-col rounded-xl border border-edge bg-river-panel p-4 sm:p-5">
      <h2 className="font-display text-lg font-medium text-mist sm:text-xl">
        Niveles de referencia
      </h2>
      <p className="mt-1 text-xs text-reed">
        Los mismos umbrales que usan la estación (LEDs) y las tarjetas de arriba.
      </p>

      <div className="mt-3 grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
        {METRICAS.map((m) => {
          const r = RANGOS[m.key];
          return (
            <article key={m.key} className="rounded-lg border border-edge bg-river-deep px-3 py-2.5">
              <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-reed">
                {m.nombre}
                {m.unidad && <span className="ml-1 normal-case">({m.unidad})</span>}
              </h3>
              <div className="mt-2 space-y-1.5">
                <Fila color="var(--canopy)" etiqueta="bueno" texto={r.bueno} />
                <Fila color="var(--sun)" etiqueta="precaución" texto={r.precaucion} />
                <Fila color="var(--clay)" etiqueta="peligro" texto={r.peligro} />
              </div>
              {r.nota && <p className="mt-2 text-[11px] leading-snug text-reed">{r.nota}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
