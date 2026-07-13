import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Estado, Lectura } from '../lib/api';
import { getTrack } from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import { DEFAULT_STATION_COORDS, MOBILE_MODE, METRICAS } from '../config';
import { colorNivel, type Nivel } from '../lib/levels';
import { fmtFechaHora, fmtNumero } from '../lib/format';

/** Marcador coloreado según nivel (divIcon → hereda tokens CSS) */
function iconoEstacion(nivel: Nivel): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<span class="station-marker" style="background:${colorNivel(nivel)}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

/** Reencuadra el mapa cuando la estación sale del encuadre (modo móvil) */
function Reencuadre({ pos }: { pos: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (!map.getBounds().contains(pos)) {
      map.panTo(pos);
    }
  }, [map, pos]);
  return null;
}

interface Props {
  status: Estado | null;
  latest: Lectura | null;
}

export function StationMap({ status, latest }: Props) {
  const pos: [number, number] = status?.posicion
    ? [status.posicion.lat, status.posicion.lon]
    : DEFAULT_STATION_COORDS;
  const nivel = (latest?.nivel as Nivel) || 'NORMAL';

  const { data: track } = usePolling(
    () => (MOBILE_MODE ? getTrack(24) : Promise.resolve([])),
    60_000
  );

  const trayectoria: [number, number][] = useMemo(
    () => (track ?? []).map((p) => [p.lat, p.lon]),
    [track]
  );

  return (
    <section className="flex min-h-[380px] flex-col overflow-hidden rounded-xl border border-edge bg-river-panel">
      <div className="flex items-center justify-between px-4 pt-4 sm:px-5">
        <h2 className="font-display text-lg font-medium text-mist sm:text-xl">
          Mapa de Iquitos
        </h2>
        {!status?.posicion && (
          <span className="text-xs text-reed">posición aproximada (sin GPS)</span>
        )}
      </div>
      <div className="mt-3 flex-1" style={{ minHeight: 320 }}>
        <MapContainer
          center={pos}
          zoom={13}
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {MOBILE_MODE && trayectoria.length > 1 && (
            <Polyline
              positions={trayectoria}
              pathOptions={{ color: 'var(--azulejo)', weight: 3, opacity: 0.7, dashArray: '6 6' }}
            />
          )}
          <Marker position={pos} icon={iconoEstacion(nivel)}>
            <Popup>
              <div className="font-sans text-sm">
                <p className="font-display font-medium">Estación Iquitos</p>
                {latest ? (
                  <>
                    {METRICAS.map((m) => (
                      <p key={m.key} className="tabular font-mono text-xs">
                        {m.nombre}: {fmtNumero(latest[m.key], m.decimales)} {m.unidad}
                      </p>
                    ))}
                    <p className="mt-1 text-xs" style={{ color: colorNivel(nivel) }}>
                      {nivel.toLowerCase()}
                      {latest.causa && latest.causa !== 'OK' ? ` · ${latest.causa.trim()}` : ''}
                    </p>
                    <p className="tabular font-mono text-xs">{fmtFechaHora(latest.ts)}</p>
                  </>
                ) : (
                  <p className="text-xs">sin datos aún</p>
                )}
              </div>
            </Popup>
          </Marker>
          {MOBILE_MODE && <Reencuadre pos={pos} />}
        </MapContainer>
      </div>
    </section>
  );
}
