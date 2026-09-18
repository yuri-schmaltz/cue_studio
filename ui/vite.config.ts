import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Environment files must be loaded before resolving the development proxy.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = process.env.MAESTRO_BACKEND_PORT || process.env.VITE_BACKEND_PORT
    || env.MAESTRO_BACKEND_PORT || env.VITE_BACKEND_PORT || '7860'
  if (!/^\d+$/.test(backendPort) || Number(backendPort) < 1 || Number(backendPort) > 65535) {
    throw new Error('Invalid Maestro backend port')
  }
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 3000,
      proxy: {
        '/api': `http://127.0.0.1:${backendPort}`,
      },
    },
    // Strip console.* and debugger statements from the production bundle.
    // Dev mode (npm run dev) is unaffected — esbuild `drop` only runs at
    // build time.
    esbuild: {
      drop: ['console', 'debugger'],
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // 800 kB per chunk — gentle enough that the main entry + a couple of
      // feature chunks pass without warnings, tight enough that future
      // regressions are still flagged early.
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          // No manualChunks here on purpose. The useStore + studio slices
          // form a tightly coupled cycle (useStore imports each slice,
          // each slice imports AppState from useStore) and any attempt
          // to split them into separate chunks crashes the runtime with
          // a TDZ ReferenceError because Rollup evaluates one half
          // before the other has finished initializing.
          //
          // The cost of the monolithic bundle is a slower initial paint
          // — acceptable for an internal creative tool where first-load
          // UX is dominated by backend warm-up anyway. The previous
          // chunked attempts broke the app entirely, which is not.
          manualChunks: undefined,
        },
      },
    },
  }
})