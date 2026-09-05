/**
 * CI bot — posts build notifications through an incoming webhook and answers
 * slash commands in the channel.
 *
 * The webhook half works today. The slash command half is pending server
 * support: Klank 53d464a never emits `command.invoked` over the WebSocket, so
 * `bot.command()` handlers do not fire — and its HTTP dispatch path has no
 * caller either, so an HTTP receiver would also sit idle. Details in
 * docs/server-requirements.md.
 *
 * Usage:
 *   SERVER_URL=http://localhost:3000 BOT_TOKEN=bot_xxx \
 *   WEBHOOK_ID=uuid WEBHOOK_SECRET=secret npx tsx index.ts
 */
import { KlankBot, WebhookBot } from '@klank/sdk'

const serverUrl = process.env.SERVER_URL ?? 'http://localhost:3000'
const webhookId = process.env.WEBHOOK_ID
const webhookSecret = process.env.WEBHOOK_SECRET
const botToken = process.env.BOT_TOKEN
if (!webhookId) throw new Error('WEBHOOK_ID is required')
if (!webhookSecret) throw new Error('WEBHOOK_SECRET is required')
if (!botToken) throw new Error('BOT_TOKEN is required')

// Posts build results. No WebSocket needed for this direction.
const webhook = new WebhookBot({ serverUrl, webhookId, webhookSecret })

const bot = new KlankBot({
  token: botToken,
  serverUrl,
  // The server stamps webhook posts with `sender_id = webhookId`, so listing
  // the id here keeps this bot from reacting to its own build notifications.
  webhookIds: [webhookId],
  handleSignals: true,
})

let lastBuild = { number: 0, status: 'unknown', timestamp: 'never' }

// Ephemeral responses are not implemented server-side and throw
// `UnsupportedError`; everything a bot answers is visible in the channel.
bot.command('/status', async (_cmd, ctx) => {
  await ctx.respond({
    responseType: 'in_channel',
    text: `Last build: #${lastBuild.number} — ${lastBuild.status} (${lastBuild.timestamp})`,
  })
})

bot.command('/deploy', async (cmd, ctx) => {
  const target = cmd.text.trim() || 'production'
  await ctx.respond({ responseType: 'in_channel', text: `🚀 Deploying to ${target}...` })
})

bot.onError((err, event) => {
  console.error(`[ci-bot] ${event?.type ?? 'connection'}:`, err.message)
})

/** Call from the CI pipeline. */
export async function notifyBuild(number: number, status: 'pass' | 'fail') {
  lastBuild = { number, status, timestamp: new Date().toISOString() }
  await webhook.send(`Build #${number} ${status} ${status === 'pass' ? '✅' : '❌'}`, {
    username: 'CI',
  })
}

await bot.start()
console.log('ci bot connected')
