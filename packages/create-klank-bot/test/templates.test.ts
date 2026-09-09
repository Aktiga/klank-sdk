import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { TEMPLATES, scaffold } from '../src/scaffold.js'

const require = createRequire(import.meta.url)

const worktreeRoot = fileURLToPath(new URL('../../..', import.meta.url))
const sdkEntry = join(worktreeRoot, 'packages/sdk/src/index.ts')
const sdkTestingEntry = join(worktreeRoot, 'packages/sdk/src/testing/index.ts')
/** `…/node_modules/@types`, so `types: ['node']` resolves from a temp directory. */
const typeRoots = [dirname(dirname(require.resolve('@types/node/package.json')))]
const vitestTypes = join(dirname(require.resolve('vitest/package.json')), 'dist/index.d.ts')

/**
 * `@klank/sdk/testing` (the `MockKlank` harness the echo template's test uses)
 * lands with the SDK bot-model work. While it is absent, the echo template may
 * only report the unresolved import itself — nothing else is tolerated, and the
 * tolerance disappears the moment the module exists.
 */
const sdkTestingMissing = !existsSync(sdkTestingEntry)

// Mirrors templates/*/tsconfig.json, with the workspace SDK source substituted
// for the published package so templates are checked against the code in this
// repo rather than whatever is on npm.
const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts'],
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noUncheckedIndexedAccess: true,
  verbatimModuleSyntax: true,
  esModuleInterop: true,
  skipLibCheck: true,
  noEmit: true,
  types: ['node'],
  typeRoots,
  baseUrl: worktreeRoot,
  paths: {
    '@klank/sdk': [sdkEntry],
    '@klank/sdk/testing': [sdkTestingEntry],
    vitest: [vitestTypes],
  },
}

const created: string[] = []

afterEach(async () => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

interface Reported {
  file: string
  code: number
  message: string
}

function typecheck(dir: string, files: string[]): Reported[] {
  const program = ts.createProgram({ rootNames: files.map((file) => join(dir, file)), options })
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    file: diagnostic.file ? diagnostic.file.fileName.slice(dir.length + 1) : '(options)',
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
  }))
}

describe('template typecheck', () => {
  it('has the SDK source the templates are checked against', () => {
    expect(existsSync(sdkEntry)).toBe(true)
    expect(existsSync(vitestTypes)).toBe(true)
    expect(existsSync(join(typeRoots[0] ?? '', 'node/package.json'))).toBe(true)
  })

  for (const template of TEMPLATES) {
    it(`typechecks the scaffolded ${template.name} project`, async () => {
      const dir = join(await mkdtemp(join(tmpdir(), 'ckb-tsc-')), 'app')
      created.push(dirname(dir))

      const result = await scaffold({ dir, template: template.name })
      const sources = result.files.filter((file) => file.endsWith('.ts'))
      expect(sources).toEqual(['src/index.ts', 'test/bot.test.ts'])

      const reported = typecheck(dir, sources)
      const tolerated =
        template.name === 'echo' && sdkTestingMissing
          ? reported.filter(
              (entry) => entry.code === 2307 && entry.message.includes('@klank/sdk/testing'),
            )
          : []

      expect(reported.filter((entry) => !tolerated.includes(entry))).toEqual([])
      if (template.name === 'echo' && sdkTestingMissing) {
        expect(tolerated).toHaveLength(1)
      }
    })
  }
})
