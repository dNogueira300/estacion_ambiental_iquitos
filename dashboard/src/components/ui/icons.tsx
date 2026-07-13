/** Iconos SVG inline (currentColor), sin librerías. */

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function IconLuna() {
  return (
    <svg {...base}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function IconSol() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
    </svg>
  );
}

export function IconWifi() {
  return (
    <svg {...base}>
      <path d="M5 12.5a10 10 0 0 1 14 0M8.5 15.7a5.5 5.5 0 0 1 7 0M2 9a15 15 0 0 1 20 0" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCalibrar() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
    </svg>
  );
}

export function IconCandado({ abierto = false }: { abierto?: boolean }) {
  return (
    <svg {...base}>
      <rect x="4" y="11" width="16" height="9" rx="2" />
      {abierto ? <path d="M8 11V7a4 4 0 0 1 7.7-1.5" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
    </svg>
  );
}

export function IconAlerta() {
  return (
    <svg {...base}>
      <path d="M12 3 2.5 20h19L12 3z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCerrar() {
  return (
    <svg {...base}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
