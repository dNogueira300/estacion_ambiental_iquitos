import { getLatest, getReadings, getStatus } from './lib/api';
import { usePolling, useAhora } from './hooks/usePolling';
import { useTheme } from './hooks/useTheme';
import { POLL_INTERVAL_MS, METRICAS, SHOW_MAP, STALE_MS } from './config';
import { StatusBar } from './components/StatusBar';
import { MetricTile } from './components/MetricTile';
import { TimeSeriesPanel } from './components/TimeSeriesPanel';
import { AlertHistory } from './components/AlertHistory';
import { ThresholdsPanel } from './components/ThresholdsPanel';
import { StationMap } from './components/StationMap';
import { CommandPanel } from './components/CommandPanel';

export default function App() {
  const { tema, alternar } = useTheme();
  const ahora = useAhora();

  const status = usePolling(getStatus, POLL_INTERVAL_MS);
  const latest = usePolling(getLatest, POLL_INTERVAL_MS);
  const ultimaHora = usePolling(() => getReadings({ hours: 1 }), 60_000);

  const cargando = status.loading || latest.loading;
  const sinDatosRecientes =
    !latest.data?.ts || ahora - new Date(latest.data.ts).getTime() > STALE_MS;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <StatusBar
        status={status.data}
        latest={latest.data}
        cargando={cargando}
        errorRed={status.error}
        ahora={ahora}
        tema={tema}
        alternarTema={alternar}
      />

      {/* Dos columnas en escritorio: contenido + sidebar de niveles de referencia */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {METRICAS.map((m) => (
              <MetricTile
                key={m.key}
                metric={m.key}
                nombre={m.nombre}
                unidad={m.unidad}
                decimales={m.decimales}
                latest={latest.data}
                historia={ultimaHora.data ?? []}
                cargando={cargando}
                atenuada={sinDatosRecientes}
              />
            ))}
          </div>

          <TimeSeriesPanel />

          {/* El mapa se reactiva con SHOW_MAP cuando haya posición real (GPS/WPS) */}
          <div className={`grid grid-cols-1 gap-4 ${SHOW_MAP ? 'lg:grid-cols-2' : ''}`}>
            <AlertHistory />
            {SHOW_MAP && <StationMap status={status.data} latest={latest.data} />}
          </div>

          <CommandPanel status={status.data} ahora={ahora} onComandoEnviado={status.refresh} />
        </div>

        <aside className="min-w-0 xl:sticky xl:top-4">
          <ThresholdsPanel />
        </aside>
      </div>

      <footer className="pb-2 pt-1 text-center text-xs text-reed">
        Estación Ambiental Inteligente · Iquitos, Loreto · datos abiertos para la ciudad
      </footer>
    </div>
  );
}
