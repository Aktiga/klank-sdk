import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import {
  DEFAULT_TEMPLATE,
  TEMPLATES,
  type TemplateName,
  isTemplateName,
  scaffold,
} from './scaffold.js'

const NAMES = TEMPLATES.map((template) => template.name).join(' | ')

const USAGE = `Usage: create-klank-bot <dir> [options]

Options:
  --template <name>  ${NAMES} (default: ${DEFAULT_TEMPLATE})
  --name <pkg-name>  package name for the new project (default: from <dir>)
  --yes              take the defaults instead of prompting
  --help             print this message

Templates:
${TEMPLATES.map((template) => `  ${template.name.padEnd(15)} ${template.description}`).join('\n')}`

/** Thrown for anything the user should fix by re-reading the usage text. */
class UsageError extends Error {}

interface CliArgs {
  dir: string | undefined
  template: string | undefined
  name: string | undefined
  yes: boolean
  help: boolean
}

/** Parse argv, reporting every malformed invocation as a `UsageError`. */
function parseCli(argv: string[]): CliArgs {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        template: { type: 'string' },
        name: { type: 'string' },
        yes: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: true,
    })
    const [dir, ...rest] = positionals
    if (rest.length > 0) throw new UsageError(`Unexpected argument '${rest[0]}'`)
    return { dir, template: values.template, name: values.name, yes: values.yes, help: values.help }
  } catch (err) {
    if (err instanceof UsageError) throw err
    throw new UsageError(err instanceof Error ? err.message : String(err))
  }
}

/** Ask which template to scaffold. Non-interactive callers get the default. */
async function chooseTemplate(yes: boolean): Promise<TemplateName> {
  if (yes || process.stdin.isTTY !== true) return DEFAULT_TEMPLATE

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log('Which template?')
    for (const [index, template] of TEMPLATES.entries()) {
      console.log(`  ${index + 1}) ${template.name} — ${template.description}`)
    }
    const answer = (
      await rl.question(`Template [1-${TEMPLATES.length}] (${DEFAULT_TEMPLATE}): `)
    ).trim()
    if (answer === '') return DEFAULT_TEMPLATE
    const picked = TEMPLATES[Number(answer) - 1]
    if (picked !== undefined) return picked.name
    if (isTemplateName(answer)) return answer
    throw new UsageError(`'${answer}' is not one of the templates`)
  } finally {
    rl.close()
  }
}

async function main(argv: string[]): Promise<number> {
  try {
    const args = parseCli(argv)
    // Before the missing-directory check: `--help` alone must succeed.
    if (args.help) {
      console.log(USAGE)
      return 0
    }
    if (args.dir === undefined) throw new UsageError('Missing target directory')

    const template = args.template ?? (await chooseTemplate(args.yes))
    const result = await scaffold({ dir: args.dir, template, name: args.name })
    console.log(`
Created ${result.name} (${result.template}) in ${result.dir}

Next steps:
  cd ${args.dir}
  cp .env.example .env    # fill in the values it lists
  npm install
  npm start

The project README explains how to register it on your Klank server.`)
    return 0
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    console.error(err instanceof UsageError ? `${text}\n\n${USAGE}` : text)
    return 1
  }
}

process.exit(await main(process.argv.slice(2)))
