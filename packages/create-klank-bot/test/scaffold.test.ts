import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TEMPLATES, scaffold, toPackageName } from '../src/scaffold.js'

const created: string[] = []

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ckb-'))
  created.push(dir)
  return dir
}

afterEach(async () => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

/** Every file in the tree, as `/`-separated paths relative to `root`, sorted. */
async function tree(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

/**
 * The range a template pins `@klank/sdk` to must resolve to the next published SDK: the
 * workspace version, bumped once when a pending changeset declares a `minor` for it.
 * A future minor changeset reds this until the templates are bumped with it.
 */
async function expectedSdkRange(): Promise<string> {
  const sdk = JSON.parse(
    await readFile(new URL('../../sdk/package.json', import.meta.url), 'utf8'),
  ) as { version: string }
  const match = /^(\d+)\.(\d+)\.\d+$/.exec(sdk.version)
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new Error(`unexpected @klank/sdk version ${sdk.version}`)
  }
  const changesets = new URL('../../../.changeset/', import.meta.url)
  let bumpMinor = false
  for (const file of await readdir(changesets)) {
    if (!file.endsWith('.md')) continue
    const text = await readFile(new URL(file, changesets), 'utf8')
    if (/^["']@klank\/sdk["']:\s*minor\s*$/m.test(text)) bumpMinor = true
  }
  return bumpMinor ? `^${match[1]}.${Number(match[2]) + 1}.0` : `^${sdk.version}`
}

const EXPECTED_FILES = [
  '.env.example',
  'README.md',
  'package.json',
  'src/index.ts',
  'test/bot.test.ts',
  'tsconfig.json',
]

describe('TEMPLATES', () => {
  it('offers the three documented templates, each with a description', () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual(['echo', 'webhook-poster', 'slash-receiver'])
    for (const template of TEMPLATES) {
      expect(template.description.length).toBeGreaterThan(10)
    }
  })
})

describe('toPackageName', () => {
  it('makes an npm-safe name out of a directory basename', () => {
    expect(toPackageName('My Bot!')).toBe('my-bot')
    expect(toPackageName('Klank__Deploy Bot')).toBe('klank-deploy-bot')
    expect(toPackageName('.hidden')).toBe('hidden')
    expect(toPackageName('bot')).toBe('bot')
  })

  it('falls back to a usable name when nothing survives sanitizing', () => {
    expect(toPackageName('...')).toBe('klank-bot')
    expect(toPackageName('')).toBe('klank-bot')
  })
})

describe('scaffold', () => {
  for (const template of TEMPLATES) {
    it(`writes a complete ${template.name} project`, async () => {
      const dir = join(await tmp(), 'app')

      const result = await scaffold({ dir, template: template.name })

      expect(result.template).toBe(template.name)
      expect(result.name).toBe('app')
      expect(result.files).toEqual(EXPECTED_FILES)
      expect(await tree(dir)).toEqual(EXPECTED_FILES)
    })

    it(`replaces __NAME__ everywhere in the ${template.name} project`, async () => {
      const dir = join(await tmp(), 'app')

      await scaffold({ dir, template: template.name, name: 'my-klank-bot' })

      for (const file of await tree(dir)) {
        expect(await readFile(join(dir, file), 'utf8')).not.toContain('__NAME__')
      }
      const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
        name: string
        scripts: Record<string, string>
        dependencies: Record<string, string>
      }
      expect(manifest.name).toBe('my-klank-bot')
      expect(manifest.scripts.test).toBe('vitest run')
      expect(manifest.dependencies['@klank/sdk']).toBe(await expectedSdkRange())
      expect(await readFile(join(dir, 'README.md'), 'utf8')).toContain('my-klank-bot')
    })
  }

  it('derives an npm-safe default name from the directory basename', async () => {
    const dir = join(await tmp(), 'My Bot!')

    const result = await scaffold({ dir, template: 'echo' })

    expect(result.name).toBe('my-bot')
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
      name: string
    }
    expect(manifest.name).toBe('my-bot')
  })

  it('accepts an existing empty directory', async () => {
    const dir = join(await tmp(), 'app')
    await mkdir(dir, { recursive: true })

    await expect(scaffold({ dir, template: 'echo' })).resolves.toMatchObject({ name: 'app' })
  })

  it('refuses a non-empty directory and leaves it untouched', async () => {
    const dir = await tmp()
    await writeFile(join(dir, 'keep.txt'), 'mine')

    await expect(scaffold({ dir, template: 'echo' })).rejects.toThrow(/not empty/i)
    expect(await tree(dir)).toEqual(['keep.txt'])
  })

  it('rejects an unknown template and names the valid ones', async () => {
    const dir = join(await tmp(), 'app')

    await expect(scaffold({ dir, template: 'nope' })).rejects.toThrow(
      /unknown template.*echo.*webhook-poster.*slash-receiver/is,
    )
    await expect(readdir(dir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a --name that npm would not accept', async () => {
    const dir = join(await tmp(), 'app')

    await expect(scaffold({ dir, template: 'echo', name: 'Not A Name' })).rejects.toThrow(
      /not a valid npm package name/i,
    )
  })
})
