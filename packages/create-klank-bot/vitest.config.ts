import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const sdkSource = fileURLToPath(new URL('../sdk/src/index.ts', import.meta.url))
const sdkTestingSource = fileURLToPath(new URL('../sdk/src/testing/index.ts', import.meta.url))

// The echo template's test needs `@klank/sdk/testing`, which ships with the SDK
// bot-model work. Run it only once that module exists so this package stays green
// on its own; the SDK aliases point at source so no build step is needed.
const include = [
  'test/**/*.test.ts',
  'templates/webhook-poster/test/*.test.ts',
  'templates/slash-receiver/test/*.test.ts',
]
if (existsSync(sdkTestingSource)) include.push('templates/echo/test/*.test.ts')

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
