import { pathToFileURL } from 'node:url'
import { type BotConfig, KlankBot } from '@klank/sdk'

/**
 * A bot that replies `echo: <text>` to every message it can read. Encrypted
 * messages arrive as ciphertext a bot holds no keys for, so they are skipped.
 */
export function createBot(config: BotConfig): KlankBot {
  const bot = new KlankBot(config)

  bot.on('message.new', async (event, ctx) => {
    const text = event.plaintext
    if (text === null || text === '') return
    await ctx.say(`echo: ${text}`)
  })

  bot.onError((err, event) => {
    console.error('[echo]', event?.type ?? 'connection', err.message)
  })

  return bot
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`)
  }
  return value
}

const entry = process.argv[1]
const invokedDirectly = entry !== undefined && import.meta.url === pathToFileURL(entry).href

if (invokedDirectly) {
  const bot = createBot({
    token: requiredEnv('BOT_TOKEN'),
    serverUrl: requiredEnv('SERVER_URL'),
  })
  process.on('SIGTERM', () => bot.stop())
  process.on('SIGINT', () => bot.stop())

  await bot.start()
  console.log(`echo bot connected as ${bot.getBotInfo()?.name ?? 'unknown'}`)
}
