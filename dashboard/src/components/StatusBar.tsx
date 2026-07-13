import type { Estado, Lectura } from '../lib/api';
import { fmtCoord, fmtHace } from '../lib/format';
import { colorNivel, etiquetaNivel, type Nivel } from '../lib/levels';
import { DEFAULT_STATION_COORDS } from '../config';
import { IconLuna, IconSol } from './ui/icons';
import type { Tema } from '../hooks/useTheme';
import { Skeleton } from './ui/Skeleton';

interface Props {
  status: Estado | null;
  latest: Lectura | null;
  cargando: boolean;
  errorRed: string | null;
  ahora: number;
  tema: Tema;
  alternarTema: () => void;
}

/** Hero = estado vivo de la estación (plan §5.1). */
export function StatusBar({ status, latest, cargando, errorRed, ahora, tema, alternarTema }: Props) {
  const enConfig = status?.ultimoEstado === 'config';
  const online = status?.online ?? false;

  const pill = enConfig
    ? { texto: 'EN CONFIGURACIÓN', color: 'var(--sun)' }
    : online
      ? { texto: 'EN LÍNEA', color: 'var(--canopy)' }
      : { texto: 'DESCONECTADA', color: 'var(--reed)' };

  const nivel = (latest?.nivel as Nivel) || 'NORMAL';
  const lat = status?.posicion?.lat ?? DEFAULT_STATION_COORDS[0];
  const lon = status?.posicion?.lon ?? DEFAULT_STATION_COORDS[1];

  return (
    <header className="rounded-xl border border-edge bg-river-panel px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {cargando ? (
            <Skeleton className="h-7 w-40" />
          ) : (
            <span
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold tracking-widest"
              style={{ color: pill.color, borderColor: pill.color }}
            >
              <span
                className={online && !enConfig ? 'ripple-dot' : undefined}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 9999,
                  background: pill.color,
                  color: pill.color,
                  display: 'inline-block',
                }}
                aria-hidden="true"
              />
              {pill.texto}
            </span>
          )}
          <h1 className="font-display text-lg font-bold tracking-wide text-mist sm:text-xl">
            ESTACIÓN AMBIENTAL — IQUITOS
          </h1>
        </div>
        <button
          onClick={alternarTema}
          aria-label={tema === 'dark' ? 'tema oscuro activo, cambiar a claro' : 'tema claro activo, cambiar a oscuro'}
          title={tema === 'dark' ? 'Tema: río al anochecer' : 'Tema: río al amanecer'}
          className="rounded-full border border-edge p-2 text-reed hover:text-mist"
        >
          {tema === 'dark' ? <IconLuna /> : <IconSol />}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-reed">
        {cargando ? (
          <Skeleton className="h-4 w-72" />
        ) : (
          <>
            <span className="tabular font-mono">
              Última lectura {fmtHace(status?.ultimaLectura, ahora)}
            </span>
            {latest?.rssi != null && (
              <span className="tabular font-mono">RSSI {latest.rssi} dBm</span>
            )}
            <span>{latest?.cal ? 'Calibrada' : latest ? 'Sin calibrar' : ''}</span>
            <span className="tabular font-mono">
              Loreto · {fmtCoord(lat)}, {fmtCoord(lon)}
            </span>
            {latest && (
              <span style={{ color: colorNivel(nivel) }}>
                Estado {etiquetaNivel(nivel)}
                {nivel !== 'NORMAL' && latest.causa ? ` · ${latest.causa.trim()}` : ''}
              </span>
            )}
          </>
        )}
      </div>

      {!cargando && errorRed && (
        <p className="mt-2 text-sm" style={{ color: 'var(--sun)' }}>
          No se pudo conectar con la estación. Reintentando…
        </p>
      )}
      {!cargando && !errorRed && !online && !enConfig && (
        <p className="mt-2 text-sm text-reed">
          Sin datos recientes. Los valores muestran la última lectura conocida.
        </p>
      )}
    </header>
  );
}
