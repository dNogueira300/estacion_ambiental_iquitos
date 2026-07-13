import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo, /api se proxea al backend en producción (o a uno local si
// se cambia el target). En producción el dashboard se sirve desde el mismo
// Express que la API, así que las rutas relativas funcionan sin proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://163.176.139.242:3000',
        changeOrigin: true,
      },
    },
  },
});
