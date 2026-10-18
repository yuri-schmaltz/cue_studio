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
      // chunkSizeWarningLimit lowered to 220 (A20 budget); warnings are advisory.
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/src/editor/') || id.includes('useEditorStore')) return 'editor'
            if (id.includes('/src/components/Notification') || id.includes('Banner')) return 'notifications'
            return undefined
          },
        },
      },
      chunkSizeWarningLimit: 220,
    },
  }
})