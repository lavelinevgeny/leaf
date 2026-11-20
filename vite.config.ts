import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const backend = `http://127.0.0.1:${process.env.LEAF_PORT ?? '3000'}`;
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', sourcemap: false },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.LEAF_DEV_PORT ?? '5173'),
    strictPort: true,
    watch: {
      ignored: [
        '**/.tmp/**',
        '**/.superpowers/**',
        '**/{.worktrees,worktrees}/**',
        '**/{.codex,.claude,.tools}/**',
        '**/{.data,data,secrets,.private,.local,backups,exports,uploads,logs}/**',
        '**/{dist,build,coverage,artifacts,screenshots,playwright-report,blob-report}/**',
      ],
    },
    proxy: {
      '/api': backend,
      '/healthz': backend,
      '/readyz': backend,
    },
  },
});
