import { defineConfig } from 'tsup'

export default defineConfig({
  // Two entries, and `splitting: false` below keeps them independent: the testing
  // bundle must not pull runtime code out of the main one (duplicate class identities).
  entry: ['src/index.ts', 'src/testing/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  dts: false,
  clean: false,
  sourcemap: true,
  splitting: false,
  treeshake: true,
})
