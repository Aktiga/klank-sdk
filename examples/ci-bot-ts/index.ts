/**
 * CI bot — posts build notifications through an incoming webhook and answers
 * slash commands in the channel.
 *
 * Needs a Klank server with the bot-model work (bot channel membership and
 * slash commands; see docs/server-requirements.md). Register `/status` and
 * `/deploy` with `POST /api/v1/workspaces/{wid}/slash-commands` pointing at this
 * bot's id; while the bot is connected, invocations arrive as `command.invoked`.
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
