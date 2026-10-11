import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: { chunkSizeWarningLimit: 2500, outDir: '../../dist/renderer', emptyOutDir: true },
  test: { root: '.', include: ['tests/**/*.test.ts'] },
})
