import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  dts: false,
  clean: false,
  sourcemap: true,
  splitting: false,
  treeshake: true,
})
