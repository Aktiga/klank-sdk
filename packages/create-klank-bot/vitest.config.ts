import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const sdkSource = fileURLToPath(new URL('../sdk/src/index.ts', import.meta.url))
const sdkTestingSource = fileURLToPath(new URL('../sdk/src/testing/index.ts', import.meta.url))

// Templates are exercised against the workspace SDK source, so nothing has to be
// published or built for their tests to run here.
const include = ['test/**/*.test.ts', 'templates/*/test/*.test.ts']

export default defineConfig({
  resolve: {
    alias: [
      { find: '@klank/sdk/testing', replacement: sdkTestingSource },
      { find: '@klank/sdk', replacement: sdkSource },
    ],
  },
  test: {
    include,
    environment: 'node',
    globals: false,
  },
})
