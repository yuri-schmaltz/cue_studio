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
      rollupOptions: {
        onwarn(warning, warn) {
          if (warning.code === 'CIRCULAR_CHUNK' || warning.code === 'CYCLIC_CROSS_CHUNK_REEXPORT') {
            throw new Error(warning.message)
          }
          warn(warning)
        },
        output: {
          // Keep shared dependencies out of route chunks. Grouping the
          // editor store with its entire UI made shell banners load the
          // whole editor at startup and pulled common code into that chunk.
          manualChunks(id) {
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor'
            if (id.includes('/src/api/')) return 'api-client'
            // Pure utilities are shared by the root and Studio slices. Keep
            // them below both layers instead of assigning them to the root,
            // which would make the emitted chunks import each other.
            if (/\/src\/lib\/(h3Memory|durationPlanning|generationPlan|reviewSnapshot|promptHistory)\.ts$/.test(id)
              || /\/src\/stores\/(modelCatalog|loraState|utils|projectAdvancedDefaults|studioModelRuntime)\.ts$/.test(id)
              || id.endsWith('/src/types/index.ts')) return 'state-utils'
            if (/\/src\/stores\/studio/.test(id)) return 'studio-state'
            if (id.includes('/src/stores/') && !/\/(outputRestoration|directorSubmission)/.test(id)) return 'app-state'
            if (/\/Sidebar\/(AdvancedSettings|PostProcessing|OutputCodecs|ControlVideoSection)\.tsx$/.test(id)) return 'studio-advanced'
            if (/\/Sidebar\/(AudioModeSection|MusicControls|SfxControls|MixerControls)\.tsx$/.test(id)) return 'studio-audio'
            return undefined
          },
        },
      },
      chunkSizeWarningLimit: 220,
    },
  }
})
