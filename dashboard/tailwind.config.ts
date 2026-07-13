import type { Config } from 'tailwindcss';

// Paleta "río al anochecer / río al amanecer" (plan §2.2 y §2.6).
// Los valores viven como variables CSS en styles/index.css (data-theme),
// aquí solo se mapean a utilidades. Nada de colores hardcodeados en JSX.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'river-deep': 'var(--river-deep)',
        'river-panel': 'var(--river-panel)',
        reed: 'var(--reed)',
        mist: 'var(--mist)',
        canopy: 'var(--canopy)',
        azulejo: 'var(--azulejo)',
        sun: 'var(--sun)',
        clay: 'var(--clay)',
        edge: 'var(--edge)',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
