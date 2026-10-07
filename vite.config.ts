import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const backend = `http://127.0.0.1:${process.env.LEAF_PORT ?? '3000'}`;
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', sourcemap: false },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': backend,
      '/healthz': backend,
      '/readyz': backend,
    },
  },
});
