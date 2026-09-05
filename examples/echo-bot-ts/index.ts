/**
 * Echo bot — WebSocket events, `ctx` helpers, middleware, error handling.
 *
 * Pending server support: on Klank 53d464a a bot token authenticates and the
 * socket connects, but bots have no channel membership, so no events arrive
 * and the message routes reject bot tokens. See docs/server-requirements.md.
 *
 * Usage:
 *   SERVER_URL=http://localhost:3000 BOT_TOKEN=bot_xxx npx tsx index.ts
 */
import { KlankBot } from '@klank/sdk'

const token = process.env.BOT_TOKEN
if (!token) throw new Error('BOT_TOKEN is required')

const bot = new KlankBot({
  token,
  serverUrl: process.env.SERVER_URL ?? 'http://localhost:3000',
})

// Runs before every handler.
bot.use(async (event, _ctx, next) => {
  const start = Date.now()
  await next()
  console.log(`${event.type} handled in ${Date.now() - start}ms`)
})

// Encrypted messages arrive as ciphertext a bot cannot read; only plaintext
// (user messages in non-E2EE channels, and other bots) is echoable.
bot.on('message.new', async (event, ctx) => {
  if (event.plaintext) await ctx.say(`Echo: ${event.plaintext}`)
})

// String patterns are compiled as unanchored regular expressions.
bot.message(/\bhello\b/i, async (_event, ctx) => {
  await ctx.react('👋')
})

// This socket fell behind the broadcast: anything cached is stale.
bot.on('events.missed', (event) => {
  console.warn(`missed ${event.count} events — re-fetch state over REST`)
})

bot.onError((err, event) => {
  console.error(`[bot] ${event?.type ?? 'connection'}:`, err.message)
})

process.on('SIGTERM', () => bot.stop())
process.on('SIGINT', () => bot.stop())

await bot.start()
console.log('echo bot connected')
