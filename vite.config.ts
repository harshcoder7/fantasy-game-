/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: { chunkSizeWarningLimit: 1600 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
