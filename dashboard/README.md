# Dashboard — Estación Ambiental Iquitos

Frontend del proyecto: Vite + React + TypeScript + Tailwind, con Recharts (gráficas + brush)
y Leaflet/OpenStreetMap (mapa). Consume la API REST del backend con **rutas relativas** y se
sirve **desde el mismo Express** de la API (mismo origen → sin CORS ni contenido mixto).

Diseño: "observatorio ambiental de una ciudad fluvial" — tema oscuro *río al anochecer* /
claro *río al amanecer* (toggle sol/luna, persistido), tarjetas de valores tipo **azulejo**
(guiño a las fachadas del caucho de Iquitos), tipografía Space Grotesk + IBM Plex.

## Desarrollo (Windows / cualquier PC)

```bash
cd dashboard
npm install
npm run dev        # abre Vite en http://localhost:5173
```

En desarrollo, las llamadas `/api/*` se **proxean al backend en producción**
(`http://163.176.139.242:3000`, ver `vite.config.ts`). Para apuntar a un backend local:

```bash
VITE_API_TARGET=http://localhost:3000 npm run dev
```

## Build y despliegue

La VM de 1 GB **no compila** el frontend: el build se hace en la PC de desarrollo y
**`dashboard/dist/` se commitea al repo**. El backend lo sirve automáticamente con
`express.static` si la carpeta existe.

```bash
npm run build      # type-check + genera dashboard/dist/
git add dist && git commit && git push
```

En la VM:

```bash
cd ~/estacion_ambiental_iquitos
git pull
sudo systemctl restart estacion-backend
# el dashboard queda en http://163.176.139.242:3000/
```

## Estructura

```
src/
├── config/         # umbrales del firmware v2.5, coords de respaldo, MOBILE_MODE, polling
├── lib/            # cliente de la API tipado, formateo es-PE, niveles de alerta
├── hooks/          # usePolling (con pausa en pestaña oculta), useTheme
├── components/
│   ├── StatusBar.tsx        # hero: estado vivo, ripple, toggle de tema
│   ├── MetricTile.tsx       # tarjeta azulejo + sparkline SVG
│   ├── TimeSeriesPanel.tsx  # Recharts: rangos, fechas, toggles, brush, umbrales
│   ├── AlertHistory.tsx     # episodios con duración y filtros
│   ├── StationMap.tsx       # Leaflet: posición viva, trayectoria, fallback Iquitos
│   ├── CommandPanel.tsx     # gate de token (solo memoria) + modales + toasts
│   └── ui/                  # Modal (focus trap + Esc), Skeleton, iconos SVG
└── styles/         # tokens de ambos temas, patrón azulejo, ripple, reduced-motion
```

## Decisiones clave

- **Token de comandos:** nunca se incrusta en el build ni se persiste; se pide al operador
  ("Desbloquear controles") y vive solo en memoria. `401` → se vuelve a pedir.
- **Umbrales** (`src/config/index.ts`): copiados 1:1 del firmware v2.5 para que el color del
  dashboard diga lo mismo que los LEDs físicos. Los de humedad están adaptados a Iquitos
  (80–95 % es lo normal); no "corregirlos".
- **Estación móvil:** el mapa lee la posición de `/api/status.posicion` (fallback: centro de
  Iquitos) y con `MOBILE_MODE` dibuja la trayectoria de `/api/track` y reencuadra.
- **Accesibilidad:** foco visible, modales con trap + Esc, `prefers-reduced-motion` respetado,
  contraste AA en ambos temas.
