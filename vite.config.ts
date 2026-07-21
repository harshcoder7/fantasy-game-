/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // three.js barely ever changes between releases and dwarfs the app code
        // (~600KB of ~700KB); its own chunk lets browsers cache it across deploys
        // instead of re-downloading it whenever app code changes.
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three'
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
