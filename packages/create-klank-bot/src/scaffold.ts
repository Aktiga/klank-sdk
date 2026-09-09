import type { Dirent } from 'node:fs'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface TemplateInfo {
  name: string
  description: string
}

/** Offered in prompt order; the first entry is the non-interactive default. */
export const TEMPLATES = [
  {
    name: 'echo',
    description: 'Long-running bot: WebSocket events, echoes every message back to its channel',
  },
  {
    name: 'webhook-poster',
    description: 'Post into one channel through an incoming webhook (works on today’s server)',
  },
  {
    name: 'slash-receiver',
    description: 'HTTP endpoint that verifies a slash command signature and answers it',
  },
] as const satisfies readonly TemplateInfo[]

export type TemplateName = (typeof TEMPLATES)[number]['name']

export const DEFAULT_TEMPLATE: TemplateName = 'echo'

export function isTemplateName(value: string): value is TemplateName {
  return TEMPLATES.some((template) => template.name === value)
}

/** Files whose `__NAME__` placeholders are replaced with the project name. */
const NAMED_FILES = ['package.json', 'README.md']

// https://docs.npmjs.com/cli/configuring-npm/package-json#name
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

/** Turn a directory basename into a name npm will accept, e.g. `My Bot!` → `my-bot`. */
export function toPackageName(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 214)
  return slug === '' ? 'klank-bot' : slug
}

export interface ScaffoldOptions {
  /** Target directory. Must be empty or absent. */
  dir: string
  template: string
  /** Package name. Defaults to an npm-safe form of the directory basename. */
  name?: string
}

export interface ScaffoldResult {
  /** Absolute target directory. */
  dir: string
  template: TemplateName
  name: string
  /** Files written, relative to `dir`, `/`-separated, sorted. */
  files: string[]
}

/** Copy a template into `dir` and fill in its project name. */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const { template } = options
  if (!isTemplateName(template)) {
    const known = TEMPLATES.map((entry) => entry.name).join(', ')
    throw new Error(`Unknown template '${template}'. Available templates: ${known}`)
  }

  const dir = resolve(options.dir)
  const name = options.name ?? toPackageName(basename(dir))
  if (!NPM_NAME.test(name)) {
    throw new Error(`'${name}' is not a valid npm package name`)
  }
  const existing = await listFiles(dir)
  if (existing.length > 0) {
    throw new Error(`Target directory ${dir} is not empty`)
  }

  await mkdir(dir, { recursive: true })
  // `templates/` sits next to `src/` in the repo and next to `dist/` in the package.
  const templates = fileURLToPath(new URL('../templates', import.meta.url))
  await cp(join(templates, template), dir, { recursive: true })
  for (const file of NAMED_FILES) {
    const path = join(dir, file)
    const contents = await readFile(path, 'utf8')
    await writeFile(path, contents.replaceAll('__NAME__', name))
  }

  return { dir, template, name, files: (await listFiles(dir)).sort() }
}

/**
 * Files under `root`, relative and `/`-separated; empty for a missing directory.
 * Walks explicitly rather than using `readdir`'s recursive Dirent fields, which
 * differ across the Node 20 patch range this package supports.
 */
async function listFiles(root: string, prefix = ''): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const files: string[] = []
  for (const entry of entries) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)))
    else files.push(path)
  }
  return files
}
